"""Weather question API tests; only upstream HTTP and AI are mocked."""
import os
import unittest

import govee_server


class WeatherQuestionTests(unittest.TestCase):
    def setUp(self):
        self.client = govee_server.app.test_client()
        govee_server.app.extensions["weather_questions"]["attempts"].clear()
        previous = os.environ.pop("ANTHROPIC_API_KEY", None)
        def restore_key():
            os.environ.pop("ANTHROPIC_API_KEY", None)
            if previous is not None:
                os.environ["ANTHROPIC_API_KEY"] = previous
        self.addCleanup(restore_key)

    def upstream_fixtures(self):
        import json
        import time
        from types import SimpleNamespace
        from unittest.mock import Mock, patch
        now = int(time.time())
        forecast = {
            "timezone": "America/Los_Angeles", "utc_offset_seconds": -25200,
            "current": {"time": now, "temperature_2m": 84},
            "current_units": {"time": "unixtime", "temperature_2m": "°F"},
            "hourly": {"time": [now + i * 3600 for i in range(48)],
                       "temperature_2m": [84] * 48},
            "hourly_units": {"temperature_2m": "°F"},
            "daily": {"time": [now + i * 86400 for i in range(7)],
                      "temperature_2m_max": [90] * 7},
            "daily_units": {"temperature_2m_max": "°F"},
        }
        upstream = Mock(status_code=200)
        upstream.json.return_value = forecast
        ai = Mock()
        ai.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Warm today at 84°F.")], stop_reason="end_turn")
        ai.__enter__ = Mock(return_value=ai)
        ai.__exit__ = Mock(return_value=False)
        return upstream, ai

    def test_asks_model_using_only_fresh_server_forecast(self):
        import json
        from unittest.mock import patch
        upstream, ai = self.upstream_fixtures()
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        with patch("requests.get", return_value=upstream) as get, patch("anthropic.Anthropic", return_value=ai) as sdk:
            response = self.client.post("/api/weather/ask", json={
                "question": "Should I walk outside?", "latitude": 36.17,
                "longitude": -115.14, "location": "Las Vegas", "unit": "F",
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["answer"], "Warm today at 84°F.")
        self.assertEqual(response.json["unit"], "F")
        self.assertEqual(response.json["location"], "Las Vegas")
        self.assertTrue(response.json["generated_at"].endswith("+00:00"))
        self.assertEqual(response.json["sources"], [{"label": "Open-Meteo forecast", "url": "https://open-meteo.com/"}])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("test-only-not-a-real-key", response.get_data(as_text=True))
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.args[0], "https://api.open-meteo.com/v1/forecast")
        params = get.call_args.kwargs["params"]
        self.assertEqual(params["latitude"], 36.17)
        self.assertEqual(params["forecast_hours"], 48)
        self.assertEqual(params["forecast_days"], 7)
        self.assertEqual(params["temperature_unit"], "fahrenheit")
        self.assertFalse(get.call_args.kwargs["allow_redirects"])
        self.assertLessEqual(get.call_args.kwargs["timeout"], 12)
        self.assertEqual(sdk.call_args.kwargs["max_retries"], 0)
        self.assertLessEqual(sdk.call_args.kwargs["timeout"], 30)
        generation = ai.messages.create.call_args.kwargs
        self.assertEqual(generation["model"], govee_server.ANTHROPIC_MODEL)
        self.assertLessEqual(generation["max_tokens"], 800)
        self.assertNotIn("tools", generation)
        self.assertIn("missing", generation["system"].lower())
        self.assertIn("untrusted", generation["system"].lower())
        context = json.loads(generation["messages"][0]["content"])
        self.assertEqual(context["forecast"]["current"]["temperature_2m"], 84)
        self.assertEqual(len(context["forecast"]["hourly"]["time"]), 48)
        self.assertEqual(len(context["forecast"]["daily"]["time"]), 7)
        self.assertIn("retrieved_at", context)
        self.assertEqual(context["location"], "Las Vegas")

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
                            {"Origin": "http://192.168.1.20:8000@evil.example"},
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
        payload = {"question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                   "unit": "F", "location": "Las Vegas"}
        with patch.dict(os.environ, {"WEATHER_PUBLIC_ORIGIN": "https://weather.cullum.dad",
                                     "ANTHROPIC_API_KEY": "test-only-not-a-real-key"}), \
                patch("requests.get", return_value=upstream), \
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
                           "https://weather.cullum.dad@evil.example", "null"):
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
        ai.messages.create.side_effect = anthropic.BadRequestError(
            "Your credit balance is too low to access the Anthropic API.",
            response=Mock(status_code=400), body={})
        with patch("requests.get", return_value=upstream), patch("anthropic.Anthropic", return_value=ai):
            response = self.client.post("/api/weather/ask", json={
                "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                "unit": "F", "location": "Las Vegas"})
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
            ai.messages.create.side_effect = failure
            with self.subTest(kind=type(failure).__name__), patch("requests.get", return_value=upstream), patch("anthropic.Anthropic", return_value=ai):
                response = self.client.post("/api/weather/ask", json={
                    "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                    "unit": "F", "location": "Las Vegas"})
                self.assertEqual(response.status_code, status)
                self.assertIn("error", response.json)
                self.assertNotIn("private-secret", response.get_data(as_text=True))
                self.assertEqual(ai.messages.create.call_count, 1)

    def test_global_cost_budget_is_shared_across_clients(self):
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, ai = self.upstream_fixtures()
        with patch("requests.get", return_value=upstream) as get, patch("anthropic.Anthropic", return_value=ai):
            for index in range(11):
                response = self.client.post("/api/weather/ask", json={
                    "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                    "unit": "F", "location": "Las Vegas"},
                    environ_overrides={"REMOTE_ADDR": "192.168.1." + str(index + 1)})
            self.assertEqual(response.status_code, 429)
            self.assertIn("error", response.json)
            self.assertGreater(int(response.headers["Retry-After"]), 0)
            self.assertLessEqual(get.call_count, 10)
            self.assertLessEqual(ai.messages.create.call_count, 10)

    def test_only_one_question_runs_at_a_time_and_slot_releases(self):
        import threading
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, ai = self.upstream_fixtures()
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
        with patch("requests.get", return_value=upstream) as get, patch("anthropic.Anthropic", return_value=ai):
            worker = threading.Thread(target=first_request)
            worker.start()
            try:
                self.assertTrue(started.wait(2))
                second = self.client.post("/api/weather/ask", json=payload)
                self.assertEqual(second.status_code, 429)
                self.assertIn("busy", second.json["error"].lower())
                self.assertEqual(get.call_count, 1)
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
            ai.messages.create.return_value = SimpleNamespace(content=blocks, stop_reason=reason)
            with self.subTest(reason=reason), patch("requests.get", return_value=upstream), patch("anthropic.Anthropic", return_value=ai):
                response = self.client.post("/api/weather/ask", json={
                    "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                    "unit": "F", "location": "Las Vegas"})
                self.assertEqual(response.status_code, 502)
                self.assertIn("error", response.json)

    def test_forecast_context_is_bounded_and_celsius_lan_works(self):
        import json
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, ai = self.upstream_fixtures()
        forecast = upstream.json.return_value
        forecast["unexpected"] = "untrusted-extra" * 10000
        for section, length in (("hourly", 100), ("daily", 30)):
            base = forecast[section]["time"][0]
            step = 3600 if section == "hourly" else 86400
            forecast[section]["time"] = [base + i * step for i in range(length)]
            forecast[section]["temperature_2m" if section == "hourly" else "temperature_2m_max"] = [None] * length
        forecast["current_units"]["temperature_2m"] = "°C"
        with patch("requests.get", return_value=upstream) as get, patch("anthropic.Anthropic", return_value=ai):
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
        self.assertEqual(len(context["forecast"]["daily"]["time"]), 7)
        self.assertIsNone(context["forecast"]["hourly"]["temperature_2m"][0])
        self.assertLess(len(json.dumps(context)), 40000)

    def test_redirected_forecast_is_not_used(self):
        from unittest.mock import patch
        os.environ["ANTHROPIC_API_KEY"] = "test-only-not-a-real-key"
        upstream, _ = self.upstream_fixtures()
        upstream.status_code = 302
        with patch("requests.get", return_value=upstream), patch("anthropic.Anthropic") as sdk:
            response = self.client.post("/api/weather/ask", json={
                "question": "Rain?", "latitude": 36.17, "longitude": -115.14,
                "unit": "F", "location": "Las Vegas"})
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
