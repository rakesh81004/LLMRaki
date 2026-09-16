#!/bin/bash
# Builds LLMRaki and installs the .app bundle into /Applications so it shows up
# in Launchpad/Spotlight like any other Mac app. Re-run this after any code change.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building renderer/main/preload..."
npx electron-vite build

echo "==> Packaging the macOS .app (unsigned, ad-hoc)..."
npx electron-builder --mac --dir

APP_PATH=$(find dist -maxdepth 2 -name "*.app" | head -1)
if [ -z "$APP_PATH" ]; then
  echo "Build failed: no .app bundle found under dist/"
  exit 1
fi

APP_NAME=$(basename "$APP_PATH")

echo "==> Installing $APP_NAME to /Applications..."
rm -rf "/Applications/$APP_NAME"
cp -R "$APP_PATH" /Applications/

echo "==> Done. Launch it from Spotlight/Launchpad, or run:"
echo "    open \"/Applications/$APP_NAME\""
