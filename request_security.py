"""Same-origin checks for dashboard operations that trigger upstream work."""
import os
from urllib.parse import urlsplit
from flask import request


def same_origin_request():
    def origin_tuple(value):
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Invalid origin")
        return parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        allowed = {origin_tuple(request.host_url)}
        public = os.environ.get("WEATHER_PUBLIC_ORIGIN", "").strip()
        if public:
            parsed = urlsplit(public)
            if parsed.scheme != "https" or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
                return False
            allowed.add(origin_tuple(public))
        origin = request.headers.get("Origin")
        referer = request.headers.get("Referer")
        return not (
            request.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site")
            or (origin is not None and (origin_tuple(origin) not in allowed or urlsplit(origin).path not in ("", "/")))
            or (origin is None and referer is not None and origin_tuple(referer) not in allowed)
        )
    except ValueError:
        return False
