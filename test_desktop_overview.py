"""Desktop overview acceptance checks using explicit offline weather fixtures."""
import math
import unittest
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright


class DesktopOverviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(channel='msedge', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':1440,'height':900}, service_workers='block', reduced_motion='reduce')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script('navigator.geolocation.getCurrentPosition = (_, fail) => fail({code:1})')
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        days = [(today + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(10)]
        hours = [(today + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(240)]
        weather = {
            'timezone':'America/Los_Angeles',
            'current':{'time':days[0]+'T09:30', 'temperature_2m':68.5, 'relative_humidity_2m':38, 'weathercode':1, 'wind_speed_10m':9, 'wind_gusts_10m':12, 'is_day':1},
            'daily':{'time':days, 'temperature_2m_max':[81-i for i in range(10)], 'temperature_2m_min':[57+i%4 for i in range(10)], 'precipitation_probability_max':[0,0,5,10,15,20,25,30,35,10], 'weathercode':[1,2,3,3,3,61,61,2,2,1], 'sunrise':[d+'T07:05' for d in days], 'sunset':[d+'T18:07' for d in days], 'apparent_temperature_max':[77]*10, 'apparent_temperature_min':[55]*10, 'uv_index_max':[5]*10, 'wind_speed_10m_max':[9]*10, 'wind_gusts_10m_max':[12]*10, 'precipitation_sum':[0]*10},
            'hourly':{'time':hours, 'temperature_2m':[68+10*math.sin(i/24*2*math.pi) for i in range(240)], 'weathercode':[1]*240, 'precipitation_probability':[0]*240, 'uv_index':[3]*240}
        }
        timestamp = datetime.now(timezone.utc).isoformat()
        readings = {'items':[{'device':str(i),'name':name,'temp_f':temp,'temp_c':(temp-32)*5/9,'humidity':46,'timestamp':timestamp} for i,(name,temp) in enumerate([('Living Room',70),('Office',75),('Backyard',66)])]}
        self.page.route('https://**/*', lambda route: route.abort())
        self.page.route('https://api.open-meteo.com/v1/forecast?*', lambda route: route.fulfill(json=weather))
        self.page.route('**/api/**', lambda route: route.fulfill(json={'items':[], 'series':{}, 'insights':[]}))
        self.page.route('**/api/readings', lambda route: route.fulfill(json=readings))
        self.page.route('**/api/almanac/insights*', lambda route: route.fulfill(json={'insights':['Forecast fixture: a calm morning, warmer this afternoon.'], 'timestamp':timestamp}))
        self.page.goto('http://localhost:8000', wait_until='domcontentloaded')
        self.page.wait_for_function("() => document.querySelectorAll('#weatherUpcoming [data-day]').length === 10 && document.querySelectorAll('.house-sensor').length === 3")
        self.page.wait_for_function('() => dashboardRefreshTasks.every(task => !task.running)')
        self.settle_layout()

    def settle_layout(self):
        self.page.wait_for_timeout(180)  # Existing reduced-motion color/layout transitions last 120ms.
        self.page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

    def tearDown(self):
        self.assertEqual(self.errors, [])
        self.context.close()

    def test_overview_fits_desktop_viewports_and_themes(self):
        for width,height in [(1440,920),(1440,900),(1366,768),(1280,720),(1100,768)]:
            self.page.set_viewport_size({'width':width,'height':height})
            for theme in ['dark','light']:
                self.page.evaluate('(theme) => applyTheme(theme, false)', theme)
                self.settle_layout()
                dimensions = self.page.evaluate('''() => ({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,overflow:[...document.querySelectorAll('#desktopOverview .card, #desktopOverview .forecast-tile, #desktopOverview .desktop-now')].filter(node=>node.scrollWidth>node.clientWidth+2 || node.scrollHeight>node.clientHeight+2).map(node=>node.className)})''')
                self.assertLessEqual(dimensions['width'], width)
                self.assertLessEqual(dimensions['height'], height, (width,height,theme,dimensions))
                self.assertEqual(dimensions['overflow'], [], (width,height,theme,dimensions))
                for selector in ['#weatherTemp','.house-sensor','#forecastDetail','[data-day="9"]','.desktop-summaries']:
                    box = self.page.locator(selector).first.bounding_box()
                    self.assertGreaterEqual(box['y'], 0)
                    self.assertLessEqual(box['y']+box['height'], height)

    def test_forecast_selection_and_keyboard_update_center(self):
        current = self.page.locator('#weatherTemp').inner_text()
        self.page.locator('[data-day="3"]').click()
        self.assertNotIn('Today,', self.page.locator('.fd-title').inner_text())
        self.assertEqual(self.page.locator('[data-day="3"]').get_attribute('aria-pressed'), 'true')
        self.page.locator('[data-day="3"]').press('ArrowDown')
        self.assertEqual(self.page.locator('[data-day="4"]').get_attribute('aria-pressed'), 'true')
        self.assertEqual(self.page.locator('#weatherTemp').inner_text(), current)
        self.assertTrue(self.page.locator('.house-sensor').first.is_visible())

    def test_details_trap_focus_close_and_restore_live_components(self):
        for index in range(4):
            button = self.page.locator('.desktop-summary').nth(index)
            button.click()
            self.assertTrue(self.page.locator('dialog').evaluate('(node)=>node.open'))
            self.page.keyboard.press('Escape')
            self.page.wait_for_function('() => !document.querySelector("dialog").open && document.activeElement.classList.contains("desktop-summary")')
        self.page.get_by_role('button', name='Ask the weather', exact=True).click()
        self.assertTrue(self.page.locator('#weatherQuestion').is_visible())
        self.page.route('**/api/weather/ask', lambda route: route.fulfill(json={'answer':'Fixture: no rain expected.', 'sources':[]}))
        self.page.locator('#weatherQuestion').fill('Will it rain?')
        self.page.locator('#weatherAskSubmit').click()
        self.page.locator('#weatherAskResult').wait_for(state='visible')
        self.assertIn('no rain',self.page.locator('#weatherAskAnswer').inner_text())
        self.page.get_by_role('button', name='Close details').click()
        self.page.get_by_role('button', name='US weather', exact=True).click()
        self.assertTrue(self.page.locator('#usActivityMap').is_visible())
        self.page.keyboard.press('Escape')
        self.assertEqual(self.page.locator('#weatherCard').count(), 1)

    def test_overview_adapts_between_mobile_and_desktop(self):
        self.page.get_by_role('button', name='Ask the weather', exact=True).click()
        for width in [390,320,1440,768,1440]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.settle_layout()
            self.assertTrue(self.page.locator('.desktop-now #weatherTemp').is_visible())
            self.assertTrue(self.page.locator('#desktopOverview .forecast-column').is_visible())
            self.assertFalse(self.page.locator('.dashboard-tabs').is_visible())
            self.assertEqual(self.page.locator('.mobile-day-disclosure').evaluate('(node)=>node.open'), width>=1100)
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.assertEqual(self.page.locator('#weatherTemp,#weatherUpcoming,#overviewIndoor').count(),3)

    def test_mobile_weather_leads_and_forecast_details_open_without_page_jump(self):
        self.page.set_viewport_size({'width':390,'height':844})
        self.settle_layout()
        weather = self.page.locator('.desktop-current').bounding_box()
        home = self.page.locator('#weatherCard').bounding_box()
        self.assertLess(weather['y'], home['y'])
        self.assertLess(weather['y']+weather['height'],844)
        self.page.locator('.mobile-day-disclosure summary').click()
        self.assertTrue(self.page.locator('#forecastDetail').is_visible())
        self.page.locator('.mobile-day-disclosure summary').click()
        tile = self.page.locator('[data-day="4"]')
        tile.scroll_into_view_if_needed()
        scroll = self.page.evaluate('scrollY')
        tile.click()
        self.assertTrue(self.page.locator('dialog #forecastDetail').is_visible())
        self.assertNotIn('Today,',self.page.locator('.fd-title').inner_text())
        self.assertAlmostEqual(self.page.evaluate('scrollY'), scroll, delta=2)
        self.page.keyboard.press('Escape')
        self.page.wait_for_function('() => !document.querySelector("dialog").open')
        self.page.wait_for_function("() => document.activeElement.dataset.day === '4' && !!document.activeElement.closest('#weatherUpcoming')")

    def test_mobile_widths_themes_and_detail_overlays(self):
        for width in [320,375,390,430,768,1024]:
            self.page.set_viewport_size({'width':width,'height':844})
            for theme in ['dark','light']:
                self.page.evaluate('(theme)=>applyTheme(theme,false)',theme)
                self.settle_layout()
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(self.page.locator('#rainBadge').is_visible())
                self.page.locator('.desktop-summary').nth(1).click()
                self.assertTrue(self.page.locator('dialog #airQualityCard').is_visible())
                self.assertLessEqual(self.page.locator('dialog').evaluate('(node)=>node.scrollWidth'), self.page.locator('dialog').evaluate('(node)=>node.clientWidth')+1)
                self.page.get_by_role('button',name='Close details').click()

    def test_overview_refreshes_visible_feeds_and_keeps_national_lazy(self):
        self.page.evaluate('''() => {
            window.calls={};
            for (const task of dashboardRefreshTasks) {
                task.lastAttempt=0;
                task.load=()=>{calls[task.key]=(calls[task.key]||0)+1;};
            }
            refreshDashboard();
        }''')
        self.page.wait_for_function('() => dashboardRefreshTasks.every(task => !task.running)')
        self.assertEqual(self.page.evaluate('calls'), {'readings':1,'weather':1,'local':1,'insights':1})
        self.page.get_by_role('button',name='US weather',exact=True).click()
        self.page.wait_for_function('() => calls.national === 1')

    def test_warnings_stay_visible_without_pushing_data_below_fold(self):
        self.page.evaluate('''() => {
            const alert=document.createElement('a');
            alert.className='weather-alert watch';
            alert.innerHTML='<div><strong>Flood Watch</strong><span>'+ 'Long warning details. '.repeat(100)+'</span></div>';
            document.getElementById('weatherAlerts').replaceChildren(alert);
        }''')
        button=self.page.locator('.desktop-alert-button')
        button.wait_for(state='visible')
        self.settle_layout()
        self.assertIn('Flood Watch',button.inner_text())
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollHeight'),900)
        button.click()
        self.assertTrue(self.page.locator('dialog #weatherAlerts').is_visible())
        self.assertIn('Long warning details.', self.page.locator('dialog').inner_text())
        self.page.keyboard.press('Escape')


if __name__ == '__main__':
    unittest.main()
