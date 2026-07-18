#!/usr/bin/env bash
#
# Package TopShelf for the Chrome Web Store.
# Reads the version from manifest.json and produces topshelf-<version>.zip
# in the repo root, containing ONLY the files the extension ships with.
#
# Excludes: site/, tests/, scripts/, store-assets/, .git, and the source
# SVG (the store only needs the rendered PNGs).
set -euo pipefail

cd "$(dirname "$0")/.."

# --- version from manifest.json (no jq dependency) ---
VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/')
if [ -z "${VERSION:-}" ]; then
  echo "Could not read version from manifest.json" >&2
  exit 1
fi

# --- the icons the manifest references must exist before we zip ---
missing=0
for s in 16 32 48 128; do
  if [ ! -f "icons/icon-${s}.png" ]; then
    echo "Missing icons/icon-${s}.png -- run: node scripts/render-icons.mjs" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "Refusing to package: rendered PNG icons are required." >&2
  exit 1
fi

ZIP="topshelf-${VERSION}.zip"
rm -f "$ZIP"

# Files/dirs that make up the shipped extension.
zip -r "$ZIP" \
  manifest.json \
  src \
  options \
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png \
  -x '*.DS_Store' >/dev/null

echo "Built $ZIP"
unzip -l "$ZIP"
