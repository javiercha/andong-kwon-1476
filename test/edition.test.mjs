/* The edition's own checks — the tables, the leaf index, and the shared module.
 *
 *   node --test test/
 *
 * The engine is Relinkings' (vendored); its own suite lives there. What is
 * checked here is what this edition adds: that every leaf the print has is
 * cited, that the leaf index is what Inspection expects, and that the
 * samhan-graph module loads without a page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const Engine = require(path.join(ROOT, 'web/js/engine.js'));

const nodeRows = Engine.loadTSV(fs.readFileSync(path.join(ROOT, 'data/andongkwon_1476_nodes_20250707.tsv'), 'utf8'));
const edgeRows = Engine.loadTSV(fs.readFileSync(path.join(ROOT, 'data/andongkwon_1476_edges_20250707.tsv'), 'utf8'));
const G = Engine.build(nodeRows, edgeRows);
G.generations();

function pageKey(v, l, s) { return 'vol' + v + '_' + (l < 10 ? '0' : '') + l + s; }

test('the tables build', () => {
  assert.equal(G.stats.nodeCount, 7617);
  assert.equal(G.stats.edgeCount, 8729);
  assert.equal(G.stats.byType.HAS_SON + G.stats.byType.HAS_SIL, 8729);
});

test('every leaf of the print is cited, and no other', () => {
  const cited = new Set(G.edges.map(e => pageKey(e.vol, e.leaf, e.side)));
  const expected = new Set();
  for (const [v, max, includeB] of [[1, 57, true], [2, 54, true], [3, 71, false]]) {
    for (let l = 1; l <= max; l++) for (const s of ['a', 'b']) {
      if (s === 'b' && !includeB && l === max) continue;
      expected.add(pageKey(v, l, s));
    }
  }
  assert.equal(cited.size, 363);
  for (const k of expected) assert.ok(cited.has(k), 'leaf never cited: ' + k);
  for (const k of cited) assert.ok(expected.has(k), 'edge cites a leaf the print has not: ' + k);
});

test('every node with a folio stands on a cited leaf', () => {
  const cited = new Set(G.edges.map(e => pageKey(e.vol, e.leaf, e.side)));
  let off = 0;
  G.nodes.forEach(n => { if (n.vol && n.leaf && n.side && !cited.has(pageKey(n.vol, n.leaf, n.side))) off++; });
  assert.equal(off, 0);
});

test('the derivative images exist for every leaf (run scripts/build_images.py first)', () => {
  const pages = path.join(ROOT, 'web/facsimile/pages');
  if (!fs.existsSync(pages)) return;    // not built yet: not a failure of the code
  const cited = new Set(G.edges.map(e => pageKey(e.vol, e.leaf, e.side)));
  for (const k of cited) assert.ok(fs.existsSync(path.join(pages, k + '.jpg')), 'no derivative for ' + k);
});

test('samhan-graph loads without a page and refuses to draw without d3', () => {
  const SG = require(path.join(ROOT, 'web/js/samhan-graph/samhan-graph.js'));
  assert.equal(typeof SG.create, 'function');
  assert.equal(typeof SG.Layout.columns, 'function');
  assert.match(SG.VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(SG.VERSION, fs.readFileSync(path.join(ROOT, 'web/js/samhan-graph/VERSION'), 'utf8').trim());
  assert.throws(() => SG.create({}, {}), /d3/);
});

test('the layout places a leaf without d3', () => {
  const SG = require(path.join(ROOT, 'web/js/samhan-graph/samhan-graph.js'));
  const edges = G.edges.filter(e => e.vol === 1 && e.leaf === 6 && e.side === 'a');
  const ids = new Set(); edges.forEach(e => { ids.add(e.source); ids.add(e.target); });
  const nodes = Array.from(ids).map(id => Object.assign({}, G.node(id)));
  const frame = SG.Layout.columns(nodes, edges, { width: 900, height: 600 });
  assert.ok(frame.gens.length >= 2);
  nodes.forEach(n => { assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), 'unplaced ' + n.id); });
});
