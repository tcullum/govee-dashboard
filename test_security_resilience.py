"""Offline regressions for the security and outage review findings."""
import os
import tempfile
import threading
import time
import unittest
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import jwt
import requests
from cryptography.hazmat.primitives.asymmetric import rsa
from flask import Flask

import govee_server as server
import weather_context
from cloudflare_access import register_access
from runtime_storage import read_json, write_json


class AccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def setUp(self):
        self.app = Flask(__name__)
        with patch.dict(os.environ, {"CLOUDFLARE_ACCESS_REQUIRED": "true", "CLOUDFLARE_ACCESS_TEAM": "fixture", "CLOUDFLARE_ACCESS_AUD": "weather-audience"}):
            register_access(self.app)
        self.app.add_url_rule("/protected", endpoint="protected", view_func=lambda: "private data")
        self.app.add_url_rule("/healthz", endpoint="health", view_func=lambda: "ok")
        self.client = self.app.test_client()
        self.keys = patch.object(self.app.extensions["cloudflare_access"]["keys"], "get_signing_key_from_jwt", return_value=SimpleNamespace(key=self.private.public_key()))
        self.keys.start()
        self.addCleanup(self.keys.stop)

    def token(self, **overrides):
        claims = {"exp": int(time.time()) + 300, "iat": int(time.time()), "iss": "https://fixture.cloudflareaccess.com",
                  "aud": ["weather-audience"], "sub": "fixture-user", "email": "fixture@example.com", "type": "app"}
        claims.update(overrides)
        return jwt.encode(claims, self.private, algorithm="RS256")

    def test_signed_application_identity_is_accepted(self):
        response = self.client.get("/protected", headers={"Cf-Access-Jwt-Assertion": self.token()})
        self.assertEqual(response.status_code, 200)

    def test_missing_assertion_and_forged_email_do_not_bypass_authentication(self):
        for headers in ({}, {"Cf-Access-Authenticated-User-Email": "fixture@example.com"}, {"Cf-Access-Jwt-Assertion": "forged"}):
            self.assertEqual(self.client.get("/protected", headers=headers).status_code, 401)

    def test_invalid_signature_issuer_audience_expiry_and_token_type_are_rejected(self):
        for changes in ({"iss": "https://other.cloudflareaccess.com"}, {"aud": ["other-app"]}, {"exp": int(time.time()) - 1}, {"type": "service"}, {"email": ""}):
            with self.subTest(changes=changes):
                self.assertEqual(self.client.get("/protected", headers={"Cf-Access-Jwt-Assertion": self.token(**changes)}).status_code, 401)
        other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        unsigned_claims = jwt.decode(self.token(), options={"verify_signature": False})
        forged = jwt.encode(unsigned_claims, other, algorithm="RS256")
        self.assertEqual(self.client.get("/protected", headers={"Cf-Access-Jwt-Assertion": forged}).status_code, 401)

    def test_health_check_contains_no_household_data(self):
        self.assertEqual(self.client.get("/healthz").get_data(as_text=True), "ok")


class ResilienceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        for name, value in {
            "INSIGHTS_CACHE_FILE": str(self.directory / "insights.json"),
            "_insights_budget_path": str(self.directory / "insights-budget.json"),
            "_pollen_budget_path": str(self.directory / "pollen-budget.json"),
            "_insights_active": False, "_insights_error": None, "_insights_attempts": deque(),
            "_pollen_request_times": deque(), "_pollen_cache": {}, "_pollen_inflight": set(), "_pollen_client_requests": {},
            "_readings_cache": None, "_readings_refreshing": False, "_readings_last_attempt": float("-inf"),
            "_readings_last_error": None, "_history_cache": {}, "_latest_by_device": {},
        }.items():
            replacement = patch.object(server, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        self.context = {"latitude": 36.17, "longitude": -115.14, "timezone": "America/Los_Angeles"}
        self.client = server.app.test_client()

    def test_forced_and_cold_sensor_requests_share_one_poll(self):
        with patch.object(server.threading, "Thread") as thread:
            for _ in range(10):
                self.assertEqual(self.client.get("/api/readings?refresh=1").status_code, 202)
            self.assertEqual(thread.call_count, 1)
            server._readings_refreshing = False
            self.client.get("/api/readings?refresh=1")
            self.assertEqual(thread.call_count, 1, "A completed poll must still respect the minimum interval")

    def test_empty_inventory_and_unexpected_failure_are_visible(self):
        for result in [({"items": []}, 200), ({"items": [], "error": "No Govee sensors are available"}, 503)]:
            with patch.object(server, "_poll_readings_live", return_value=result):
                server._refresh_readings_cache()
            self.assertTrue(server._readings_last_error)
        with patch.object(server, "_poll_readings_live", side_effect=RuntimeError("fixture")):
            server._refresh_readings_cache()
        self.assertFalse(server._readings_refreshing)
        self.assertTrue(server._readings_last_error)

    def test_history_excludes_samples_outside_24_hours(self):
        now = datetime.now(timezone.utc)
        for stamp in [now - timedelta(days=10), now - timedelta(hours=25), now - timedelta(hours=1)]:
            server._history_append("fixture", stamp.isoformat(), 20, 40, "Office")
        self.assertEqual(len(server._read_history()["fixture"]), 1)

    def test_cross_origin_and_get_forced_insights_never_start_generation(self):
        with patch.object(server, "_start_insights_refresh") as start:
            self.assertEqual(self.client.post("/api/almanac/insights", headers={"Origin": "https://other.example"}).status_code, 403)
            self.assertEqual(self.client.get("/api/almanac/insights?refresh=1").status_code, 405)
            start.assert_not_called()

    def test_insights_single_flight_and_budget_survive_a_restart(self):
        with patch.object(server.threading, "Thread") as thread:
            for _ in range(10):
                server._start_insights_refresh(self.context)
            self.assertEqual(thread.call_count, 1)
            self.assertEqual(len(read_json(server._insights_budget_path)), 1)
            server._insights_active = False
            server._insights_attempts = deque(read_json(server._insights_budget_path))
            server._start_insights_refresh(self.context)
            self.assertEqual(thread.call_count, 1)
            self.assertIn("limit", server._insights_error)

    def test_failed_insights_preserve_last_successful_cache(self):
        old = {"entries": {weather_context.context_key(self.context): {"insights": ["last valid"], "timestamp": "2026-01-01T00:00:00+00:00"}}}
        write_json(server.INSIGHTS_CACHE_FILE, old)
        with patch.object(server, "_generate_insights", side_effect=RuntimeError("fixture")):
            server._refresh_insights(self.context)
        self.assertEqual(read_json(server.INSIGHTS_CACHE_FILE), old)
        self.assertTrue(server._insights_error)

    def test_insights_expire_on_the_location_calendar_date(self):
        now = datetime(2026, 11, 5, 0, 30, tzinfo=timezone.utc)
        with patch.object(server, "datetime", wraps=datetime) as clock:
            clock.now.side_effect = lambda zone: now.astimezone(zone)
            self.assertTrue(server._insights_current({"timestamp": "2026-11-04T08:00:00-08:00"}, self.context))
            self.assertFalse(server._insights_current({"timestamp": "2026-11-03T23:55:00-08:00"}, self.context))

    def test_pollen_failures_count_and_budget_is_persisted(self):
        with patch.dict(os.environ, {"GOOGLE_POLLEN_API_KEY": "fixture"}), patch.object(server.requests, "get", side_effect=requests.Timeout) as upstream:
            codes = [self.client.get("/api/pollen?lat=36.17&lon=-115.14").status_code for _ in range(6)]
        self.assertEqual(codes, [502] * 5 + [429])
        self.assertEqual(upstream.call_count, 5)
        self.assertEqual(len(read_json(server._pollen_budget_path)), 5)

    def test_cached_pollen_does_not_wait_for_an_unrelated_network_request(self):
        from test_pollen_api import SAMPLE_RESPONSE
        entered, release = threading.Event(), threading.Event()
        def slow(*args, **kwargs):
            entered.set()
            release.wait(5)
            response = Mock()
            response.json.return_value = SAMPLE_RESPONSE
            return response
        server._pollen_cache["40.00,-120.00"] = {"timestamp": time.time(), "payload": {"days": []}}
        with patch.dict(os.environ, {"GOOGLE_POLLEN_API_KEY": "fixture"}), patch.object(server.requests, "get", side_effect=slow):
            worker = threading.Thread(target=lambda: server.app.test_client().get("/api/pollen?lat=36.17&lon=-115.14"))
            worker.start()
            try:
                self.assertTrue(entered.wait(2))
                cached = self.client.get("/api/pollen?lat=40&lon=-120")
                self.assertTrue(cached.json["cached"])
                self.assertTrue(worker.is_alive(), "Cached data must be served while upstream is still pending")
            finally:
                release.set()
                worker.join(5)
        self.assertFalse(worker.is_alive())

    def test_household_api_responses_are_not_cacheable(self):
        for path in ["/api/history", "/api/status", "/api/config"]:
            self.assertIn("no-store", self.client.get(path).headers["Cache-Control"])

    def test_location_validation_and_cache_identity(self):
        for args in [{"lat": "nan"}, {"lon": "181"}, {"timezone": "../UTC"}]:
            self.assertEqual(self.client.get("/api/almanac", query_string=args).status_code, 400)
        other = weather_context.location_context({"lat": "47.6", "lon": "-122.3", "timezone": "America/Los_Angeles"}, 0, 0, "UTC")
        self.assertNotEqual(weather_context.context_key(other), weather_context.context_key(self.context))

    def test_almanac_uses_local_date_and_shares_lookup_with_background_insights(self):
        entered, release = threading.Event(), threading.Event()
        path = str(self.directory / "almanac.json")
        results, errors = [], []
        instant = datetime(2026, 11, 5, 0, 30, tzinfo=timezone.utc)
        def fetch(*args, **kwargs):
            entered.set()
            release.wait(5)
            response = Mock(status_code=200)
            response.json.return_value = {"daily": {"time": ["2025-11-04", "2024-11-04", "2025-11-05"],
                "temperature_2m_max": [70, 80, 99], "temperature_2m_min": [40, 50, 99]}}
            return response
        def lookup(wait):
            try:
                results.append(weather_context.get_almanac(self.context, path, wait=wait))
            except Exception as exc:
                errors.append(exc)
        with patch.object(weather_context, "datetime", wraps=datetime) as clock, patch.object(weather_context.requests, "get", side_effect=fetch) as upstream:
            clock.now.side_effect = lambda zone: instant.astimezone(zone)
            first = threading.Thread(target=lookup, args=(False,))
            second = threading.Thread(target=lookup, args=(True,))
            first.start()
            try:
                self.assertTrue(entered.wait(2))
                second.start()
            finally:
                release.set()
                first.join(5)
                second.join(5)
            self.assertEqual(upstream.call_count, 1)
            self.assertEqual(upstream.call_args.kwargs["params"]["timezone"], "America/Los_Angeles")
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["date"], "2026-11-04")
        self.assertEqual(results[0]["avg_high"], 75)
        self.assertEqual(results[0], results[1])


if __name__ == "__main__":
    unittest.main()
