#!/usr/bin/env python3
r"""
Local server with history logging, sparklines, and Optimized Open-Meteo Almanac.
"""

import os, csv, json, time, sys, threading, uuid
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Flask, jsonify, send_from_directory, send_file, Response, request, abort
import requests
import anthropic
import openrouter_ai

try:
    from dotenv import load_dotenv
    # utf-8-sig tolerates the BOM that Windows editors often prepend
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), encoding="utf-8-sig")
except ImportError:
    pass

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
DEVICE_CACHE_SECONDS = int(os.environ.get("GOVEE_DEVICE_CACHE_SECONDS", "1800"))
POLLEN_CACHE_SECONDS = int(os.environ.get("POLLEN_CACHE_SECONDS", "17280"))
POLLEN_DAILY_REQUEST_LIMIT = 5
LOG_RETENTION_DAYS = int(os.environ.get("LOG_RETENTION_DAYS", "30"))
LOG_TRIM_INTERVAL_SECONDS = 24 * 3600
# 24h of history at one row per refresh interval, with headroom
HISTORY_POINTS_PER_DEVICE = max(2400, int(86400 / READINGS_REFRESH_SECONDS) + 200)
HISTORY_MAX_PAYLOAD_POINTS = 240
_readings_cache = None
_readings_cache_time = 0.0
_readings_last_success_time = 0.0
_readings_last_error = None
_readings_refreshing = False
_readings_lock = threading.Lock()
_log_lock = threading.Lock()
_history_lock = threading.Lock()
_history_cache: Dict[str, deque] = {}
_last_trim_time = 0.0
_device_cache: List[Dict[str, Any]] = []
_device_cache_time = 0.0
_device_cache_lock = threading.Lock()
_pollen_cache: Dict[str, Dict[str, Any]] = {}
_pollen_request_times = deque()
_pollen_client_requests: Dict[str, deque] = {}
_pollen_lock = threading.Lock()

# ---------------------------------------------------------------------
# FLASK APP
# ---------------------------------------------------------------------
app = Flask(__name__, static_folder=None)

from weather_questions import register_weather_questions
register_weather_questions(app, ANTHROPIC_MODEL)

# Only these files are served from the project root. The previous catch-all
# route exposed .env, the readings CSV, and server source to anyone on the
# network.
STATIC_FILES = {
    "index.html", "app.js", "style.css", "service-worker.js", "manifest.json",
    "favicon.ico", "favicon-16x16.png", "favicon-32x32.png",
    "assets/dashboard-tabs.css", "assets/desktop-overview.css", "assets/desktop-overview.js",
    "assets/autumn-cabin.png", "assets/d3-array.min.js", "assets/d3-geo.min.js",
    "assets/sensor-living-room.svg", "assets/sensor-office.svg", "assets/sensor-backyard.svg",
}
STATIC_FAVICON_EXTS = (".png", ".ico", ".webmanifest")

@app.after_request
def security_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "geolocation=(self)")
    if request.path == "/" or request.path.endswith((".html", ".js", ".css", ".json")):
        response.headers.setdefault("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://api.open-meteo.com https://api.weather.gov https://air-quality-api.open-meteo.com https://pollen.googleapis.com https://api.bigdatacloud.net https://cdn.jsdelivr.net https://nowcoast.noaa.gov; img-src 'self' data: https://nowcoast.noaa.gov; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    return response

@app.route("/")
def serve_index() -> Response:
    return send_from_directory(HERE, "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    safe = filename.replace("\\", "/")
    in_root = safe in STATIC_FILES
    in_favicons = (
        safe.startswith("favicon/")
        and safe.count("/") == 1
        and safe.endswith(STATIC_FAVICON_EXTS)
    )
    if not (in_root or in_favicons):
        abort(404)
    return send_from_directory(HERE, safe)

# ---------------------------------------------------------------------
# LOGGING HELPER
# ---------------------------------------------------------------------
def log(msg):
    print(f"[SERVER] {msg}", file=sys.stdout)
    sys.stdout.flush()

# ---------------------------------------------------------------------
# GOOGLE POLLEN
# ---------------------------------------------------------------------
def _pollen_location_key(latitude: float, longitude: float) -> str:
    # About 1 km, matching the API's advertised forecast resolution.
    return f"{latitude:.2f},{longitude:.2f}"

def _normalize_pollen(payload):
    days = []
    for day in payload.get("dailyInfo") or []:
        date = day.get("date") or {}
        date_text = ""
        if all(date.get(part) for part in ("year", "month", "day")):
            date_text = f"{date['year']:04d}-{date['month']:02d}-{date['day']:02d}"

        pollen_types = []
        for item in day.get("pollenTypeInfo") or []:
            index = item.get("indexInfo") or {}
            pollen_types.append({
                "code": item.get("code"),
                "name": item.get("displayName") or (item.get("code") or "").title(),
                "in_season": bool(item.get("inSeason")),
                "value": index.get("value"),
                "category": index.get("category"),
                "description": index.get("indexDescription"),
                "health_recommendations": item.get("healthRecommendations") or [],
            })

        plants = []
        for item in day.get("plantInfo") or []:
            index = item.get("indexInfo") or {}
            if index.get("value") is not None:
                plants.append({
                    "code": item.get("code"),
                    "name": item.get("displayName") or (item.get("code") or "").replace("_", " ").title(),
                    "in_season": bool(item.get("inSeason")),
                    "value": index.get("value"),
                    "category": index.get("category"),
                })
        plants.sort(key=lambda item: item["value"], reverse=True)
        days.append({"date": date_text, "types": pollen_types, "plants": plants[:5]})

    return {
        "source": "Google Maps",
        "attribution": "Source: Includes pollen data from Google",
        "region_code": payload.get("regionCode"),
        "days": days,
    }

def _check_pollen_client_rate_limit(client_id: str, now_ts: float) -> bool:
    window_start = now_ts - 60
    requests_for_client = _pollen_client_requests.setdefault(client_id, deque())
    while requests_for_client and requests_for_client[0] <= window_start:
        requests_for_client.popleft()
    if len(requests_for_client) >= 30:
        return False
    requests_for_client.append(now_ts)
    return True

@app.get("/api/pollen")
def api_pollen():
    api_key = os.environ.get("GOOGLE_POLLEN_API_KEY")
    if not api_key:
        return jsonify({"error": "Google Pollen API is not configured."}), 503

    try:
        latitude = float(request.args["lat"])
        longitude = float(request.args["lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Valid lat and lon parameters are required."}), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"error": "Coordinates are outside the valid range."}), 400

    now_ts = time.time()
    client_id = request.remote_addr or "unknown"
    location_key = _pollen_location_key(latitude, longitude)
    with _pollen_lock:
        if not _check_pollen_client_rate_limit(client_id, now_ts):
            return jsonify({"error": "Too many pollen requests. Try again shortly."}), 429

        cached = _pollen_cache.get(location_key)
        if cached and now_ts - cached["timestamp"] < POLLEN_CACHE_SECONDS:
            response = jsonify({**cached["payload"], "cached": True})
            response.headers["Cache-Control"] = "private, no-store"
            return response

        cutoff = now_ts - 86400
        while _pollen_request_times and _pollen_request_times[0] <= cutoff:
            _pollen_request_times.popleft()
        if len(_pollen_request_times) >= POLLEN_DAILY_REQUEST_LIMIT:
            return jsonify({"error": "Daily Google Pollen API request limit reached."}), 429

        try:
            upstream = requests.get(
                "https://pollen.googleapis.com/v1/forecast:lookup",
                params={
                    "key": api_key,
                    "location.latitude": round(latitude, 4),
                    "location.longitude": round(longitude, 4),
                    "days": 3,
                    "languageCode": "en",
                    "plantsDescription": "false",
                },
                timeout=15,
            )
            upstream.raise_for_status()
            payload = _normalize_pollen(upstream.json())
            if not payload["days"]:
                return jsonify({"error": "No pollen forecast is available for this location."}), 404
        except requests.RequestException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            log(f"Google Pollen API request failed (status={status or 'network error'})")
            if cached:
                response = jsonify({**cached["payload"], "cached": True, "stale": True})
                response.headers["Cache-Control"] = "private, no-store"
                return response
            return jsonify({"error": "Pollen forecast is temporarily unavailable."}), 502
        except (TypeError, ValueError, KeyError) as exc:
            log(f"Google Pollen API response was invalid: {exc}")
            return jsonify({"error": "Pollen forecast response was invalid."}), 502

        _pollen_request_times.append(now_ts)
        if location_key not in _pollen_cache and len(_pollen_cache) >= 8:
            oldest_key = min(_pollen_cache, key=lambda key: _pollen_cache[key]["timestamp"])
            del _pollen_cache[oldest_key]
        _pollen_cache[location_key] = {"timestamp": now_ts, "payload": payload}
        response = jsonify({**payload, "cached": False})
        response.headers["Cache-Control"] = "private, no-store"
        return response

# ---------------------------------------------------------------------
# GOVEE HELPERS
# ---------------------------------------------------------------------
def get_headers() -> Dict[str, str]:
    api_key = os.environ.get("GOVEE_API_KEY")
    if not api_key:
        log("WARNING: GOVEE_API_KEY not set.")
        return {}
    return {"Content-Type": "application/json", "Govee-API-Key": api_key}

def fetch_devices(force=False) -> List[Dict[str, Any]]:
    global _device_cache, _device_cache_time
    now_ts = time.time()
    with _device_cache_lock:
        if not force and _device_cache and now_ts - _device_cache_time < DEVICE_CACHE_SECONDS:
            return list(_device_cache)
    try:
        r = requests.get(f"{BASE_URL}/user/devices", headers=get_headers(), timeout=30)
        r.raise_for_status()
        devices = r.json().get("data", [])
        if not isinstance(devices, list):
            raise ValueError("Govee device response did not contain a device list")
        with _device_cache_lock:
            _device_cache = devices
            _device_cache_time = time.time()
        return list(devices)
    except Exception as e:
        log(f"Error fetching devices: {e}")
        with _device_cache_lock:
            if _device_cache:
                log("Using stale cached Govee device inventory")
                return list(_device_cache)
        raise

def get_state(sku: str, device: str) -> Dict[str, Any]:
    last_error = None
    for attempt in range(2):
        payload = {"requestId": str(uuid.uuid4()), "payload": {"sku": sku, "device": device}}
        try:
            r = requests.post(f"{BASE_URL}/device/state", headers=get_headers(), json=payload, timeout=20)
            if r.status_code == 429 or 500 <= r.status_code < 600:
                retry_after = r.headers.get("Retry-After")
                delay = min(5.0, float(retry_after)) if retry_after else 1.5 * (attempt + 1)
                if attempt == 0:
                    time.sleep(delay)
                    continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_error = e
            if attempt == 0:
                time.sleep(1.0)
    raise RuntimeError(f"Govee state request failed for {device}: {last_error}")

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

_latest_by_device: Dict[str, Dict[str, Any]] = {}

def _history_append(device, ts, temp_c, humidity, name=None):
    with _history_lock:
        series = _history_cache.get(device)
        if series is None:
            series = deque(maxlen=HISTORY_POINTS_PER_DEVICE)
            _history_cache[device] = series
        series.append({"timestamp": ts, "temp_c": temp_c, "humidity": humidity})
        _latest_by_device[device] = {
            "name": name or _latest_by_device.get(device, {}).get("name") or "Unknown",
            "device": device,
            "temp_c": temp_c,
            "humidity": humidity,
            "timestamp": ts,
        }

def _append_log_row(ts, name, device, temp_c, humidity):
    try:
        with _log_lock:
            header_needed = not os.path.exists(LOG_PATH) or os.path.getsize(LOG_PATH) == 0
            with open(LOG_PATH, "a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                if header_needed:
                    w.writerow(["timestamp","name","device","temp_c","humidity"])
                w.writerow([ts, name, device, temp_c if temp_c is not None else "", humidity if humidity is not None else ""])
        _history_append(device, ts, temp_c, humidity, name)
    except Exception as e:
        log(f"Error writing log: {e}")

def _parse_row_floats(row):
    try:
        t = float(row["temp_c"]) if row.get("temp_c") else None
    except (TypeError, ValueError):
        t = None
    try:
        h = float(row["humidity"]) if row.get("humidity") else None
    except (TypeError, ValueError):
        h = None
    return t, h

def _seed_history_cache():
    """Read the CSV once at startup so /api/history never re-parses the file."""
    if not os.path.exists(LOG_PATH):
        return
    try:
        with _log_lock:
            with open(LOG_PATH, "r", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
        count = 0
        for row in rows:
            dev = row.get("device")
            if not dev:
                continue
            t, h = _parse_row_floats(row)
            _history_append(dev, row.get("timestamp"), t, h, row.get("name"))
            count += 1
        log(f"Seeded history cache with {count} rows across {len(_history_cache)} devices")
    except Exception as e:
        log(f"History seed error: {e}")

def _trim_log():
    """Rewrite the CSV keeping only rows newer than the retention window."""
    global _last_trim_time
    _last_trim_time = time.time()
    if not os.path.exists(LOG_PATH):
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOG_RETENTION_DAYS)
    tmp_path = LOG_PATH + ".tmp"
    kept = 0
    dropped = 0
    try:
        with _log_lock:
            with open(LOG_PATH, "r", encoding="utf-8") as src:
                reader = csv.DictReader(src)
                fieldnames = reader.fieldnames or ["timestamp", "name", "device", "temp_c", "humidity"]
                with open(tmp_path, "w", newline="", encoding="utf-8") as dst:
                    writer = csv.DictWriter(dst, fieldnames=fieldnames, extrasaction="ignore")
                    writer.writeheader()
                    for row in reader:
                        try:
                            ts = datetime.fromisoformat(row["timestamp"])
                            if ts.tzinfo is None:
                                ts = ts.replace(tzinfo=timezone.utc)
                        except (KeyError, TypeError, ValueError):
                            dropped += 1
                            continue
                        if ts >= cutoff:
                            writer.writerow(row)
                            kept += 1
                        else:
                            dropped += 1
            os.replace(tmp_path, LOG_PATH)
        log(f"Trimmed readings log to {LOG_RETENTION_DAYS} days: kept {kept}, dropped {dropped}")
    except Exception as e:
        log(f"Log trim error: {e}")
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass

def _downsample(points, max_points=HISTORY_MAX_PAYLOAD_POINTS):
    if len(points) <= max_points:
        return points
    stride = len(points) / max_points
    sampled = [points[int(i * stride)] for i in range(max_points)]
    sampled[-1] = points[-1]
    return sampled

def _read_history(limit_per_device: int = HISTORY_MAX_PAYLOAD_POINTS):
    out = {}
    with _history_lock:
        for dev, series in _history_cache.items():
            out[dev] = _downsample(list(series), limit_per_device)
    return out

def _iso_from_timestamp(ts):
    if not ts:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).astimezone().isoformat(timespec="seconds")

def _latest_readings_from_log():
    with _history_lock:
        latest = [dict(entry) for entry in _latest_by_device.values()]
    if not latest:
        return None
    for item in latest:
        item["sku"] = None
        item["battery"] = None
        item["temp_f"] = c_to_f(item.get("temp_c"))
    return {
        "items": latest,
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
    _seed_history_cache()
    _trim_log()
    time.sleep(2)
    while True:
        _start_readings_refresh()
        if time.time() - _last_trim_time > LOG_TRIM_INTERVAL_SECONDS:
            _trim_log()
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
            "refresh_interval_seconds": READINGS_REFRESH_SECONDS,
            "device_cache_seconds": DEVICE_CACHE_SECONDS
        },
        "history": {
            "devices": len(_history_cache),
            "retention_days": LOG_RETENTION_DAYS,
            "last_trim_at": _iso_from_timestamp(_last_trim_time)
        },
        "ai": {
            "anthropic_model": ANTHROPIC_MODEL,
            "provider": "openrouter" if openrouter_ai.enabled() else "anthropic",
            "model": openrouter_ai.model() if openrouter_ai.enabled() else ANTHROPIC_MODEL,
            "insights_cached": insights_cached,
            "insights_timestamp": insights_timestamp
        }
    })

@app.get("/api/history")
def api_history():
    return jsonify({"series": _read_history()})

@app.get("/api/export")
def api_export():
    if not os.path.exists(LOG_PATH):
        abort(404)
    stamp = datetime.now().strftime("%Y-%m-%d")
    return send_file(
        LOG_PATH,
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"govee_readings_{stamp}.csv",
    )

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
    api_key = openrouter_ai.api_key() if openrouter_ai.enabled() else os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "AI provider API key is not configured"}), 503

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

        temp_f = s.get("temp_f")
        temp_c = s.get("temp_c")
        if temp_f is not None:
            indoor_temps_f.append(temp_f)
        elif temp_c is not None:
            indoor_temps_f.append((temp_c * 9/5) + 32)

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
        if openrouter_ai.enabled():
            response_text = openrouter_ai.complete("Analyze only the supplied environmental data. Return the requested JSON array, no other text.", prompt, 500)
        else:
            with anthropic.Anthropic(api_key=api_key, timeout=30, max_retries=0) as client:
                message = client.messages.create(model=ANTHROPIC_MODEL, max_tokens=500,
                    messages=[{"role": "user", "content": prompt}])
            response_text = message.content[0].text

        insights = parse_insights_response(response_text)

    except json.JSONDecodeError as e:
        log(f"JSON parse error: {e}")
        insights = ["Unable to generate insights at this time."]
    except Exception as e:
        log(f"AI provider failure: {type(e).__name__}")
        # Fall back to the last cached insights rather than showing nothing
        if cache.get("insights"):
            return jsonify({
                "insights": cache["insights"],
                "cached": True,
                "stale": True,
                "timestamp": cache.get("timestamp")
            })
        return jsonify({"error": str(e) if isinstance(e, openrouter_ai.AIError) else "AI generation failed. Check provider configuration."}), 503

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
    try:
        from waitress import serve
        log("Serving with waitress")
        serve(app, host="0.0.0.0", port=port, threads=8)
    except ImportError:
        log("waitress not installed; falling back to Flask dev server")
        app.run(host="0.0.0.0", port=port, debug=False)
