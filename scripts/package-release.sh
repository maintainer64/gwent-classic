#!/usr/bin/env bash
# Build a standalone downloadable Gwent Classic bundle (server + browser assets).
set -euo pipefail

: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${TARGET_OS:?TARGET_OS is required}"
: "${TARGET_ARCH:?TARGET_ARCH is required}"

if [[ ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9][A-Za-z0-9.-]*)?$ ]]; then
  echo 'Invalid RELEASE_VERSION' >&2
  exit 1
fi
if [[ ! "$TARGET_OS" =~ ^[a-z0-9]+$ || ! "$TARGET_ARCH" =~ ^[a-z0-9]+$ || ! "${TARGET_VARIANT:-}" =~ ^[a-z0-9]*$ ]]; then
  echo 'Invalid target platform' >&2
  exit 1
fi
for needed in web/dist/index.html web/dist/img web/dist/svg web/dist/sfx LICENSE MULTIPLAYER.md go.mod; do
  if [[ ! -e "$needed" ]]; then echo "Required bundle input missing: $needed" >&2; exit 1; fi
done

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/web/dist" dist
cp -R web/dist/. "$stage/web/dist/"
cp LICENSE MULTIPLAYER.md "$stage/"

binary='gwent'
if [[ "$TARGET_OS" == 'windows' ]]; then binary='gwent.exe'; fi
CGO_ENABLED=0 GOOS="$TARGET_OS" GOARCH="$TARGET_ARCH" GOARM="${GOARM:-}" \
  go build -trimpath -ldflags='-s -w -buildid=' -o "$stage/$binary" ./cmd/gwent

cat > "$stage/RUNNING.txt" <<'TXT'
Gwent Classic - standalone multiplayer server

1. Unpack this entire ZIP to a writable directory.
2. In a terminal, change to the unpacked directory.
3. Run ./gwent on Linux/macOS/BSD, or gwent.exe on Windows.
4. Open http://localhost:8080 in a browser.

Keep web/dist/ next to the executable. The card catalog is embedded in Go.
The server stores games in ./data; rooms expire 24 hours after creation.
For public Internet use, put the server behind an HTTPS reverse proxy,
set PUBLIC_ORIGIN to your URL and COOKIE_SECURE=true.
You can change the listening address with LISTEN_ADDR (default :8080).
Read MULTIPLAYER.md for gameplay, privacy and deployment details.
TXT

target="${TARGET_OS}_${TARGET_ARCH}${TARGET_VARIANT:+_${TARGET_VARIANT}}"
filename="gwent-classic_${RELEASE_VERSION}_${target}.zip"
output="$(pwd)/dist/$filename"
(cd "$stage" && zip -qr "$output" .)
echo "Created $output"
