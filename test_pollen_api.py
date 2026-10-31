import os
import sys
import types
import unittest
from unittest.mock import Mock, patch

sys.modules.setdefault("anthropic", types.SimpleNamespace())
import govee_server


SAMPLE_RESPONSE = {
    "regionCode": "US",
    "dailyInfo": [{
        "date": {"year": 2026, "month": 7, "day": 23},
        "pollenTypeInfo": [{
            "code": "TREE",
            "displayName": "Tree",
            "inSeason": True,
            "indexInfo": {
                "value": 3,
                "category": "Moderate",
                "indexDescription": "Some people may experience symptoms.",
            },
            "healthRecommendations": ["Consider limiting prolonged outdoor activity."],
        }],
        "plantInfo": [],
    }],
}


class PollenApiTests(unittest.TestCase):
    def setUp(self):
        self.client = govee_server.app.test_client()
        govee_server._pollen_cache.clear()
        govee_server._pollen_request_times.clear()
        govee_server._pollen_client_requests.clear()

    def test_requires_server_api_key(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GOOGLE_POLLEN_API_KEY", None)
            response = self.client.get("/api/pollen?lat=36.17&lon=-115.14")
        self.assertEqual(response.status_code, 503)

    def test_fetches_and_reuses_normalized_response_without_key(self):
        upstream = Mock()
        upstream.json.return_value = SAMPLE_RESPONSE
        upstream.raise_for_status.return_value = None

        with (
            patch.dict(os.environ, {"GOOGLE_POLLEN_API_KEY": "server-secret"}),
            patch("govee_server.requests.get", return_value=upstream) as get,
        ):
            first = self.client.get("/api/pollen?lat=36.17&lon=-115.14")
            second = self.client.get("/api/pollen?lat=36.17&lon=-115.14")

        self.assertEqual(first.status_code, 200)
        self.assertFalse(first.json["cached"])
        self.assertTrue(second.json["cached"])
        self.assertEqual(first.json["days"][0]["types"][0]["value"], 3)
        self.assertNotIn("server-secret", first.get_data(as_text=True))
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.kwargs["params"]["key"], "server-secret")
        self.assertEqual(get.call_args.kwargs["params"]["days"], 3)

    def test_rejects_invalid_coordinates_without_upstream_call(self):
        with (
            patch.dict(os.environ, {"GOOGLE_POLLEN_API_KEY": "server-secret"}),
            patch("govee_server.requests.get") as get,
        ):
            response = self.client.get("/api/pollen?lat=91&lon=0")
        self.assertEqual(response.status_code, 400)
        get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
