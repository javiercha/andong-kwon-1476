#!/bin/sh
# Assemble the static site in dist/: the app at the root, the TSVs under /data.
# The page fetches ../data/ relative to its own location, which resolves to
# /data from the root just as it does from /web/ in local development.
set -eu
cd "$(dirname "$0")/.."
python3 scripts/assemble.py
python3 scripts/build_images.py
node scripts/build_pages.mjs
rm -rf dist
mkdir -p dist/data
cp -R web/. dist/
rm -f dist/index.template.html
cp data/andongkwon_1476_nodes_20250707.tsv data/andongkwon_1476_edges_20250707.tsv dist/data/
cp -R data/derived dist/data/derived
find dist -name .DS_Store -delete
# Security headers for the assets-only Worker: the same policy the preview
# server sends, so what was checked on the tailnet is what ships.
CSP=$(python3 server.py --csp)
cat > dist/_headers <<H
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: $CSP
/facsimile/*
  Cache-Control: public, max-age=31536000, immutable
/notebook/*
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=3600
/admin/*
  Cache-Control: no-store
H
echo "built dist/ ($(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1))"
