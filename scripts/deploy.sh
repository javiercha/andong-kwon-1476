#!/bin/sh
# andongkwon1476.samhan.ai — build from this working copy and publish.
# Not run yet: the preview is on the tailnet. See DEPLOY.md before the first run.
set -eu
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then
  echo "! uncommitted changes — commit first so the deploy is traceable:"
  git status --short
  printf '  continue anyway? [y/N] '
  read -r a; [ "$a" = y ] || exit 1
fi
echo "→ tests"; node --test test/edition.test.mjs && python3 test/test_reports.py
echo "→ building"; ./scripts/build.sh
echo "→ deploying"; npx --yes wrangler@latest deploy
echo "→ verifying"
code=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 25 "https://andongkwon1476.samhan.ai/" || echo 000)
printf '  %-28s %s\n' andongkwon1476.samhan.ai "$code"
echo "done. Deployed commit: $(git rev-parse --short HEAD)"
