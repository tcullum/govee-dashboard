"""Behavior checks for tab lifecycle, background refresh, and mobile information."""
import unittest
from playwright.sync_api import sync_playwright


class DashboardTabsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(channel='msedge', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':1024,'height':900}, service_workers='block', reduced_motion='reduce')
        self.page = self.context.new_page()
        self.requested = []
        self.page.on("request", lambda request: self.requested.append(request.url))
        self.page.add_init_script("navigator.geolocation.getCurrentPosition = (_, fail) => fail({code:1})")
        self.page.route('https://**/*', lambda r: r.abort())
        self.page.route('**/api/**', lambda r: r.fulfill(json={'items': [], 'series': {}, 'insights': []}))
        self.page.goto('http://localhost:8000', wait_until='domcontentloaded')
        self.page.wait_for_function('() => dashboardRefreshTasks.every(t => !t.running)')

    def tearDown(self):
        self.context.close()

    def test_initial_house_view_does_not_request_secondary_feeds(self):
        for url in self.requested:
            self.assertNotIn('/api/almanac', url)
            self.assertNotIn('/api/pollen', url)
            self.assertNotIn('air-quality-api.open-meteo.com', url)
            self.assertNotIn('nowcoast.noaa.gov', url)
            self.assertNotIn('message_type=alert', url)

    def test_secondary_feeds_are_lazy_and_revisits_use_cached_results(self):
        self.page.evaluate("""() => {
          window.calls = {};
          for (const task of dashboardRefreshTasks) {
            task.lastAttempt = 0;
            task.load = () => { calls[task.key] = (calls[task.key] || 0) + 1; };
          }
          refreshDashboard();
        }""")
        self.page.wait_for_function('() => dashboardRefreshTasks.every(t => !t.running)')
        self.assertEqual(self.page.evaluate('calls'), {'readings': 1, 'weather': 1})
        self.page.locator('#tab-interesting').click()
        self.page.wait_for_function('() => calls.national === 1')
        self.page.locator('#tab-house').click()
        self.page.locator('#tab-interesting').click()
        self.assertEqual(self.page.evaluate('calls.national'), 1)
        self.page.locator('#tab-ai').click()
        self.page.wait_for_function('() => calls.insights === 1')
        self.page.locator('#tab-local').click()
        self.page.wait_for_function('() => calls.local === 1')
        self.assertEqual(self.page.evaluate('calls'), {'readings': 1, 'weather': 1, 'national': 1, 'insights': 1, 'local': 1})

    def test_hidden_page_pauses_and_return_refreshes_only_stale_active_resources(self):
        self.page.evaluate("""() => {
          window.calls = {};
          for (const task of dashboardRefreshTasks) {
            task.lastAttempt = Date.now() - 1000000;
            task.load = () => { calls[task.key] = (calls[task.key] || 0) + 1; };
          }
          Object.defineProperty(document, 'hidden', {configurable:true, get:() => true});
          refreshDashboard();
        }""")
        self.assertEqual(self.page.evaluate('calls'), {})
        self.page.evaluate("delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))")
        self.page.wait_for_function('() => dashboardRefreshTasks.every(t => !t.running)')
        self.assertEqual(self.page.evaluate('calls'), {'readings': 1, 'weather': 1})
        self.page.evaluate('refreshDashboard()')
        self.assertEqual(self.page.evaluate('calls'), {'readings': 1, 'weather': 1})

    def test_refresh_does_not_overlap_an_inflight_request(self):
        self.page.evaluate("""() => {
          window.started = 0;
          const task = dashboardRefreshTasks.find(t => t.key === 'readings');
          task.lastAttempt = 0;
          task.load = () => { started++; return new Promise(resolve => { window.finishLoad = resolve; }); };
          refreshDashboard();
        }""")
        self.page.wait_for_function('() => started === 1')
        self.page.evaluate('refreshDashboard(Date.now() + 1000000)')
        self.assertEqual(self.page.evaluate('started'), 1)
        self.page.evaluate('finishLoad()')

    def test_mobile_information_and_warning_indicators_remain_accessible(self):
        self.page.set_viewport_size({'width': 320, 'height': 900})
        self.page.evaluate("""() => {
          renderSensors({items:[{device:'a', name:'Living Room', temp_c:20, temp_f:68, humidity:20, timestamp:new Date().toISOString()}, {device:'b', name:'Backyard', temp_c:30, temp_f:86, humidity:18, timestamp:new Date().toISOString()}]}, {});
        }""")
        self.assertIn('sensors need attention', self.page.locator('#tab-house').get_attribute('aria-label'))
        self.page.locator('#tab-local').click()
        self.assertTrue(self.page.locator('#almanacContainer').is_visible())
        self.assertGreater(self.page.locator('.attention-item:visible').count(), 1)
        self.page.evaluate("setTabAttention('local', '2 active local weather alerts')")
        self.assertIn('2 active local weather alerts', self.page.locator('#tab-local').get_attribute('aria-label'))
        self.assertFalse(self.page.locator('#tab-local .tab-attention').is_visible())
        self.page.evaluate("setTabAttention('local', '')")
        self.assertFalse(self.page.locator('#tab-local .tab-attention').is_visible())
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 320)

    def test_attention_clears_on_view_and_only_returns_for_changed_content(self):
        self.page.evaluate("setTabAttention('ai', 'New AI insights', ['first insight'])")
        dot = self.page.locator('#tab-ai .tab-attention')
        self.assertTrue(dot.is_visible())
        self.page.locator('#tab-ai').click()
        self.assertFalse(dot.is_visible())
        self.page.locator('#tab-house').click()
        self.page.evaluate("setTabAttention('ai', 'New AI insights', ['first insight'])")
        self.assertFalse(dot.is_visible())
        self.page.evaluate("setTabAttention('ai', 'New AI insights', ['different insight'])")
        self.assertTrue(dot.is_visible())
        self.page.locator('#tab-ai').click()
        self.page.evaluate("setTabAttention('ai', 'New AI insights', ['arrived while viewing'])")
        self.assertFalse(dot.is_visible())
        self.page.locator('#tab-house').click()
        self.page.evaluate("setTabAttention('ai', 'New AI insights', ['arrived while viewing'])")
        self.assertFalse(dot.is_visible())

    def test_mobile_summary_values_are_aligned(self):
        for width in [320, 390, 720]:
            self.page.set_viewport_size({'width':width, 'height':900})
            tops = self.page.locator('.overview-stats strong').evaluate_all('(els) => els.map(e => e.getBoundingClientRect().top)')
            self.assertLess(max(tops) - min(tops), 1)

    def test_switching_views_does_not_redraw_other_views(self):
        self.page.evaluate("""() => {
          window.draws = [];
          renderWeather = () => draws.push('weather');
          drawHouseConnections = () => draws.push('house');
          renderUsTemperatures = () => draws.push('national');
          for (const task of dashboardRefreshTasks) task.load = () => {};
        }""")
        self.page.locator('#tab-local').click()
        self.page.wait_for_timeout(150)
        self.page.evaluate('draws.length = 0; renderActiveDashboardView()')
        self.assertEqual(self.page.evaluate('draws'), ['weather'])
        self.page.evaluate('draws.length = 0')
        self.page.locator('#tab-ai').click()
        self.page.wait_for_timeout(100)
        self.assertEqual(self.page.evaluate('draws'), [])


if __name__ == '__main__':
    unittest.main()
