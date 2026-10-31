"""Acceptance checks for the house scene; forecast data is an offline fixture."""
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

class HouseAtmosphereTests(unittest.TestCase):
    def test_live_scene_controls_and_responsive_layout(self):
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='msedge',headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1200},reduced_motion='reduce',service_workers='block')
            page.route('https://**/*',lambda r:r.abort())
            page.route('**/api/readings*',lambda r:r.abort())
            page.route('**/api/history*',lambda r:r.abort())
            page.route('**/api/almanac/insights*',lambda r:r.fulfill(json={'insights':[]}))
            page.goto('http://localhost:8000/?scene=snow&time=night',wait_until='domcontentloaded')
            page.evaluate('''() => {
              _lastWeather={lat:36.17,lon:-115.14,data:{timezone:'America/Los_Angeles',current:{weathercode:0,is_day:0}}};
              applyWeatherScene(63,{},_lastWeather.data.current);
              _lastReadings={items:[{device:'a',name:'Living Room',temp_f:70.3,temp_c:21.3,humidity:50,timestamp:new Date().toISOString()},{device:'b',name:'Office',temp_f:74.5,temp_c:23.6,humidity:42,timestamp:new Date().toISOString()},{device:'c',name:'Backyard',temp_f:89.6,temp_c:32,humidity:18,timestamp:'2000-01-01T00:00:00Z'}]};
              renderSensors(_lastReadings,{});renderHomeOverview();
            }''')
            self.assertIn('scene-rain',page.locator('#weatherCard').get_attribute('class'))
            expected=page.evaluate("SunCalc.getPosition(new Date(),36.17,-115.14).altitude > -0.01454 ? 'scene-day':'scene-night'")
            self.assertIn(expected,page.locator('#weatherCard').get_attribute('class'))
            self.assertIn('illuminated',page.locator('#moonSummary').inner_text())
            self.assertIn('Out of date',page.locator('.house-sensor[data-position=outside]').inner_text())
            page.wait_for_function("() => document.querySelectorAll('#houseConnectors path').length === 3")
            self.assertEqual(page.locator('#roofToggle,.house-roof,.sensor-column,.sensor-card').count(),0)
            self.assertEqual(page.locator('.house-interior').evaluate('(e)=>getComputedStyle(e).opacity'),'1')
            self.assertEqual(page.locator('[data-house-anchor=living] circle').first.get_attribute('cy'),'246')
            for width in (1440,1024,768,390,375,320):
                page.set_viewport_size({'width':width,'height':1200})
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
                boxes=page.locator('.house-sensor').evaluate_all('(els)=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})')
                if width <= 720:
                    card=page.locator('#weatherCard').bounding_box()
                    self.assertGreaterEqual(card['y']+card['height'],max(b['y']+b['h'] for b in boxes))
                for i,a in enumerate(boxes):
                    self.assertGreaterEqual(a['h'],44)
                    for b in boxes[i+1:]:
                        self.assertFalse(a['x']<b['x']+b['w'] and b['x']<a['x']+a['w'] and a['y']<b['y']+b['h'] and b['y']<a['y']+a['h'],f'Overlapping markers at {width}')
            page.set_viewport_size({'width':1440,'height':1200})
            page.evaluate("document.documentElement.dataset.theme='dark';window.scrollTo(0,0);document.querySelectorAll('.skeleton').forEach(e=>e.classList.remove('skeleton'));document.getElementById('weatherTemp').textContent='87.9';document.getElementById('weatherLocation').textContent='Las Vegas';document.getElementById('weatherCondition').textContent='Rain';")
            Path('docs').mkdir(exist_ok=True)
            page.screenshot(path='docs/house-atmosphere-desktop.png')
            page.set_viewport_size({'width':390,'height':1500})
            page.evaluate('window.scrollTo(0,0)')
            page.screenshot(path='docs/house-atmosphere-mobile.png')
            browser.close()

    def test_uv_uses_local_current_hour_and_preserves_missing_values(self):
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='msedge',headless=True)
            page=browser.new_page(service_workers='block')
            page.route('https://**/*',lambda r:r.abort())
            page.route('**/api/almanac/insights*',lambda r:r.fulfill(json={'insights':[]}))
            page.goto('http://localhost:8000',wait_until='domcontentloaded')
            fixture={'timezone':'America/Los_Angeles','current':{'time':'2026-10-09T10:00'},'hourly':{'time':['2026-10-09T11:00','2026-10-09T12:00','2026-10-09T13:00'],'uv_index':[2,6.4,8]},'daily':{'uv_index_max':[9]}}
            page.evaluate('(data)=>renderSunUv(data,new Date("2026-10-09T19:15:00Z"))',fixture)
            self.assertEqual(page.locator('#sunUvValue').inner_text(),'6.4')
            self.assertIn('High',page.locator('#sunUvLevel').inner_text())
            fixture['hourly']['uv_index'][1]=0
            page.evaluate('(data)=>renderSunUv(data,new Date("2026-10-09T19:15:00Z"))',fixture)
            self.assertEqual(page.locator('#sunUvValue').inner_text(),'0.0')
            fixture['hourly']['uv_index'][1]=None
            page.evaluate('(data)=>renderSunUv(data,new Date("2026-10-09T19:15:00Z"))',fixture)
            self.assertEqual(page.locator('#sunUvLevel').inner_text(),'Unavailable')
            browser.close()

if __name__=='__main__':unittest.main()
