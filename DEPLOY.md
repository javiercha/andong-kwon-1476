# Running and publishing the edition

## The preview (now)

A launchd job keeps the static server on port 8160, and Tailscale Serve
exposes it to the tailnet only — not a Funnel, so nobody outside the tailnet
can reach it:

    https://zora.tailb7d1f2.ts.net:8160/

    ~/Library/LaunchAgents/com.bdsl.andongkwon1476.plist     the job (python3 server.py 8160 --quiet)
    tailscale serve --https=8160 http://127.0.0.1:8160          the exposure (persistent; --bg)
    tailscale serve --https=8160 off                            to take it down

`server.py` serves `web/` and `data/` only, answers GET and HEAD, and sends the
same security headers the published site will (see below). It reads
`web/index.html`, which `scripts/assemble.py` writes from
`web/index.template.html` — edit the template, not the output.

    python3 scripts/assemble.py        # after editing the template or css/samhan-skin/theme.js
    python3 scripts/build_images.py    # after adding scans (only what is missing; also the full scans for deep zoom)
    node scripts/build_pages.mjs       # People, Lineages and Data pages + data/derived/ (after a table revision)
    launchctl kickstart -k gui/$(id -u)/com.bdsl.andongkwon1476   # restart the server
    node --test test/edition.test.mjs  # the edition's checks
    python3 test/test_reports.py       # the report store and its refusals
    python3 test/smoke.py              # Playwright: both tabs, both themes, four widths, reports, pages → test/shots/

### Reader reports (the one write path)

Report on a leaf posts a JSON form to `/api/report`; `reports.py` stores it in
`data/reports.sqlite` (gitignored, never served). The editor reads them at

    https://zora.tailb7d1f2.ts.net:8160/admin/reports        user "editor"

with the password in `data/admin.password`, generated and printed once at the
server's first start (`launchctl` swallows that print, so read the file). Each
report can be marked accepted, declined or fixed with a note; `/admin/reports.tsv`
downloads the ledger. Accepting a report does not touch the tables. Limits: 20
reports per address per hour, every field capped, a honeypot for bots.


The server computes the Content-Security-Policy from the inline blocks in
`index.html` at start-up, so it must be restarted after reassembling.

## Publishing at andongkwon1476.samhan.ai

**Live since 23 September 2026** (Worker `andongkwon1476`, custom domain, D1
`andongkwon1476-reports`, both secrets set). The edition is static, so it went
where Relinkings went: Cloudflare Workers static assets on a custom domain, no
process on this machine, no tunnel.

    ./scripts/deploy.sh      # tests → build dist/ → wrangler deploy → verify

`wrangler.toml` names the Worker `andongkwon1476` and the route
`andongkwon1476.samhan.ai` as a custom domain, so Cloudflare creates the DNS
record in the samhan.ai zone on the first deploy. `wrangler` is authenticated
on this machine as bigdatastudieslab@gmail.com (as for Relinkings).

The sync is the deploy script: it refuses uncommitted changes, builds `dist/`
from this working copy and uploads, so the local site (this tree on port 8160),
the GitHub repository and the published site are the same commit.

What was done before the first deploy, kept for the record:

1. **Size.** `dist/` is about 440 MB: 364 leaf derivatives (~250 KB), 364 full scans (~0.7 MB), 364
   thumbnails, 363 matplotlib renders as SVG (~180 KB) and the two tables. Workers
   static assets allow 20,000 files and 25 MiB per file, so this fits, and the
   first upload takes a few minutes; later deploys upload only what changed.
   If the notebook renders are not wanted online, delete `web/notebook/`
   from the build and the layer option from the template.
2. **Analytics.** The sibling sites carry the GA4 tag. If it is wanted here,
   add the two tags to the template head and admit
   `https://www.googletagmanager.com` in `script-src` and `connect-src` in
   `server.py`'s `csp()`; the inline `gtag` bootstrap must then also be
   hashed, which the server does for every inline block it finds.
3. **The imprint.** The preview note is gone; the index link carries `?to=D1`,
   the edition's siglum in samhan.ai's index, so the return half of the lemma
   transition lands on its entry. The index links here with `?from=index`.
4. **The views line.** The Worker answers `/api/views` from the KV namespace
   samhan.ai, Sebo and Relinkings share, under the domain's one key.
5. **The reports.** The Worker carries the same report endpoint and admin page
   as the preview, on D1 with a signed-cookie login instead of SQLite and
   Basic auth:

        npx wrangler d1 create andongkwon1476-reports                 # paste the id into wrangler.toml, uncomment the block
        npx wrangler d1 execute andongkwon1476-reports --remote --file worker/schema.sql
        npx wrangler secret put ADMIN_PASSWORD                        # the editor's password
        npx wrangler secret put ADMIN_SECRET                          # random; signs the 12-hour session cookie

   Until these exist, `/api/report` answers 503 and the admin page says what
   is missing; nothing else is affected. The ledger downloads at
   `/admin/reports.tsv` in the same columns as the preview's, so the two can be
   merged by hand if reports arrived on both.
6. **The DOI.** Tag a release on GitHub with Zenodo's integration on; Zenodo
   reads `.zenodo.json` and mints a DOI. Put it into `CITATION.cff` (`doi:`)
   and rebuild the Data page with `EDITION_DOI=10.5281/zenodo.NNN node scripts/build_pages.mjs`.

## The security headers

Set by `server.py` on the preview and written to `dist/_headers` by
`scripts/build.sh`, from the same function, so what was checked on the
tailnet is what ships:

    Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-…' ×3;
      style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
      font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:;
      connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';
      frame-ancestors 'none'; upgrade-insecure-requests
    X-Content-Type-Options: nosniff
    X-Frame-Options: DENY
    Referrer-Policy: strict-origin-when-cross-origin
    Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
    Cross-Origin-Opener-Policy: same-origin
    Strict-Transport-Security (edge only)

The three script hashes are the theme block, the arrival mark and the hanji
mat — the only inline scripts the page carries. `style-src 'unsafe-inline'`
is kept because the module positions its tooltip and the report dialog's
layout uses a few style attributes; it admits no script.

## Rolling back

Every deploy is a commit. `git log --oneline` to find a point, `git revert`
or `git checkout <sha> -- web/`, then `./scripts/deploy.sh`.
