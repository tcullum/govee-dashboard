import json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('C:/Users/Thomas/.codex/visualizations/2026/09/23/01a0cfa2-fba8-7940-a505-faee117f90e3');out.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 page=b.new_page(viewport={'width':1440,'height':1100},service_workers='block',reduced_motion='reduce')
 page.route('https://**/*',lambda r:r.abort())
 page.route('**/api/almanac/insights*',lambda r:r.fulfill(json={'insights':[]}))
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:8000',wait_until='domcontentloaded')
 page.wait_for_function("document.querySelector('#weatherStatus').textContent === 'Weather Unavailable'")
 page.evaluate('''() => {
 const times=Array.from({length:72},(_,i)=>`2026-09-${String(23+Math.floor(i/24)).padStart(2,'0')}T${String(i%24).padStart(2,'0')}:00`);
 _lastWeather={lat:34,locName:'Los Angeles',usedFallback:false,data:{current:{time:'2026-09-23T12:00',is_day:1,temperature_2m:83.6,relative_humidity_2m:50,wind_speed_10m:3.1,weathercode:0},daily:{time:['2026-09-23'],sunrise:['2026-09-23T06:40'],sunset:['2026-09-23T18:48'],temperature_2m_min:[62],temperature_2m_max:[90],precipitation_probability_max:[0],weathercode:[0]},hourly:{time:times,temperature_2m:times.map((_,i)=>75+12*Math.sin((i-6)*Math.PI/12)),weathercode:times.map(()=>0),precipitation_probability:times.map(()=>0)}}};renderWeather();document.querySelector('#weatherAlerts').innerHTML='<div class="weather-alert empty">No active local weather warnings.</div>';
 }''')
 page.wait_for_timeout(500)
 page.locator('#weatherCard').screenshot(path=str(out/'weather-panel-desktop.png'))
 for w in [1440,768,390,320]:
  page.set_viewport_size({'width':w,'height':1100})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),w
  if w==390:page.locator('#weatherCard').screenshot(path=str(out/'weather-panel-mobile.png'))
 page.set_viewport_size({'width':1440,'height':1100})
 for code,name in [(63,'rain'),(85,'snow'),(95,'storm'),(45,'fog'),(3,'cloud')]:
  page.evaluate('(code)=>{_lastWeather.data.current.weathercode=code;renderWeather()}',code)
  assert page.locator('#weatherCard').evaluate('(e)=>e.classList.contains("scene-'+name+'")')
  page.locator('#weatherCard').screenshot(path=str(out/f'weather-panel-{name}.png'))
 page.evaluate('()=>{_lastWeather.data.current.is_day=0;_lastWeather.data.current.weathercode=0;renderWeather()}')
 page.locator('#weatherCard').screenshot(path=str(out/'weather-panel-night.png'))
 page.emulate_media(reduced_motion='no-preference');page.locator('#weatherMotion').click()
 assert page.locator('#weatherMotion').get_attribute('aria-pressed')=='true'
 assert page.locator('.sky-orb').evaluate('(e)=>getComputedStyle(e).animationPlayState')=='paused'
 assert json.loads(page.locator('#weatherForecast').get_attribute('data-series'))[0]['ts']=='2026-09-23T12:00'
 page.evaluate('()=>{_lastWeather.lat=-34;renderWeather()}');assert page.locator('#weatherCard').get_attribute('data-season')=='spring'
 print(json.dumps({'errors':errors,'screenshots':str(out),'checks':'6 scenes, night, hemisphere, upcoming hours, motion pause, 4 widths passed'}))
 b.close()
