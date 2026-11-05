# Dashboard review resolution — November 4, 2026

The fixes follow the review's order: dependencies, expensive refresh operations, household access, pollen limits, data correctness, then offline behavior and test coverage.

| Review finding | Resolution |
| --- | --- |
| 1. Vulnerable/unpinned dependencies | Updated certifi to 2026.10.23, urllib3 to 2.8.0, Werkzeug to 3.1.9, and build tooling. Kept the existing Anthropic SDK version to avoid a major migration. Added exact direct requirements and a complete Linux dependency lock. The rebuilt environment's 38 Python packages returned zero OSV findings. |
| 2. Unrestricted paid insights | Generation runs in one background operation. GET serves cached/pending results; forced refresh uses POST and same-origin checks. All generation attempts share a persistent four-attempt rolling daily budget and 15-minute cooldown, including failures. Failed generation preserves the last valid cache. |
| 3. Sensor poll amplification | Cold, ordinary, and forced requests all use one guarded background poll with a 45-second minimum interval. HTTP requests no longer run their own polling executors. Empty inventories and unexpected refresh failures produce availability errors. |
| 4. Household data access | Updated the existing weather Cloudflare Access application: removed its public bypass, selected the existing Google provider, and preserved the existing email-specific Allow Thomas policy. The origin independently verifies RS256 signature, issuer, weather audience, expiry, issued-at, subject, and user email. Direct origin traffic cannot authenticate with a forged email header. APIs/exports use no-store policies. |
| 5. Pollen attempt accounting | Every outbound attempt is reserved and persisted before the request, including timeouts, HTTP errors, invalid JSON and empty forecasts. The five-attempt daily limit survives restarts. |
| 6. Pollen lock contention | Network work happens outside the state lock. Duplicate lookups return pending/stale responses, and unrelated cached locations remain immediately available. Inactive client-limit entries are pruned; their map is bounded. |
| 7. Location/calendar mismatch | Browser requests send the forecast coordinates and IANA timezone to almanac and insight services. Bounded caches include location/timezone and use local calendar dates. Insight instants include UTC offsets. Home defaults are configurable, and the server supplies them to the browser. |
| 8. History outage discarding readings | Readings and history failures are handled independently, including malformed history JSON. Fresh readings still render with the last successful graph. |
| 9. Frozen live indicator | Freshness is derived from the absolute last-live instant or elapsed time since payload receipt. Dashboard fetch failures explicitly mark the indicator stale; successful reads clear the failure. |
| 10. Insight timeout mismatch | Requests promptly return cached/pending responses while generation runs in the background. The browser polls pending results. Context assembly uses service functions rather than route handlers; it cannot inherit a forced sensor-refresh query. Almanac lookups are shared with background generation. Only fresh sensor samples enter AI context. |
| 11. History time window | History is filtered to the actual preceding 24 hours before downsampling. CSV retention remains separate. |
| 12. Offline asset mismatch | Installation and interception use the same static manifest; query versions resolve to canonical cache paths. Overview CSS/JS, the house image, and sensor assets are included. Redirected sign-in responses and API data are never cached. Old-cache cleanup is scoped to this app. |
| 13. Outdated UI acceptance tests | Tests now exercise overview summaries and dialogs, hidden-page scheduling, deferred national data, attention lifecycle, responsive layout, and current mobile moon/alert behavior. Tests accept an isolated preview URL. Added authentication, concurrency, accounting, timezone and offline regressions. |
| 14. Credential-printing diagnostic | The Anthropic diagnostic runs only when explicitly invoked; import/test discovery no longer prints key material, exits, or makes provider calls. |

Additional review items were addressed: application files are copied explicitly into the image; the build context excludes unrelated artifacts; production runs as UID 10001 with a read-only root filesystem, dropped capabilities and no-new-privileges. Runtime data uses the `govee_dashboard_data` volume. The host port is bound to 127.0.0.1 for the existing host cloudflared tunnel. `/healthz` exposes only a generic health result. Local non-Docker development binds to loopback by default.

Invalid Windows-1252 punctuation in HTML/JavaScript was normalized to UTF-8. Numeric normalization rejects nonfinite values and uses explicit, tested account temperature-unit configuration. Bare numeric exception handlers and the obsolete stale-window constant were removed. Atomic JSON persistence and location-aware almanac operations now have small shared modules rather than route-to-route calls.

## Validation

- Backend: 47 tests passed, including signed/forged/expired/wrong-audience JWTs, shared polling, durable request limits, concurrent cache access, local dates, location identities, history cutoff and explicit temperature units.
- Browser: all 34 tests passed across the overview, outage, offline, scene, moon and warning suites against an isolated preview. Together with the 47 backend tests, 81 tests passed.
- JavaScript syntax, Compose validation, and Git whitespace checks passed.
- The running hardened container reported UID 10001, a read-only root filesystem, localhost-only port publication, writable dedicated data storage, and no `.env` or unrelated migration artifact in the application image.
- Anonymous requests to the public dashboard and CSV export returned a redirect to the team's Cloudflare Access domain. Direct origin sensor and export requests returned 401; health remained 200.
- The signed-in Chrome session loaded all three fresh sensors, the local November 4 forecast, pollen, almanac and newly generated insights.
- Migration copied the existing readings CSV and caches into the data volume and verified their SHA-256 checksums. Original project runtime files remain intact. Production uses the volume from this point onward.

No broad permissions were granted, and the Access application's existing Google email allow rule was preserved. The public bypass was detached from this application; the reusable policy itself was not deleted. Debian package vulnerabilities and full historical secret scanning remain outside this review's validation scope.
