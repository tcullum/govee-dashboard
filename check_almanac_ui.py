"""UI smoke: Ask the Almanac branding, suggestions, mocked answer flow, overflow."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8010"
SHOTS = Path(__file__).parent / "shots"
SHOTS.mkdir(exist_ok=True)
FIXTURE = {
    "answer": "Fixture: the last freezing low was 31.4°F on Feb 21, 2026. No freezing temps in the 16-day forecast.",
    "sources": [
        {"label": "Open-Meteo forecast", "url": "https://open-meteo.com/"},
        {"label": "Open-Meteo historical archive", "url": "https://open-meteo.com/en/docs"},
    ],
    "generated_at": "2026-11-21T20:50:00+00:00",
    "location": "Las Vegas",
    "unit": "F",
}
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f" [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    for width, height in ((1440, 900), (1100, 768), (390, 844)):
        tag = f"{width}x{height}"
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        page.route("**/api/weather/ask", lambda route: route.fulfill(json=FIXTURE))
        page.goto(BASE, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        nav = page.get_by_role("button", name="Ask the Almanac", exact=True)
        check(f"{tag} nav button", nav.count() == 1 and nav.is_visible())
        nav.click()
        page.wait_for_selector("dialog[open]", timeout=5000)
        page.wait_for_timeout(600)
        title = page.locator("#weatherAskTitle").inner_text()
        check(f"{tag} title", title == "Ask the Almanac", title)
        chips = page.locator("[data-weather-question]")
        check(f"{tag} four suggestions", chips.count() == 4, str(chips.count()))
        questions = [chips.nth(i).get_attribute("data-weather-question") for i in range(chips.count())]
        check(f"{tag} 30s suggestion", "When can I expect temperatures in the 30s?" in questions)
        check(f"{tag} freezing suggestion", "When's the last time we had freezing temperatures?" in questions)
        meta = page.locator(".ask-meta").inner_text()
        check(f"{tag} meta horizon", "16-day forecast" in meta, meta)
        # suggestion fills the composer
        page.get_by_role("button", name="Last freezing temps?", exact=True).click()
        value = page.locator("#weatherQuestion").input_value()
        check(f"{tag} chip fills question", value == "When's the last time we had freezing temperatures?", value)
        # submit -> mocked answer renders
        page.locator("#weatherAskSubmit").click()
        page.wait_for_selector("#weatherAskResult:not([hidden])", timeout=8000)
        page.wait_for_timeout(300)
        kicker = page.locator("#weatherAskResult .section-kicker").inner_text()
        check(f"{tag} answer kicker", kicker.lower() == "almanac answer", kicker)
        answer = page.locator("#weatherAskAnswer").inner_text()
        check(f"{tag} answer text", "31.4" in answer and "Feb 21, 2026" in answer, answer[:80])
        links = page.locator("#weatherAskSources a")
        check(f"{tag} two source links", links.count() == 2, str(links.count()))
        status = page.locator("#weatherAskStatus").inner_text()
        check(f"{tag} status mentions history", "historical data" in status, status)
        # overflow checks
        for sel in ("#weatherAskPanel", "dialog[open]"):
            ok = page.locator(sel).evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")
            check(f"{tag} no h-overflow {sel}", ok)
        page.locator("dialog[open]").screenshot(path=str(SHOTS / f"almanac-{tag}.png"))
        if width == 1440:
            page.screenshot(path=str(SHOTS / "almanac-full-1440.png"), full_page=True)
        context.close()
    browser.close()

print("\n" + ("ALL PASS" if not failures else f"{len(failures)} FAILURES: {failures}"))
sys.exit(1 if failures else 0)
