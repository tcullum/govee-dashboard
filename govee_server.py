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

# ---------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------
BASE_URL = "https://openapi.api.govee.com/router/api/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, "govee_readings.csv")
ALMANAC_CACHE_FILE = os.path.join(HERE, "almanac_cache.json")

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

# ---------------------------------------------------------------------
# RUN SERVER
# ---------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    log(f"Starting server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)