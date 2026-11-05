"""Weather warning layout regression with explicit offline warning fixtures."""
import os
import unittest
from playwright.sync_api import sync_playwright

class WeatherAlertLayoutTests(unittest.TestCase):
 def test_warning_text_stays_inside_panels(self):
  with sync_playwright() as p:
   browser=p.chromium.launch(channel='msedge',headless=True)
   page=browser.new_page(viewport={'width':1440,'height':1200},reduced_motion='reduce',service_workers='block')
   page.route('https://**/*',lambda r:r.abort())
   page.route('**/api/almanac/insights*',lambda r:r.fulfill(json={'insights':[]}))
   page.goto(os.environ.get('DASHBOARD_TEST_URL', 'http://localhost:8000'),wait_until='domcontentloaded')
   page.evaluate('''() => {
    const root=document.getElementById('weatherAlerts');root.replaceChildren();
    for(const title of ['Flood Watch','Severe Thunderstorm Warning']) {
     const alert=document.createElement('a');alert.className='weather-alert watch';alert.href='https://www.weather.gov/';
     const body=document.createElement('div');const heading=document.createElement('strong');heading.textContent=title;
     const area=document.createElement('span');area.textContent='Northwest Plateau, Lake Havasu and Fort Mohave, surrounding communities';
     const detail=document.createElement('span');detail.className='weather-alert-detail';detail.textContent='Heavy rainfall may cause flash flooding in washes, low-lying areas, and roads. '+ 'Monitor local forecasts and follow instructions from local officials. '.repeat(6);
     body.append(heading,area,detail);const time=document.createElement('time');time.textContent='Until Saturday, 8:00 PM';alert.append(body,time);root.append(alert);
    }
   }''')
   for width in (1440,1024,768,390,320):
    page.set_viewport_size({'width':width,'height':1200})
    page.wait_for_timeout(100)
    page.locator('.desktop-alert-button').click()
    self.assertTrue(page.locator('dialog #weatherAlerts').is_visible())
    result=page.locator('.weather-alert:not(.empty)').evaluate_all('''els=>els.map(e=>{const p=e.getBoundingClientRect();return {panel:{top:p.top,bottom:p.bottom,left:p.left,right:p.right},children:[...e.querySelectorAll('strong,span,time')].map(c=>{const r=c.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}})}})''')
    for item in result:
     panel=item['panel']
     for child in item['children']:
      self.assertGreaterEqual(child['top'],panel['top'],width)
      self.assertLessEqual(child['bottom'],panel['bottom'],width)
      self.assertGreaterEqual(child['left'],panel['left'],width)
      self.assertLessEqual(child['right'],panel['right'],width)
    self.assertLessEqual(page.locator('dialog').evaluate('(node)=>node.scrollWidth'), page.locator('dialog').evaluate('(node)=>node.clientWidth')+1)
    page.get_by_role('button',name='Close details',exact=True).click()
   browser.close()

if __name__=='__main__':unittest.main()
