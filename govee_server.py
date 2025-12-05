#!/usr/bin/env python3
r"""
Local server with history logging, sparklines, and Optimized Open-Meteo Almanac.
"""

import os, csv, json, time, sys
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
from collections import deque

from flask import Flask, jsonify, send_from_directory, Response
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
INSIGHTS_CACHE_HOURS = 6

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
        r = requests.get(f"{BASE_URL}/user/devices", headers=get_headers(), timeout=10)
        r.raise_for_status()
        return r.json().get("data", [])
    except Exception as e:
        log(f"Error fetching devices: {e}")
        return []

def get_state(sku: str, device: str) -> Dict[str, Any]:
    payload = {"requestId": "local-dashboard", "payload": {"sku": sku, "device": device}}
    try:
        r = requests.post(f"{BASE_URL}/device/state", headers=get_headers(), json=payload, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log(f"Error getting state for {device}: {e}")
        return {}

# ---------------------------------------------------------------------
# NORMALIZATION
# ---------------------------------------------------------------------
def normalize_temp_c_from_raw(raw):
    if raw is None: return None
    try:
        v = float(raw)
    except: return None
    if v > 1000: return round(v / 100.0, 2)
    if v > 100: return round(v / 10.0, 2)
    return round(v, 2)

def normalize_humidity(raw):
    if raw is None: return None
    try:
        v = float(raw)
    except: return None
    if v > 100: v = v / 10.0 if v <= 1000 else v / 100.0
    v = max(0, min(v, 100))
    return round(v, 1)

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

# ---------------------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------------------
@app.get("/api/readings")
def api_readings():
    try:
        devices = fetch_devices()
    except Exception as e:
        return jsonify({"items": [], "error": str(e)}), 500

    sensors = _collect_sensor_devices(devices)
    ts = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    items = []
    errs = []

    for s in sensors:
        try:
            st = get_state(s["sku"], s["device"])
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

            temp_c = normalize_temp_c_from_raw(raw_temp)
            humidity = normalize_humidity(raw_hum)

            items.append({
                "name": s["name"],
                "sku": s["sku"],
                "device": s["device"],
                "temp_c": temp_c,
                "temp_f": None, 
                "humidity": humidity,
                "battery": next((c["state"]["value"] for c in caps if c.get("instance")=="battery" and "state" in c), None),
                "timestamp": ts
            })
            _append_log_row(ts, s["name"], s["device"], temp_c, humidity)
        except Exception as e:
            errs.append(f"{s['name']}: {e}")

    return jsonify({"items": items, "note": (" | ".join(errs) if errs else "")})

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
    
    if cache.get("date") == today_key:
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
        r = requests.get(url, timeout=15) # Generous timeout for the big data payload
        if r.status_code == 200:
            js = r.json()
            daily = js.get("daily", {})
            dates = daily.get("time", [])
            tmax = daily.get("temperature_2m_max", [])
            tmin = daily.get("temperature_2m_min", [])
            
            # Target string to match (e.g., "11-21")
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
        else:
            log(f"Open-Meteo Error: {r.status_code}")
            
    except Exception as e:
        log(f"Almanac Fetch Error: {e}")

    if not history_items:
        return jsonify({"error": "No data"}), 500
        
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
    except: pass

    return jsonify(payload)

@app.get("/api/almanac/insights")
def api_almanac_insights():
    """Generate AI insights using Claude based on almanac, weather, and sensor data."""

    # 1. Check Cache
    now = datetime.now()
    cache = {}

    if os.path.exists(INSIGHTS_CACHE_FILE):
        try:
            with open(INSIGHTS_CACHE_FILE, 'r') as f:
                cache = json.load(f)

            cache_time = datetime.fromisoformat(cache.get("timestamp", "2000-01-01T00:00:00"))
            age_hours = (now - cache_time).total_seconds() / 3600

            if age_hours < INSIGHTS_CACHE_HOURS:
                log("Using cached insights")
                return jsonify({"insights": cache.get("insights", []), "cached": True})
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

    # Indoor sensor summary
    indoor_temps = [s.get("temp_c") for s in sensor_data.get("items", []) if s.get("temp_c")]
    indoor_humidities = [s.get("humidity") for s in sensor_data.get("items", []) if s.get("humidity")]

    avg_indoor_c = sum(indoor_temps) / len(indoor_temps) if indoor_temps else None
    avg_indoor_f = (avg_indoor_c * 9/5) + 32 if avg_indoor_c else None
    avg_indoor_humidity = sum(indoor_humidities) / len(indoor_humidities) if indoor_humidities else None

    date_str = now.strftime("%B %d, %Y")

    prompt = f"""You are analyzing weather and environmental data for {date_str}.

OUTDOOR WEATHER:
- Current: {current_temp}°F, {current_humidity}% humidity
- Today's forecast: High {today_high}°F, Low {today_low}°F

HISTORICAL DATA (10-year average for this date):
- Average High: {avg_high}°F
- Average Low: {avg_low}°F
- Recent years: {history[:5]}

INDOOR SENSORS:
- Average indoor temp: {avg_indoor_f:.1f}°F ({len(indoor_temps)} sensors)
- Average indoor humidity: {avg_indoor_humidity:.0f}%
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
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )

        response_text = message.content[0].text

        # Parse JSON response
        insights = json.loads(response_text)

        if not isinstance(insights, list):
            insights = [response_text]

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
    return jsonify({"insights": insights, "cached": False})

# ---------------------------------------------------------------------
# RUN SERVER
# ---------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    log(f"Starting server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)