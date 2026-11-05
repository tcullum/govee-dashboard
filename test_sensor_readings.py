import unittest
from unittest.mock import Mock, patch

import govee_server as server


class SensorReadingsTests(unittest.TestCase):
    def setUp(self):
        self.sensor = {"name": "Office", "device": "test", "sku": "H5110"}
        self.saved = (server._readings_cache, server._readings_cache_time,
                      server._readings_last_success_time, server._readings_last_error)

    def tearDown(self):
        (server._readings_cache, server._readings_cache_time,
         server._readings_last_success_time, server._readings_last_error) = self.saved

    def test_blank_readings_are_not_logged_as_success(self):
        state = {"payload": {"capabilities": [
            {"instance": "sensorTemperature", "state": {"value": ""}},
            {"instance": "sensorHumidity", "state": {"value": ""}},
        ]}}
        with patch.object(server, "get_state", return_value=state), \
                patch.object(server, "_append_log_row") as log:
            item, error = server._fetch_sensor_data(self.sensor, "now")
        self.assertIsNone(item)
        self.assertIn("no temperature or humidity", error)
        log.assert_not_called()

    def test_govee_error_inside_http_success_is_rejected(self):
        response = Mock(status_code=200)
        response.json.return_value = {"code": 500, "msg": "Unavailable"}
        with patch.object(server.requests, "post", return_value=response), \
                patch.object(server.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "code 500"):
                server.get_state("H5110", "test")

    def test_blank_history_does_not_replace_last_valid_reading(self):
        with patch.dict(server._latest_by_device, {}, clear=True), \
                patch.dict(server._history_cache, {}, clear=True):
            server._history_append("test", "old", 20, 40, "Office")
            server._history_append("test", "new", None, None, "Office")
            self.assertEqual(server._latest_by_device["test"]["timestamp"], "old")

    def test_partial_update_preserves_missing_sensor_and_error(self):
        server._readings_cache = {"items": [{"device": "missing", "timestamp": "old"}]}
        server._store_readings_cache({"items": [{"device": "ok"}], "note": "missing: timeout"})
        self.assertEqual(len(server._readings_cache["items"]), 2)
        self.assertTrue(server._readings_cache["items"][1]["stale"])
        self.assertEqual(server._readings_last_error, "missing: timeout")

    def test_old_cache_is_served_while_retrying(self):
        server._readings_cache = {"items": [{"device": "test"}]}
        server._readings_cache_time = 1
        with patch.object(server, "_start_readings_refresh") as refresh, \
                patch.object(server, "_poll_readings_live") as poll:
            response = server.app.test_client().get("/api/readings")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["cached"])
        refresh.assert_called_once()
        poll.assert_not_called()

    def test_temperature_units_are_explicit_and_nonfinite_values_are_rejected(self):
        with patch.object(server, "GOVEE_TEMPERATURE_UNIT", "F"):
            self.assertEqual(server.normalize_temp_f_from_raw(68), 68)
        with patch.object(server, "GOVEE_TEMPERATURE_UNIT", "C"):
            self.assertEqual(server.normalize_temp_f_from_raw(20), 68)
            self.assertEqual(server.normalize_temp_f_from_raw(-10), 14)
        for value in ("NaN", "Infinity", "", None):
            self.assertIsNone(server.normalize_temp_f_from_raw(value))
            self.assertIsNone(server.normalize_humidity(value))


if __name__ == "__main__":
    unittest.main()
