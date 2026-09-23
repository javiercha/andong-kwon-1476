#!/bin/sh
# Take the shared files from their canonical homes, and say which version.
#
#   ./scripts/vendor.sh            # refuses to overwrite a locally edited copy
#   ./scripts/vendor.sh --force
#
# samhan-graph is canonical HERE (web/js/samhan-graph/); the engine and the
# two stylesheets are canonical in Relinkings until the skin is extracted
# (see Review → Proposals → "Extract the samhan skin"). The point of the
# script is the record it leaves in web/VENDORED, not the copying.
set -eu
cd "$(dirname "$0")/.."
RL=~/projects/relinkings/web
FORCE=${1:-}
take() {  # take <src> <dst>
  if [ -f "$2" ] && [ "$FORCE" != "--force" ] && ! cmp -s "$1" "$2"; then
    echo "  ! $2 differs from $1 — keep the local edit, or --force"; return 0
  fi
  cp "$1" "$2"; echo "  $2  ← $1"
}
echo "from relinkings"
take "$RL/js/engine.js"    web/js/engine.js
take "$RL/js/d3.v7.min.js" web/js/d3.v7.min.js
take "$RL/css/main.css"    web/css/main.css
# the skin is canonical HERE now (web/css/samhan-skin/); Relinkings and Sebo vendor it
{
  echo "vendored $(date +%Y-%m-%d)"
  echo "relinkings  $(git -C ~/projects/relinkings rev-parse --short HEAD 2>/dev/null || echo '?')  engine $(grep -oE "VERSION: '[0-9.]+'" web/js/engine.js | head -1 | grep -oE '[0-9.]+')"
  echo "samhan-graph $(cat web/js/samhan-graph/VERSION)  (canonical here)"
} > web/VENDORED
cat web/VENDORED
