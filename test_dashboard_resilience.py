"""Browser regressions for independent data refresh, freshness, and offline shell."""
import os
import unittest
from playwright.sync_api import sync_playwright


class DashboardResilienceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(channel="msedge", headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(service_workers="block", reduced_motion="reduce")
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.page.route("https://**/*", lambda route: route.abort())
        self.page.route("**/api/**", lambda route: route.fulfill(json={"items": [], "series": {}, "insights": []}))
        self.page.add_init_script("navigator.geolocation.getCurrentPosition = (_, fail) => fail({code:1})")
        self.page.goto(os.environ.get("DASHBOARD_TEST_URL", "http://localhost:8000"), wait_until="domcontentloaded")
        self.page.wait_for_function("() => dashboardRefreshTasks.every(task => !task.running)")

    def readings(self):
        self.page.route("**/api/readings", lambda route: route.fulfill(json={"items": [{
            "device": "fresh", "name": "Office", "temp_f": 70, "temp_c": 21.1, "humidity": 40,
            "timestamp": "2026-11-05T00:00:00Z",
        }]}))

    def test_history_network_failure_keeps_new_readings(self):
        self.readings()
        self.page.route("**/api/history", lambda route: route.abort())
        device = self.page.evaluate("async () => {await loadData({forceHistory:true}); return _lastReadings.items[0].device;}")
        self.assertEqual(device, "fresh")

    def test_invalid_history_json_keeps_new_readings(self):
        self.readings()
        self.page.route("**/api/history", lambda route: route.fulfill(body="{invalid", content_type="application/json"))
        device = self.page.evaluate("async () => {await loadData({forceHistory:true}); return _lastReadings.items[0].device;}")
        self.assertEqual(device, "fresh")

    def test_freshness_ages_without_new_network_payloads(self):
        result = self.page.evaluate("""() => {
            const now = Date.now;
            const readings = {last_live_age_seconds:10, _receivedAt:now()};
            updateFreshness(readings);
            const initial = elements.freshness.textContent;
            Date.now = () => now() + 3600000;
            try {updateFreshness(readings); return [initial, elements.freshness.textContent, elements.freshness.className];}
            finally {Date.now = now;}
        }""")
        self.assertIn("10s", result[0])
        self.assertIn("1h", result[1])
        self.assertIn("stale", result[2])

    def test_failed_dashboard_fetch_clears_live_indicator(self):
        self.page.route("**/api/readings", lambda route: route.abort())
        result = self.page.evaluate("""async () => {
            _lastReadings={items:[],last_live_at:new Date().toISOString()};
            await loadData();return [elements.freshness.textContent,elements.freshness.className];
        }""")
        self.assertIn("failed", result[0].lower())
        self.assertIn("stale", result[1])

    def test_forced_insights_use_post_and_forecast_location(self):
        captured = []
        def reply(route):
            captured.append((route.request.method, route.request.url))
            route.fulfill(status=202, json={"insights": [], "refreshing": True})
        self.page.route("**/api/almanac/insights*", reply)
        self.page.evaluate("async () => {_lastWeather={lat:47.6,lon:-122.3,data:{timezone:'America/Los_Angeles'}};await loadAlmanacInsights(true);}")
        self.assertEqual(captured[0][0], "POST")
        self.assertIn("lat=47.6", captured[0][1])
        self.assertIn("lon=-122.3", captured[0][1])
        self.assertIn("Preparing", self.page.locator("#aiInsights").text_content())

    def test_offline_shell_loads_versioned_scripts_and_overview_styles(self):
        # A separate context enables the real service worker; no API responses are cached.
        with self.browser.new_context(service_workers="allow", reduced_motion="reduce") as context:
            page = context.new_page()
            context.route("https://**/*", lambda route: route.abort())
            context.route("**/api/**", lambda route: route.fulfill(json={"items": [], "series": {}, "insights": []}))
            page.add_init_script("navigator.geolocation.getCurrentPosition = (_, fail) => fail({code:1})")
            page.goto(os.environ.get("DASHBOARD_TEST_URL", "http://localhost:8000"), wait_until="domcontentloaded")
            page.evaluate("async () => {await navigator.serviceWorker.ready;}")
            page.wait_for_function("() => navigator.serviceWorker.controller !== null")
            context.set_offline(True)
            page.reload(wait_until="domcontentloaded")
            self.assertEqual(page.evaluate("typeof loadData"), "function")
            self.assertEqual(page.locator("#desktopOverview").count(), 1)
            self.assertTrue(page.evaluate("[...document.styleSheets].some(s => s.href?.includes('desktop-overview.css') && s.cssRules.length > 0)"))
            self.assertEqual(page.evaluate("async () => (await caches.match('/api/history')) === undefined"), True)


if __name__ == "__main__":
    unittest.main()
