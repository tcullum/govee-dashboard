"""Verify Cloudflare Access assertions at the origin, including direct-port traffic."""
import os
import re

import jwt
from flask import jsonify, request


def register_access(app):
    required = os.environ.get("CLOUDFLARE_ACCESS_REQUIRED", "false").lower() == "true"
    team = os.environ.get("CLOUDFLARE_ACCESS_TEAM", "").strip()
    audience = os.environ.get("CLOUDFLARE_ACCESS_AUD", "").strip()
    if required and (not re.fullmatch(r"[a-z0-9-]+", team) or not audience):
        raise RuntimeError("Cloudflare Access requires a team name and application audience")
    issuer = f"https://{team}.cloudflareaccess.com"
    keys = jwt.PyJWKClient(issuer + "/cdn-cgi/access/certs", lifespan=300, timeout=5) if required else None
    app.extensions["cloudflare_access"] = {"required": required, "keys": keys}

    @app.before_request
    def verify_access():
        if not required or request.path == "/healthz":
            return None
        token = request.headers.get("Cf-Access-Jwt-Assertion", "")
        if not token or len(token) > 16384:
            return jsonify({"error": "Sign in through the dashboard's Cloudflare Access URL."}), 401
        try:
            key = keys.get_signing_key_from_jwt(token).key
            claims = jwt.decode(token, key, algorithms=["RS256"], audience=audience,
                                issuer=issuer, options={"require": ["exp", "iat", "iss", "aud", "sub", "email"]})
            if claims.get("type") != "app" or not claims.get("email"):
                raise jwt.InvalidTokenError("A user application token is required")
        except (jwt.PyJWTError, OSError, ValueError):
            return jsonify({"error": "Cloudflare Access authentication is required."}), 401
        return None
