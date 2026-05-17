FROM python:3.11-slim

# Install curl + CA certificates so Python HTTPS works (NOAA requires this)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the dashboard source and static assets.
COPY . /app/

# Flask port
ENV PORT=8000
EXPOSE 8000

CMD ["python", "govee_server.py"]
