#!/bin/bash
# Cloud session setup: npm dependencies, Chromium for `npm run e2e`, system libraries for `cargo test` in src-tauri.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Node 24, as in CI (the image ships Node 22, below what some test dependencies require); checksum verified
NODE_VERSION=v24.21.0
NODE_DIR=/opt/node-$NODE_VERSION
if [ ! -x "$NODE_DIR/bin/node" ]; then
  archive="node-$NODE_VERSION-linux-x64.tar.xz"
  tmp=$(mktemp -d)
  if curl -fsSL -o "$tmp/$archive" "https://nodejs.org/dist/$NODE_VERSION/$archive" \
    && curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" \
    && (cd "$tmp" && grep " $archive\$" SHASUMS256.txt | sha256sum -c --quiet -); then
    mkdir -p "$NODE_DIR" && tar -xJf "$tmp/$archive" -C "$NODE_DIR" --strip-components=1
  else
    echo "session-start: Node $NODE_VERSION not installed, keeping $(node -v)" >&2
  fi
  rm -rf "$tmp"
fi
if [ -x "$NODE_DIR/bin/node" ]; then
  export PATH="$NODE_DIR/bin:$PATH"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# npm install (not ci): reuses node_modules cached with the container
npm install --no-audit --no-fund

# UTF-8 locale: without one, Chromium names a download with accents « download » (e2e « Projet enregistré »)
if [ -n "${CLAUDE_ENV_FILE:-}" ] && locale -a 2>/dev/null | grep -qix 'c.utf-\?8'; then
  echo 'export LANG=C.UTF-8' >> "$CLAUDE_ENV_FILE"
fi

# e2e: Playwright's headless shell preinstalled in the image
shell=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -n 1 || true)
if [ -n "$shell" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export OPENFLYOVER_CHROME=\"$shell\"" >> "$CLAUDE_ENV_FILE"
fi

# Tauri on Linux (README, "Application de bureau"): lets `cargo test` run in src-tauri; never blocks the session
packages=(libwebkit2gtk-4.1-dev build-essential file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev)
if command -v apt-get >/dev/null && ! dpkg -s "${packages[@]}" >/dev/null 2>&1; then
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${packages[@]}") \
    >/dev/null 2>&1 || echo "session-start: Tauri system libraries not installed (cargo test unavailable)" >&2
fi
