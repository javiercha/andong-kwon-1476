"""andongkwon1476 — reader reports: the internal record of what visitors flag.

A visitor who finds the table disagreeing with the print presses "Report" in
Inspection and fills a short form: the leaf and the person come from the page,
the visitor writes what the print says, what the table says, a note, and an
optional way to reach them. The report is stored here, in data/reports.sqlite
(never committed), and is read at /admin/reports behind a login. Nothing a
visitor sends is shown to any other visitor, and nothing here writes to the
tables: a report is a claim for the editor to weigh, not an edit.

The login is HTTP Basic over the tailnet's TLS (Tailscale Serve terminates
https). The password lives in data/admin.password, created on first start
with a random 20-character secret that is printed once to the console:

    python3 server.py 8160          # "admin password (first run): ...."

Change it by editing the file. The published site uses the same schema on
Cloudflare D1 (see worker/index.js); the admin page there is the same HTML.

Limits: 20 reports per client address per hour; every text field capped;
no HTML is ever rendered from a report without escaping.
"""
import html
import json
import os
import secrets
import sqlite3
import threading
import time

DB_LOCK = threading.Lock()
CAPS = {'leaf': 40, 'person': 40, 'url': 400, 'print_says': 2000, 'table_says': 2000, 'note': 4000, 'contact': 200}
STATES = ('new', 'accepted', 'declined', 'fixed')


class Reports:
    def __init__(self, data_dir):
        self.path = os.path.join(data_dir, 'reports.sqlite')
        self.pw_path = os.path.join(data_dir, 'admin.password')
        self.rate = {}                      # addr → [timestamps]
        with self._db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created TEXT NOT NULL, addr TEXT, leaf TEXT, person TEXT, url TEXT,
                print_says TEXT, table_says TEXT, note TEXT, contact TEXT,
                state TEXT NOT NULL DEFAULT 'new', resolved TEXT, editor_note TEXT)''')
        self.password = self._password()

    def _db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def _password(self):
        try:
            with open(self.pw_path, encoding='utf-8') as f:
                pw = f.read().strip()
            if pw:
                return pw
        except OSError:
            pass
        pw = secrets.token_urlsafe(15)
        with open(self.pw_path, 'w', encoding='utf-8') as f:
            f.write(pw + '\n')
        os.chmod(self.pw_path, 0o600)
        print('admin password (first run, kept in %s): %s' % (self.pw_path, pw), flush=True)
        return pw

    # ── visitors ──────────────────────────────────────────────────────────
    def allowed(self, addr, now=None):
        now = now or time.time()
        hits = [t for t in self.rate.get(addr, []) if now - t < 3600]
        self.rate[addr] = hits
        if len(hits) >= 20:
            return False
        hits.append(now)
        return True

    def submit(self, body, addr):
        """body: dict from the form. Returns (status, payload)."""
        try:
            d = json.loads(body.decode('utf-8')) if isinstance(body, (bytes, bytearray)) else body
        except (ValueError, UnicodeDecodeError):
            return 400, {'error': 'not JSON'}
        if not isinstance(d, dict):
            return 400, {'error': 'not an object'}
        if d.get('website'):                 # the honeypot field a form-filling bot fills
            return 200, {'ok': True, 'id': 0}
        row = {}
        for k, cap in CAPS.items():
            v = d.get(k, '')
            if v is None:
                v = ''
            if not isinstance(v, str):
                return 400, {'error': k + ' must be text'}
            row[k] = v.strip()[:cap]
        if not (row['print_says'] or row['table_says'] or row['note']):
            return 400, {'error': 'say what the print says, what the table says, or leave a note'}
        if not self.allowed(addr):
            return 429, {'error': 'too many reports from this address this hour'}
        with DB_LOCK, self._db() as db:
            cur = db.execute('INSERT INTO reports (created, addr, leaf, person, url, print_says, table_says, note, contact) '
                             'VALUES (?,?,?,?,?,?,?,?,?)',
                             (time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), addr, row['leaf'], row['person'], row['url'],
                              row['print_says'], row['table_says'], row['note'], row['contact']))
            rid = cur.lastrowid
        return 200, {'ok': True, 'id': rid}

    # ── the editor ────────────────────────────────────────────────────────
    def check_auth(self, header):
        import base64
        if not header or not header.startswith('Basic '):
            return False
        try:
            user, _, pw = base64.b64decode(header[6:]).decode('utf-8').partition(':')
        except Exception:
            return False
        return user == 'editor' and secrets.compare_digest(pw, self.password)

    def rows(self, state=None):
        with self._db() as db:
            if state and state in STATES:
                return [dict(r) for r in db.execute('SELECT * FROM reports WHERE state=? ORDER BY id DESC', (state,))]
            return [dict(r) for r in db.execute('SELECT * FROM reports ORDER BY id DESC')]

    def resolve(self, rid, state, editor_note=''):
        if state not in STATES:
            return False
        with DB_LOCK, self._db() as db:
            db.execute('UPDATE reports SET state=?, resolved=?, editor_note=? WHERE id=?',
                       (state, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) if state != 'new' else None,
                        (editor_note or '')[:2000], int(rid)))
        return True

    def counts(self):
        with self._db() as db:
            return {r['state']: r['n'] for r in db.execute('SELECT state, COUNT(*) n FROM reports GROUP BY state')}

    def tsv(self):
        cols = ['id', 'created', 'state', 'leaf', 'person', 'url', 'print_says', 'table_says', 'note', 'contact', 'resolved', 'editor_note']
        out = ['\t'.join(cols)]
        for r in self.rows():
            out.append('\t'.join((str(r.get(c) or '')).replace('\t', ' ').replace('\n', ' / ') for c in cols))
        return '\n'.join(out) + '\n'

    def admin_html(self, state=None, base='/admin/reports'):
        e = html.escape
        c = self.counts()
        rows = self.rows(state)
        tabs = ''.join('<a href="%s%s" class="%s">%s <span class="n">%d</span></a>' % (
            base, ('?state=' + s) if s else '', 'on' if (state or '') == s else '', s or 'all',
            c.get(s, 0) if s else sum(c.values())) for s in ('', 'new', 'accepted', 'fixed', 'declined'))
        body = ''
        for r in rows:
            body += ('<article class="r %s" id="r%d"><header><span class="id mono">#%d</span> <span class="mono">%s</span> '
                     '<span class="st st-%s">%s</span> <span class="leaf">%s</span> %s</header>' % (
                         e(r['state']), r['id'], r['id'], e(r['created'][:16].replace('T', ' ')), e(r['state']), e(r['state']),
                         e(r['leaf'] or '—'), ('<span class="hanja">%s</span>' % e(r['person'])) if r['person'] else ''))
            if r['url']:
                body += '<div class="url"><a href="%s">%s</a></div>' % (e(r['url']), e(r['url']))
            for k, lab in (('print_says', 'the print says'), ('table_says', 'the table says'), ('note', 'note')):
                if r[k]:
                    body += '<dl><dt>%s</dt><dd>%s</dd></dl>' % (lab, e(r[k]))
            if r['contact']:
                body += '<dl><dt>contact</dt><dd>%s</dd></dl>' % e(r['contact'])
            if r['editor_note']:
                body += '<dl><dt>editor</dt><dd>%s</dd></dl>' % e(r['editor_note'])
            body += ('<form method="post" action="%s/resolve" class="act"><input type="hidden" name="id" value="%d">'
                     '<input type="text" name="editor_note" placeholder="editor\'s note (kept here only)" value="%s">'
                     '%s</form></article>' % (base, r['id'], e(r['editor_note'] or ''),
                     ''.join('<button name="state" value="%s"%s>%s</button>' % (s, ' disabled' if s == r['state'] else '', s) for s in STATES)))
        if not rows:
            body = '<p class="empty">No reports%s.</p>' % ((' in state ' + e(state)) if state else '')
        return ('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                '<title>Reports — The Andong Kwŏn Genealogy of 1476</title><meta name="robots" content="noindex">'
                '<style>' + ADMIN_CSS + '</style></head><body><h1>Reader reports <small>The Andong Kwŏn Genealogy of 1476</small></h1>'
                '<nav>' + tabs + '<a href="%s.tsv" class="dl">download TSV</a></nav>' % base + body +
                '<footer>Reports are kept in data/reports.sqlite on this machine and shown to no visitor. '
                'Accepting one does not change the tables; that is done by hand, with the report as the warrant.</footer></body></html>')


ADMIN_CSS = '''
:root{--bg:#f7f4ee;--pn:#fffdf8;--ink:#1f1c17;--sec:#5d574c;--faint:#8e877a;--hair:#d9d2c4;--acc:#a0342d;--acc2:#3b5f83}
@media(prefers-color-scheme:dark){:root{--bg:#141311;--pn:#1c1a17;--ink:#e8e2d6;--sec:#b3ab9c;--faint:#7d7668;--hair:#3a362f;--acc:#d16a62;--acc2:#8fb0d1}}
body{margin:0;padding:28px 20px 60px;background:var(--bg);color:var(--ink);font:14px/1.5 "Public Sans",system-ui,sans-serif;max-width:900px;margin:0 auto}
h1{font:400 24px/1.2 Newsreader,Georgia,serif;margin:0 0 14px}h1 small{display:block;font:10px/1.4 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-top:4px}
nav{display:flex;gap:14px;border-bottom:1px solid var(--hair);padding-bottom:8px;margin-bottom:16px;font:11px "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase}
nav a{color:var(--sec);text-decoration:none}nav a.on{color:var(--ink);border-bottom:2px solid var(--acc)}nav a .n{color:var(--faint)}nav .dl{margin-left:auto;color:var(--acc2)}
article.r{background:var(--pn);border:1px solid var(--hair);border-radius:2px;padding:12px 14px;margin-bottom:12px}
article.r header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.mono{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--sec)}
.st{font:10px "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase;padding:1px 6px;border:1px solid var(--hair);border-radius:2px}
.st-new{color:var(--acc);border-color:var(--acc)}.st-accepted{color:var(--acc2);border-color:var(--acc2)}.st-fixed{color:#3e7a4a}.st-declined{color:var(--faint)}
.leaf{font-weight:600}.hanja{font-family:"Noto Serif TC","Noto Serif KR",serif;font-size:15px}
.url{font-size:11px;margin:4px 0}.url a{color:var(--acc2);word-break:break-all}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;margin:8px 0}dt{font:10px "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding-top:3px}dd{margin:0;white-space:pre-wrap}
form.act{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}form.act input[type=text]{flex:1;min-width:200px;font:13px inherit;padding:4px 8px;background:var(--bg);color:var(--ink);border:1px solid var(--hair);border-radius:2px}
form.act button{font:11px "IBM Plex Mono",monospace;letter-spacing:.08em;text-transform:uppercase;background:var(--bg);color:var(--sec);border:1px solid var(--hair);border-radius:2px;padding:4px 10px;cursor:pointer}form.act button:disabled{color:var(--faint);cursor:default;border-style:dashed}
.empty{color:var(--faint)}footer{margin-top:30px;font-size:11.5px;color:var(--faint);border-top:1px solid var(--hair);padding-top:10px}
'''
