"""Browser acceptance tests. AI responses here are explicit test fixtures, not live verification."""
import os
import unittest
from playwright.sync_api import sync_playwright


class DashboardUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(channel='msedge', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1024, 'height': 1000}, reduced_motion='reduce', service_workers='block')
        self.page = self.context.new_page()
        self.page.route('**/api/almanac/insights*', lambda r: r.fulfill(json={'insights': [], 'cached': False}))
        self.page.goto(os.environ.get('DASHBOARD_TEST_URL', 'http://localhost:8000'), wait_until='domcontentloaded')
        self.page.get_by_role('button', name='Ask the weather', exact=True).click()

    def tearDown(self):
        self.context.close()

    def test_weather_question_panel_is_available_alongside_insights(self):
        self.assertTrue(self.page.locator('#weatherQuestion').count(), 'A separately labeled weather question input must exist')
        self.assertTrue(self.page.locator('#weatherQuestion').is_visible())
        self.assertTrue(self.page.locator('#aiInsightsContainer').is_visible())
        self.assertEqual(self.page.locator('#weatherQuestion').get_attribute('maxlength'), '500')

    def test_question_submission_uses_current_location_and_unit_safely(self):
        captured = []
        def reply(route):
            captured.append(route.request.post_data_json)
            route.fulfill(json={'answer': '<script>test</script> Forecast fixture answer.', 'sources': [{'label': 'Open-Meteo', 'url': 'https://open-meteo.com/'}, {'label': 'Unsafe', 'url': 'javascript:alert(1)'}], 'generated_at': '2026-09-07T12:00:00Z', 'location': 'Seattle', 'unit': 'C'})
        self.page.route('**/api/weather/ask', reply)
        self.page.evaluate("_lastWeather = {lat:47.6,lon:-122.3,locName:'Seattle',usedFallback:false}; unit='C'")
        self.page.locator('[data-weather-question]').first.click()
        self.assertEqual(self.page.locator('#weatherQuestion').input_value(), 'Will I need an umbrella tomorrow?')
        self.page.locator('#weatherAskSubmit').click()
        self.page.locator('#weatherAskResult').wait_for(state='visible')
        self.assertIn(captured[0]['latitude'], (36.17, 47.6))
        self.assertIn(captured[0]['longitude'], (-115.14, -122.3))
        self.assertEqual(captured[0]['unit'], 'C')
        self.assertIn('<script>test</script>', self.page.locator('#weatherAskAnswer').inner_text())
        self.assertEqual(self.page.locator('#weatherAskAnswer script').count(), 0)
        self.assertEqual(self.page.locator('#weatherAskSources a').count(), 1)
        self.assertTrue(self.page.locator('#weatherAskSubmit').is_enabled())

    def test_overview_shows_fresh_indoor_average_and_unit_changes(self):
        self.assertTrue(self.page.locator('#homeOverview').count(), 'Combined home overview must lead the dashboard')
        self.page.evaluate("""() => {
          _lastReadings = {items:[{device:'a',name:'Office',temp_c:20,temp_f:68,humidity:40,timestamp:new Date().toISOString()}, {device:'b',name:'Backyard',temp_c:35,temp_f:95,humidity:20,timestamp:new Date().toISOString()}]};
          renderHomeOverview();
        }""")
        self.assertIn('68', self.page.locator('#overviewIndoor').inner_text())
        self.page.get_by_role('button', name='Close details').click()
        self.page.locator('#unitC').click()
        self.assertIn('20', self.page.locator('#overviewIndoor').inner_text())
        self.assertIn('°C', self.page.locator('#weatherAskContext').inner_text())
        self.page.evaluate("_lastReadings.items[0].timestamp = '2000-01-01T00:00:00Z'; renderHomeOverview()")
        self.assertEqual(self.page.locator('#overviewIndoor').inner_text(), '—')

    def test_old_ai_insights_are_explicitly_labeled(self):
        self.page.route('**/api/almanac/insights*', lambda r: r.fulfill(json={'insights': ['Historical fixture, not current weather.'], 'cached': True, 'stale': True, 'timestamp': '2020-01-01T12:00:00'}))
        self.page.evaluate('loadAlmanacInsights()')
        self.assertIn('Out of date', self.page.locator('#aiInsightsTimestamp').inner_text())

    def test_mobile_panels_fill_available_width_without_internal_overflow(self):
        self.page.set_viewport_size({'width': 390, 'height': 900})
        widths = self.page.evaluate("""() => {const layout=document.querySelector('.dashboard-panel:not([hidden])');return [...layout.children].filter(e=>e.className !== 'location-strip').map(e=>({name:e.className,w:e.clientWidth,available:layout.clientWidth-parseFloat(getComputedStyle(layout).paddingLeft)-parseFloat(getComputedStyle(layout).paddingRight)-2,scroll:e.scrollWidth}));}""")
        for item in widths:
            self.assertGreaterEqual(item['w'], item['available'] - 4, item)
            self.assertLessEqual(item['scroll'], item['w'] + 2, item)

    def test_answer_formats_markdown_and_keeps_html_inert(self):
        answer = '''| Day | High | Low | Conditions |
|---|---|---|---|
| **Saturday** (Day 6) | **96.4°F** | 79.6°F | Partly cloudy |
| **Sunday** (Day 7) | **94.5°F** | 74.4°F | Clear |

Both days will be **below 100°F**.

---

### When Do You Get Out of the 100s?

- **Tuesday:** 101.4°F
- **Wednesday:** 105.5°F

<img src=x onerror=alert(1)><script>alert(1)</script>
[unsafe](javascript:alert(1))'''
        self.page.route('**/api/weather/ask', lambda r: r.fulfill(json={'answer': answer,'unit':'F','location':'Las Vegas','sources':[]}))
        self.page.locator('#weatherQuestion').fill('What about the weekend?')
        self.page.locator('#weatherAskSubmit').click()
        self.page.locator('#weatherAskResult').wait_for(state='visible')
        area = self.page.locator('#weatherAskAnswer')
        self.assertEqual(area.locator('table').count(), 1)
        self.assertEqual(area.locator('th').count(), 4)
        self.assertEqual(area.locator('tbody tr').count(), 2)
        self.assertEqual(area.locator('h3').inner_text(), 'When Do You Get Out of the 100s?')
        self.assertEqual(area.locator('ul li').count(), 2)
        self.assertGreater(area.locator('strong').count(), 0)
        self.assertEqual(area.locator('script,img,iframe,a').count(), 0)
        for width in (1440,390,320):
            self.page.set_viewport_size({'width':width,'height':900})
            if not self.page.locator('dialog').evaluate('(node)=>node.open'):
                self.page.get_by_role('button', name='Ask the weather', exact=True).click()
            self.assertTrue(area.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'))
            self.assertEqual(area.locator('script,img,iframe,a').count(), 0)
        self.page.locator('#weatherAskResult').screenshot(path='C:/Users/Thomas/AppData/Local/hermes/cache/govee-answer-mobile.png')

    def test_question_error_is_recoverable(self):
        self.page.route('**/api/weather/ask', lambda r: r.fulfill(status=503, json={'error': 'AI service is temporarily unavailable.'}))
        self.page.locator('#weatherQuestion').fill('Will it rain?')
        self.page.locator('#weatherAskSubmit').click()
        self.page.locator('#weatherAskStatus.is-error').wait_for(state='visible')
        self.assertIn('temporarily unavailable', self.page.locator('#weatherAskStatus').inner_text())
        self.assertEqual(self.page.locator('#weatherQuestion').input_value(), 'Will it rain?')
        self.assertTrue(self.page.locator('#weatherAskSubmit').is_enabled())


if __name__ == '__main__':
    unittest.main()
