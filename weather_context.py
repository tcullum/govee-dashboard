"""Location-aware almanac data with bounded, atomic caches and shared lookups."""
import math
import threading
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from runtime_storage import DataUnavailable, read_json, write_json

_lock = threading.Lock()
_inflight = {}


def location_context(args, latitude, longitude, zone):
    try:
        latitude = float(args.get("lat", latitude))
        longitude = float(args.get("lon", longitude))
        zone = args.get("timezone", zone)
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180 or len(zone) > 80:
            raise ValueError()
        ZoneInfo(zone)
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        raise DataUnavailable("Valid coordinates and an IANA timezone are required", 400) from None
    return {"latitude": round(latitude, 4), "longitude": round(longitude, 4), "timezone": zone}


def context_key(context):
    return f"{context['latitude']:.4f},{context['longitude']:.4f},{context['timezone']}"


def get_almanac(context, cache_path, wait=False):
    now = datetime.now(ZoneInfo(context["timezone"]))
    today = now.date().isoformat()
    key = context_key(context)
    with _lock:
        entries = read_json(cache_path, {}).get("entries", {})
        cached = entries.get(key, {})
        if cached.get("date") == today:
            return cached["payload"]
        pending = _inflight.get(key)
        if pending is not None and not wait:
            if cached:
                return dict(cached["payload"], stale=True)
            raise DataUnavailable("Historical weather is being fetched; retry shortly", 202)
        if pending is None:
            _inflight[key] = threading.Event()
    if pending is not None:
        # Background insight generation can wait for the same lookup without
        # holding the cache lock or starting a duplicate network request.
        pending.wait(30)
        with _lock:
            finished = read_json(cache_path, {}).get("entries", {}).get(key, {})
        if finished.get("date") == today:
            return finished["payload"]
        raise DataUnavailable("Fresh historical weather is unavailable")
    try:
        upstream = requests.get("https://archive-api.open-meteo.com/v1/archive", params={
            "latitude": context["latitude"], "longitude": context["longitude"],
            "start_date": f"{now.year - 10}-01-01", "end_date": f"{now.year - 1}-12-31",
            "daily": "temperature_2m_max,temperature_2m_min", "temperature_unit": "fahrenheit",
            "timezone": context["timezone"],
        }, timeout=(5, 20), allow_redirects=False)
        if upstream.status_code != 200:
            raise ValueError("Historical weather unavailable")
        daily = upstream.json()["daily"]
        history = []
        for stamp, high, low in zip(daily["time"], daily["temperature_2m_max"], daily["temperature_2m_min"]):
            if stamp.endswith(now.strftime("%m-%d")) and all(isinstance(v, (float, int)) and math.isfinite(v) for v in (high, low)):
                history.append({"year": int(stamp[:4]), "high": high, "low": low})
        if not history:
            raise ValueError("No historical observations for this date")
        payload = {
            **context, "date": today,
            "avg_high": round(sum(item["high"] for item in history) / len(history), 1),
            "avg_low": round(sum(item["low"] for item in history) / len(history), 1),
            "history": sorted(history, key=lambda item: item["year"], reverse=True)[:10],
        }
        with _lock:
            entries = read_json(cache_path, {}).get("entries", {})
            entries[key] = {"date": today, "payload": payload}
            while len(entries) > 8:
                del entries[next(iter(entries))]
            write_json(cache_path, {"entries": entries})
        return payload
    except (requests.RequestException, ValueError, KeyError, TypeError, OSError):
        if cached:
            return dict(cached["payload"], stale=True)
        raise DataUnavailable("Historical weather is temporarily unavailable") from None
    finally:
        with _lock:
            _inflight.pop(key).set()
