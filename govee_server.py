#!/usr/bin/env python3
r"""
Local server with history logging, sparklines, and Optimized Open-Meteo Almanac.
"""

import os, csv, json, time, sys, threading
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Flask, jsonify, send_from_directory, Response, request
import requests
import anthropic

# ---------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------
BASE_URL = "https://openapi.api.govee.com/router/api/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, "govee_readings.csv")
ALMANAC_CACHE_FILE = os.path.join(HERE, "almanac_cache.json")
INSIGHTS_CACHE_FILE = os.path.join(HERE, "insights_cache.json")
INSIGHTS_CACHE_HOURS = 24  # Cache for 24 hours so insights refresh daily
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
READINGS_REFRESH_SECONDS = 45
READINGS_STALE_SECONDS = 300
_readings_cache = None
_readings_cache_time = 0.0
_readings_last_success_time = 0.0
_readings_last_error = None
_readings_refreshing = False
_readings_lock = threading.Lock()

# ---------------------------------------------------------------------
# FLASK APP
# ---------------------------------------------------------------------
app = Flask(__name__, static_folder='.', static_url_path='')

@app.route("/")
def serve_index() -> Response:
    return send_from_directory(".", "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(".", filename)

# ---------------------------------------------------------------------
# LOGGING HELPER
# ---------------------------------------------------------------------
def log(msg):
    print(f"[SERVER] {msg}", file=sys.stdout)
    sys.stdout.flush()

# ---------------------------------------------------------------------
# GOVEE HELPERS
# ---------------------------------------------------------------------
def get_headers() -> Dict[str, str]:
    api_key = os.environ.get("GOVEE_API_KEY")
    if not api_key:
        log("WARNING: GOVEE_API_KEY not set.")
        return {}
    return {"Content-Type": "application/json", "Govee-API-Key": api_key}

def fetch_devices() -> List[Dict[str, Any]]:
    try:
        r = requests.get(f"{BASE_URL}/user/devices", headers=get_headers(), timeout=30)
        r.raise_for_status()
        return r.json().get("data", [])
    except Exception as e:
        log(f"Error fetching devices: {e}")
        return []

def get_state(sku: str, device: str) -> Dict[str, Any]:
    payload = {"requestId": "local-dashboard", "payload": {"sku": sku, "device": device}}
    try:
        r = requests.post(f"{BASE_URL}/device/state", headers=get_headers(), json=payload, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log(f"Error getting state for {device}: {e}")
        return {}

# ---------------------------------------------------------------------
# NORMALIZATION
# ---------------------------------------------------------------------
def normalize_temp_f_from_raw(raw):
    if raw is None: return None
    try:
        v = float(raw)
    except: return None
    # H5110 sensorTemperature values from the Govee router API are already
    # Fahrenheit for this account. Only de-scale large integer-style payloads.
    if v > 2000: v = v / 100.0
    elif v > 200: v = v / 10.0
    return round(v, 2)

def f_to_c(temp_f):
    if temp_f is None: return None
    return round((temp_f - 32) * 5.0 / 9.0, 2)

def c_to_f(temp_c):
    if temp_c is None: return None
    return round((temp_c * 9.0 / 5.0) + 32, 2)

def normalize_humidity(raw):
    if raw is None: return None
    try:
        v = float(raw)
    except: return None
    if v > 100: v = v / 10.0 if v <= 1000 else v / 100.0
    v = max(0, min(v, 100))
    return round(v, 1)

def parse_insights_response(response_text):
    text = (response_text or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(text[start:end + 1])

    if not isinstance(parsed, list):
        return [str(parsed)]
    return [str(item) for item in parsed if item]

# ---------------------------------------------------------------------
# HISTORY LOGGING
# ---------------------------------------------------------------------
def _collect_sensor_devices(devices):
    sensors = []
    for d in devices:
        caps = d.get("capabilities") or []
        inst = {c.get("instance") for c in caps if isinstance(c, dict)}
        if "sensorTemperature" in inst or "sensorHumidity" in inst:
            sensors.append({
                "sku": d.get("sku"),
                "device": d.get("device"),
                "name": d.get("deviceName") or "Unknown"
            })
    return sensors

def _append_log_row(ts, name, device, temp_c, humidity):
    header_needed = not os.path.exists(LOG_PATH) or os.path.getsize(LOG_PATH) == 0
    try:
        with open(LOG_PATH, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if header_needed:
                w.writerow(["timestamp","name","device","temp_c","humidity"])
            w.writerow([ts, name, device, temp_c if temp_c is not None else "", humidity if humidity is not None else ""])
    except Exception as e:
        log(f"Error writing log: {e}")

def _read_history(limit_per_device: int = 100):
    if not os.path.exists(LOG_PATH):
        return {}
    out = {}
    try:
        with open(LOG_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            recent_rows = deque(reader, maxlen=4000) 

        for row in recent_rows:
            dev = row.get("device")
            if not dev: continue
            try:
                t = float(row["temp_c"]) if row["temp_c"] else None
                h = float(row["humidity"]) if row["humidity"] else None
            except:
                t = None; h = None

            out.setdefault(dev, []).append({
                "timestamp": row["timestamp"],
                "temp_c": t,
                "humidity": h
            })
        for k in out:
            out[k] = out[k][-limit_per_device:]
    except Exception as e:
        log(f"History read error: {e}")
        return {}
    return out

def _iso_from_timestamp(ts):
    if not ts:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).astimezone().isoformat(timespec="seconds")

def _latest_readings_from_log():
    if not os.path.exists(LOG_PATH):
        return None

    latest = {}
    try:
        with open(LOG_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                dev = row.get("device")
                if not dev:
                    continue
                try:
                    temp_c = float(row["temp_c"]) if row.get("temp_c") else None
                    humidity = float(row["humidity"]) if row.get("humidity") else None
                except Exception:
                    temp_c = None
                    humidity = None

                latest[dev] = {
                    "name": row.get("name") or "Unknown",
                    "sku": None,
                    "device": dev,
                    "temp_c": temp_c,
                    "temp_f": c_to_f(temp_c),
                    "humidity": humidity,
                    "battery": None,
                    "timestamp": row.get("timestamp")
                }
    except Exception as e:
        log(f"Latest readings cache read error: {e}")
        return None

    if not latest:
        return None
    return {
        "items": list(latest.values()),
        "note": "Showing last logged readings while refreshing",
        "source": "log"
    }

# ---------------------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------------------
def _fetch_sensor_data(sensor, ts):
    """Fetch data for a single sensor (used for parallel execution)"""
    try:
        st = get_state(sensor["sku"], sensor["device"])
        caps = st.get("payload", {}).get("capabilities", [])

        raw_temp = None
        raw_hum = None
        for c in caps:
            inst = c.get("instance")
            val = None
            st_dict = c.get("state")
            if isinstance(st_dict, dict) and "value" in st_dict:
                val = st_dict["value"]
            elif "value" in c:
                val = c["value"]
            if inst == "sensorTemperature": raw_temp = val
            if inst == "sensorHumidity": raw_hum = val

        temp_f = normalize_temp_f_from_raw(raw_temp)
        temp_c = f_to_c(temp_f)
        humidity = normalize_humidity(raw_hum)

        # Debug logging for blank temps
        if temp_f is None and raw_temp is not None:
            log(f"WARNING: {sensor['name']} - Temperature normalization failed. Raw value: {raw_temp}")

        item = {
            "name": sensor["name"],
            "sku": sensor["sku"],
            "device": sensor["device"],
            "temp_c": temp_c,
            "temp_f": temp_f,
            "humidity": humidity,
            "battery": next((c["state"]["value"] for c in caps if c.get("instance")=="battery" and "state" in c), None),
            "timestamp": ts
        }
        _append_log_row(ts, sensor["name"], sensor["device"], temp_c, humidity)
        return item, None
    except Exception as e:
        log(f"ERROR fetching {sensor['name']}: {e}")
        return None, f"{sensor['name']}: {e}"

def _poll_readings_live():
    import time as time_module
    start_time = time_module.time()

    try:
        devices = fetch_devices()
    except Exception as e:
        log(f"ERROR: Failed to fetch devices: {e}")
        return {"items": [], "error": str(e)}, 500

    sensors = _collect_sensor_devices(devices)
    log(f"Found {len(sensors)} sensors to poll")

    ts = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    items = []
    errs = []

    # Parallel API calls for much faster response
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_fetch_sensor_data, s, ts): s for s in sensors}

        for future in as_completed(futures):
            item, error = future.result()
            if item:
                items.append(item)
            if error:
                errs.append(error)

    elapsed = time_module.time() - start_time
    log(f"API /api/readings completed in {elapsed:.2f}s - {len(items)} sensors, {len(errs)} errors")

    if len(items) == 0 and len(errs) > 0:
        log(f"WARNING: All sensors failed! Errors: {errs}")
        return {"items": [], "error": "All sensors failed", "note": "; ".join(errs[:3])}, 500

    return {"items": items, "note": (" | ".join(errs) if errs else "")}, 200

def _store_readings_cache(payload):
    global _readings_cache, _readings_cache_time, _readings_last_success_time, _readings_last_error
    now_ts = time.time()
    payload = dict(payload)
    payload["source"] = "live"
    payload["last_live_at"] = _iso_from_timestamp(now_ts)
    with _readings_lock:
        _readings_cache = payload
        _readings_cache_time = now_ts
        _readings_last_success_time = now_ts
        _readings_last_error = None

def _refresh_readings_cache():
    global _readings_refreshing, _readings_last_error
    try:
        payload, status = _poll_readings_live()
        if status == 200 and payload.get("items"):
            _store_readings_cache(payload)
        elif status != 200:
            with _readings_lock:
                _readings_last_error = payload.get("error") or payload.get("note") or f"HTTP {status}"
    finally:
        with _readings_lock:
            _readings_refreshing = False

def _start_readings_refresh():
    global _readings_refreshing
    with _readings_lock:
        if _readings_refreshing:
            return
        _readings_refreshing = True
    threading.Thread(target=_refresh_readings_cache, daemon=True).start()

def _cached_readings_payload():
    now_ts = time.time()
    with _readings_lock:
        cache = _readings_cache
        age = now_ts - _readings_cache_time if cache else None
        refreshing = _readings_refreshing
        last_success = _readings_last_success_time
        last_error = _readings_last_error

    if cache:
        payload = dict(cache)
        payload["refreshing"] = refreshing
        payload["last_live_age_seconds"] = round(now_ts - last_success, 1) if last_success else None
        payload["last_error"] = last_error
        return payload, age

    payload = _latest_readings_from_log()
    if payload:
        payload["refreshing"] = refreshing
        payload["last_live_age_seconds"] = None
        payload["last_error"] = last_error
        return payload, READINGS_REFRESH_SECONDS
    return None, None

def _background_readings_loop():
    time.sleep(2)
    while True:
        _start_readings_refresh()
        time.sleep(READINGS_REFRESH_SECONDS)

@app.get("/api/readings")
def api_readings():
    force_refresh = request.args.get("refresh") == "1"
    cached, age = _cached_readings_payload()

    if not force_refresh and cached and age is not None:
        if age < READINGS_REFRESH_SECONDS:
            cached["cached"] = True
            cached["age_seconds"] = round(age, 1)
            return jsonify(cached)

        if age < READINGS_STALE_SECONDS:
            _start_readings_refresh()
            cached["cached"] = True
            cached["refreshing"] = True
            cached["age_seconds"] = round(age, 1)
            return jsonify(cached)

    payload, status = _poll_readings_live()
    if status == 200 and payload.get("items"):
        _store_readings_cache(payload)
    return (jsonify(payload), status) if status != 200 else jsonify(payload)

@app.get("/api/status")
def api_status():
    now_ts = time.time()
    with _readings_lock:
        cache_age = now_ts - _readings_cache_time if _readings_cache else None
        live_age = now_ts - _readings_last_success_time if _readings_last_success_time else None
        refreshing = _readings_refreshing
        last_error = _readings_last_error

    insights_cached = False
    insights_timestamp = None
    if os.path.exists(INSIGHTS_CACHE_FILE):
        try:
            with open(INSIGHTS_CACHE_FILE, "r", encoding="utf-8") as f:
                cache = json.load(f)
            insights_cached = bool(cache.get("insights"))
            insights_timestamp = cache.get("timestamp")
        except Exception:
            pass

    return jsonify({
        "govee": {
            "cached": _readings_cache is not None,
            "cache_age_seconds": round(cache_age, 1) if cache_age is not None else None,
            "last_live_at": _iso_from_timestamp(_readings_last_success_time),
            "last_live_age_seconds": round(live_age, 1) if live_age is not None else None,
            "refreshing": refreshing,
            "last_error": last_error,
            "refresh_interval_seconds": READINGS_REFRESH_SECONDS
        },
        "ai": {
            "anthropic_model": ANTHROPIC_MODEL,
            "insights_cached": insights_cached,
            "insights_timestamp": insights_timestamp
        }
    })

@app.get("/api/history")
def api_history():
    return jsonify({"series": _read_history(limit_per_device=200)})

@app.get("/api/almanac")
def api_almanac():
    # 1. Check Cache
    now = datetime.now()
    today_key = now.strftime("%Y-%m-%d")

    cache = {}
    if os.path.exists(ALMANAC_CACHE_FILE):
        try:
            with open(ALMANAC_CACHE_FILE, 'r') as f:
                cache = json.load(f)
        except Exception as e:
            log(f"Cache read error: {e}")

    if cache.get("date") == today_key and cache.get("payload"):
        log("Returning cached almanac data")
        return jsonify(cache["payload"])

    log("Fetching Almanac History (Optimized)...")

    lat, lon = 36.17, -115.14
    start_year = now.year - 10
    end_year = now.year - 1

    # --- OPTIMIZED FETCH ---
    # Instead of 10 requests, we do 1 request for the full date range
    # and filter in Python. This is 10x faster.
    s_date = f"{start_year}-01-01"
    e_date = f"{end_year}-12-31"

    url = f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={s_date}&end_date={e_date}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto"

    history_items = []
    hist_highs = []
    hist_lows = []

    try:
        log(f"Requesting almanac data from Open-Meteo Archive API...")
        r = requests.get(url, timeout=20) # Increased timeout for reliability

        if r.status_code == 200:
            js = r.json()
            daily = js.get("daily", {})
            dates = daily.get("time", [])
            tmax = daily.get("temperature_2m_max", [])
            tmin = daily.get("temperature_2m_min", [])

            log(f"Received {len(dates)} days of data from archive API")

            # Target string to match (e.g., "12-07")
            target_md = now.strftime("%m-%d")

            for i, d_str in enumerate(dates):
                # d_str format is YYYY-MM-DD
                if d_str.endswith(target_md):
                    h = tmax[i]
                    l = tmin[i]

                    if h is not None and l is not None:
                        year = int(d_str.split("-")[0])
                        hist_highs.append(h)
                        hist_lows.append(l)
                        history_items.append({"year": year, "high": h, "low": l})

            log(f"Found {len(history_items)} historical records for {target_md}")
        else:
            log(f"Open-Meteo Archive API Error: HTTP {r.status_code} - {r.text[:200]}")

    except requests.exceptions.Timeout:
        log(f"Almanac Fetch Timeout: Request took longer than 20 seconds")
        return jsonify({"error": "API timeout"}), 504
    except requests.exceptions.RequestException as e:
        log(f"Almanac Network Error: {e}")
        return jsonify({"error": "Network error"}), 503
    except Exception as e:
        log(f"Almanac Unexpected Error: {e}")
        return jsonify({"error": "Server error"}), 500

    if not history_items:
        log("No historical data found - returning error")
        return jsonify({"error": "No historical data available"}), 503

    avg_high = sum(hist_highs) / len(hist_highs)
    avg_low = sum(hist_lows) / len(hist_lows)

    history_items.sort(key=lambda x: x["year"], reverse=True)

    payload = {
        "avg_high": round(avg_high, 1),
        "avg_low": round(avg_low, 1),
        "history": history_items[:10] # Ensure we only send relevant years
    }

    try:
        with open(ALMANAC_CACHE_FILE, 'w') as f:
            json.dump({"date": today_key, "payload": payload}, f)
        log(f"Cached almanac data for {today_key}")
    except Exception as e:
        log(f"Cache write error: {e}")

    log(f"Returning almanac data: avg_high={payload['avg_high']}°F, avg_low={payload['avg_low']}°F")
    return jsonify(payload)

@app.get("/api/almanac/insights")
def api_almanac_insights():
    """Generate AI insights using Claude based on almanac, weather, and sensor data."""

    # 1. Check Cache (unless force refresh requested)
    now = datetime.now()
    cache = {}
    force_refresh = request.args.get('refresh') == '1'

    if not force_refresh and os.path.exists(INSIGHTS_CACHE_FILE):
        try:
            with open(INSIGHTS_CACHE_FILE, 'r') as f:
                cache = json.load(f)

            cache_time = datetime.fromisoformat(cache.get("timestamp", "2000-01-01T00:00:00"))
            age_hours = (now - cache_time).total_seconds() / 3600

            # Invalidate cache if date has changed (new day) OR if older than 24 hours
            cache_date = cache_time.date()
            current_date = now.date()
            is_same_day = cache_date == current_date

            if is_same_day and age_hours < INSIGHTS_CACHE_HOURS:
                log("Using cached insights")
                return jsonify({
                    "insights": cache.get("insights", []),
                    "cached": True,
                    "timestamp": cache.get("timestamp")
                })
            else:
                if not is_same_day:
                    log(f"Cache is from {cache_date}, today is {current_date} - regenerating insights")
                else:
                    log(f"Cache is {age_hours:.1f} hours old - regenerating insights")
        except Exception as e:
            log(f"Insights cache read error: {e}")

    # 2. Check for API Key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY not set"}), 500

    log("Generating fresh AI insights...")

    # 3. Gather Context Data
    try:
        # Get almanac data
        almanac_response = api_almanac()
        almanac_data = almanac_response.get_json() if hasattr(almanac_response, 'get_json') else {}

        # Get current weather from Open-Meteo
        lat, lon = 36.17, -115.14
        weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,weathercode&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&forecast_days=3&timezone=auto"
        weather_data = requests.get(weather_url, timeout=10).json()

        # Get sensor readings
        readings_response = api_readings()
        sensor_data = readings_response.get_json() if hasattr(readings_response, 'get_json') else {"items": []}

    except Exception as e:
        log(f"Error gathering context: {e}")
        return jsonify({"error": "Failed to gather context data"}), 500

    # 4. Build Prompt
    current_temp = weather_data.get("current", {}).get("temperature_2m", "N/A")
    current_humidity = weather_data.get("current", {}).get("relative_humidity_2m", "N/A")

    today_high = weather_data.get("daily", {}).get("temperature_2m_max", [None])[0]
    today_low = weather_data.get("daily", {}).get("temperature_2m_min", [None])[0]

    avg_high = almanac_data.get("avg_high", "N/A")
    avg_low = almanac_data.get("avg_low", "N/A")
    history = almanac_data.get("history", [])

    # Indoor sensor summary - Filter out outdoor sensors
    OUTDOOR_KEYWORDS = ['backyard', 'outdoor', 'outside', 'patio', 'porch', 'deck', 'garage', 'yard', 'garden', 'shed']

    indoor_temps_f = []
    indoor_humidities = []

    for s in sensor_data.get("items", []):
        sensor_name = (s.get("name") or "").lower()

        # Skip outdoor sensors
        is_outdoor = any(keyword in sensor_name for keyword in OUTDOOR_KEYWORDS)
        if is_outdoor:
            continue

        temp_c = s.get("temp_c")
        if temp_c is not None:
            # Fix glitch: if temp_c is in range 40-120, it's actually Fahrenheit
            if 40 < temp_c < 120:
                indoor_temps_f.append(temp_c)  # Already in Fahrenheit
            else:
                indoor_temps_f.append((temp_c * 9/5) + 32)  # Convert to Fahrenheit

        humidity = s.get("humidity")
        if humidity is not None:
            indoor_humidities.append(humidity)

    avg_indoor_f = sum(indoor_temps_f) / len(indoor_temps_f) if indoor_temps_f else None
    avg_indoor_humidity = sum(indoor_humidities) / len(indoor_humidities) if indoor_humidities else None

    date_str = now.strftime("%B %d, %Y")

    # Format indoor sensor data for prompt (handle None values)
    indoor_temp_str = f"{avg_indoor_f:.1f}°F" if avg_indoor_f is not None else "N/A"
    indoor_humidity_str = f"{avg_indoor_humidity:.0f}%" if avg_indoor_humidity is not None else "N/A"

    prompt = f"""You are analyzing weather and environmental data for {date_str}.

OUTDOOR WEATHER:
- Current: {current_temp}°F, {current_humidity}% humidity
- Today's forecast: High {today_high}°F, Low {today_low}°F

HISTORICAL DATA (10-year average for this date):
- Average High: {avg_high}°F
- Average Low: {avg_low}°F
- Recent years: {history[:5]}

INDOOR SENSORS:
- Average indoor temp: {indoor_temp_str} ({len(indoor_temps_f)} sensors)
- Average indoor humidity: {indoor_humidity_str}
- Sensor count: {len(sensor_data.get("items", []))}

Generate 3-4 concise, actionable insights as a JSON array. Each insight should be a brief sentence (max 120 characters) highlighting interesting patterns, comparisons, or recommendations.

Focus on:
1. How today compares to historical averages
2. Indoor vs outdoor conditions
3. Comfort recommendations or notable trends
4. Seasonal context

Return ONLY a JSON array of strings, like:
["Insight 1 here", "Insight 2 here", "Insight 3 here"]"""

    # 5. Call Claude API
    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=500,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        response_text = message.content[0].text

        insights = parse_insights_response(response_text)

    except json.JSONDecodeError as e:
        log(f"JSON parse error: {e}")
        insights = ["Unable to generate insights at this time."]
    except Exception as e:
        log(f"Claude API error: {e}")
        return jsonify({"error": f"AI generation failed: {str(e)}"}), 500

    # 6. Cache the results
    try:
        with open(INSIGHTS_CACHE_FILE, 'w') as f:
            json.dump({
                "timestamp": now.isoformat(),
                "insights": insights
            }, f)
    except Exception as e:
        log(f"Failed to cache insights: {e}")

    log(f"Generated {len(insights)} insights")
    return jsonify({
        "insights": insights,
        "cached": False,
        "timestamp": now.isoformat()
    })

# ---------------------------------------------------------------------
# RUN SERVER
# ---------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    log(f"Starting server on port {port}...")
    threading.Thread(target=_background_readings_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=port, debug=False)
