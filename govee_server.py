#!/usr/bin/env python3
r"""
Local server with history logging, sparklines, and Optimized Open-Meteo Almanac.
"""

import os, csv, json, time, sys, threading, uuid, math
from zoneinfo import ZoneInfo
from runtime_storage import read_json, write_json, DataUnavailable
from request_security import same_origin_request
from weather_context import location_context, context_key, get_almanac
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
DATA_DIR = os.environ.get("GOVEE_DATA_DIR", HERE)
LOG_PATH = os.path.join(DATA_DIR, "govee_readings.csv")
ALMANAC_CACHE_FILE = os.path.join(DATA_DIR, "almanac_cache.json")
INSIGHTS_CACHE_FILE = os.path.join(DATA_DIR, "insights_cache.json")
INSIGHTS_CACHE_HOURS = 24  # Cache for 24 hours so insights refresh daily
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
READINGS_REFRESH_SECONDS = 45
HOME_LATITUDE = float(os.environ.get("HOME_LATITUDE", "36.17"))
HOME_LONGITUDE = float(os.environ.get("HOME_LONGITUDE", "-115.14"))
HOME_TIMEZONE = os.environ.get("HOME_TIMEZONE", "America/Los_Angeles")
HOME_NAME = os.environ.get("HOME_NAME", "Las Vegas")
HOME_ZONE = ZoneInfo(HOME_TIMEZONE)
GOVEE_TEMPERATURE_UNIT = os.environ.get("GOVEE_TEMPERATURE_UNIT", "F").upper()
if GOVEE_TEMPERATURE_UNIT not in ("F", "C"):
    raise ValueError("GOVEE_TEMPERATURE_UNIT must be F or C")
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
_readings_last_attempt = float("-inf")
_readings_lock = threading.Lock()
_log_lock = threading.Lock()
_history_lock = threading.Lock()
_history_cache: Dict[str, deque] = {}
_last_trim_time = 0.0
_device_cache: List[Dict[str, Any]] = []
_device_cache_time = 0.0
_device_cache_lock = threading.Lock()
_pollen_cache: Dict[str, Dict[str, Any]] = {}
_pollen_budget_path = os.path.join(DATA_DIR, "pollen_budget.json")
_pollen_request_times = deque(read_json(_pollen_budget_path, []))
_pollen_inflight = set()
_pollen_client_requests: Dict[str, deque] = {}
_pollen_lock = threading.Lock()

# ---------------------------------------------------------------------
# FLASK APP
# ---------------------------------------------------------------------
app = Flask(__name__, static_folder=None)
from cloudflare_access import register_access
register_access(app)

@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"})

@app.get("/api/config")
def api_config():
    return jsonify({"latitude": HOME_LATITUDE, "longitude": HOME_LONGITUDE,
                    "timezone": HOME_TIMEZONE, "name": HOME_NAME})

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
    if request.path.startswith("/api/") or response.status_code == 401:
        response.headers.setdefault("Cache-Control", "private, no-store")
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
    for client, attempts in list(_pollen_client_requests.items()):
        if not attempts or attempts[-1] <= now_ts - 60:
            del _pollen_client_requests[client]
    if client_id not in _pollen_client_requests and len(_pollen_client_requests) >= 1024:
        return False
    attempts = _pollen_client_requests.setdefault(client_id, deque())
    while attempts and attempts[0] <= now_ts - 60:
        attempts.popleft()
    if len(attempts) >= 30:
        return False
    attempts.append(now_ts)
    return True


@app.get("/api/pollen")
def api_pollen():
    api_key = os.environ.get("GOOGLE_POLLEN_API_KEY")
    if not api_key:
        return jsonify({"error": "Google Pollen API is not configured."}), 503
    if not same_origin_request():
        return jsonify({"error": "Pollen must be requested from this dashboard's origin."}), 403
    try:
        latitude = float(request.args["lat"])
        longitude = float(request.args["lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Valid lat and lon parameters are required."}), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"error": "Coordinates are outside the valid range."}), 400
    now = time.time()
    key = _pollen_location_key(latitude, longitude)
    with _pollen_lock:
        if not _check_pollen_client_rate_limit(request.remote_addr or "unknown", now):
            return jsonify({"error": "Too many pollen requests. Try again shortly."}), 429
        cached = _pollen_cache.get(key)
        if cached and now - cached["timestamp"] < POLLEN_CACHE_SECONDS:
            return jsonify({**cached["payload"], "cached": True})
        if key in _pollen_inflight:
            if cached:
                return jsonify({**cached["payload"], "cached": True, "stale": True})
            return jsonify({"error": "Pollen is being fetched. Retry shortly."}), 503
        while _pollen_request_times and _pollen_request_times[0] <= now - 86400:
            _pollen_request_times.popleft()
        if len(_pollen_request_times) >= POLLEN_DAILY_REQUEST_LIMIT:
            if cached:
                return jsonify({**cached["payload"], "cached": True, "stale": True})
            return jsonify({"error": "Daily Google Pollen API request limit reached."}), 429
        # Count and durably reserve every outbound attempt, including failures.
        _pollen_request_times.append(now)
        try:
            write_json(_pollen_budget_path, list(_pollen_request_times))
        except OSError:
            return jsonify({"error": "Could not reserve the pollen request budget."}), 503
        _pollen_inflight.add(key)
    try:
        upstream = requests.get("https://pollen.googleapis.com/v1/forecast:lookup", params={
            "key": api_key, "location.latitude": round(latitude, 4),
            "location.longitude": round(longitude, 4), "days": 3,
            "languageCode": "en", "plantsDescription": "false",
        }, timeout=(5, 15), allow_redirects=False)
        upstream.raise_for_status()
        payload = _normalize_pollen(upstream.json())
        if not payload["days"]:
            return jsonify({"error": "No pollen forecast is available for this location."}), 404
        with _pollen_lock:
            if key not in _pollen_cache and len(_pollen_cache) >= 8:
                del _pollen_cache[min(_pollen_cache, key=lambda item: _pollen_cache[item]["timestamp"])]
            _pollen_cache[key] = {"timestamp": now, "payload": payload}
        return jsonify({**payload, "cached": False})
    except (requests.RequestException, TypeError, ValueError, KeyError):
        log("Google Pollen API request failed")
        if cached:
            return jsonify({**cached["payload"], "cached": True, "stale": True})
        return jsonify({"error": "Pollen forecast is temporarily unavailable."}), 502
    finally:
        with _pollen_lock:
            _pollen_inflight.discard(key)

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
        r = requests.get(f"{BASE_URL}/user/devices", headers=get_headers(), timeout=(5, 20), allow_redirects=False)
        r.raise_for_status()
        if r.status_code != 200 or r.json().get("code", 200) != 200:
            raise ValueError("Govee device inventory is unavailable")
        devices = r.json().get("data", [])
        if not isinstance(devices, list) or not devices:
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
            r = requests.post(f"{BASE_URL}/device/state", headers=get_headers(), json=payload, timeout=(5, 20), allow_redirects=False)
            if r.status_code == 429 or 500 <= r.status_code < 600:
                retry_after = r.headers.get("Retry-After")
                delay = min(5.0, float(retry_after)) if retry_after else 1.5 * (attempt + 1)
                if attempt == 0:
                    time.sleep(delay)
                    continue
            r.raise_for_status()
            if r.status_code != 200:
                raise ValueError("Govee state endpoint did not return HTTP 200")
            result = r.json()
            if result.get("code", 200) != 200:
                raise ValueError(f"Govee returned code {result.get('code')}: {result.get('msg', 'State unavailable')}")
            return result
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
    except (TypeError, ValueError, OverflowError): return None
    if not math.isfinite(v): return None
    # Router API units vary by account configuration; this deployment uses F.
    # Decode known scaled numeric payloads before converting to Fahrenheit.
    if v > 2000: v = v / 100.0
    elif v > 200: v = v / 10.0
    if GOVEE_TEMPERATURE_UNIT == "C": v = v * 9.0 / 5.0 + 32
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
    except (TypeError, ValueError, OverflowError): return None
    if not math.isfinite(v): return None
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
        if temp_c is None and humidity is None:
            return
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
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    out = {}
    with _history_lock:
        for dev, series in _history_cache.items():
            recent = []
            for point in series:
                try:
                    stamp = datetime.fromisoformat(point["timestamp"])
                    if stamp.tzinfo is None:
                        stamp = stamp.replace(tzinfo=timezone.utc)
                    if stamp >= cutoff:
                        recent.append(point)
                except (ValueError, TypeError, KeyError):
                    continue
            out[dev] = _downsample(recent, limit_per_device)
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

        if temp_f is None and humidity is None:
            raise ValueError("Govee returned no temperature or humidity readings")

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
    if not sensors:
        return {"items": [], "error": "No Govee sensors are available"}, 503
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
        previous = _readings_cache or _latest_readings_from_log() or {}
        current_devices = {item["device"] for item in payload["items"]}
        payload["items"] = payload["items"] + [
            dict(item, stale=True) for item in previous.get("items", [])
            if item["device"] not in current_devices
        ]
        _readings_cache = payload
        _readings_cache_time = now_ts
        _readings_last_success_time = now_ts
        _readings_last_error = payload.get("note") or None

def _refresh_readings_cache():
    global _readings_refreshing, _readings_last_error
    try:
        payload, status = _poll_readings_live()
        if status == 200 and payload.get("items"):
            _store_readings_cache(payload)
        else:
            with _readings_lock:
                _readings_last_error = payload.get("note") or payload.get("error") or "No sensor readings received"
    except Exception as exc:
        log(f"Readings refresh failed: {type(exc).__name__}")
        with _readings_lock:
            _readings_last_error = "Sensor refresh is temporarily unavailable"
    finally:
        with _readings_lock:
            _readings_refreshing = False

def _start_readings_refresh():
    global _readings_refreshing, _readings_last_attempt
    with _readings_lock:
        now = time.monotonic()
        if _readings_refreshing or (now - _readings_last_attempt < READINGS_REFRESH_SECONDS):
            return False
        _readings_refreshing = True
        _readings_last_attempt = now
    threading.Thread(target=_refresh_readings_cache, daemon=True).start()
    return True


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
    cached, age = _cached_readings_payload()
    if not cached or age is None or age >= READINGS_REFRESH_SECONDS or request.args.get("refresh") == "1":
        _start_readings_refresh()
    cached, age = _cached_readings_payload()
    if cached:
        cached["cached"] = True
        cached["age_seconds"] = round(age, 1) if age is not None else None
        return jsonify(cached)
    return jsonify({"items": [], "refreshing": True, "note": "Fetching the first sensor readings"}), 202

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
            home_cache = cache.get("entries", {}).get(context_key({"latitude": HOME_LATITUDE, "longitude": HOME_LONGITUDE, "timezone": HOME_TIMEZONE}), {})
            insights_cached = bool(home_cache.get("insights"))
            insights_timestamp = home_cache.get("timestamp")
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
    stamp = datetime.now(HOME_ZONE).strftime("%Y-%m-%d")
    return send_file(
        LOG_PATH,
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"govee_readings_{stamp}.csv",
    )

def _request_location():
    return location_context(request.args, HOME_LATITUDE, HOME_LONGITUDE, HOME_TIMEZONE)


@app.get("/api/almanac")
def api_almanac():
    try:
        return jsonify(get_almanac(_request_location(), ALMANAC_CACHE_FILE))
    except DataUnavailable as exc:
        return jsonify({"error": str(exc)}), exc.status


_insights_lock = threading.Lock()
_insights_active = False
_insights_error = None
_insights_budget_path = os.path.join(DATA_DIR, "insights_budget.json")
_insights_attempts = deque(read_json(_insights_budget_path, []))


def _read_insights(context):
    return read_json(INSIGHTS_CACHE_FILE, {}).get("entries", {}).get(context_key(context), {})


def _insights_current(cached, context):
    try:
        stamp = datetime.fromisoformat(cached["timestamp"])
        now = datetime.now(ZoneInfo(context["timezone"]))
        return (stamp.tzinfo is not None and stamp.astimezone(now.tzinfo).date() == now.date()
                and 0 <= (now - stamp).total_seconds() < INSIGHTS_CACHE_HOURS * 3600)
    except (ValueError, TypeError, KeyError):
        return False


def _generate_insights(context):
    now = datetime.now(ZoneInfo(context["timezone"]))
    api_key = openrouter_ai.api_key() if openrouter_ai.enabled() else os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise DataUnavailable("AI provider API key is not configured")
    almanac_data = get_almanac(context, ALMANAC_CACHE_FILE, wait=True)
    if almanac_data.get("stale"):
        raise DataUnavailable("Fresh historical weather is unavailable")
    weather_response = requests.get("https://api.open-meteo.com/v1/forecast", params={
        "latitude": context["latitude"], "longitude": context["longitude"],
        "current": "temperature_2m,relative_humidity_2m,weathercode",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "temperature_unit": "fahrenheit", "forecast_days": 3, "timezone": context["timezone"],
    }, timeout=(5, 10), allow_redirects=False)
    if weather_response.status_code != 200:
        raise DataUnavailable("Fresh forecast is unavailable")
    weather_data = weather_response.json()
    sensor_data, _ = _cached_readings_payload()
    sensor_data = sensor_data or {"items": []}
    # Last-known readings are useful for display but must not become current AI context.
    fresh_items = []
    for item in sensor_data.get("items", []):
        try:
            stamp = datetime.fromisoformat(item["timestamp"])
            if stamp.tzinfo is not None and -60 <= (now - stamp).total_seconds() <= 300:
                fresh_items.append(item)
        except (ValueError, TypeError, KeyError):
            continue
    sensor_data = {"items": fresh_items}

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

    prompt = f"""You are analyzing weather and environmental data for {date_str} in {context["timezone"]} at {context["latitude"]}, {context["longitude"]}.

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

    except (json.JSONDecodeError, IndexError, AttributeError) as exc:
        raise DataUnavailable("AI returned an incomplete insight response") from exc

    if not insights:
        raise DataUnavailable("AI returned no insights")
    return {"timestamp": now.isoformat(), "insights": insights[:4], **context}


def _refresh_insights(context):
    global _insights_active, _insights_error
    try:
        result = _generate_insights(context)
        with _insights_lock:
            entries = read_json(INSIGHTS_CACHE_FILE, {}).get("entries", {})
            entries[context_key(context)] = result
            while len(entries) > 8:
                del entries[next(iter(entries))]
            write_json(INSIGHTS_CACHE_FILE, {"entries": entries})
            _insights_error = None
    except Exception as exc:
        log(f"Insights generation failed: {type(exc).__name__}")
        with _insights_lock:
            _insights_error = "Insights are temporarily unavailable; automatic retry is limited to protect API credits."
    finally:
        with _insights_lock:
            _insights_active = False


def _start_insights_refresh(context):
    global _insights_active, _insights_error
    with _insights_lock:
        now = time.time()
        while _insights_attempts and _insights_attempts[0] <= now - 86400:
            _insights_attempts.popleft()
        if _insights_active:
            return
        if len(_insights_attempts) >= 4 or (_insights_attempts and now - _insights_attempts[-1] < 900):
            _insights_error = "Insights refresh limit reached; showing the last available insights."
            return
        _insights_attempts.append(now)
        try:
            write_json(_insights_budget_path, list(_insights_attempts))
        except OSError:
            _insights_error = "Could not reserve the insights request budget."
            return
        _insights_active = True
        _insights_error = None
    threading.Thread(target=_refresh_insights, args=(context,), daemon=True).start()


@app.route("/api/almanac/insights", methods=["GET", "POST"])
def api_almanac_insights():
    if not same_origin_request():
        return jsonify({"error": "Insights must be requested from this dashboard's origin."}), 403
    if request.method == "GET" and request.args.get("refresh") == "1":
        return jsonify({"error": "Use POST to request an insights refresh."}), 405
    try:
        context = _request_location()
    except DataUnavailable as exc:
        return jsonify({"error": str(exc)}), exc.status
    cached = _read_insights(context)
    current = _insights_current(cached, context)
    if request.method == "POST" or not current:
        if not (openrouter_ai.api_key() if openrouter_ai.enabled() else os.environ.get("ANTHROPIC_API_KEY")):
            return jsonify({"error": "AI provider API key is not configured"}), 503
        _start_insights_refresh(context)
    with _insights_lock:
        refreshing, error = _insights_active, _insights_error
    return jsonify({**cached, "insights": cached.get("insights", []), "cached": bool(cached),
                    "stale": bool(cached) and not current, "refreshing": refreshing,
                    "last_error": error}), 202 if refreshing and not cached else 200

# ---------------------------------------------------------------------
# RUN SERVER
# ---------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    bind_host = os.environ.get("BIND_HOST", "127.0.0.1")
    os.makedirs(DATA_DIR, exist_ok=True)
    log(f"Starting server on port {port}...")
    threading.Thread(target=_background_readings_loop, daemon=True).start()
    try:
        from waitress import serve
        log("Serving with waitress")
        serve(app, host=bind_host, port=port, threads=8)
    except ImportError:
        log("waitress not installed; falling back to Flask dev server")
        app.run(host=bind_host, port=port, debug=False)
