# AskAlf Browser Bridge — Headless Chromium via CDP
FROM debian:bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/askalf/askalf"
LABEL org.opencontainers.image.description="AskAlf Browser Bridge — Headless Chromium for web scraping and automation"
LABEL org.opencontainers.image.licenses="MIT"

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      chromium \
      socat \
      fonts-liberation \
      fonts-noto-color-emoji \
      ca-certificates \
      curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN groupadd -r browser && useradd -r -g browser browser && \
    mkdir -p /home/browser/data && chown -R browser:browser /home/browser

EXPOSE 9222

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://127.0.0.1:9222/json/version || exit 1

# socat forwards 0.0.0.0:9222 → 127.0.0.1:9223
# Chromium debugger only listens on 127.0.0.1 in newer versions
CMD ["sh", "-c", "socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9223 & exec chromium --headless --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer --disable-crash-reporter --disable-extensions --disable-background-networking --no-first-run --remote-debugging-port=9223 --remote-allow-origins=* --user-data-dir=/home/browser/data"]
