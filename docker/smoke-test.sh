#!/usr/bin/env bash
# Prove a built image actually does the job: boot it, upload a PDF, and check a
# real presentation comes back out. Used by CI before anything is published,
# and by hand after a local build:
#
#   docker build -f docker/Dockerfile -t izerp:dev .
#   docker/smoke-test.sh izerp:dev
set -euo pipefail

IMAGE="${1:-izerp:dev}"
PORT="${PORT:-8099}"
NAME="izerp-smoke-$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PDF="${PDF:-$ROOT/test/e2e/fixtures/sample.pdf}"
DATA="$(mktemp -d)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # On Linux the container writes as root into the bind mount, so a non-root
  # runner cannot delete the result. Empty it from inside a container first.
  docker run --rm -v "$DATA:/data" "$IMAGE" \
    sh -c 'rm -rf /data/..?* /data/.[!.]* /data/*' >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

fail() { echo "✗ $*" >&2; docker logs "$NAME" 2>&1 | tail -30 >&2 || true; exit 1; }
ok()   { echo "✓ $*"; }

echo "── smoke test · $IMAGE"
docker run -d --name "$NAME" -p "$PORT:8080" -v "$DATA:/data" "$IMAGE" >/dev/null

for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS --max-time 5 "http://localhost:$PORT/healthz" >/dev/null || fail "the server never became healthy"
ok "healthy"

# The library page must render before anything is uploaded.
curl -fsS "http://localhost:$PORT/" | grep -q "Add a presentation" || fail "library page is missing the upload form"
ok "library page renders"

# Upload → the deck must be reachable straight away.
curl -fsS -o /dev/null -F "name=Smoke Deck" -F "pdf=@$PDF" "http://localhost:$PORT/upload" || fail "upload was refused"
ok "PDF uploaded"

DECK="$(curl -fsS "http://localhost:$PORT/p/smoke-deck/deck.izerp")" || fail "no deck.izerp was generated"
echo "$DECK" | grep -q '"slides"' || fail "deck.izerp has no slides array"
SLIDES="$(printf '%s' "$DECK" | tr -d ' \n' | grep -o '"id":' | wc -l | tr -d ' ')"
[ "$SLIDES" -ge 3 ] || fail "expected at least 3 slides for a 3-page PDF, got $SLIDES"
ok "deck generated ($SLIDES slides)"

PAGE="$(curl -fsS "http://localhost:$PORT/p/smoke-deck/")" || fail "presentation page did not render"
echo "$PAGE" | grep -q 'data-slides="deck.izerp"' || fail "the page does not wire data-slides"
echo "$PAGE" | grep -q 'izerp-lib.js'              || fail "the page does not load izerp-lib.js"
echo "$PAGE" | grep -q 'class="izerp-page"'        || fail "the page contains no page images"
ok "presentation page wires iZerp"

curl -fsS -o /dev/null "http://localhost:$PORT/assets/izerp-lib.js"  || fail "izerp-lib.js is not served"
curl -fsS -o /dev/null "http://localhost:$PORT/assets/izerp-lib.css" || fail "izerp-lib.css is not served"
curl -fsS -o /dev/null "http://localhost:$PORT/p/smoke-deck/pages/0001.png" || fail "page image missing"
ok "library files and page images served"

# The volume is the product promise: everything must be on the host side.
[ -f "$DATA/smoke-deck/deck.izerp" ]      || fail "deck.izerp is not on the volume"
[ -f "$DATA/smoke-deck/source.pdf" ]      || fail "the original PDF was not kept"
[ -f "$DATA/smoke-deck/pages/0001.png" ]  || fail "page images are not on the volume"
ok "everything landed on the mounted volume"

# The two jobs get two links, and both land on the one canonical URL so a deck
# never ends up with a separate set of slides per path.
for route in present edit; do
  LOC="$(curl -fsS -o /dev/null -w '%{redirect_url}' "http://localhost:$PORT/p/smoke-deck/$route")"
  case "$LOC" in
    */p/smoke-deck/\#$route) ok "/$route → ${LOC##*/p/smoke-deck/}" ;;
    *) fail "/$route should redirect to /p/smoke-deck/#$route, got: ${LOC:-nothing}" ;;
  esac
done

# The volume must stay usable from the host: a deck the container created has
# to be deletable by whoever owns the mounted directory, without sudo.
if [ "$(uname)" = "Linux" ]; then
  want="$(stat -c '%u:%g' "$DATA")"
  got="$(stat -c '%u:%g' "$DATA/smoke-deck/deck.izerp")"
  [ "$want" = "$got" ] || fail "deck files are owned by $got, the volume by $want — the host user could not delete them"
  ok "files belong to the volume's owner ($got)"
fi

# Garbage in must not produce a broken deck.
BAD="$(mktemp)"; echo 'not an izerp file' > "$BAD"
LOC="$(curl -fsS -o /dev/null -w '%{redirect_url}' -F "name=Bad" -F "pdf=@$PDF" -F "deck=@$BAD" "http://localhost:$PORT/upload")"
case "$LOC" in *tone=warn*) ok "a broken .izerp is rejected with a message" ;;
               *) fail "a broken .izerp was accepted: $LOC" ;; esac
rm -f "$BAD"

echo "── all good"
