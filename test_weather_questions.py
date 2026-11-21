"""Almanac question API tests; only upstream HTTP and AI are mocked."""
import os
import unittest

import govee_server

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


class WeatherQuestionTests(unittest.TestCase):
    def setUp(self):
        self.client = govee_server.app.test_client()
        budget = govee_server.app.extensions["weather_questions"]
        budget["attempts"].clear()
        budget["history_cache"] = None  # keep unit tests off the production cache path
        previous = os.environ.pop("ANTHROPIC_API_KEY", None)
        def restore_key():
            os.environ.pop("ANTHROPIC_API_KEY", None)
            if previous is not None:
                os.environ["ANTHROPIC_API_KEY"] = previous
        self.addCleanup(restore_key)

    def local_today(self, now, offset=-25200):
        from datetime import datetime, timezone
        return datetime.fromtimestamp(now + offset, timezone.utc).date()

    def upstream_fixtures(self):
        import time
        from types import SimpleNamespace
        from unittest.mock import Mock
        now = int(time.time())
        offset = -25200
        midnight = ((now + offset) // 86400) * 86400 - offset
        forecast = {
            "timezone": "America/Los_Angeles", "utc_offset_seconds": offset,
            "current": {"time": now, "temperature_2m": 84},
            "current_units": {"time": "unixtime", "temperature_2m": "°F"},
            "hourly": {"time": [now + i * 3600 for i in range(48)],
                       "temperature_2m": [84] * 48},
            "hourly_units": {"temperature_2m": "°F"},
            # past_days=7 plus forecast_days=16: seven past days, then today onward.
            "daily": {"time": [midnight + i * 86400 for i in range(-7, 16)],
                      "temperature_2m_max": [90] * 23,
                      "temperature_2m_min": [60] * 23},
            "daily_units": {"temperature_2m_max": "°F", "temperature_2m_min": "°F"},
        }
        upstream = Mock(status_code=200)
        upstream.json.return_value = forecast
        ai = Mock()
        ai.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Warm today at 84°F.")], stop_reason="end_turn")
        ai.__enter__ = Mock(return_value=ai)
        ai.__exit__ = Mock(return_value=False)
        return upstream, ai

    def archive_fixture(self):
        """30 archive days ending today-8, with a freeze at end-5 and a 30s low at end-2."""
        import time
        from datetime import timedelta
        from unittest.mock import Mock
        end = self.local_today(int(time.time())) - timedelta(days=8)
        records = {}
        for i in range(30):
            records[(end - timedelta(days=29 - i)).isoformat()] = [70.0, 50.0]
        records[(end - timedelta(days=5)).isoformat()] = [45.0, 28.0]
        records[(end - timedelta(days=2)).isoformat()] = [55.0, 35.0]
        dates = sorted(records)
        upstream = Mock(status_code=200)
        upstream.json.return_value = {"daily": {
            "time": dates,
            "temperature_2m_max": [records[d][0] for d in dates],
            "temperature_2m_min": [records[d][1] for d in dates]}}
        return upstream

    def route_upstreams(self, upstream, archive):
        def route(url, **kwargs):
            return archive if url == ARCHIVE_URL else upstream
        return route

    def ask(self, **overrides):
        payload = {"question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                   "unit": "F", "location": "Las Vegas"}
        payload.update(overrides)
        return self.client.post("/api/weather/ask", json=payload)

    def test_asks_model_using_fresh_forecast_and_history(self):
        import json
        import time
        from datetime import timedelta
        from unittest.mock import patch
        from weather_questions import FORECAST_SOURCE, ARCHIVE_SOURCE, HISTORY_DAYS, RECENT_DAYS
        upstream, ai = self.upstream_fixtures()
        archive = self.archive_fixture()
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)) as get, \
                patch("anthropic.Anthropic", return_value=ai) as sdk:
            response = self.client.post("/api/weather/ask", json={
                "question": "Should I walk outside?", "latitude": 36.17,
                "longitude": -115.14, "location": "Las Vegas", "unit": "F",
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["answer"], "Warm today at 84°F.")
        self.assertEqual(response.json["unit"], "F")
        self.assertEqual(response.json["location"], "Las Vegas")
        self.assertTrue(response.json["generated_at"].endswith("+00:00"))
        self.assertEqual(response.json["sources"], [FORECAST_SOURCE, ARCHIVE_SOURCE])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("test-only-not-a-real-key", response.get_data(as_text=True))
        self.assertEqual(get.call_count, 2)
        forecast_call, archive_call = get.call_args_list
        self.assertEqual(forecast_call.args[0], FORECAST_URL)
        params = forecast_call.kwargs["params"]
        self.assertEqual(params["latitude"], 36.17)
        self.assertEqual(params["forecast_hours"], 48)
        self.assertEqual(params["forecast_days"], 16)
        self.assertEqual(params["past_days"], RECENT_DAYS)
        self.assertEqual(params["temperature_unit"], "fahrenheit")
        self.assertFalse(forecast_call.kwargs["allow_redirects"])
        self.assertLessEqual(forecast_call.kwargs["timeout"], 12)
        self.assertEqual(archive_call.args[0], ARCHIVE_URL)
        today = self.local_today(int(time.time()))
        archive_params = archive_call.kwargs["params"]
        self.assertEqual(archive_params["start_date"], (today - timedelta(days=HISTORY_DAYS)).isoformat())
        self.assertEqual(archive_params["end_date"], (today - timedelta(days=RECENT_DAYS + 1)).isoformat())
        self.assertEqual(archive_params["daily"], "temperature_2m_max,temperature_2m_min")
        self.assertEqual(archive_params["temperature_unit"], "fahrenheit")
        self.assertFalse(archive_call.kwargs["allow_redirects"])
        self.assertEqual(sdk.call_args.kwargs["max_retries"], 0)
        self.assertLessEqual(sdk.call_args.kwargs["timeout"], 30)
        generation = ai.messages.create.call_args.kwargs
        self.assertEqual(generation["model"], govee_server.ANTHROPIC_MODEL)
        self.assertLessEqual(generation["max_tokens"], 800)
        self.assertNotIn("tools", generation)
        self.assertIn("missing", generation["system"].lower())
        self.assertIn("untrusted", generation["system"].lower())
        self.assertIn("almanac", generation["system"].lower())
        context = json.loads(generation["messages"][0]["content"])
        self.assertEqual(context["forecast"]["current"]["temperature_2m"], 84)
        self.assertEqual(len(context["forecast"]["hourly"]["time"]), 48)
        self.assertEqual(len(context["forecast"]["daily"]["time"]), 16)
        self.assertIn("retrieved_at", context)
        self.assertEqual(context["location"], "Las Vegas")
        history = context["history"]
        self.assertTrue(history["archive_available"])
        self.assertEqual(history["units"]["temperature"], "°F")
        self.assertEqual(history["coverage"]["end"], (today - timedelta(days=1)).isoformat())
        self.assertTrue(history["days"])
        self.assertIsInstance(history["milestones"], list)

    def test_history_grounds_last_freezing_question(self):
        import json
        import time
        from datetime import timedelta
        from unittest.mock import patch
        upstream, ai = self.upstream_fixtures()
        forecast = upstream.json.return_value
        forecast["daily"]["temperature_2m_min"][6] = 31.0  # yesterday dipped to freezing
        archive = self.archive_fixture()
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)), \
                patch("anthropic.Anthropic", return_value=ai):
            response = self.ask(question="When's the last time we had freezing temperatures?")
        self.assertEqual(response.status_code, 200)
        context = json.loads(ai.messages.create.call_args.kwargs["messages"][0]["content"])
        history = context["history"]
        today = self.local_today(int(time.time()))
        yesterday = (today - timedelta(days=1)).isoformat()
        self.assertEqual(history["coverage"]["end"], yesterday)
        self.assertIn([yesterday, 90.0, 31.0], history["days"])
        freezing = next(m for m in history["milestones"]
                        if m["record"].startswith("low") and "freezing" in m["record"])
        self.assertEqual(freezing["last"], {"date": yesterday, "value": 31.0})
        # The older archive freeze is still in the series, and today stays in the forecast.
        self.assertTrue(any(day[2] == 28.0 for day in history["days"]))
        self.assertEqual(len(context["forecast"]["daily"]["time"]), 16)
        self.assertNotIn(yesterday, [self.local_today(t, -25200).isoformat()
                                     for t in context["forecast"]["daily"]["time"]])

    def test_archive_failure_still_answers_from_forecast(self):
        import json
        import time
        from datetime import timedelta
        from unittest.mock import Mock, patch
        from weather_questions import FORECAST_SOURCE
        upstream, ai = self.upstream_fixtures()
        archive = Mock(status_code=503)
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)), \
                patch("anthropic.Anthropic", return_value=ai):
            response = self.ask()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["sources"], [FORECAST_SOURCE])
        context = json.loads(ai.messages.create.call_args.kwargs["messages"][0]["content"])
        history = context["history"]
        self.assertFalse(history["archive_available"])
        self.assertEqual(len(history["days"]), 7)
        self.assertEqual(history["coverage"]["end"],
                         (self.local_today(int(time.time())) - timedelta(days=1)).isoformat())

    def test_archive_cache_is_reused_within_the_same_day(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        upstream, ai = self.upstream_fixtures()
        archive = self.archive_fixture()
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        with tempfile.TemporaryDirectory() as tmp:
            cache = str(Path(tmp) / "history.json")
            govee_server.app.extensions["weather_questions"]["history_cache"] = cache
            with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)) as get, \
                    patch("anthropic.Anthropic", return_value=ai):
                self.assertEqual(self.ask().status_code, 200)
                self.assertEqual(self.ask().status_code, 200)
            archive_calls = [c for c in get.call_args_list if c.args[0] == ARCHIVE_URL]
            self.assertEqual(len(archive_calls), 1)
            self.assertEqual(get.call_count, 3)
            self.assertTrue(Path(cache).is_file())

    def test_stale_archive_cache_survives_upstream_failure(self):
        import json
        import tempfile
        from pathlib import Path
        from unittest.mock import Mock, patch
        upstream, ai = self.upstream_fixtures()
        archive = Mock(status_code=500)
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "history.json"
            cache.write_text(json.dumps({"entries": {
                "36.1700,-115.1400,F": {"date": "2000-01-01",
                                        "payload": [["2000-01-01", 40.0, 25.0]]}}}))
            govee_server.app.extensions["weather_questions"]["history_cache"] = str(cache)
            with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)), \
                    patch("anthropic.Anthropic", return_value=ai):
                response = self.ask()
        self.assertEqual(response.status_code, 200)
        context = json.loads(ai.messages.create.call_args.kwargs["messages"][0]["content"])
        history = context["history"]
        self.assertTrue(history["archive_stale"])
        self.assertIn(["2000-01-01", 40.0, 25.0], history["days"])

    def test_rejects_invalid_input_before_external_calls(self):
        import json
        from unittest.mock import patch
        valid = {"question": "Rain tomorrow?", "latitude": 36.17,
                 "longitude": -115.14, "unit": "F", "location": "Las Vegas"}
        invalid = [None, [], "text", {}, dict(valid, question=" "),
                   dict(valid, question="q" * 1001), dict(valid, question=42),
                   dict(valid, location=" "), dict(valid, location="x" * 121),
                   dict(valid, location=[]), dict(valid, unit="f"),
                   dict(valid, unit=[]), dict(valid, latitude=True),
                   dict(valid, latitude="36"), dict(valid, latitude=91),
                   dict(valid, latitude=float("nan")), dict(valid, latitude=float("inf")),
                   dict(valid, longitude=-181), dict(valid, longitude=None),
                   dict(valid, forecast={"temperature": 999}),
                   dict(valid, url="http://127.0.0.1/private"),
                   dict(valid, question="hi\x00there")]
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        with patch("requests.get") as get, patch("anthropic.Anthropic") as sdk:
            for payload in invalid:
                with self.subTest(payload=repr(payload)[:90]):
                    response = self.client.post("/api/weather/ask", data=json.dumps(payload), content_type="application/json")
                    self.assertEqual(response.status_code, 400)
                    self.assertIsInstance(response.json["error"], str)
            response = self.client.post("/api/weather/ask", data="{", content_type="application/json")
            self.assertEqual(response.status_code, 400)
            self.assertIn("error", response.json)
            response = self.client.post("/api/weather/ask", data=json.dumps(valid), content_type="text/plain")
            self.assertEqual(response.status_code, 415)
            self.assertIn("error", response.json)
            response = self.client.post("/api/weather/ask", data=" " * 8193, content_type="application/json")
            self.assertEqual(response.status_code, 413)
            self.assertIn("error", response.json)
            get.assert_not_called()
            sdk.assert_not_called()

    def test_cross_origin_requests_are_blocked_without_paid_calls(self):
        from unittest.mock import patch
        valid = {"question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                 "unit": "C", "location": "Las Vegas"}
        with patch("requests.get") as get, patch("anthropic.Anthropic") as sdk:
            for headers in ({"Origin": "https://evil.example"}, {"Origin": "null"},
                            {"Origin": "http://192.168.1.20:9000"},
                            {"Origin": "http://192.168.1.20:***@evil.example"},
                            {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"},
                            {"Referer": "https://evil.example/dashboard"}):
                with self.subTest(headers=headers):
                    response = self.client.post("/api/weather/ask", json=valid,
                        base_url="http://192.168.1.20:8000", headers=headers)
                    self.assertEqual(response.status_code, 403)
                    self.assertIn("error", response.json)
            get.assert_not_called()
            sdk.assert_not_called()

    def test_configured_public_https_origin_works_behind_http_proxy(self):
        from unittest.mock import patch
        upstream, ai = self.upstream_fixtures()
        archive = self.archive_fixture()
        payload = {"question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                   "unit": "F", "location": "Las Vegas"}
        with patch.dict(os.environ, {"WEATHER_PUBLIC_ORIGIN": "https://weather.cullum.dad",
                                     "ANTHROPIC_API_KEY": "test-only-not-a-real-key"}), \
                patch("requests.get", side_effect=self.route_upstreams(upstream, archive)), \
                patch("anthropic.Anthropic", return_value=ai):
            for host in ("http://localhost:8000", "http://weather.cullum.dad"):
                for headers in ({"Origin": "https://weather.cullum.dad", "Sec-Fetch-Site": "same-origin"},
                                {"Referer": "https://weather.cullum.dad/", "Sec-Fetch-Site": "same-origin"}):
                    with self.subTest(host=host, headers=headers):
                        response = self.client.post("/api/weather/ask", json=payload,
                                                    base_url=host, headers=headers)
                        self.assertEqual(response.status_code, 200, response.json)

    def test_public_origin_does_not_trust_other_origins_or_forwarded_headers(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {"WEATHER_PUBLIC_ORIGIN": "https://weather.cullum.dad"}), \
                patch("requests.get") as get, patch("anthropic.Anthropic") as sdk:
            for origin in ("https://evil.example", "https://weather.cullum.dad.evil.example",
                           "http://weather.cullum.dad", "https://weather.cullum.dad:8443",
                           "https://weathe....dad@evil.example", "null"):
                response = self.client.post("/api/weather/ask", json={}, headers={
                    "Origin": origin, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "evil.example"})
                self.assertEqual(response.status_code, 403, origin)
            response = self.client.post("/api/weather/ask", json={}, headers={
                "Origin": "https://weather.cullum.dad", "Sec-Fetch-Site": "cross-site"})
            self.assertEqual(response.status_code, 403)
            get.assert_not_called()
            sdk.assert_not_called()

    def test_missing_key_fails_safely_for_same_origin_lan(self):
        from unittest.mock import patch
        with patch("requests.get") as get, patch("anthropic.Anthropic") as sdk:
            response = self.client.post("/api/weather/ask", json={
                "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                "unit": "C", "location": "Las Vegas"},
                base_url="http://192.168.1.20:8000", headers={"Origin": "http://192.168.1.20:8000"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("not configured", response.json["error"])
        get.assert_not_called()
        sdk.assert_not_called()

    def test_forecast_failures_return_safe_json_without_ai(self):
        import requests
        from unittest.mock import Mock, patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        payload = {"question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                   "unit": "F", "location": "Las Vegas"}
        for failure, status in ((requests.Timeout("private-secret"), 504),
                                (requests.ConnectionError("private-secret"), 502),
                                (ValueError("private-secret"), 502)):
            upstream = Mock(status_code=200)
            upstream.json.side_effect = failure
            with self.subTest(kind=type(failure).__name__), patch("requests.get", return_value=upstream) as get, patch("anthropic.Anthropic") as sdk:
                response = self.client.post("/api/weather/ask", json=payload)
                self.assertEqual(response.status_code, status)
                self.assertIsInstance(response.json["error"], str)
                self.assertNotIn("private-secret", response.get_data(as_text=True))
                self.assertEqual(get.call_count, 1)
                sdk.assert_not_called()

    def test_unusable_forecasts_never_reach_ai(self):
        import copy
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, _ = self.upstream_fixtures()
        good = upstream.json.return_value
        stale = copy.deepcopy(good)
        stale["current"]["time"] -= 86400
        for forecast in ({}, [], {"error": True}, dict(good, current=None),
                         stale, dict(good, hourly={}), dict(good, daily={})):
            with self.subTest(forecast=str(forecast)[:60]):
                upstream.json.return_value = forecast
                with patch("requests.get", return_value=upstream), patch("anthropic.Anthropic") as sdk:
                    response = self.client.post("/api/weather/ask", json={
                        "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                        "unit": "F", "location": "Las Vegas"})
                self.assertEqual(response.status_code, 502)
                self.assertIn("error", response.json)
                sdk.assert_not_called()

    def test_anthropic_credit_failure_is_reported_as_configuration_issue(self):
        import anthropic
        from unittest.mock import Mock, patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, ai = self.upstream_fixtures()
        archive = self.archive_fixture()
        ai.messages.create.side_effect = anthropic.BadRequestError(
            "Your credit balance is too low to access the Anthropic API.",
            response=Mock(status_code=400), body={})
        with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)), \
                patch("anthropic.Anthropic", return_value=ai):
            response = self.ask()
        self.assertEqual(response.status_code, 503)
        self.assertIn("credit", response.json["error"].lower())
        self.assertNotIn("Your credit balance is too low", response.get_data(as_text=True))

    def test_ai_failures_are_safe_and_never_retried(self):
        import anthropic
        # Anthropic 1.x uses httpx2; the existing 0.x SDK uses httpx.
        try:
            import httpx2 as httpx
        except ImportError:
            import httpx
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        failures = [(anthropic.APITimeoutError(request=req), 504),
                    (anthropic.AuthenticationError("private-secret", response=httpx.Response(401, request=req), body={}), 503),
                    (anthropic.RateLimitError("private-secret", response=httpx.Response(429, request=req), body={}), 503),
                    (anthropic.APIConnectionError(message="private-secret", request=req), 502),
                    (RuntimeError("private-secret"), 502)]
        for failure, status in failures:
            upstream, ai = self.upstream_fixtures()
            archive = self.archive_fixture()
            ai.messages.create.side_effect = failure
            with self.subTest(kind=type(failure).__name__), \
                    patch("requests.get", side_effect=self.route_upstreams(upstream, archive)), \
                    patch("anthropic.Anthropic", return_value=ai):
                response = self.ask()
                self.assertEqual(response.status_code, status)
                self.assertIn("error", response.json)
                self.assertNotIn("private-secret", response.get_data(as_text=True))
                self.assertEqual(ai.messages.create.call_count, 1)

    def test_global_cost_budget_is_shared_across_clients(self):
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, ai = self.upstream_fixtures()
        archive = self.archive_fixture()
        with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)) as get, \
                patch("anthropic.Anthropic", return_value=ai):
            for index in range(11):
                response = self.client.post("/api/weather/ask", json={
                    "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                    "unit": "F", "location": "Las Vegas"},
                    environ_overrides={"REMOTE_ADDR": "192.168.1." + str(index + 1)})
            self.assertEqual(response.status_code, 429)
            self.assertIn("error", response.json)
            self.assertGreater(int(response.headers["Retry-After"]), 0)
            self.assertLessEqual(get.call_count, 20)
            self.assertLessEqual(ai.messages.create.call_count, 10)

    def test_only_one_question_runs_at_a_time_and_slot_releases(self):
        import threading
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, ai = self.upstream_fixtures()
        archive = self.archive_fixture()
        started, release = threading.Event(), threading.Event()
        answer = ai.messages.create.return_value
        def slow_ai(**kwargs):
            started.set()
            release.wait(5)
            return answer
        ai.messages.create.side_effect = slow_ai
        payload = {"question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                   "unit": "F", "location": "Las Vegas"}
        completed = []
        def first_request():
            with govee_server.app.test_client() as client:
                completed.append(client.post("/api/weather/ask", json=payload).status_code)
        with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)) as get, \
                patch("anthropic.Anthropic", return_value=ai):
            worker = threading.Thread(target=first_request)
            worker.start()
            try:
                self.assertTrue(started.wait(2))
                second = self.client.post("/api/weather/ask", json=payload)
                self.assertEqual(second.status_code, 429)
                self.assertIn("busy", second.json["error"].lower())
                self.assertEqual(get.call_count, 2)
            finally:
                release.set()
                worker.join(6)
            self.assertEqual(completed, [200])
            self.assertEqual(self.client.post("/api/weather/ask", json=payload).status_code, 200)

    def test_empty_or_action_responses_fail_instead_of_faking_success(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        for blocks, reason in (([], "end_turn"),
                               ([SimpleNamespace(type="text", text=" ")], "end_turn"),
                               ([SimpleNamespace(type="tool_use", name="secret_action")], "tool_use"),
                               ([SimpleNamespace(type="text", text="partial")], "max_tokens")):
            upstream, ai = self.upstream_fixtures()
            archive = self.archive_fixture()
            ai.messages.create.return_value = SimpleNamespace(content=blocks, stop_reason=reason)
            with self.subTest(reason=reason), \
                    patch("requests.get", side_effect=self.route_upstreams(upstream, archive)), \
                    patch("anthropic.Anthropic", return_value=ai):
                response = self.ask()
                self.assertEqual(response.status_code, 502)
                self.assertIn("error", response.json)

    def test_forecast_context_is_bounded_and_celsius_lan_works(self):
        import json
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, ai = self.upstream_fixtures()
        archive = self.archive_fixture()
        forecast = upstream.json.return_value
        forecast["unexpected"] = "untrusted-extra" * 10000
        for section, length in (("hourly", 100), ("daily", 30)):
            base = forecast[section]["time"][0]
            step = 3600 if section == "hourly" else 86400
            forecast[section]["time"] = [base + i * step for i in range(length)]
            forecast[section]["temperature_2m" if section == "hourly" else "temperature_2m_max"] = [None] * length
        forecast["current_units"]["temperature_2m"] = "°C"
        with patch("requests.get", side_effect=self.route_upstreams(upstream, archive)) as get, \
                patch("anthropic.Anthropic", return_value=ai):
            response = self.client.post("/api/weather/ask", json={
                "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                "unit": "C", "location": " Las Vegas "},
                base_url="http://192.168.1.20:8000", headers={"Origin": "http://192.168.1.20:8000"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["unit"], "C")
        self.assertEqual(response.json["location"], "Las Vegas")
        self.assertEqual(get.call_args.kwargs["params"]["temperature_unit"], "celsius")
        context = json.loads(ai.messages.create.call_args.kwargs["messages"][0]["content"])
        self.assertNotIn("unexpected", context["forecast"])
        self.assertEqual(len(context["forecast"]["hourly"]["time"]), 48)
        self.assertEqual(len(context["forecast"]["daily"]["time"]), 16)
        self.assertIsNone(context["forecast"]["hourly"]["temperature_2m"][0])
        self.assertEqual(context["history"]["units"]["temperature"], "°C")
        self.assertLess(len(json.dumps(context)), 40000)

    def test_redirected_forecast_is_not_used(self):
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, _ = self.upstream_fixtures()
        upstream.status_code = 302
        with patch("requests.get", return_value=upstream), patch("anthropic.Anthropic") as sdk:
            response = self.ask()
        self.assertEqual(response.status_code, 502)
        sdk.assert_not_called()

    def test_deeply_nested_json_returns_readable_error(self):
        response = self.client.post("/api/weather/ask", data="[" * 1100 + "]" * 1100,
                                    content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json)

    def test_status_reports_configuration_without_provider_call(self):
        response = self.client.get("/api/weather/ask/status")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["available"])
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        response = self.client.get("/api/weather/ask/status")
        self.assertTrue(response.json["available"])
        self.assertNotIn("test-only-not-a-real-key", response.get_data(as_text=True))
        self.assertEqual(response.headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
