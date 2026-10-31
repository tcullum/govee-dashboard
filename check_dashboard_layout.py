"""Real browser layout/interaction checks; no mocked telemetry or AI calls."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path('C:/Users/Thomas/AppData/Local/hermes/cache/govee-review')
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(service_workers='block', reduced_motion='reduce')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:8000/?theme=dark', wait_until='domcontentloaded')
    page.wait_for_function("document.querySelectorAll('.sensor-card').length > 0")
    page.wait_for_function("document.querySelector('#weatherTemp').textContent !== '--'", timeout=30000)
    records = []
    for width in [1440, 1024, 768, 390, 320]:
        page.set_viewport_size({'width':width,'height':1000})
        page.wait_for_timeout(250)
        record = page.evaluate("""() => ({width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main section, .ask-composer, .overview-stats, .sensor-card')].filter(e => e.scrollWidth > e.clientWidth + 2).map(e=>({class:e.className,id:e.id,width:e.clientWidth,scroll:e.scrollWidth})),askVisible:!!document.querySelector('#weatherAskPanel').offsetHeight})""")
        records.append(record)
        if width in [1440,390]:
            page.screenshot(path=str(out/f'dashboard-{width}-dark.png'),full_page=True)
        if width == 390:
            page.locator('#weatherAskPanel').screenshot(path=str(out/'weather-question-panel.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    page.evaluate("applyTheme('light',false)")
    page.screenshot(path=str(out/'dashboard-1440-light.png'),full_page=True)
    page.locator('#compactToggleBtn').click()
    compact = page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
    page.set_viewport_size({'width':390,'height':900})
    page.evaluate('openLocationManager()')
    modal = page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,panel:document.querySelector('.location-modal-panel').clientWidth,panelScroll:document.querySelector('.location-modal-panel').scrollWidth})")
    page.keyboard.press('Escape')
    print(json.dumps({'layouts':records,'compact':compact,'modal':modal,'javascript_errors':errors,'artifacts':str(out)},indent=2))
    browser.close()
