#!/usr/bin/env bash
# Build Julgi from this checkout and put it in /Applications.
#
#   scripts/install.sh            pull, build, install
#   scripts/install.sh --check    only check that the tools are there
#   scripts/install.sh --no-pull  build what is checked out now
#   scripts/install.sh --open     also (re)start Julgi afterwards
#
# Locally built apps are not quarantined, so macOS opens them without signing.
# If a code signing identity is in the keychain the app is signed with it (see below).
set -euo pipefail

cd "$(dirname "$0")/.."
APP="src-tauri/target/release/bundle/macos/Julgi.app"
DEST="${JULGI_DEST:-/Applications}"
pull=1; open_after=0; check_only=0
for arg in "$@"; do
  case "$arg" in
    --check) check_only=1 ;;
    --no-pull) pull=0 ;;
    --open) open_after=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ "$(uname)" = "Darwin" ] || { echo "Julgi only runs on macOS for now." >&2; exit 1; }

missing=0
need() { # need <command> <how to get it>
  if command -v "$1" >/dev/null 2>&1; then
    printf '  ok       %s\n' "$1"
  else
    printf '  missing  %s  (%s)\n' "$1" "$2"; missing=1
  fi
}
echo "Checking tools"
need git "xcode-select --install"
need node "https://nodejs.org, version 20 or newer"
need npm "comes with node"
need cargo "https://rustup.rs"
need claude "https://claude.com/claude-code, then run 'claude' once to log in"
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || { echo "  node $major is too old, need 20 or newer"; missing=1; }
fi
[ "$missing" -eq 0 ] || { echo "Install what is missing and run this again." >&2; exit 1; }
[ "$check_only" -eq 0 ] || { echo "All there."; exit 0; }

if [ "$pull" -eq 1 ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Local changes found, skipping git pull."
  else
    echo "Pulling"
    git pull --ff-only
  fi
fi

echo "Installing packages"
npm install --no-fund --no-audit
echo "Building (the first build takes several minutes)"
npm run tauri build

[ -d "$APP" ] || { echo "Build finished but $APP is not there." >&2; exit 1; }
echo "Installing to $DEST/Julgi.app"
rm -rf "$DEST/Julgi.app.new"
cp -R "$APP" "$DEST/Julgi.app.new"
rm -rf "$DEST/Julgi.app"
mv "$DEST/Julgi.app.new" "$DEST/Julgi.app"

# Sign with a stable identity when one exists. macOS ties folder permissions (Documents, Desktop,
# Full Disk Access, ...) to the app's signature. An unsigned build gets a new ad-hoc signature every
# time, so every update made macOS forget what you allowed and ask again.
# JULGI_SIGN=off skips this; JULGI_SIGN="<identity name or hash>" picks one.
sign="${JULGI_SIGN:-auto}"
if [ "$sign" = "auto" ]; then
  sign="$(security find-identity -v -p codesigning 2>/dev/null | awk 'NR==1 && $2 ~ /^[0-9A-F]{40}$/ {print $2}')"
fi
if [ -n "$sign" ] && [ "$sign" != "off" ]; then
  if codesign --force --deep --sign "$sign" --identifier dev.julgi.app "$DEST/Julgi.app" 2>/dev/null; then
    echo "Signed, so macOS keeps the folder permissions you grant across updates."
  else
    echo "Could not sign (the keychain may have refused). macOS may ask for folder permissions again."
  fi
else
  echo "No code signing identity found: macOS will ask for folder permissions again after each update."
  echo "  To stop that, create one (Keychain Access > Certificate Assistant > Create a Certificate, type Code Signing)."
fi

if [ "$open_after" -eq 1 ]; then
  # Sessions are reopened on start, but a session that was mid-answer stops there.
  pkill -x julgi 2>/dev/null || true
  sleep 1
  open "$DEST/Julgi.app"
  echo "Julgi restarted."
else
  echo "Done. Quit Julgi (⌘Q) and open it again to use the new build."
fi
