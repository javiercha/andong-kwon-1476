#!/usr/bin/env node
/* Build the edition's back matter and its downloads from the tables.
 *
 *   node scripts/build_pages.mjs
 *
 * Writes
 *   web/people.html      the index of every person: surname, choronym, leaf, links into the edition
 *   web/lineages.html    the index of every choronym with its men
 *   web/data.html        the tables and the derived data, each with size and SHA-256
 *   data/derived/leaves.json        the leaf index Inspection uses (vol, leaf, side → people, relations)
 *   data/derived/generations.tsv    biog_id, name, generation from the apex 權幸
 *   data/derived/audit.tsv          the engine's apparatus (every observation, with its leaf)
 *
 * Static pages, so a search engine can index the people, and so the edition
 * has back matter the way a printed one would. Styled by the same sheets as
 * the application.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Engine = require(path.join(ROOT, 'web/js/engine.js'));
const NODES = 'data/andongkwon_1476_nodes_20250707.tsv', EDGES = 'data/andongkwon_1476_edges_20250707.tsv';
const VERSION = '0.9', TABLES = '2025-07-07';
const DOI = process.env.EDITION_DOI || '';
const DOI_LINE = DOI ? `DOI ${DOI}` : '(DOI to follow with the first tagged release)';

const G = Engine.build(Engine.loadTSV(fs.readFileSync(path.join(ROOT, NODES), 'utf8')), Engine.loadTSV(fs.readFileSync(path.join(ROOT, EDGES), 'utf8')));
const gen = G.generations();
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pad2 = n => (n < 10 ? '0' : '') + n;
const leafKey = (v, l, s) => `vol${v}_${pad2(l)}${s}`;
const leafHash = n => n.vol ? `#/leaf/${n.vol}/${n.leaf}${n.side}/${encodeURIComponent(n.id)}` : `#/person/${encodeURIComponent(n.id)}`;
const chor = n => Array.isArray(n.choronym) ? n.choronym.join(' / ') : (n.choronym || '');

function page(title, body, description) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — The Andong Kwŏn Genealogy of 1476</title><meta name="description" content="${esc(description || title)}">
<meta name="color-scheme" content="light dark"><link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500&family=Public+Sans:ital,wght@0,300..600;1,400&family=IBM+Plex+Mono:wght@400;500&family=Noto+Serif+TC:wght@300;400;600&family=Noto+Serif+KR:wght@300;400&display=swap">
<link rel="stylesheet" href="css/main.css"><link rel="stylesheet" href="css/samhan-skin/samhan.css"><link rel="stylesheet" href="css/pages.css">
<script src="css/samhan-skin/theme.js"></script></head><body class="page">
<div class="samhan-imprint"><a class="samhan-imprint-home" href="https://samhan.ai/?to=D1"><svg class="mk" viewBox="0 0 64 48" width="30" height="22" aria-hidden="true"><path d="M4 36H60" stroke="currentColor" stroke-width="2.2" fill="none"/><rect x="7" y="12" width="8" height="24" fill="currentColor"/><rect x="20" y="12" width="8" height="24" fill="currentColor"/><rect x="33" y="12" width="8" height="24" fill="currentColor"/><path d="M45 36h8l4.6-15.6h-8z" fill="var(--mark-acc,var(--acc))"/></svg><span>samhan<span class="pt">.</span>ai</span></a><span class="samhan-imprint-sp"></span></div>
<header class="top-bar page-bar"><div class="top-bar-left"><div class="brand-group"><h1 class="app-title"><a href="./">The Andong Kwŏn Genealogy of 1476</a> <span class="app-title-hj">安東權氏成化譜</span><span class="rl-stage">BETA</span></h1>
<span class="rl-ap"><span class="rl-ap-n">V${VERSION}</span><span>TABLES ${TABLES}</span></span></div></div>
<div class="top-bar-center"><div class="view-toggles"><a class="btn-toggle" href="./#/leaf/1/1a">Inspection</a><a class="btn-toggle" href="./#/graph">Graph</a><a class="btn-toggle${title === 'People' ? ' active' : ''}" href="people.html">People</a><a class="btn-toggle${title === 'Lineages' ? ' active' : ''}" href="lineages.html">Lineages</a><a class="btn-toggle${title === 'Data' ? ' active' : ''}" href="data.html">Data</a></div></div></header>
<main class="page-main">${body}</main>
<footer class="page-foot mono">The Andong Kwŏn Genealogy of 1476 · digital edition by Javier Cha · version ${VERSION} · tables of ${TABLES} · <a href="data.html">how to cite</a></footer>
<div class="hanji-edge" aria-hidden="true"></div></body></html>`;
}

// ── people
const people = Array.from(G.nodes.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh') || (a.id > b.id ? 1 : -1));
const bySurname = new Map();
people.forEach(n => { const s = (n.name || '?').charAt(0); if (!bySurname.has(s)) bySurname.set(s, []); bySurname.get(s).push(n); });
const surnames = Array.from(bySurname.keys()).sort((a, b) => bySurname.get(b).length - bySurname.get(a).length);
let body = `<h2>People <small>${people.length.toLocaleString()} men in the print, in the order of their surnames</small></h2>
<p class="lede">Every man the 1476 print records, with his reading, his lineage and the leaf he stands on. A name opens him on that leaf in Inspection; the lineage opens its index entry. The print names no woman; a daughter appears only as the line from her father to her husband.</p>
<nav class="surnames">${surnames.map(s => `<a href="#s-${encodeURIComponent(s)}" class="hanja">${esc(s)}<span class="n">${bySurname.get(s).length}</span></a>`).join('')}</nav>`;
surnames.forEach(s => {
  body += `<h3 id="s-${esc(s)}" class="hanja">${esc(s)} <small>${bySurname.get(s).length}</small></h3><table class="idx"><thead><tr><th>name</th><th>reading</th><th>lineage</th><th>office</th><th>gen.</th><th>leaf</th><th>id</th></tr></thead><tbody>`;
  bySurname.get(s).forEach(n => {
    const c = chor(n);
    body += `<tr><td class="hanja"><a href="./${leafHash(n)}">${esc(n.name || n.id)}</a>${n.hangul ? ` <span class="hangul faint">${esc(n.hangul)}</span>` : ''}</td><td class="roman">${esc(n.roman || '')}</td>
<td class="hanja">${c ? `<a href="lineages.html#c-${encodeURIComponent(Array.isArray(n.choronym) ? n.choronym[0] : n.choronym)}">${esc(c)}</a>` : '—'}${n.choronymInferred ? ' <span class="inf">inferred</span>' : ''}</td>
<td class="hanja office">${esc(n.office || '')}</td><td class="mono">${n.generation == null ? '—' : n.generation}</td><td class="mono">${n.vol ? `vol. ${n.vol} · ${n.leaf}${n.side}` : '—'}</td><td class="mono faint">${esc(n.id)}</td></tr>`;
  });
  body += '</tbody></table>';
});
fs.writeFileSync(path.join(ROOT, 'web/people.html'), page('People', body, 'Every man in the Andong Kwŏn Genealogy of 1476, with reading, lineage, office and leaf'));

// ── lineages
const byChor = new Map();
people.forEach(n => { (Array.isArray(n.choronym) ? n.choronym : [n.choronym]).filter(Boolean).forEach(c => { if (!byChor.has(c)) byChor.set(c, []); byChor.get(c).push(n); }); });
const chors = Array.from(byChor.keys()).sort((a, b) => byChor.get(b).length - byChor.get(a).length || a.localeCompare(b, 'zh'));
const marriages = new Map(); // choronym → count of HAS_SIL edges in or out
G.edges.forEach(e => { if (e.baseType !== 'HAS_SIL') return; [G.node(e.source), G.node(e.target)].forEach(n => { if (!n) return; (Array.isArray(n.choronym) ? n.choronym : [n.choronym]).filter(Boolean).forEach(c => marriages.set(c, (marriages.get(c) || 0) + 1)); }); });
body = `<h2>Lineages <small>${chors.length} choronyms (本貫) in the print</small></h2>
<p class="lede">Each ancestral seat with the men the print files under it and the marriages it records with other lines. A lineage attributed by inference (propagated along a descent chain because the print gives none) is marked. The Andong Kwŏn themselves are the trunk; everyone else is here through a marriage.</p>
<table class="idx"><thead><tr><th>choronym</th><th class="n">men</th><th class="n">marriages</th><th class="n">inferred</th><th>men</th></tr></thead><tbody>`;
chors.forEach(c => {
  const list = byChor.get(c);
  const inferred = list.filter(n => n.choronymInferred).length;
  body += `<tr id="c-${esc(c)}"><td class="hanja"><strong>${esc(c)}</strong></td><td class="n mono">${list.length}</td><td class="n mono">${marriages.get(c) || 0}</td><td class="n mono">${inferred || ''}</td>
<td class="men hanja">${list.slice(0, 60).map(n => `<a href="./${leafHash(n)}" title="${esc(n.roman || '')}">${esc(n.name || n.id)}</a>`).join(' · ')}${list.length > 60 ? ` <span class="faint">… ${list.length - 60} more</span>` : ''}</td></tr>`;
});
body += '</tbody></table>';
fs.writeFileSync(path.join(ROOT, 'web/lineages.html'), page('Lineages', body, 'The choronyms of the Andong Kwŏn Genealogy of 1476 and the men filed under each'));

// ── derived data
fs.mkdirSync(path.join(ROOT, 'data/derived'), { recursive: true });
const leaves = {};
G.edges.forEach(e => { if (!e.vol) return; const k = leafKey(e.vol, e.leaf, e.side); (leaves[k] = leaves[k] || { vol: e.vol, leaf: e.leaf, side: e.side, people: new Set(), relations: 0 }); leaves[k].relations++; leaves[k].people.add(e.source); leaves[k].people.add(e.target); });
const leavesOut = Object.fromEntries(Object.entries(leaves).sort().map(([k, v]) => [k, { vol: v.vol, leaf: v.leaf, side: v.side, people: Array.from(v.people), relations: v.relations }]));
fs.writeFileSync(path.join(ROOT, 'data/derived/leaves.json'), JSON.stringify({ tables: TABLES, leaves: leavesOut }, null, 1));
fs.writeFileSync(path.join(ROOT, 'data/derived/generations.tsv'), Engine.rowsToTSV(people.map(n => ({ biog_id: n.id, 'x姓名': n.name, name: n.roman, generation: n.generation, inferred_choronym: n.choronymInferred ? 1 : '' }))));
const audit = G.audit();
fs.writeFileSync(path.join(ROOT, 'data/derived/audit.tsv'), Engine.rowsToTSV((audit.items || []).map(it => ({
  kind: it.kind, severity: it.severity, message: it.message, ids: (it.ids || []).join('; '), names: (it.names || []).join('; '),
  vol: it.folio && it.folio.vol, leaf: it.folio && it.folio.leaf, side: it.folio && it.folio.side }))));

// ── the data page
function fileRow(rel, what, columns) {
  const p = path.join(ROOT, rel);
  const buf = fs.readFileSync(p);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const kb = (buf.length / 1024).toFixed(0);
  return `<tr><td><a href="../${rel}" download>${esc(path.basename(rel))}</a></td><td>${what}</td><td class="n mono">${kb} KB</td><td class="mono sha">${sha}</td></tr>` + (columns ? `<tr class="cols"><td></td><td colspan="3" class="faint">${esc(columns)}</td></tr>` : '');
}
body = `<h2>Data <small>the tables, the derived data, and how to cite</small></h2>
<p class="lede">The edition reads two tab-separated tables, the revision of ${TABLES}. Neither is modified by anything on this site. The derived files are computed from them by <code>scripts/build_pages.mjs</code> and can be regenerated; their checksums are given so a download can be verified.</p>
<h3>The tables</h3><table class="idx files"><thead><tr><th>file</th><th>what it is</th><th class="n">size</th><th>sha-256</th></tr></thead><tbody>
${fileRow(NODES, `${G.stats.nodeCount.toLocaleString()} people (${G.stats.duplicateNodeRows} duplicate rows merged)`, 'biog_id · x姓名 (hanja) · 성명 (hangul) · name (McCune-Reischauer) · alt_name · alt_name2 · 姓貫 (choronym) · office · reference · vol · page · side · notes')}
${fileRow(EDGES, `${G.stats.edgeCount.toLocaleString()} relations: HAS_SON (father → son) ${G.stats.byType.HAS_SON.toLocaleString()}, HAS_SIL (father-in-law → son-in-law) ${G.stats.byType.HAS_SIL.toLocaleString()}`, 'source · source_name · target · target_name · type · child_order · wife_note · vol · leaf · side · reference · checked · notes')}
</tbody></table>
<h3>Derived</h3><table class="idx files"><thead><tr><th>file</th><th>what it is</th><th class="n">size</th><th>sha-256</th></tr></thead><tbody>
${fileRow('data/derived/leaves.json', 'the leaf index: for each of the 363 leaves, the people and the number of relations cited on it')}
${fileRow('data/derived/generations.tsv', `the generation of every man from the apex 權幸 (${gen.assigned.toLocaleString()} placed; ${gen.inconsistent.toLocaleString()} inconsistent with an edge, ${gen.repaired.toLocaleString()} repaired)`)}
${fileRow('data/derived/audit.tsv', `the engine's apparatus: ${(audit.items || []).length.toLocaleString()} observations in ${Object.keys(audit.counts || {}).length} kinds, each with its leaf`)}
</tbody></table>
<h3 id="cite">How to cite</h3>
<p>The edition:</p>
<pre class="cite">Cha, Javier. <em>The Andong Kwŏn Genealogy of 1476 (安東權氏成化譜): a digital scholarly edition</em>, version ${VERSION}, tables of ${TABLES}. samhan.ai, 2026. https://andongkwon1476.samhan.ai/ ${DOI_LINE}</pre>
<p>A leaf, or a man on it — the address is stable and carries the leaf and the biographical number:</p>
<pre class="cite">Cha, Javier. <em>The Andong Kwŏn Genealogy of 1476</em>, v${VERSION}, vol. 1 leaf 6a, 權漢功 (D206469). https://andongkwon1476.samhan.ai/#/leaf/1/6a/D206469</pre>
<p>The facsimile is the copy of the Academy of Korean Studies, shelfmark <span class="mono">AKS JE A 55020</span>. The source repository is <a href="https://github.com/javiercha/andong-kwon-1476">github.com/javiercha/andong-kwon-1476</a>; a <code>CITATION.cff</code> file there gives the same in machine-readable form, and each tagged release is archived with a DOI.</p>`;
fs.writeFileSync(path.join(ROOT, 'web/data.html'), page('Data', body, 'The tables of the Andong Kwŏn Genealogy of 1476 edition, derived data with checksums, and how to cite'));
console.log(`people.html (${people.length}), lineages.html (${chors.length}), data.html, data/derived/{leaves.json,generations.tsv,audit.tsv}`);
