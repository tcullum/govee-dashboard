#!/usr/bin/env python3
"""
Govee Thermo-Hygrometer Reader (macOS/Linux)
- Uses the official Govee Cloud API.
- Prints a clean table of current readings (°C and %RH) and device names.
- Optional: --csv /path/to/file.csv to append readings (ISO timestamp, name, temp_c, humidity).

Usage:
  export GOVEE_API_KEY="your-api-key"
  python3 govee_readings.py
  python3 govee_readings.py --csv ~/govee_log.csv
"""
import os
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from typing import Dict, Any, List

try:
    import requests
except ImportError:
    print("This script requires the 'requests' package. Install it with:\n  python3 -m pip install requests")
    sys.exit(1)

API_KEY = os.environ.get("GOVEE_API_KEY")
BASE   = "https://openapi.api.govee.com/router/api/v1"
HEADERS = {"Content-Type": "application/json"}

def die(msg: str, code: int = 1):
    print(f"Error: {msg}", file=sys.stderr)
    sys.exit(code)

def fetch_devices() -> List[Dict[str, Any]]:
    if not API_KEY:
        die("GOVEE_API_KEY env var not set. Run: export GOVEE_API_KEY='YOUR_API_KEY'")
    h = dict(HEADERS)
    h["Govee-API-Key"] = API_KEY
    r = requests.get(f"{BASE}/user/devices", headers=h, timeout=20)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, dict) or "data" not in data:
        die(f"Unexpected response from devices endpoint:\n{json.dumps(data, indent=2)}")
    return data["data"]

def get_state(sku: str, device: str) -> Dict[str, Any]:
    h = dict(HEADERS)
    h["Govee-API-Key"] = API_KEY
    payload = {"requestId": "mac-cli", "payload": {"sku": sku, "device": device}}
    r = requests.post(f"{BASE}/device/state", headers=h, json=payload, timeout=20)
    r.raise_for_status()
    return r.json()

def as_table(rows: List[List[str]]) -> str:
    # Simple fixed-width table
    widths = [max(len(str(cell)) for cell in col) for col in zip(*rows)]
    lines = []
    for i, row in enumerate(rows):
        line = "  ".join(str(cell).ljust(widths[idx]) for idx, cell in enumerate(row))
        lines.append(line)
        if i == 0:
            lines.append("  ".join("-" * w for w in widths))
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", help="Append readings to this CSV file (timestamp,name,temp_c,humidity)")
    args = parser.parse_args()

    devices = fetch_devices()
    # Filter to those that expose sensorTemperature and/or sensorHumidity
    sensor_like = []
    for d in devices:
        caps = d.get("capabilities", []) or []
        instances = {c.get("instance") for c in caps if isinstance(c, dict)}
        if "sensorTemperature" in instances or "sensorHumidity" in instances:
            sensor_like.append({
                "sku": d.get("sku"),
                "device": d.get("device"),
                "name": d.get("deviceName") or "",
            })

    if not sensor_like:
        die("No sensor-like devices found under this account.")

    rows = [["Device", "Temp (°C)", "Humidity (%)"]]
    csv_lines = []
    now_iso = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    for s in sensor_like:
        try:
            st = get_state(s["sku"], s["device"])
            caps = st.get("payload", {}).get("capabilities", [])
            cap_map = {}
            for c in caps:
                inst = c.get("instance")
                val = None
                # temperature/humidity may be nested in 'state': {'value': X}
                if isinstance(c.get("state"), dict):
                    val = c["state"].get("value")
                elif "value" in c:
                    val = c.get("value")
                cap_map[inst] = val
            t = cap_map.get("sensorTemperature")
            h = cap_map.get("sensorHumidity")
            rows.append([s["name"] or s["device"], 
                         "" if t is None else str(t), 
                         "" if h is None else str(h)])
            if args.csv is not None:
                csv_lines.append(f'{now_iso},"{(s["name"] or s["device"]).replace("\"","\"\"")}",{"" if t is None else t},{"" if h is None else h}')
        except requests.HTTPError as e:
            rows.append([s["name"] or s["device"], "ERR", "ERR"])
            print(f"Warning: failed to read {s['name'] or s['device']}: {e}", file=sys.stderr)
        except Exception as e:
            rows.append([s["name"] or s["device"], "ERR", "ERR"])
            print(f"Warning: failed to read {s['name'] or s['device']}: {e}", file=sys.stderr)

    print(as_table(rows))
    if args.csv is not None:
        header_needed = not os.path.exists(args.csv) or os.path.getsize(args.csv) == 0
        with open(args.csv, "a", encoding="utf-8") as f:
            if header_needed:
                f.write("timestamp,name,temp_c,humidity\n")
            for line in csv_lines:
                f.write(line + "\n")
        print(f"\nAppended {len(csv_lines)} row(s) to {args.csv}")

if __name__ == "__main__":
    main()
