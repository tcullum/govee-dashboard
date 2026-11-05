"""Moon phase, horizon gating, and accessible tooltip regression checks."""
import os
from datetime import datetime
import unittest
from playwright.sync_api import sync_playwright

class MoonTests(unittest.TestCase):
    def test_phase_visibility_and_tooltip(self):
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='msedge',headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1000},service_workers='block')
            page.route('https://**/*',lambda r:r.abort())
            page.route('**/api/**',lambda r:r.fulfill(json={'items':[],'series':{},'insights':[]}))
            page.route('**/api/almanac/insights*',lambda r:r.fulfill(json={'insights':[]}))
            page.goto(os.environ.get('DASHBOARD_TEST_URL', 'http://localhost:8000'),wait_until='domcontentloaded')
            page.wait_for_function('() => dashboardRefreshTasks.every(task => !task.running)')
            page.wait_for_timeout(100)
            for date,name in [('2024-04-08T18:21:00Z','New moon'),('2024-03-25T07:00:00Z','Full moon'),('2024-04-12T12:00:00Z','Waxing crescent'),('2024-04-19T12:00:00Z','Waxing gibbous'),('2024-04-27T12:00:00Z','Waning gibbous'),('2024-05-04T12:00:00Z','Waning crescent')]:
                state=page.evaluate('(date)=>moonState(new Date(date),36.17,-115.14)',date)
                self.assertEqual(state['name'],name)
                self.assertTrue(0<=state['fraction']<=1)
            page.evaluate('''() => {
                _lastWeather={lat:36.17,lon:-115.14,data:{current:{weathercode:0}}};
                elements.weather.card.classList.add('scene-clear','scene-night');
                window.moonTestDate=Array.from({length:24},(_,h)=>new Date(Date.UTC(2026,8,23,h))).find(d=>moonState(d,36.17,-115.14).altitude>.2);
                updateMoon(window.moonTestDate);
            }''')
            fixed_date=page.evaluate('window.moonTestDate.toISOString()')
            page.clock.set_fixed_time(datetime.fromisoformat(fixed_date.replace('Z','+00:00')))
            page.evaluate('updateMoon(window.moonTestDate)')
            moon=page.locator('#weatherMoon')
            self.assertTrue(moon.is_visible())
            moon.hover()
            self.assertEqual(page.locator('#moonPhaseTooltip').evaluate('(e)=>getComputedStyle(e).visibility'),'visible')
            self.assertIn('illuminated',moon.get_attribute('aria-label'))
            page.keyboard.press('Escape')
            self.assertEqual(page.locator('#moonPhaseTooltip').evaluate('(e)=>getComputedStyle(e).visibility'),'hidden')
            moon.focus()
            self.assertEqual(page.locator('#moonPhaseTooltip').evaluate('(e)=>getComputedStyle(e).visibility'),'visible')
            moon.click()
            self.assertEqual(moon.get_attribute('aria-expanded'),'true')
            for width in [1440,390,320]:
                page.set_viewport_size({'width':width,'height':1000})
                page.wait_for_timeout(100)
                page.evaluate('updateMoon(window.moonTestDate)')
                if width < 1100:
                    self.assertTrue(moon.is_hidden())
                    self.assertIn('illuminated', page.locator('#moonSummary').inner_text())
                    continue
                moon.focus()
                box=page.locator('#moonPhaseTooltip').bounding_box()
                self.assertIsNotNone(box)
                self.assertGreaterEqual(box['x'],0)
                self.assertLessEqual(box['x']+box['width'],width)
            page.set_viewport_size({'width':1440,'height':1000})
            page.locator('#weatherCard').screenshot(path='docs/moon-tooltip.png')
            page.evaluate("()=>{elements.weather.card.classList.replace('scene-clear','scene-rain');updateMoon(window.moonTestDate)}")
            self.assertTrue(moon.is_hidden())
            page.evaluate('''()=>{
                elements.weather.card.classList.replace('scene-rain','scene-clear');
                const below=Array.from({length:24},(_,h)=>new Date(Date.UTC(2026,8,23,h))).find(d=>moonState(d,36.17,-115.14).altitude<-.2);
                updateMoon(below);
            }''')
            self.assertTrue(moon.is_hidden())
            page.evaluate('()=>{_lastWeather.lat=undefined;updateMoon(window.moonTestDate)}')
            self.assertTrue(moon.is_hidden())
            browser.close()

if __name__=='__main__':unittest.main()
