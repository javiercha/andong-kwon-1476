/**
 * andongkwon1476.samhan.ai — static assets, one integer, and the reader reports.
 *
 * The edition is a client-side application: the Worker serves the files and
 * answers three things.
 *
 *   GET  /api/views       the domain-wide view tally, one KV key ("total"),
 *                         as samhan.ai's Worker does for the apex and for Sebo
 *                         and Relinkings'. A count and nothing else.
 *   POST /api/report      a visitor's error report → the D1 table `reports`
 *                         (schema in worker/schema.sql; same columns as the
 *                         preview server's reports.py). Same-origin only,
 *                         JSON only, every field capped, 20 an hour per address.
 *   /admin/reports        the editor's view of the reports, behind a login:
 *                         a form that checks ADMIN_PASSWORD (a Worker secret)
 *                         and sets a signed, HttpOnly cookie for 12 hours
 *                         (ADMIN_SECRET signs it); resolve with a state and a note;
 *                         /admin/reports.tsv downloads the ledger.
 *
 * Security headers are set by dist/_headers (written by scripts/build.sh from
 * server.py); the admin pages carry their own tighter policy.
 */
const SINCE = "2026-09-23";
const KEY = "total";
const BOTS = /bot|crawl|spider|slurp|curl|wget|python-requests|go-http-client|facebookexternalhit|bingpreview|uptime|monitor|lighthouse|pingdom/i;
const CAPS = { leaf: 40, person: 40, url: 400, print_says: 2000, table_says: 2000, note: 4000, contact: 200 };
const STATES = ["new", "accepted", "declined", "fixed"];
const ADMIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return new Response(null, { status: 301, headers: { Location: url.toString() } });
    }
    if (url.pathname === "/api/views") {
      let views = 0;
      try { views = Number(await env.VISITS.get(KEY)) || 0; } catch (e) {}
      return json({ views, since: SINCE });
    }
    if (url.pathname === "/api/report") return request.method === "POST" ? report(request, env) : json({ error: "POST" }, 405);
    if (url.pathname.startsWith("/admin/")) return admin(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const response = await env.ASSETS.fetch(request);
    const isDoc = (response.headers.get("content-type") || "").includes("text/html");
    const ua = request.headers.get("user-agent") || "";
    if (isDoc && response.ok && request.method === "GET" && !BOTS.test(ua)) ctx.waitUntil(bump(env));
    return response;
  },
};

async function bump(env) {
  try {
    const n = Number(await env.VISITS.get(KEY)) || 0;
    await env.VISITS.put(KEY, String(n + 1));
  } catch (e) {}
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ── visitors ────────────────────────────────────────────────────────────
async function report(request, env) {
  if (!env.REPORTS) return json({ error: "reports are not enabled on this deployment" }, 503);
  if ((request.headers.get("content-type") || "").split(";")[0].trim() !== "application/json") return json({ error: "send JSON" }, 415);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "cross-origin" }, 403);
  let d;
  try { d = await request.json(); } catch (e) { return json({ error: "not JSON" }, 400); }
  if (!d || typeof d !== "object") return json({ error: "not an object" }, 400);
  if (d.website) return json({ ok: true, id: 0 });                       // the honeypot
  const row = {};
  for (const [k, cap] of Object.entries(CAPS)) {
    const v = d[k] == null ? "" : d[k];
    if (typeof v !== "string") return json({ error: k + " must be text" }, 400);
    row[k] = v.trim().slice(0, cap);
  }
  if (!(row.print_says || row.table_says || row.note)) return json({ error: "say what the print says, what the table says, or leave a note" }, 400);
  const addr = request.headers.get("cf-connecting-ip") || "";
  const hour = new Date(Date.now() - 3600e3).toISOString();
  const { n } = await env.REPORTS.prepare("SELECT COUNT(*) n FROM reports WHERE addr = ? AND created > ?").bind(addr, hour).first();
  if (n >= 20) return json({ error: "too many reports from this address this hour" }, 429);
  const res = await env.REPORTS.prepare(
    "INSERT INTO reports (created, addr, leaf, person, url, print_says, table_says, note, contact) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(new Date().toISOString().slice(0, 19) + "Z", addr, row.leaf, row.person, row.url, row.print_says, row.table_says, row.note, row.contact).run();
  return json({ ok: true, id: res.meta.last_row_id });
}

// ── the editor ──────────────────────────────────────────────────────────
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
}
async function session(request, env) {
  const m = /(?:^|;\s*)ak_editor=([^;]+)/.exec(request.headers.get("cookie") || "");
  if (!m || !env.ADMIN_SECRET) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return (await hmac(env.ADMIN_SECRET, "editor." + exp)) === sig;
}
function page(title, body) {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — The Andong Kwŏn Genealogy of 1476</title><meta name="robots" content="noindex"><style>${CSS}</style></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": ADMIN_CSP, "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });
}
async function admin(request, env, url) {
  if (!env.REPORTS || !env.ADMIN_PASSWORD || !env.ADMIN_SECRET) return page("Reports", "<p>Reports are not enabled on this deployment: bind the D1 database REPORTS and set the secrets ADMIN_PASSWORD and ADMIN_SECRET.</p>");
  if (url.pathname === "/admin/login" && request.method === "POST") {
    const f = await request.formData();
    const given = String(f.get("password") || "");
    const ok = given.length === env.ADMIN_PASSWORD.length && (await hmac(env.ADMIN_SECRET, given)) === (await hmac(env.ADMIN_SECRET, env.ADMIN_PASSWORD));
    if (!ok) return page("Sign in", loginForm("That is not the password."));
    const exp = Date.now() + 12 * 3600e3;
    const cookie = `ak_editor=${exp}.${await hmac(env.ADMIN_SECRET, "editor." + exp)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
    return new Response(null, { status: 303, headers: { location: "/admin/reports", "set-cookie": cookie } });
  }
  if (url.pathname === "/admin/logout") {
    return new Response(null, { status: 303, headers: { location: "/admin/reports", "set-cookie": "ak_editor=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0" } });
  }
  if (!(await session(request, env))) return page("Sign in", loginForm());
  if (url.pathname === "/admin/reports/resolve" && request.method === "POST") {
    const f = await request.formData();
    const id = Number(f.get("id")), state = String(f.get("state") || "");
    if (!Number.isInteger(id) || !STATES.includes(state)) return new Response("Bad Request", { status: 400 });
    await env.REPORTS.prepare("UPDATE reports SET state=?, resolved=?, editor_note=? WHERE id=?")
      .bind(state, state === "new" ? null : new Date().toISOString().slice(0, 19) + "Z", String(f.get("editor_note") || "").slice(0, 2000), id).run();
    return new Response(null, { status: 303, headers: { location: "/admin/reports#r" + id } });
  }
  if (url.pathname === "/admin/reports.tsv") {
    const { results } = await env.REPORTS.prepare("SELECT * FROM reports ORDER BY id DESC").all();
    const cols = ["id", "created", "state", "leaf", "person", "url", "print_says", "table_says", "note", "contact", "resolved", "editor_note"];
    const tsv = [cols.join("\t")].concat(results.map(r => cols.map(c => String(r[c] ?? "").replace(/\t/g, " ").replace(/\n/g, " / ")).join("\t"))).join("\n") + "\n";
    return new Response(tsv, { headers: { "content-type": "text/tab-separated-values; charset=utf-8", "content-disposition": 'attachment; filename="ak1476-reports.tsv"', "cache-control": "no-store" } });
  }
  if (url.pathname === "/admin/reports") {
    const state = url.searchParams.get("state");
    const { results: counts } = await env.REPORTS.prepare("SELECT state, COUNT(*) n FROM reports GROUP BY state").all();
    const c = Object.fromEntries(counts.map(r => [r.state, r.n]));
    const rows = STATES.includes(state)
      ? (await env.REPORTS.prepare("SELECT * FROM reports WHERE state=? ORDER BY id DESC").bind(state).all()).results
      : (await env.REPORTS.prepare("SELECT * FROM reports ORDER BY id DESC").all()).results;
    const tabs = ["", ...STATES].map(s => `<a href="/admin/reports${s ? "?state=" + s : ""}" class="${(state || "") === s ? "on" : ""}">${s || "all"} <span class="n">${s ? c[s] || 0 : counts.reduce((a, r) => a + r.n, 0)}</span></a>`).join("");
    const body = rows.length ? rows.map(r => `<article class="r" id="r${r.id}"><header><span class="mono">#${r.id}</span> <span class="mono">${esc(r.created.slice(0, 16).replace("T", " "))}</span> <span class="st st-${esc(r.state)}">${esc(r.state)}</span> <span class="leaf">${esc(r.leaf || "—")}</span> ${r.person ? `<span class="hanja">${esc(r.person)}</span>` : ""}</header>
${r.url ? `<div class="url"><a href="${esc(r.url)}">${esc(r.url)}</a></div>` : ""}
${[["print_says", "the print says"], ["table_says", "the table says"], ["note", "note"], ["contact", "contact"], ["editor_note", "editor"]].filter(([k]) => r[k]).map(([k, l]) => `<dl><dt>${l}</dt><dd>${esc(r[k])}</dd></dl>`).join("")}
<form method="post" action="/admin/reports/resolve" class="act"><input type="hidden" name="id" value="${r.id}"><input type="text" name="editor_note" placeholder="editor's note (kept here only)" value="${esc(r.editor_note || "")}">${STATES.map(s => `<button name="state" value="${s}"${s === r.state ? " disabled" : ""}>${s}</button>`).join("")}</form></article>`).join("")
      : `<p class="empty">No reports${state ? " in state " + esc(state) : ""}.</p>`;
    return page("Reports", `<h1>Reader reports <small>The Andong Kwŏn Genealogy of 1476</small></h1><nav>${tabs}<a href="/admin/reports.tsv" class="dl">download TSV</a><a href="/admin/logout" class="dl">sign out</a></nav>${body}<footer>Reports live in the D1 table and are shown to no visitor. Accepting one does not change the tables; that is done by hand, with the report as the warrant.</footer>`);
  }
  return new Response("Not Found", { status: 404 });
}
function loginForm(msg) {
  return `<h1>Reader reports <small>The Andong Kwŏn Genealogy of 1476</small></h1><form method="post" action="/admin/login" class="login"><label for="pw">The editor's password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus><button>Sign in</button>${msg ? `<p class="err">${esc(msg)}</p>` : ""}</form>`;
}
const CSS = `
:root{--bg:#f7f4ee;--pn:#fffdf8;--ink:#1f1c17;--sec:#5d574c;--faint:#8e877a;--hair:#d9d2c4;--acc:#a0342d;--acc2:#3b5f83}
@media(prefers-color-scheme:dark){:root{--bg:#141311;--pn:#1c1a17;--ink:#e8e2d6;--sec:#b3ab9c;--faint:#7d7668;--hair:#3a362f;--acc:#d16a62;--acc2:#8fb0d1}}
body{margin:0 auto;padding:28px 20px 60px;background:var(--bg);color:var(--ink);font:14px/1.5 "Public Sans",system-ui,sans-serif;max-width:900px}
h1{font:400 24px/1.2 Newsreader,Georgia,serif;margin:0 0 14px}h1 small{display:block;font:10px/1.4 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-top:4px}
nav{display:flex;gap:14px;border-bottom:1px solid var(--hair);padding-bottom:8px;margin-bottom:16px;font:11px "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase}
nav a{color:var(--sec);text-decoration:none}nav a.on{color:var(--ink);border-bottom:2px solid var(--acc)}nav a .n{color:var(--faint)}nav .dl{color:var(--acc2)}nav .dl:first-of-type{margin-left:auto}
article.r{background:var(--pn);border:1px solid var(--hair);border-radius:2px;padding:12px 14px;margin-bottom:12px}
article.r header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.mono{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--sec)}
.st{font:10px "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase;padding:1px 6px;border:1px solid var(--hair);border-radius:2px}
.st-new{color:var(--acc);border-color:var(--acc)}.st-accepted{color:var(--acc2);border-color:var(--acc2)}.st-fixed{color:#3e7a4a}.st-declined{color:var(--faint)}
.leaf{font-weight:600}.hanja{font-family:"Noto Serif TC","Noto Serif KR",serif;font-size:15px}
.url{font-size:11px;margin:4px 0}.url a{color:var(--acc2);word-break:break-all}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;margin:8px 0}dt{font:10px "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding-top:3px}dd{margin:0;white-space:pre-wrap}
form.act{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}form.act input[type=text],form.login input{flex:1;min-width:200px;font:13px inherit;padding:4px 8px;background:var(--bg);color:var(--ink);border:1px solid var(--hair);border-radius:2px}
form.act button,form.login button{font:11px "IBM Plex Mono",monospace;letter-spacing:.08em;text-transform:uppercase;background:var(--bg);color:var(--sec);border:1px solid var(--hair);border-radius:2px;padding:4px 10px;cursor:pointer}form.act button:disabled{color:var(--faint);cursor:default;border-style:dashed}
form.login{display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:480px}form.login label{width:100%;font:10px "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--sec)}.err{color:var(--acc);width:100%;font-size:12px}
.empty{color:var(--faint)}footer{margin-top:30px;font-size:11.5px;color:var(--faint);border-top:1px solid var(--hair);padding-top:10px}
`;
