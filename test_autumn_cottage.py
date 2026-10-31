"""Seasonal weather scene acceptance; replaces the retired cottage checks."""
import unittest
from playwright.sync_api import sync_playwright

class SeasonalWeatherTests(unittest.TestCase):
    def test_conditions_seasons_motion_and_responsive_layout(self):
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='msedge', headless=True)
            page = browser.new_page(viewport={'width':1440,'height':1100}, service_workers='block')
            page.route('https://**/*', lambda r:r.abort())
            page.route('**/api/almanac/insights*', lambda r:r.fulfill(json={'insights':[]}))
            page.goto('http://localhost:8000', wait_until='domcontentloaded')
            for code, scene in [(0,'clear'),(3,'cloud'),(45,'fog'),(63,'rain'),(73,'snow'),(85,'snow'),(86,'snow'),(95,'storm')]:
                page.evaluate('(code)=>applyWeatherScene(code, {}, {is_day:1,time:"2026-09-23T12:00"})', code)
                self.assertIn('scene-'+scene, page.locator('#weatherCard').get_attribute('class'))
            page.evaluate('applyWeatherScene(0, {}, {is_day:0,time:"2026-09-23T23:00"})')
            self.assertIn('scene-night', page.locator('#weatherCard').get_attribute('class'))
            self.assertEqual(page.locator('#weatherCard').get_attribute('data-season'), 'autumn')
            page.locator('#weatherMotion').click()
            self.assertEqual(page.locator('.sky-orb').evaluate('(e)=>getComputedStyle(e).animationPlayState'), 'paused')
            page.emulate_media(reduced_motion='reduce')
            self.assertEqual(page.locator('.sky-orb').evaluate('(e)=>getComputedStyle(e).animationName'), 'none')
            for width in (1440,768,390,320):
                page.set_viewport_size({'width':width,'height':1100})
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), width)
                self.assertTrue(page.locator('#weatherLocation').is_visible())
            browser.close()

if __name__ == '__main__': unittest.main()
