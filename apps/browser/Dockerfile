# AskAlf Browser Bridge — Stealth Chromium via CDP
# Routes through Gluetun VPN, evades bot detection
FROM node:22-slim

LABEL org.opencontainers.image.source="https://github.com/askalf/askalf"
LABEL org.opencontainers.image.description="AskAlf Browser Bridge — Stealth headless Chromium for web automation"
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

WORKDIR /app

# Install puppeteer-extra with stealth plugin
RUN npm install puppeteer-extra puppeteer-extra-plugin-stealth puppeteer-core 2>/dev/null

# Browser launcher script
COPY apps/browser/launch.mjs /app/launch.mjs

RUN groupadd -r browser && useradd -r -g browser browser && \
    mkdir -p /home/browser/data && chown -R browser:browser /home/browser /app

USER browser

ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 9222

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://127.0.0.1:9222/json/version || exit 1

CMD ["node", "/app/launch.mjs"]
