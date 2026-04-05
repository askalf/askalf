#!/bin/sh
# AskAlf Browser Bridge entrypoint
# Chromium binds debugger to 127.0.0.1 only on newer versions.
# socat forwards 0.0.0.0:9222 → 127.0.0.1:9223 so other containers can connect.

socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9223 &

exec chromium \
  --headless \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-software-rasterizer \
  --disable-crash-reporter \
  --disable-extensions \
  --disable-background-networking \
  --no-first-run \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9223 \
  --remote-allow-origins=* \
  --user-data-dir=/home/browser/data
