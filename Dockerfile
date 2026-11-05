FROM python:3.11-slim

# Install curl + CA certificates so Python HTTPS works (NOAA requires this)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.lock ./
RUN pip install --no-cache-dir --upgrade -r requirements.lock

# Copy the dashboard source and static assets.
COPY govee_server.py weather_questions.py openrouter_ai.py runtime_storage.py cloudflare_access.py request_security.py weather_context.py /app/
COPY index.html app.js style.css service-worker.js manifest.json favicon.ico favicon-16x16.png favicon-32x32.png /app/
COPY assets/ /app/assets/
COPY favicon/ /app/favicon/
RUN groupadd --gid 10001 dashboard && useradd --uid 10001 --gid dashboard --no-create-home dashboard && \
    mkdir /data && chown dashboard:dashboard /data
USER dashboard
ENV GOVEE_DATA_DIR=/data

# Flask port
ENV PORT=8000 BIND_HOST=0.0.0.0 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD curl --fail --silent http://127.0.0.1:8000/healthz || exit 1

CMD ["python", "govee_server.py"]
