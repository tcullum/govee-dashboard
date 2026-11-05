# Dashboard review — November 4, 2026

Reviewed the current working tree, including the recent sensor recovery changes, Flask routes, AI transports, browser fetch/render lifecycle, service worker, Docker configuration, dependencies in the running container, and selected automated tests. No application code or deployment settings were changed during this review. Upstream abuse checks used mocks; they did not call paid AI services.

Priority: P1 = address first; P2 = correctness, resilience, or meaningful hardening; P3 = maintenance. Findings below distinguish reproduced behavior from configuration-dependent exposure.

## Findings

### 1. P1 — The running certificate bundle has a published security advisory

The installed container has `certifi==2026.7.22`. The advisory covers versions before 2026.10.18 because of compromised intermediate CA keys chaining to a bundled trust root. An attacker also needs an on-path position; this review did not demonstrate interception. The dashboard sends API credentials through Python HTTPS clients, so this dependency deserves prompt attention. The advisory recommends 2026.10.19 or later.

The OSV query checked 34 installed packages and also flagged `urllib3==2.7.0`, `Werkzeug==3.1.8`, `pip==24.0`, and `setuptools==79.0.1`. urllib3 advisories concern proxy TLS handling and malicious chunked responses. Werkzeug's reported issue concerns Windows/NTFS special-device paths; the current Linux container and static filename allowlist materially reduce its applicability. pip/setuptools findings primarily affect installation/build workflows and need separate applicability triage.

`requirements.txt:1` permits broad dependency ranges and has no lock or recorded transitive versions. Rebuild from a reviewed dependency set, audit the resulting image, and retain reproducible versions. A container restart does not update installed packages.

Sources: [certifi advisory](https://github.com/advisories/GHSA-6q48-6c7w-9gw2), [urllib3 proxy advisory](https://github.com/advisories/GHSA-8988-9cw3-xx77), [urllib3 decompression advisory](https://github.com/advisories/GHSA-gh4c-6fx4-qh6g), [urllib3 chunk-size advisory](https://github.com/advisories/GHSA-vxq7-64xx-v4gw), [Werkzeug advisory](https://github.com/advisories/GHSA-g6x2-hccm-hh4m).

### 2. P1 — Unprotected forced AI insights can repeatedly spend API credits

`govee_server.py:864–1039`: `GET /api/almanac/insights?refresh=1` bypasses the cache without authentication, an origin check, an attempt budget, or a concurrency guard. Three simulated requests carrying an unrelated Origin and cross-site fetch metadata returned HTTP 200 and invoked the mocked provider three times. Browser CORS prevents reading a response; it does not prevent the server from doing this work. Scripts need no browser at all.

Concurrent ordinary requests on cache expiry can also generate duplicate completions. Reuse the weather-question endpoint's bounded-attempt and single-active-request pattern, protect forced refresh, and serve cached results during generation. Use POST for operations that deliberately trigger paid work. Keep cache read/write behavior atomic.

### 3. P1 — Forced sensor requests bypass the shared refresh guard

`govee_server.py:671–698`: `refresh=1`, or a request with no cached/logged readings, calls `_poll_readings_live()` synchronously rather than using `_start_readings_refresh()`. Each request creates its own executor and upstream state calls. Three mocked forced requests caused three independent polls. Concurrent traffic can multiply Govee requests, consume the eight Waitress request threads, and write duplicate history samples. This also makes the history window depend on request volume.

Route all refresh triggers through one in-flight operation with a minimum interval, including cold starts. Return cached/status data promptly while the shared poll runs. Guard explicit refresh separately if it remains externally available.

### 4. P2 — Sensor history and CSV exports are unauthenticated

`govee_server.py:700–758`, `docker-compose.yml:7`: `/api/history`, `/api/export`, and `/api/status` returned HTTP 200 without credentials. Readings also have no application authentication. The container publishes port 8000 on all interfaces. Export exposes retained household measurements, device identifiers, names, and timestamps.

Whether this is unacceptable depends on the intended audience. Reverse-proxy access rules were not inspected, and no claim is made that the public hostname is unauthenticated. If household data should be private, protect the API and restrict direct-port access so it cannot bypass the proxy. Set explicit private/no-store policies for household API responses and exports.

### 5. P2 — Pollen's daily budget does not count failed attempts

`govee_server.py:201–236`: the attempt timestamp is appended only after a valid nonempty response. Six simulated upstream timeouts produced six outbound attempts while the daily counter stayed at zero. Invalid response bodies and empty forecasts also avoid the cap. This defeats the promised upstream-call budget during outages; whether a particular failure is billable is provider-dependent.

Reserve the attempt before making the request. Persist the budget if it must survive container restarts; the current daily counter is memory-only.

### 6. P2 — Pollen holds a global lock during the network request

`govee_server.py:191–240`: the lock covers a request with a 15-second timeout and JSON processing. Other pollen requests, including requests for an already cached location, wait behind it while occupying request threads. Enough concurrent requests can make unrelated dashboard APIs wait for a free worker.

Keep locking limited to cache/budget state. Reserve an in-flight lookup under the lock, do network I/O outside it, and reuse cached or in-flight results. The per-client request dictionary also never removes inactive client entries.

### 7. P2 — Almanac and insights can describe the wrong location and calendar day

`govee_server.py:764–805`, `869–917`; `app.js:2864–2880`, `2408–2418`: browser weather follows geolocation, but server almanac and insight weather are fixed to Las Vegas. The browser subtracts this almanac average from the geolocated forecast without checking that locations match. A user elsewhere gets an invalid comparison and insights for a different city.

The running container has no TZ setting and returned November 5 at 00:24 while the user's local date was November 4. Server `datetime.now()` therefore advances the almanac and daily insight cache at 4 p.m. Pacific standard time. Naive AI timestamps are also interpreted as browser-local time.

Use one explicit location policy, key shared caches by location/date, and calculate calendar dates in the intended IANA timezone. Serialize instants with an offset or UTC suffix.

### 8. P2 — A failed history request discards valid fresh readings

`app.js:2541–2550`: `Promise.all` couples the readings request to the optional history request. If history rejects or times out, execution jumps to the catch before processing the successful readings response. A browser reproduction supplied new readings and aborted history; `_lastReadings` retained the old device and displayed an API error.

Process readings independently and keep the previous history when history fails. `Promise.allSettled` or separate handling would allow this without changing the UI flow.

### 9. P2 — The freshness chip can stay falsely live after connectivity is lost

`app.js:866–893`, `3275–3282`: the timer repeatedly passes the stored payload's `last_live_age_seconds` back to `updateFreshness`. It does not add elapsed time or derive the age from `last_live_at`. The network error path also leaves the chip's prior state intact. A browser reproduction advanced the clock by an hour; the label remained `Live 10s ago`.

Calculate age from an absolute timestamp or elapsed time since receipt, and explicitly mark failed dashboard fetches. Per-sensor freshness should remain distinct from the time of the last successful upstream poll.

### 10. P2 — AI insight generation can exceed the browser's timeout

`app.js:2164`; `govee_server.py:906–920`, `openrouter_ai.py:48`: the browser aborts insights after 20 seconds, but server context collection can take an almanac request, a weather request, potentially a sensor refresh, and then up to a 40-second provider read timeout. A healthy but slow completion can be billed and cached after the UI has already reported failure.

Prefer a background generation operation with immediate cached/pending responses and a shared generation guard. At minimum, align end-to-end time budgets. Read-only route functions should not call other route handlers to assemble context: the inherited `refresh=1` parameter currently also reaches `api_readings()` and forces another sensor poll.

### 11. P2 — History is count-limited rather than limited to the documented 24 hours

`govee_server.py:41–42`, `374–382`, `484–488`; `README.md:202`: `/api/history` returns the last N samples without a timestamp cutoff. When sensors are unavailable, samples older than a day remain in the series. With more frequent forced polls, the same limit covers less than a day. A reproduction inserted three samples from 8–10 days ago and all three were returned.

Filter to a rolling 24-hour range before downsampling. Keep CSV retention independent of the graph's time window. Also treat an empty sensor inventory as an explicit availability outcome: `_refresh_readings_cache` currently records no error for HTTP-200 empty items, which was reproduced.

### 12. P2 — Offline caching misses the current overview assets and versioned scripts

`service-worker.js:6–22`, `48–61`; `index.html:364–365`: installation caches unversioned `app.js` and overview assets. The page requests versioned scripts, and cache matching uses the full URL. The fetch allowlist omits `assets/desktop-overview.js` and `.css`, so their install-time cache entries are never used as offline fallbacks. Offline script requests can fail even when installation succeeded.

Use one authoritative asset manifest for installation and interception and a consistent version/query policy. Add a service-worker-enabled offline browser test; the reviewed browser suites deliberately block service workers.

### 13. P2 — The legacy browser suite no longer verifies the actual interface

`test_dashboard_tabs.py:31–145`, `assets/desktop-overview.js:118`, `app.js:3213–3226`: overview mode is always active, including mobile. Legacy tests expect visible tabs and secondary feeds to stay unloaded until a tab is selected. Five assertions failed and two clicks timed out because these expectations no longer match the interface. The newer desktop-overview suite passed in this run.

Update acceptance tests around the current overview/dialog interactions and explicitly decide which feeds should load on mobile. Do not merely remove assertions that represent desired efficiency behavior. Put the security and outage reproductions above into focused regression tests when fixing them.

### 14. P3 — The diagnostic test prints a credential prefix and executes on import

`test_anthropic.py:13–43`: prints the first 20 characters of the API key and makes a real provider request at module import. Generic test discovery can fail with `SystemExit` when no key is present, or make a paid request and put part of a credential in test logs when one is configured. This script was intentionally excluded from the review's test runs.

Move it to an explicitly invoked diagnostic command with a main guard and print only whether configuration is present. Keep normal tests offline.

## Deployment and coding-guideline assessment

- Container hardening: the live container has no configured user (root), a writable root filesystem, and a read/write bind mount of the entire host project directory. A server compromise would consequently permit modification of mounted project files. Use a non-root runtime, read-only application files, and a dedicated writable data volume. This is a containment weakness, not evidence of a current remote-code-execution exploit.
- Build hygiene: `Dockerfile:15` copies the complete build context, while `.dockerignore` does not exclude the unrelated NAS/Plex migration artifacts currently present in the workspace. Use explicit source copies or a tighter build context. No unrelated files were opened for this review, so their sensitivity was not assessed.
- The static filename allowlist, response security headers, escaped AI insight text, DOM-based weather answer rendering, fixed provider URLs, disabled redirects in AI/question requests, and weather-question input limits and shared budget are good foundations. Requests for `.env`, server source, and Compose configuration all returned 404.
- Guideline adherence is mixed: recent changes are reasonably focused and the AI transports have explicit responsibilities. However, the server mixes route handling, polling, storage, provider calls, and cache lifecycle through many globals. Route-to-route calls and direct cache writes make concurrency and error behavior difficult to test. Extract small data-service functions when addressing the corresponding findings; a framework rewrite is unnecessary.
- `app.js` contains 129 named functions and is approximately 146 KB; CSS is approximately 135 KB. These sizes alone do not establish a performance problem, but feature boundaries would make review safer. The browser already avoids overlapping scheduled tasks, pauses scheduled refresh while hidden, and fetches history less frequently than readings. Preserve those behaviors.
- `app.js` has an invalid UTF-8 byte in a sun/UV fallback string; tools expecting UTF-8 fail to read it and the browser may render a replacement glyph. Bare `except` blocks in numeric normalization, an unused `READINGS_STALE_SECONDS` constant left by the recent fix, and account-specific temperature-unit assumptions should also be cleaned up with focused tests rather than broad formatting changes.

## Validation and limits

- Backend: all 30 tests passed across `test_sensor_readings`, `test_openrouter_ai`, `test_weather_questions`, and `test_pollen_api`, with the Anthropic compatibility override.
- Browser: 23 tests ran using Python 3.14 and headless Edge: 16 passed, five failed, two errored. All seven unsuccessful cases were in `test_dashboard_tabs`; `test_dashboard_ui` and `test_desktop_overview` passed. The default Python 3.15 environment lacks Playwright, so the available 3.14 environment was used.
- JavaScript syntax checks passed for `app.js`, `assets/desktop-overview.js`, and `service-worker.js`; `git diff --check` passed.
- Additional isolated reproductions confirmed forced AI calls, forced sensor polling, unauthenticated exports/history, uncounted pollen failures, older-than-24-hour history, silent empty inventories, discarded readings after history failure, and frozen freshness age.
- Dependency inspection used the running container's installed metadata plus OSV and the linked advisories. It did not scan Debian packages or prove each advisory exploitable through this application.
- No public reverse-proxy access policy, firewall configuration, full Git-history secret scan, load test, or production exploit attempt was performed. No claim of a clean security audit is implied by the passing tests.

Recommended order: update/audit dependencies; bound paid insight generation and sensor refresh; settle household-data access; repair pollen accounting/locking; fix location/time/freshness behavior; then repair offline caching and bring the tests into agreement with the intended interface.


## Resolution

The fixes were implemented and deployed on November 4, 2026. See [the resolution record](dashboard-resolution-2026-11-04.md) for the finding-by-finding changes, access policy, data migration, and 81 passing tests.
