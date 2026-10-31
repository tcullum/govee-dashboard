# Govee Dashboard

A local-first dashboard for Govee temperature/humidity sensors with live indoor readings, local weather, active weather alerts, pollen, almanac history, and optional AI-generated insights.

The app is built as a small Flask server plus a static browser UI. It is designed to run well in Docker on a home server, NAS, or desktop.

## Screenshots

Current dashboard captured October 31, 2026.

![Desktop dashboard in dark mode](docs/screenshot-desktop.png)

<details>
<summary>Light mode and mobile</summary>

![Desktop dashboard in light mode](docs/screenshot-desktop-light.png)

<img src="docs/screenshot-mobile.png" alt="Mobile dashboard in dark mode" width="390">

</details>

## Features

- Live Govee sensor readings with history sparklines
- Outdoor/local weather from Open-Meteo
- Active weather warnings from the National Weather Service
- Three-day pollen forecasts from Google Maps Platform Pollen API
- 10-day forecast and selectable comparison cities
- Almanac comparison against historical weather
- Optional AI insights and weather questions with OpenRouter or Anthropic Claude
- Desktop overview, tabbed detail views, and a live weather house scene
- Dark/light modes, compact mode, and mobile-friendly layout
- Docker Compose support

## Requirements

- A Govee account with devices supported by the Govee Developer API
- A Govee API key
- Docker and Docker Compose, recommended

Optional:

- Anthropic API key for AI Insights
- Google Maps Platform API key for pollen forecasts

## Quick Start With Docker

1. Clone the repo:

```powershell
git clone https://github.com/tcullum/govee-dashboard.git
cd govee-dashboard
```

2. Create your local environment file:

```powershell
Copy-Item .env.example .env
```

3. Edit `.env`:

```env
GOVEE_API_KEY=your_govee_api_key_here
PORT=8000
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
GOOGLE_POLLEN_API_KEY=
POLLEN_CACHE_SECONDS=17280
```

`GOVEE_API_KEY` is required for sensor readings. `ANTHROPIC_API_KEY` is optional; leave it blank if you do not want AI insights.

4. Start the dashboard:

```powershell
docker compose up -d --build
```

5. Open:

[http://localhost:8000](http://localhost:8000)

## Running Without Docker

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python govee_server.py
```

Then open [http://localhost:8000](http://localhost:8000).

On macOS/Linux, activate the virtual environment with:

```bash
source venv/bin/activate
```

## OpenRouter deployment

This deployment uses `AI_PROVIDER=openrouter` for both Ask the weather and AI Insights, with `OPENROUTER_MODEL=anthropic/claude-sonnet-4.6`. Billing is through OpenRouter, not the direct Anthropic account.

Docker mounts the supplied `govee.env` as a read-only Compose secret at `/run/secrets/openrouter_key`; `OPENROUTER_API_KEY_FILE` points to it. The file can contain a bare key or an `OPENROUTER_API_KEY=...` assignment. Do not delete or move the source file without updating the Compose secret path. The credential is not copied into the repository or image and is not sent to the browser. Alternatively, server deployments may supply `OPENROUTER_API_KEY` directly.

OpenRouter requests use a fixed HTTPS endpoint, disabled redirects, no automatic retries, a five-second connect / forty-second read timeout, and bounded output. Only complete text responses are accepted. The origin checks and question rate limit remain enabled. Forecast questions and insights context are sent to OpenRouter and the selected model provider.

Offline tests (the override exercises retained Anthropic compatibility alongside explicit OpenRouter tests; it does not change the running service):

```sh
docker exec -e AI_PROVIDER=anthropic govee-dashboard python -m unittest test_openrouter_ai test_weather_questions test_pollen_api -q
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GOVEE_API_KEY` | Yes | Govee Developer API key used to read sensor data. |
| `PORT` | No | Server port. Defaults to `8000`. |
| `AI_PROVIDER` | No | AI provider: `anthropic` (server default) or `openrouter` (supplied Compose deployment). |
| `OPENROUTER_API_KEY` | No | Server-only OpenRouter key; alternatively use `OPENROUTER_API_KEY_FILE`. |
| `OPENROUTER_API_KEY_FILE` | No | Path to a file containing the OpenRouter key. |
| `OPENROUTER_MODEL` | No | Model used through OpenRouter. |
| `ANTHROPIC_API_KEY` | No | Enables AI features with the Anthropic provider. |
| `ANTHROPIC_MODEL` | No | Anthropic model used for AI insights. |
| `GOOGLE_POLLEN_API_KEY` | No | Server-only Google Maps Platform key with the Pollen API enabled. |
| `POLLEN_CACHE_SECONDS` | No | In-memory pollen reuse window. Defaults to `17280` (4 hours 48 minutes, about five upstream calls daily). |
| `LOG_RETENTION_DAYS` | No | Days of sensor history kept in `govee_readings.csv`. Defaults to `30`. |
| `GOVEE_DEVICE_CACHE_SECONDS` | No | How long the stable Govee device inventory is cached. Defaults to `1800` (30 minutes). |
| `NOAA_TOKEN` | No | Reserved for future/legacy NOAA use. Current weather alerts use public NWS endpoints. |

## Getting A Govee API Key

1. Open the Govee app.
2. Go to account/settings.
3. Find the developer/API key section.
4. Request or copy your API key.
5. Paste it into `.env` as `GOVEE_API_KEY`.

Do not commit `.env`. It is intentionally ignored by Git.

## Useful Commands

Start or rebuild:

```powershell
docker compose up -d --build
```

View logs:

```powershell
docker compose logs --tail=120
```

Stop:

```powershell
docker compose down
```

Check server health/status:

[http://localhost:8000/api/status](http://localhost:8000/api/status)

Force a live readings refresh:

[http://localhost:8000/api/readings?refresh=1](http://localhost:8000/api/readings?refresh=1)

## Data And Caches

The app writes a few local runtime files:

- `govee_readings.csv` for sensor history (automatically trimmed to the last `LOG_RETENTION_DAYS` days, 30 by default)
- `almanac_cache.json` for historical weather cache
- `insights_cache.json` for AI insight cache

These are ignored by Git so each user keeps their own local data. Sensor history is served from an in-memory cache, so the CSV is only read once at startup. Use the export button in the dashboard header (or `/api/export`) to download the full CSV.

## Customizing The Dashboard

Common places to customize:

- City comparison list: `LOCATION_PRESETS` in `app.js`
- Default comparison cities: `DEFAULT_LOCATION_IDS` in `app.js`
- Outdoor sensor detection: `OUTDOOR_KEYWORDS` in `app.js`
- Weather/almanac fallback location: search for `36.17` and `-115.14`
- Visual styling and weather scene animation: `style.css`

The local weather panel asks the browser for geolocation when available. If geolocation is blocked or unavailable, it falls back to Las Vegas.

The house scene follows current weather conditions and local solar time, refreshed each minute. The permanent house cutaway shows live room and backyard readings in anchored markers. Moon phase and illumination remain visible even when the moon is below the horizon.

## API Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/api/readings` | Current Govee readings, cached briefly for fast UI refresh. |
| `/api/readings?refresh=1` | Force a fresh Govee API poll. |
| `/api/history` | 24 hours of per-device history, downsampled, served from memory. |
| `/api/export` | Download the full readings CSV. |
| `/api/almanac` | Historical weather averages from Open-Meteo Archive. |
| `/api/pollen?lat=...&lon=...` | Server-side Google pollen forecast proxy with bounded caching and rate limiting. |
| `/api/almanac/insights` | Optional AI insights. Requires `ANTHROPIC_API_KEY`. |
| `/api/status` | Cache, refresh, history retention, and AI status. |

## Ask The Weather API

Weather questions use the same AI provider configuration as AI Insights: OpenRouter in the supplied deployment, or `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` with the Anthropic provider. No extra key is needed. Each question is standalone; there is no conversation history or answer cache.

`GET /api/weather/ask/status` returns `{"available": true}` when a nonblank server key is configured. This is a configuration check, **not** a successful provider/billing/model health check, and makes no paid call.

`POST /api/weather/ask` requires `Content-Type: application/json` and exactly these fields:

```json
{
  "question": "Will I need an umbrella tomorrow afternoon?",
  "latitude": 36.17,
  "longitude": -115.14,
  "unit": "F",
  "location": "Las Vegas"
}
```

- `question`: nonblank string, at most 1,000 characters.
- `location`: nonblank display label, at most 120 characters; coordinates, not this unverified label, determine the forecast.
- `latitude` / `longitude`: finite JSON numbers in [-90, 90] / [-180, 180]; booleans and numeric strings are rejected.
- `unit`: exactly `F` or `C`. Fahrenheit uses mph/inches; Celsius uses km/h/mm. Other field units remain explicitly identified in forecast metadata.
- Maximum body: 8,192 bytes. Extra fields, client forecasts and custom upstream URLs are rejected.

Success is `{"answer": "...", "sources": [{"label": "Open-Meteo forecast", "url": "https://open-meteo.com/"}], "generated_at": "<UTC ISO timestamp>", "location": "Las Vegas", "unit": "F"}`. Render the answer as text, not HTML. Responses use `Cache-Control: no-store`.

The server fetches fresh Open-Meteo current conditions, the next 48 hourly forecast entries and seven daily forecasts over HTTPS, with no redirects. It includes timestamps, local timezone, retrieval time and unit metadata in the model context; current timestamps older than two hours or over 15 minutes in the future are rejected. The prompt requires admitting missing data, uncertainty and questions beyond the forecast horizon. It does not include sensor secrets, pollen, historical records or official severe-weather alerts. AI answers are not safety guarantees; consult official alerts for hazardous weather. No tools, device control or other actions are available to the model. The question and supplied location are sent to Anthropic; coordinates are sent to both forecast and AI providers.

Cost and availability safeguards:

- One in-flight question and at most **10 admitted attempts per rolling hour**, shared across all clients of the running Flask app. Upstream failures count; invalid requests and busy rejections do not. The in-memory budget resets on restart. This is a single-process limit: do not add multiple WSGI workers/replicas without a shared limiter or equivalent proxy controls.
- At most one forecast request and one AI generation per admitted attempt, with no retries. Network timeouts are 12 seconds for the forecast and 30 seconds for Anthropic; these are network-operation timeouts, not a hard end-to-end deadline. Output is capped at 800 tokens; serialized forecast context at 40,000 characters. Empty, truncated and non-text model responses are errors, never fallback answers.
- Cross-origin browser paid requests are rejected using Origin/Referer and Fetch Metadata checks; no CORS access is granted. Same-origin LAN URLs work, including plain HTTP LAN use. For the Cloudflare deployment, `WEATHER_PUBLIC_ORIGIN=https://weather.cullum.dad` permits the configured HTTPS public origin while the Flask origin remains HTTP behind the proxy. JSON API clients without browser origin headers are permitted. This is not authentication: keep the dashboard on a trusted LAN/VPN, and add authentication plus host validation at a reverse proxy before exposing it publicly. Never trust arbitrary client-supplied forwarded host/scheme headers.

Errors are JSON `{"error": "Readable safe message"}`: 400 invalid input, 403 cross-origin, 413 oversized body, 415 wrong content type, 429 local busy/hourly limit (with `Retry-After`), 502 unusable forecast or failed AI generation, 503 missing/rejected AI credentials or provider rate limit, and 504 upstream timeout. Provider exception bodies and keys are never returned by these endpoints. A configured key can still fail because of billing, model access or provider availability.

Run the isolated mocked-upstream regression suite:

```powershell
docker exec govee-dashboard python -m unittest test_weather_questions -v
```

## Troubleshooting

If no sensors appear:

- Confirm `GOVEE_API_KEY` is set in `.env`.
- Run `docker compose logs --tail=120`.
- Open `/api/readings?refresh=1` and check for returned errors.
- Confirm your devices are visible to the Govee Developer API.

If AI insights fail:

- Set `ANTHROPIC_API_KEY`.
- Confirm `ANTHROPIC_MODEL` is available for your Anthropic account.
- Check `/api/status` and Docker logs.

If weather warnings look wrong:

- Allow browser location access, or update the fallback coordinates in `app.js`.
- Weather alerts are provided by the National Weather Service and are US-focused.

## Security Notes

- Keep `.env` private.
- Restrict `GOOGLE_POLLEN_API_KEY` to the Pollen API and, where practical, to the server's outbound IP.
- The server only serves an explicit allowlist of static files; `.env`, the readings CSV, caches, and server source are never reachable over HTTP.
- Do not expose the dashboard publicly unless you understand the risks.
- If you publish it through a tunnel or reverse proxy, consider adding authentication at the proxy layer.

## License

MIT License. See [LICENSE](LICENSE).
