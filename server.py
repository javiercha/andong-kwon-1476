#!/usr/bin/env python3
"""andongkwon1476 — the static server, for local work and the tailnet preview.

    python3 server.py 8160            # http://127.0.0.1:8160/
    python3 server.py 8160 --quiet    # no access log
    python3 server.py --csp           # print the Content-Security-Policy and exit

Standard library only. It serves two directories and nothing else:

    /            → 302 to /web/ (the page's relative paths need the directory)
    /web/*       → web/            the application
    /data/*      → data/           the two TSV tables

The repository root is NOT served: the notebooks, the git history and the
originals under facsimile/ and inspection/ stay on disk. The one write path is
POST /api/report, a visitor's error report, stored in data/reports.sqlite and
read by the editor at /admin/reports behind a login (see reports.py); nothing
writes to the tables.

Every response carries the same security headers the published site sets at
the edge (scripts/build.sh writes them into dist/_headers from the same
function), so what is checked on the preview is what ships. The
Content-Security-Policy allows no inline script except the three blocks the
page itself carries — the theme, the arrival mark and the hanji mat — which are
admitted by their hashes, computed from index.html at start-up. Edit one of
those blocks and restart; the policy follows the file.
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import posixpath
import re
import sys
import urllib.parse

import reports as _reports

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
DATA = os.path.join(ROOT, 'data')

_INLINE = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.S | re.I)


def inline_script_hashes(index_html):
    """sha256 of every inline <script> body, base64, as CSP wants them."""
    try:
        with open(index_html, encoding='utf-8') as f:
            html = f.read()
    except OSError:
        return []
    out = []
    for body in _INLINE.findall(html):
        digest = hashlib.sha256(body.encode('utf-8')).digest()
        out.append("'sha256-" + base64.b64encode(digest).decode('ascii') + "'")
    return out


def csp(index_html):
    hashes = ' '.join(inline_script_hashes(index_html))
    return '; '.join([
        "default-src 'self'",
        "script-src 'self' https://www.googletagmanager.com" + (' ' + hashes if hashes else ''),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com",
        "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
    ])


ADMIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

SECURITY = [
    ('X-Content-Type-Options', 'nosniff'),
    ('X-Frame-Options', 'DENY'),
    ('Referrer-Policy', 'strict-origin-when-cross-origin'),
    ('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'),
    ('Cross-Origin-Opener-Policy', 'same-origin'),
    ('Cross-Origin-Resource-Policy', 'same-origin'),
]

_CSP = None
_REPORTS = None


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = 'andongkwon1476/0.1'
    sys_version = ''
    quiet = False

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.tsv': 'text/tab-separated-values; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.md': 'text/markdown; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
    }

    # ── what is served ────────────────────────────────────────────────────
    def translate_path(self, path):
        path = path.split('?', 1)[0].split('#', 1)[0]
        path = posixpath.normpath(urllib.parse.unquote(path))
        if path in ('', '/'):
            return os.path.join(WEB, 'index.html')
        parts = [p for p in path.split('/') if p and p not in ('.', '..')]
        if not parts:
            return os.path.join(WEB, 'index.html')
        head, rest = parts[0], parts[1:]
        if head == 'data' and rest and rest[0] in ('reports.sqlite', 'admin.password', 'reports.sqlite-journal'):
            return os.path.join(ROOT, '.nonexistent')        # the reports are the editor's, never served
        if head == 'web':
            base = WEB
        elif head == 'data':
            base = DATA
        else:
            return os.path.join(ROOT, '.nonexistent')        # 404
        # a directory under web/ falls to its index.html, as before
        full = os.path.join(base, *rest) if rest else base
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        # belt and braces: never escape the two roots
        real = os.path.realpath(full)
        if not (real.startswith(os.path.realpath(WEB) + os.sep) or real.startswith(os.path.realpath(DATA) + os.sep)):
            return os.path.join(ROOT, '.nonexistent')
        return full

    def do_GET(self):
        p = self.path.split('?', 1)[0]
        if p.startswith('/admin/reports'):
            return self.admin_get(p)
        if p in ('', '/', '/web'):
            self.send_response(302)
            self.send_header('Location', '/web/' + (('?' + self.path.split('?', 1)[1]) if '?' in self.path else ''))
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        p = self.path.split('?', 1)[0]
        if p == '/api/report':
            return self.report_post()
        if p == '/admin/reports/resolve':
            return self.admin_resolve()
        self.send_error(405, 'Method Not Allowed')

    def do_PUT(self):
        self.send_error(405, 'Method Not Allowed')
    do_DELETE = do_PATCH = do_OPTIONS = do_PUT

    # ── reports ───────────────────────────────────────────────────────────
    def _body(self, cap=16384):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > cap:
            return None
        return self.rfile.read(n)

    def _json(self, status, obj):
        data = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def report_post(self):
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            return self._json(415, {'error': 'send JSON'})
        origin = self.headers.get('Origin') or ''
        host = self.headers.get('Host') or ''
        if origin and urllib.parse.urlsplit(origin).netloc != host:      # same origin only (CSP form-action is 'none' already)
            return self._json(403, {'error': 'cross-origin'})
        body = self._body()
        if body is None:
            return self._json(413, {'error': 'too long'})
        status, payload = _REPORTS.submit(body, self.client_address[0])
        self._json(status, payload)

    def _authed(self):
        if _REPORTS.check_auth(self.headers.get('Authorization')):
            return True
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="The Andong Kwon Genealogy of 1476 - editor", charset="UTF-8"')
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b'The editor signs in as "editor" with the password in data/admin.password.\n')
        return False

    def admin_get(self, p):
        if not self._authed():
            return
        if p == '/admin/reports.tsv':
            data = _REPORTS.tsv().encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/tab-separated-values; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="ak1476-reports.tsv"')
        elif p == '/admin/reports':
            q = urllib.parse.parse_qs(self.path.split('?', 1)[1]) if '?' in self.path else {}
            data = _REPORTS.admin_html((q.get('state') or [None])[0]).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        else:
            return self.send_error(404)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def admin_resolve(self):
        if not self._authed():
            return
        body = self._body(8192) or b''
        q = urllib.parse.parse_qs(body.decode('utf-8', 'replace'))
        rid, state = (q.get('id') or [''])[0], (q.get('state') or [''])[0]
        if not rid.isdigit() or not _REPORTS.resolve(rid, state, (q.get('editor_note') or [''])[0]):
            return self.send_error(400)
        self.send_response(303)
        self.send_header('Location', '/admin/reports#r' + rid)
        self.end_headers()

    # ── headers ───────────────────────────────────────────────────────────
    def end_headers(self):
        for k, v in SECURITY:
            self.send_header(k, v)
        p = self.path.split('?', 1)[0]
        if p.startswith('/admin/'):
            self.send_header('Content-Security-Policy', ADMIN_CSP)
        elif _CSP:
            self.send_header('Content-Security-Policy', _CSP)
        if re.search(r'\.(jpg|png|svg|woff2?)$', p):
            self.send_header('Cache-Control', 'public, max-age=604800, immutable')
        elif p.endswith('.tsv'):
            self.send_header('Cache-Control', 'public, max-age=3600')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, 'Not Found')
        return None

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)


def main():
    global _CSP, _REPORTS
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('port', nargs='?', type=int, default=8160)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--csp', action='store_true', help='print the Content-Security-Policy and exit')
    a = ap.parse_args()
    _CSP = csp(os.path.join(WEB, 'index.html'))
    _REPORTS = _reports.Reports(DATA)
    if a.csp:
        print(_CSP)
        return
    Handler.quiet = a.quiet
    httpd = http.server.ThreadingHTTPServer((a.host, a.port), Handler)
    print('andongkwon1476 · http://%s:%d/  (serving web/ and data/ only; GET and HEAD)' % (a.host, a.port), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
