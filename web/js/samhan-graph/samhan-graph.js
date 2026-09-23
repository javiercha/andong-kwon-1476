/* samhan-graph — the genealogical canvas shared across samhan.ai.
 *
 * One drawing convention for every work in the index: Sebo 世譜, Relinkings
 * 連姻 and the Andong Kwŏn 1476 edition draw a genealogy the same way because
 * they draw it with this file. Version 2 carries the whole of Sebo's Graph
 * feature — not only the drawing (a static generation-row layout, family
 * clusters, the four edge routes, the snapped drag, the floor on the fit) but
 * everything the Graph tab lets a reader do to it: the colour schemes with a
 * picker for every ink and dash, the figures' roles on a path (start,
 * waypoint, target) and the root, custom patrilines with their own colour,
 * dash and width, the hand-drawn line, the floating actions on a selected
 * figure, multi-selection, and export. The Graph TOOLS — the sidebar — live in
 * samhan-graph-tools.js and drive this canvas through the API below; SVG, PNG
 * and TSV are in samhan-graph-export.js.
 *
 * It knows nothing of the page around it: the container, the legend, the
 * tooltip and the empty-state hosts are handed in; d3 is injected (default
 * window.d3); the theme is asked of a callback (default html[data-theme]);
 * every id it writes into <defs> carries a per-instance prefix; and there is
 * a destroy(). Two canvases on one page are fine.
 *
 * The data contract — a kinship subgraph:
 *   nodes: [{ id, name (hanja), roman?, hangul?, office?, dates? | born? died?,
 *             choronym?, choronymInferred?, isGhost?, generation?, altNames?, notes?,
 *             vol?, leaf?, side? }]
 *   edges: [{ id, source, target, baseType: 'HAS_SON'|'HAS_SIL'|'SAME_PERSON',
 *             childOrder?, wifeNote?, notes?, evidence?, kwon? }]
 *   starts: [id]                       kept from v1: the figures asked for (drawn as starts)
 * and setData(sub, { roles: { root, starts, waypoints, targets }, focus, anchorId }).
 *
 * Usage
 *   var g = SamhanGraph.create(el, { legend, empty, onToast, rows: 'local', handDrawn: true });
 *   g.setData({ nodes, edges }, { roles: { root: id } });
 *   g.on('select', fn).on('multiselect', fn).on('expand', fn).on('edge', fn);
 *   g.setScheme('classic'); g.setOption('hasSonStyle', 'double'); g.addPatriline('安東 權');
 *
 * See README.md in this directory for the whole API and the adoption path.
 */
(function (root) {
  'use strict';
  var VERSION = '2.0.0';

  /* Sebo's constants, unchanged: they are what make the applications draw a
     genealogy at the same size. */
  var ROW_H = 150;
  var SIB = 150;
  var CLUSTER_GAP = 80;
  var AXIS_W = 135;
  var SAFE_GUTTER = 50;
  var SNAP_T = 28;
  var BADGE_W = 112;
  var BADGE_MARGIN = 140;
  var PARALLEL_SPREAD = 80;
  var FIT_MIN_DEFAULT = 0.6;
  var FIT_MAX = 1.4;
  var FIT_PAD = 60;

  var LINE_STYLES = ['solid', 'dashed', 'dashdot', 'dotted', 'double', 'longdash', 'loosdash', 'densedot'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  /* Sebo's dash table, verbatim. */
  function dashArray(style) {
    switch (style) {
      case 'dashed': return '6,4';
      case 'dotted': return '2,3';
      case 'dashdot': return '8,3,2,3';
      case 'longdash': return '14,4';
      case 'densedot': return '1.5,2';
      case 'loosdash': return '10,8';
      default: return null;
    }
  }
  function hashKey(str) {
    var h1 = 0x811c9dc5, h2 = 0x1000193, s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = ((h1 ^ c) * 0x01000193) >>> 0;
      h2 = ((h2 + c) * 31 + 7) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
  }
  function isGhost(n) {
    if (!n) return false;
    var g = n.isGhost;
    return g === true || g === 1 || g === 'true' || g === 'True' || g === '1';
  }
  function isInferred(n) { return !!(n && n.choronymInferred); }
  function datesOf(n) {
    if (!n) return '';
    if (n.dates) return n.dates;
    var b = String(n.born || '').trim(), d = String(n.died || '').trim();
    if (!b && !d && n.notes) {
      var m = String(n.notes).match(/\((\d{3,4})[–\-~](\d{3,4})\)/);
      if (m) { b = m[1]; d = m[2]; }
    }
    if (b && d) return b + '–' + d;
    if (b) return 'b. ' + b;
    if (d) return 'd. ' + d;
    return '';
  }

  /* ══════════════════════════════════════════════ 1. kinship order ══
     Sebo's reading of a son's (or son-in-law's) position: the child_order
     column when it holds a number or a hanja ordinal, else the notes and the
     evidence for 長子 / 次男 / "2nd son" and their kin. Returns { rank, label }
     with rank 9999 for "unknown". */
  var RANK_MAP = {
    '長子': 1, '次子': 2, '三子': 3, '四子': 4, '五子': 5, '六子': 6, '七子': 7, '八子': 8, '九子': 9, '十子': 10, '季子': 90,
    '長男': 1, '次男': 2, '三男': 3, '四男': 4, '五男': 5,
    '長': 1, '次': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '元子': 1, '伯子': 1, '仲子': 2, '叔子': 3, '季': 90,
    '長女': 1, '次女': 2, '三女': 3, '四女': 4, '五女': 5,
    '長女壻': 1, '次女壻': 2, '三女壻': 3, '四女壻': 4, '五女壻': 5, '六女壻': 6, '季女壻': 90
  };
  var SON_PATTERNS = [
    [1, /elder son|eldest son|1st son|長子|長男|第一子|1男|長曰|伯子|장남|장자/i], [2, /2nd son|次子|次男|第二子|2男|次曰|仲子|차남|차자/i],
    [3, /3rd son|三子|3男|第三子|三曰|叔子|삼남|3자/i], [4, /4th son|四子|4男|第四子|四曰|사남|4자/i], [5, /5th son|五子|5男|第五子|五曰|오남|5자/i],
    [6, /6th son|六子|6男|第六子|六曰|육남|6자/i], [7, /7th son|七子|7男|第七子|七曰|칠남|7자/i], [8, /8th son|八子|8男|第八子|八曰|팔남|8자/i],
    [9, /9th son|九子|9男|第九子|九曰|구남|9자/i], [10, /10th son|十子|10男|第十子|十曰|십남|10자/i], [90, /youngest son|季子|幼子|少子|막내/i]
  ];
  var SIL_PATTERNS = [
    [1, /1st daughter|長女|1女|長女壻|1女壻|長女適|適.*長女|장녀/i], [2, /2nd daughter|次女|2女|次女壻|2女壻|次女適|適.*次女|차녀/i],
    [3, /3rd daughter|三女|3女|三女壻|3女壻|三女適|삼녀/i], [4, /4th daughter|四女|4女|四女壻|4女壻|四女適|사녀/i],
    [5, /5th daughter|五女|5女|五女壻|5女壻|五女適|오녀/i], [6, /6th daughter|六女|6女|六女壻|6女壻|六女適|육녀/i], [90, /youngest daughter|季女|少女|季女壻|막내딸/i]
  ];
  function kinshipOrder(e, target) {
    if (!e) return { rank: 9999, label: '' };
    if (e.baseType === 'SAME_PERSON') return { rank: 0, label: '同一人' };
    var sil = e.baseType === 'HAS_SIL';
    var rank = 9999;
    var co = e.childOrder;
    if (co !== null && co !== undefined && String(co).trim() !== '') {
      var s = String(co).trim();
      var n = parseInt(s, 10);
      if (!isNaN(n) && n > 0 && n < 500) rank = n;
      else if (RANK_MAP[s]) rank = RANK_MAP[s];
      else { var mm = s.match(/(\d+)/); if (mm) rank = parseInt(mm[1], 10); }
    }
    if (rank === 9999) {
      var texts = [e.notes, e.evidence, target && target.notes, target && target.name,
                   target && (Array.isArray(target.altNames) ? target.altNames.join(' ') : target.altNames)].filter(Boolean).join(' ');
      if (texts) {
        var pats = sil ? SIL_PATTERNS : SON_PATTERNS;
        for (var i = 0; i < pats.length; i++) if (pats[i][1].test(texts)) { rank = pats[i][0]; break; }
      }
    }
    return rank === 9999 ? { rank: 9999, label: '' } : { rank: rank, label: String(rank) };
  }

  /* ══════════════════════════════════════════════ 2. birth-order rank ══
     Sebo's ordering convention: all sons rank before all sons-in-law, an
     unknown order sorts to the far left, and the eldest ends up rightmost. */
  function rankOf(e, target) {
    var r = kinshipOrder(e, target).rank;
    var known = r > 0 && r < 500;
    if (e && e.baseType === 'HAS_SIL') return known ? 500 + r : 9999;
    if (e && e.baseType === 'SAME_PERSON') return 9999;
    return known ? r : 9000;
  }
  function nodeRank(id, inEdges, byId) {
    var best = null;
    var target = byId ? byId.get(id) : null;
    (inEdges.get(id) || []).forEach(function (e) {
      var r = rankOf(e, target);
      if (best === null || r < best) best = r;
    });
    return best === null ? 9999 : best;
  }

  /* ═════════════════════════════════════════════════════════ 3. placement ══ */

  /* Sebo's column assignment, generalised so both this canvas and the P-graph
     can use it. genOf(n) gives the row; the anchor is normalised to 0 so that
     ancestors take negative rows and descendants positive, as in Sebo. */
  function columns(nodes, edges, o) {
    o = o || {};
    var rowHeight = o.rowHeight || ROW_H;
    var sib = o.siblingSpacing || SIB;
    var gap = o.familyClusterGap || CLUSTER_GAP;
    var width = o.width || 900, height = o.height || 600;
    var genOf = o.genOf || function (n) { return n.generation; };
    /* Context mode: the members of the chain or loop being argued for. They are
       kept together and near the middle of a row wherever Sebo's family-block
       rule leaves the ordering free. */
    var focus = (o.focus && o.focus.size) ? o.focus : null;

    var byId = new Map();
    nodes.forEach(function (n) { byId.set(n.id, n); });
    var inE = new Map(), outE = new Map();
    nodes.forEach(function (n) { inE.set(n.id, []); outE.set(n.id, []); });
    edges.forEach(function (e) {
      if (!byId.has(e.source) || !byId.has(e.target)) return;
      outE.get(e.source).push(e);
      inE.get(e.target).push(e);
    });

    // ── rows. Anything the corpus could not place gets a longest-path depth
    //    inside this subgraph, seeded from the rows that are known.
    var gen = new Map(), unplaced = [];
    nodes.forEach(function (n) {
      var g = genOf(n);
      if (g === null || g === undefined) unplaced.push(n.id);
      else gen.set(n.id, g);
    });
    if (unplaced.length) {
      var indeg = new Map();
      nodes.forEach(function (n) { indeg.set(n.id, inE.get(n.id).length); });
      var q = [], depth = new Map();
      nodes.forEach(function (n) {
        if (indeg.get(n.id) === 0) { q.push(n.id); depth.set(n.id, gen.has(n.id) ? gen.get(n.id) : 0); }
      });
      var guard = 0;
      while (q.length && guard++ < 400000) {
        var u = q.shift(), du = depth.get(u);
        outE.get(u).forEach(function (e) {
          var v = e.target;
          var want = gen.has(v) ? gen.get(v) : du + 1;
          if (!depth.has(v) || depth.get(v) < want) depth.set(v, Math.max(want, du + 1));
          indeg.set(v, indeg.get(v) - 1);
          if (indeg.get(v) === 0) q.push(v);
        });
      }
      unplaced.forEach(function (id) { gen.set(id, depth.has(id) ? depth.get(id) : 0); });
    }

    // anchor: the query's starting figure, else a node with no father, else the first
    var anchorId = o.anchorId;
    if (!anchorId || !byId.has(anchorId)) {
      var noFather = nodes.filter(function (n) {
        return !inE.get(n.id).some(function (e) { return e.baseType === 'HAS_SON'; });
      })[0];
      anchorId = (noFather || nodes[0]).id;
    }
    var anchorGen = gen.get(anchorId) || 0;
    nodes.forEach(function (n) { n._gen = gen.get(n.id) - anchorGen; });

    var gens = Array.from(new Set(nodes.map(function (n) { return n._gen; })))
      .sort(function (a, b) { return a - b; });
    var minGen = gens[0], maxGen = gens[gens.length - 1];

    // ── y is the row, and is pinned
    var totalH = (maxGen - minGen) * rowHeight;
    var topPad = Math.max(70, Math.round((height - totalH) / 2));
    nodes.forEach(function (n) { n.y = topPad + (n._gen - minGen) * rowHeight; n.fy = n.y; });

    var byGen = new Map();
    gens.forEach(function (g) { byGen.set(g, []); });
    nodes.forEach(function (n) { byGen.get(n._gen).push(n); });

    // the in-edge a node hangs from: HAS_SON first, then HAS_SIL, then anything
    function parentEdge(n, wantGen) {
      var es = inE.get(n.id), pick = null;
      for (var i = 0; i < es.length; i++) {
        var s = byId.get(es[i].source);
        if (!s || s._gen !== wantGen) continue;
        if (es[i].baseType === 'HAS_SON') return es[i];
        if (!pick || (pick.baseType !== 'HAS_SIL' && es[i].baseType === 'HAS_SIL')) pick = es[i];
      }
      return pick;
    }

    // ── the anchor's own row first
    var row0 = byGen.get(0) || [];
    if (row0.length) {
      var fam = new Map();
      row0.forEach(function (n) {
        var e = parentEdge(n, -1) || (inE.get(n.id)[0] || null);
        var key = e ? e.source : '__orphan__';
        if (!fam.has(key)) fam.set(key, []);
        fam.get(key).push(n);
      });
      fam.forEach(function (kids) {
        kids.sort(function (a, b) { return nodeRank(b.id, inE) - nodeRank(a.id, inE); });
      });
      var anchorNode = byId.get(anchorId);
      var anchorFam = null;
      fam.forEach(function (kids, key) { if (kids.indexOf(anchorNode) >= 0) anchorFam = key; });
      var keys = Array.from(fam.keys()).filter(function (k) { return k !== anchorFam; })
        .sort(function (a, b) { return String(a).localeCompare(String(b)); });
      if (anchorFam !== null) keys.unshift(anchorFam);
      if (focus) {
        /* The anchor's row is the one place the ordering is entirely free — no
           father above to stand under — so the members' families are taken to
           the front of it and the row is centred on them. Every tier below
           inherits the order through its cluster sort. */
        var isFocusFam = function (k) {
          return fam.get(k).some(function (n) { return focus.has(n.id); });
        };
        keys = keys.filter(isFocusFam).concat(keys.filter(function (k) { return !isFocusFam(k); }));
      }
      var flat = [];
      keys.forEach(function (k) { fam.get(k).forEach(function (n) { n._blk = k; }); flat = flat.concat(fam.get(k)); });
      var ai = flat.indexOf(anchorNode);
      if (ai < 0) ai = flat.length - 1;
      if (focus) {
        var fi = [];
        flat.forEach(function (n, i) { if (focus.has(n.id)) fi.push(i); });
        if (fi.length) ai = (fi[0] + fi[fi.length - 1]) / 2;
      }
      flat.forEach(function (n, i) { n.x = (width / 2) + (i - ai) * sib; });
    }

    // ── descendants, tier by tier
    gens.filter(function (g) { return g > 0; }).forEach(function (g) {
      placeTier(byGen.get(g), g - 1, +1);
    });
    // ── ancestors, mirrored, nearest tier first
    gens.filter(function (g) { return g < 0; }).sort(function (a, b) { return b - a; })
      .forEach(function (g) { placeTier(byGen.get(g), g + 1, -1); });

    function placeTier(row, refGen, dir) {
      if (!row || !row.length) return;
      var clusters = new Map(), orphans = [];
      row.forEach(function (n) {
        var ref = null;
        if (dir > 0) {
          var e = parentEdge(n, refGen);
          ref = e ? byId.get(e.source) : null;
        } else {
          // an ancestor hangs from the child it fathered on the row below
          var es = outE.get(n.id), pick = null;
          for (var i = 0; i < es.length; i++) {
            var t = byId.get(es[i].target);
            if (!t || t._gen !== refGen) continue;
            if (es[i].baseType === 'HAS_SON') { pick = es[i]; break; }
            if (!pick) pick = es[i];
          }
          ref = pick ? byId.get(pick.target) : null;
        }
        if (!ref || ref.x === undefined) { orphans.push(n); return; }
        if (!clusters.has(ref.id)) clusters.set(ref.id, { ref: ref, kids: [] });
        clusters.get(ref.id).kids.push(n);
        n._blk = ref.id;
      });
      var list = Array.from(clusters.values()).sort(function (a, b) { return a.ref.x - b.ref.x; });
      var lastRight = -Infinity;
      list.forEach(function (c) {
        var kids = c.kids;
        kids.sort(function (a, b) { return nodeRank(b.id, inE) - nodeRank(a.id, inE); });
        var count = kids.length;
        // the eldest son sits directly beneath his father whenever he can
        var elderIdx = count - 1;
        for (var i = count - 1; i >= 0; i--) {
          var hasSon = (dir > 0 ? inE.get(kids[i].id) : outE.get(kids[i].id))
            .some(function (e) { return e.baseType === 'HAS_SON'; });
          if (hasSon) { elderIdx = i; break; }
        }
        var anchorX = c.ref.x;
        var proposedLeft = anchorX - elderIdx * sib;
        if (proposedLeft < lastRight + gap) anchorX = lastRight + gap + elderIdx * sib;
        kids.forEach(function (n, i) { n.x = anchorX - (elderIdx - i) * sib; });
        lastRight = anchorX + (count - 1 - elderIdx) * sib;
      });
      if (orphans.length) {
        orphans.sort(function (a, b) { return nodeRank(b.id, inE) - nodeRank(a.id, inE); });
        var start = (lastRight === -Infinity ? width / 2 : lastRight + gap);
        orphans.forEach(function (n, i) { n.x = start + i * sib; n._blk = '__orphan__'; });
      }
    }

    nodes.forEach(function (n) { if (n.x === undefined || !isFinite(n.x)) n.x = width / 2; });

    /* Sebo's third pass: shift a whole sibling block so the eldest son lands
       under his father, but only where nothing on that row would be crowded
       inside 0.85 of the sibling spacing. */
    var seen = new Set();
    edges.forEach(function (e) {
      if (e.baseType !== 'HAS_SON' || seen.has(e.source)) return;
      seen.add(e.source);
      var father = byId.get(e.source);
      if (!father) return;
      var kids = outE.get(e.source).map(function (x) { return byId.get(x.target); })
        .filter(function (k) { return k && k._gen === father._gen + 1; });
      if (!kids.length) return;
      var elder = kids[0];
      kids.forEach(function (k) { if (nodeRank(k.id, inE) < nodeRank(elder.id, inE)) elder = k; });
      var shift = father.x - elder.x;
      if (!shift) return;
      var others = (byGen.get(father._gen + 1) || []).filter(function (o2) { return kids.indexOf(o2) < 0; });
      var clash = kids.some(function (k) {
        var nx = k.x + shift;
        return others.some(function (o2) { return Math.abs(o2.x - nx) < sib * 0.85; });
      });
      if (!clash) kids.forEach(function (k) { k.x += shift; });
    });

    /* ROUND 3.1 — the members kept together, where the family block allows it.
       A block whose figures stand vertically on a HAS_SON line — the eldest son
       under his father, or the father over him — is pinned: Sebo's rule made
       that alignment and nothing here may unmake it. The blocks that are left
       are permuted inside the span they already occupy, which cannot collide
       with anything because the span and the spacing are unchanged, and the
       members' blocks are brought together at the middle of it. */
    if (focus) packFocus();

    function alignedOnDescent(n) {
      var es = inE.get(n.id).concat(outE.get(n.id));
      for (var i = 0; i < es.length; i++) {
        if (es[i].baseType !== 'HAS_SON') continue;
        var o2 = byId.get(es[i].source === n.id ? es[i].target : es[i].source);
        if (o2 && o2.x !== undefined && Math.abs(o2.x - n.x) < 0.5) return true;
      }
      return false;
    }

    function packFocus() {
      byGen.forEach(function (row) {
        if (!row || row.length < 3) return;
        var bl = new Map();
        row.forEach(function (n) {
          var k = n._blk === undefined ? ('_' + n.id) : n._blk;
          if (!bl.has(k)) bl.set(k, []);
          bl.get(k).push(n);
        });
        var blocks = [];
        bl.forEach(function (ns) {
          ns.sort(function (a, b) { return a.x - b.x; });
          blocks.push({
            ns: ns, x0: ns[0].x, x1: ns[ns.length - 1].x,
            hasFocus: ns.some(function (n) { return focus.has(n.id); }),
            pinned: ns.some(alignedOnDescent)
          });
        });
        blocks.sort(function (a, b) { return a.x0 - b.x0; });
        var nf = blocks.filter(function (b) { return b.hasFocus; }).length;
        if (!nf || nf === blocks.length) return;
        var i = 0;
        while (i < blocks.length) {
          if (blocks[i].pinned) { i++; continue; }
          var j = i;
          while (j < blocks.length && !blocks[j].pinned) j++;
          permute(blocks.slice(i, j));
          i = j;
        }
      });
    }

    function permute(run) {
      if (run.length < 2) return;
      var fs = run.filter(function (b) { return b.hasFocus; });
      if (!fs.length || fs.length === run.length) return;
      var rest = run.filter(function (b) { return !b.hasFocus; });
      var half = Math.floor(rest.length / 2);
      var order = rest.slice(0, half).concat(fs, rest.slice(half));
      var span = run[run.length - 1].x1 - run[0].x0;
      var solid = 0;
      run.forEach(function (b) { solid += b.x1 - b.x0; });
      var gapEach = run.length > 1 ? Math.max(gap, (span - solid) / (run.length - 1)) : 0;
      var at = run[0].x0;
      order.forEach(function (b) {
        var d = at - b.x0;
        if (d) b.ns.forEach(function (n) { n.x += d; });
        at += (b.x1 - b.x0) + gapEach;
      });
    }

    // ── pin, then centre horizontally without overdrawing the axis badges
    var minX = Infinity, maxX = -Infinity;
    nodes.forEach(function (n) {
      n.fx = n.x;
      n.idealX = n.x;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
    });
    var minAllowed = AXIS_W + SAFE_GUTTER;
    var shiftX = width / 2 - (minX + maxX) / 2;
    if (minX + shiftX < minAllowed) shiftX = minAllowed - minX;
    nodes.forEach(function (n) { n.x += shiftX; n.fx = n.x; n.idealX = n.x; });

    return { gens: gens, minGen: minGen, maxGen: maxGen, topPad: topPad, rowHeight: rowHeight, anchorId: anchorId };
  }

  /* The barycentre layout kept from round 1, still used by the P-graph where a
     couple has no single "father" to cluster under. */
  function layered(nodes, edges, o) {
    o = o || {};
    var laneH = o.laneH || ROW_H, colW = o.colW || SIB;
    var laneOf = o.laneOf || function (n) { return n.generation; };
    var lane = new Map(), unknown = [];
    nodes.forEach(function (n) {
      var g = laneOf(n);
      if (g === null || g === undefined) unknown.push(n.id); else lane.set(n.id, g);
    });
    if (unknown.length) {
      var indeg = new Map(), adj = new Map();
      nodes.forEach(function (n) { indeg.set(n.id, 0); adj.set(n.id, []); });
      edges.forEach(function (e) {
        if (!indeg.has(e.source) || !indeg.has(e.target)) return;
        adj.get(e.source).push(e.target);
        indeg.set(e.target, indeg.get(e.target) + 1);
      });
      var q = [], depth = new Map();
      nodes.forEach(function (n) {
        if (indeg.get(n.id) === 0) { q.push(n.id); depth.set(n.id, lane.has(n.id) ? lane.get(n.id) : 0); }
      });
      var guard = 0;
      while (q.length && guard++ < 400000) {
        var u = q.shift(), du = depth.get(u);
        adj.get(u).forEach(function (v) {
          var want = lane.has(v) ? lane.get(v) : du + 1;
          if (!depth.has(v) || depth.get(v) < want) depth.set(v, Math.max(want, du + 1));
          indeg.set(v, indeg.get(v) - 1);
          if (indeg.get(v) === 0) q.push(v);
        });
      }
      unknown.forEach(function (id) { lane.set(id, depth.has(id) ? depth.get(id) : 0); });
    }
    var used = Array.from(new Set(Array.from(lane.values()))).sort(function (a, b) { return a - b; });
    var rank = new Map();
    used.forEach(function (g, i) { rank.set(g, i); });
    nodes.forEach(function (n) { n._gen = lane.get(n.id); n._row = rank.get(lane.get(n.id)); });
    var rows = [];
    for (var i = 0; i < used.length; i++) rows.push([]);
    nodes.forEach(function (n) { rows[n._row].push(n); });
    rows.forEach(function (r) {
      r.sort(function (a, b) { return (a.name || a.id || '') < (b.name || b.id || '') ? -1 : 1; });
      r.forEach(function (n, k) { n._pos = k; });
    });
    var up = new Map(), down = new Map(), byId = new Map();
    nodes.forEach(function (n) { up.set(n.id, []); down.set(n.id, []); byId.set(n.id, n); });
    edges.forEach(function (e) {
      var s = byId.get(e.source), t = byId.get(e.target);
      if (s && t) { down.get(s.id).push(t); up.get(t.id).push(s); }
    });
    function sweep(dir) {
      (dir > 0 ? rows : rows.slice().reverse()).forEach(function (r) {
        r.forEach(function (n) {
          var nb = dir > 0 ? up.get(n.id) : down.get(n.id);
          if (!nb.length) { n._bary = n._pos; return; }
          var sum = 0;
          nb.forEach(function (m) { sum += m._pos; });
          n._bary = sum / nb.length;
        });
        r.sort(function (a, b) { return a._bary - b._bary; });
        r.forEach(function (n, k) { n._pos = k; });
      });
    }
    for (var s2 = 0; s2 < 4; s2++) { sweep(1); sweep(-1); }
    var widest = 0;
    rows.forEach(function (r) { widest = Math.max(widest, r.length); });
    rows.forEach(function (r) {
      var off = (widest - r.length) / 2;
      r.forEach(function (n, k) { n.x = (off + k) * colW; n.y = n._row * laneH; });
    });
    return { rows: rows, lanes: used, widest: widest };
  }

  /* Where even the chosen set will not hold at the floor, stand the reader in
     the window of the sheet that the floor can hold and that has the most of
     that set inside it — the thick of the drawing rather than a corner of it.
     The two axes are chosen together, because the densest column and the
     densest row need not cross where anybody is standing. */
  function densestWindow(list, worldW, worldH) {
    var pts = list.filter(function (n) { return isFinite(n.x) && isFinite(n.y); })
      .map(function (n) { return { x: n.x, y: n.y }; });
    if (!pts.length) return { x0: 0, x1: worldW, y0: 0, y1: worldH };
    if (pts.length > 900) pts = pts.filter(function (p, i) { return i % Math.ceil(pts.length / 900) === 0; });
    var xs = pts.slice().sort(function (a, b) { return a.x - b.x; });
    var best = null, i, q, s2, j;
    for (i = 0; i < xs.length; i++) {
      var band = [];
      for (q = i; q < xs.length && xs[q].x - xs[i].x <= worldW; q++) band.push(xs[q]);
      band.sort(function (a, b) { return a.y - b.y; });
      j = 0;
      for (s2 = 0; s2 < band.length; s2++) {
        if (j < s2) j = s2;
        while (j < band.length && band[j].y - band[s2].y <= worldH) j++;
        if (!best || j - s2 > best.n) best = { n: j - s2, sel: band.slice(s2, j) };
      }
    }
    var sel = best ? best.sel : pts;
    var sx = sel.map(function (p) { return p.x; }), sy = sel.map(function (p) { return p.y; });
    var cx = (Math.min.apply(null, sx) + Math.max.apply(null, sx)) / 2;
    var cy = (Math.min.apply(null, sy) + Math.max.apply(null, sy)) / 2;
    return { x0: cx - worldW / 2, x1: cx + worldW / 2, y0: cy - worldH / 2, y1: cy + worldH / 2 };
  }

  /* Rows from the drawn edges themselves, not from a corpus-wide index.
   *
   * A corpus-wide generation index is an inference over a print that is not
   * always consistent with itself: on the 1476 tables about three thousand men
   * carry an index that disagrees with the edge that names their father, so a
   * son could land three rows below him. When rows are 'local' the constraint
   * is applied to the subgraph being drawn — a son one row below his father, a
   * son-in-law one row below his wife's father — by BFS relaxation from the
   * anchor, descent edges first. A component that does not contain the anchor
   * hangs from its own head (a man with no father in the drawing, the lowest
   * index among them) and is offset from the anchor by the index difference of
   * the two heads, so that what the index is good for — placing families
   * against each other — is kept, and what it is bad for is not. */
  function localRows(nodes, edges, anchorId) {
    var byId = new Map();
    nodes.forEach(function (n) { byId.set(n.id, n); });
    var adj = new Map();
    nodes.forEach(function (n) { adj.set(n.id, []); });
    var hasFather = new Set();
    edges.forEach(function (e) {
      if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) return;
      var son = e.baseType === 'HAS_SON';
      var d = e.baseType === 'SAME_PERSON' ? 0 : 1;
      adj.get(e.source).push({ to: e.target, d: d, son: son });
      adj.get(e.target).push({ to: e.source, d: -d, son: son });
      if (son) hasFather.add(e.target);
    });
    adj.forEach(function (arcs) { arcs.sort(function (a, b) { return (b.son ? 1 : 0) - (a.son ? 1 : 0); }); });
    var row = new Map();
    function relax(start, val) {
      row.set(start, val);
      var q = [start], h = 0;
      while (h < q.length) {
        var u = q[h++], arcs = adj.get(u);
        for (var i = 0; i < arcs.length; i++) {
          var v = arcs[i].to;
          if (row.has(v)) continue;
          row.set(v, row.get(u) + arcs[i].d);
          q.push(v);
        }
      }
    }
    var anchor = anchorId && byId.has(anchorId) ? byId.get(anchorId) : null;
    if (anchor) relax(anchor.id, 0);
    var aG = anchor && anchor.generation != null ? anchor.generation : null;
    nodes.forEach(function (n) {
      if (row.has(n.id)) return;
      var comp = [], seen = new Set([n.id]), q = [n.id], h = 0;
      while (h < q.length) {
        var u = q[h++]; comp.push(u);
        adj.get(u).forEach(function (a) { if (!seen.has(a.to)) { seen.add(a.to); q.push(a.to); } });
      }
      var head = null;
      comp.forEach(function (id) {
        var m = byId.get(id);
        if (hasFather.has(id)) return;
        if (!head || (m.generation != null && (head.generation == null || m.generation < head.generation))) head = m;
      });
      if (!head) head = byId.get(comp[0]);
      var off = (aG != null && head.generation != null) ? head.generation - aG : 0;
      relax(head.id, off);
    });
    return row;
  }


  var Layout = { columns: columns, layered: layered, densestWindow: densestWindow, localRows: localRows };

  /* ═══════════════════════════════════════════════ 3. the schemes ══
     Five schemes. 'default' is samhan: read out of the stylesheet when it is
     applied, so the canvas is drawn in the ink of the sheet it sits on and
     follows the theme. 'classic' is Sebo's original slate-and-blue; warm, cool
     and monochrome are Sebo's fixed tables. Crimson is absent: in this house
     crimson means what remains to be done, and the canvas draws no such
     distinction. */
  var SCHEMES = ['default', 'classic', 'warm', 'cool', 'monochrome'];
  function normalizeScheme(s) {
    s = String(s == null ? '' : s).trim();
    if (s === 'samhan') return 'default';
    return SCHEMES.indexOf(s) >= 0 ? s : 'default';
  }
  var COLOR_KEYS = ['hasSonColor', 'hasSilColor', 'sameColor', 'nodeFill', 'nodeStroke',
                    'nodeStart', 'nodeWaypoint', 'nodeTarget', 'nodeRoot', 'nodeSelected', 'nodeGhost'];
  var PALETTE_CLASSIC = ['#5b8def', '#9b59b6', '#1abc9c', '#e67e22', '#e74c3c', '#3498db', '#f1c40f', '#e84393', '#00b894', '#6c5ce7', '#fd79a8', '#0984e3'];

  function legendGlyph(style, color, width) {
    var w = Math.max(1, Math.min(4, width || 2));
    var dash = dashArray(style);
    var line;
    if (style === 'double') {
      line = '<line x1="1" y1="6.4" x2="25.5" y2="6.4" stroke="' + color + '" stroke-width="' + Math.max(1, w - 0.5) + '"></line>' +
             '<line x1="1" y1="9.6" x2="25.5" y2="9.6" stroke="' + color + '" stroke-width="' + Math.max(1, w - 0.5) + '"></line>';
    } else {
      line = '<line x1="1" y1="8" x2="25.5" y2="8" stroke="' + color + '" stroke-width="' + w + '"' +
             (dash ? ' stroke-dasharray="' + dash + '"' : '') + '></line>';
    }
    return '<svg class="legend-edge-glyph" width="34" height="16" viewBox="0 0 34 16" aria-hidden="true">' +
      '<circle cx="1.5" cy="8" r="1.6" fill="' + color + '" opacity="0.85"></circle>' + line +
      '<path d="M 25.5,3.8 L 32.5,8 L 25.5,12.2 Z" fill="' + color + '"></path></svg>';
  }
  function nodeGlyph(fill, stroke, hollowStroke) {
    return '<svg class="legend-edge-glyph" width="34" height="16" viewBox="0 0 34 16" aria-hidden="true">' +
      '<circle cx="9" cy="8" r="5" fill="' + stroke + '" stroke="' + stroke + '" stroke-width="1.4"></circle>' +
      '<circle cx="25" cy="8" r="5" fill="' + fill + '" stroke="' + hollowStroke + '" stroke-width="1.4"></circle></svg>';
  }

  /* ═══════════════════════════════════════════════════ the factory ══ */
  function create(el, opts) {
    opts = opts || {};
    var d3 = opts.d3 || root.d3;
    if (!d3) throw new Error('samhan-graph: d3 v7 is required (opts.d3 or window.d3)');
    var KWON = opts.homeLineage === undefined ? '安東 權' : (opts.homeLineage || '');
    var FIT_MIN = opts.fitMin === undefined ? FIT_MIN_DEFAULT : opts.fitMin;
    var seq = (create._seq = (create._seq || 0) + 1);

    var styles = {
      colorScheme: 'default',
      hasSonColor: '', hasSilColor: '', sameColor: '', nodeFill: '', nodeStroke: '',
      nodeStart: '', nodeWaypoint: '', nodeTarget: '', nodeRoot: '', nodeSelected: '', nodeGhost: '',
      hasSonStyle: 'solid', hasSilStyle: 'dashed',
      nodeSize: 15, edgeWidth: 2, edgeOpacity: 0.78, labelSize: 15, contextFade: 0.25,
      patrilineMode: false, patrilines: [],
      showBirthOrder: true, showNames: true, labels: ['roman', 'hanja', 'dates'],
      showLanes: true, edgeGradient: true, handDrawn: false
    };
    var customNames = {};

    function isLight() {
      var t = opts.theme ? opts.theme() : document.documentElement.getAttribute('data-theme');
      return t === 'light';
    }
    function cssVar(name, fallback) {
      var v = '';
      try { v = getComputedStyle(document.documentElement).getPropertyValue(name); } catch (e) { v = ''; }
      v = (v || '').trim();
      return v || fallback;
    }
    function alpha(color, a) {
      try { var c = d3.color(color); if (!c) return color; c.opacity = a; return c.formatRgb(); } catch (e) { return color; }
    }

    /* The palette of the ACTIVE scheme, as a table of literal colours. Applied
       into styles by applyScheme(); the pickers then edit styles directly. */
    function schemeTable(s) {
      var L = isLight();
      if (s === 'classic') return {
        hasSonColor: L ? '#2563eb' : '#5b8def', hasSilColor: L ? '#d97706' : '#e8985e', sameColor: '#38bdf8',
        nodeFill: L ? '#ffffff' : '#2a3050', nodeStroke: L ? '#2563eb' : '#5b8def',
        nodeStart: '#2ecc71', nodeWaypoint: '#38bdf8', nodeTarget: '#e74c3c', nodeRoot: '#f1c40f', nodeSelected: '#00d2d3', nodeGhost: '#94a3b8'
      };
      if (s === 'warm') return {
        hasSonColor: L ? '#c2410c' : '#ea580c', hasSilColor: L ? '#b45309' : '#d97706', sameColor: '#38bdf8',
        nodeFill: L ? '#fffbeb' : '#451a03', nodeStroke: L ? '#ea580c' : '#f97316',
        nodeStart: '#16a34a', nodeWaypoint: '#0284c7', nodeTarget: '#dc2626', nodeRoot: '#d97706', nodeSelected: '#ea580c', nodeGhost: '#78716c'
      };
      if (s === 'cool') return {
        hasSonColor: L ? '#0284c7' : '#38bdf8', hasSilColor: L ? '#7c3aed' : '#a855f7', sameColor: '#38bdf8',
        nodeFill: L ? '#f0f9ff' : '#082f49', nodeStroke: L ? '#0284c7' : '#38bdf8',
        nodeStart: '#059669', nodeWaypoint: '#38bdf8', nodeTarget: '#e11d48', nodeRoot: '#2563eb', nodeSelected: '#0284c7', nodeGhost: '#64748b'
      };
      if (s === 'monochrome') return {
        hasSonColor: L ? '#000000' : '#ffffff', hasSilColor: L ? '#555555' : '#94a3b8', sameColor: L ? '#333333' : '#a0aec0',
        nodeFill: L ? '#ffffff' : '#0f172a', nodeStroke: L ? '#000000' : '#ffffff',
        nodeStart: L ? '#000000' : '#ffffff', nodeWaypoint: L ? '#555555' : '#cccccc', nodeTarget: L ? '#000000' : '#ffffff',
        nodeRoot: L ? '#555555' : '#94a3b8', nodeSelected: L ? '#000000' : '#ffffff', nodeGhost: L ? '#888888' : '#666666'
      };
      // samhan — read out of the sheet
      var soft = cssVar('--soft', cssVar('--color-text-secondary', L ? '#625c4e' : '#B7B29E'));
      var acc2 = cssVar('--acc2', cssVar('--color-accent-primary', L ? '#2e4c6d' : '#8fb4d6'));
      return {
        hasSonColor: cssVar('--g-son-ak', soft), hasSilColor: cssVar('--g-sil', cssVar('--color-has-sil', L ? '#8a5a2b' : '#c9a272')), sameColor: acc2,
        nodeFill: cssVar('--pn', cssVar('--color-surface', L ? '#fffdf8' : '#2C2C26')),
        nodeStroke: cssVar('--ink', cssVar('--color-text-primary', L ? '#17150f' : '#EDEAE0')),
        nodeStart: cssVar('--ident-certain-ink', L ? '#40624a' : '#8fbf9b'),
        nodeWaypoint: cssVar('--ident-likely-ink', acc2),
        nodeTarget: cssVar('--ident-contra-ink', L ? '#8f4034' : '#d98b7a'),
        nodeRoot: cssVar('--ident-doubtful-ink', cssVar('--color-has-sil', L ? '#8a5a2b' : '#c9a272')),
        nodeSelected: acc2,
        nodeGhost: cssVar('--faint', soft)
      };
    }
    function applyScheme(s) {
      styles.colorScheme = normalizeScheme(s);
      var t = schemeTable(styles.colorScheme);
      COLOR_KEYS.forEach(function (k) { styles[k] = t[k]; });
      // patrilines the reader has not named follow the scheme
      var pal = patrilinePalette();
      (styles.patrilines || []).forEach(function (p, i) { if (!customNames[i]) p.color = pal[i % pal.length]; });
      if (C.el) C.el.setAttribute('data-graph-scheme', styles.colorScheme);
    }
    /* The chrome's colours — the sheet, the rules, the type — plus the styles'
       inks, resolved for this render. */
    function palette() {
      var L = isLight(), mono = styles.colorScheme === 'monochrome';
      var P = {
        ink: cssVar('--color-text-primary', L ? '#17150F' : '#EDEAE0'),
        soft: cssVar('--color-text-secondary', '#B7B29E'),
        faint: cssVar('--color-text-faint', '#999585'),
        rule: cssVar('--color-border', '#3E3D34'),
        hair: cssVar('--hair', '#54523F'),
        pn: cssVar('--color-surface', '#2C2C26'),
        bg: cssVar('--graph-bg', cssVar('--color-bg', '#23231E')),
        hl: cssVar('--acc', '#DE8365')
      };
      if (mono) {
        P.bg = L ? '#FFFFFF' : '#000000'; P.ink = L ? '#000000' : '#FFFFFF'; P.faint = L ? '#666666' : '#999999';
        P.soft = L ? '#333333' : '#CCCCCC'; P.rule = L ? '#CCCCCC' : '#444444'; P.hl = L ? '#000000' : '#FFFFFF'; P.pn = L ? '#FFFFFF' : '#000000';
      }
      COLOR_KEYS.forEach(function (k) { P[k] = styles[k]; });
      P.mono = mono;
      return P;
    }
    function patrilinePalette() {
      if (styles.colorScheme !== 'default') return PALETTE_CLASSIC;
      var t = schemeTable('default');
      return [t.nodeSelected, t.nodeTarget, t.nodeStart, t.nodeRoot, t.hasSilColor, t.hasSonColor, t.nodeGhost];
    }

    /* ═══════════════════════════════════════ patrilines (clans) ══ */
    function clanOf(n) {
      if (!n) return '';
      var c = n.choronym;
      if (Array.isArray(c)) c = c[0];
      if (c) return String(c).trim();
      var nm = (n.name || '').trim();
      if (!nm) return '';
      if (/^(皇甫|南宮|鮮于|諸葛)/.test(nm)) return nm.slice(0, 2) + '氏';
      return nm.length >= 2 ? nm.charAt(0) + '氏' : '';
    }
    var clanCache = new Map();
    function clanFor(id) { return clanCache.get(id) || ''; }
    function detectPatrilines(nodes, rootId) {
      var counts = new Map();
      nodes.forEach(function (n) { var c = clanOf(n); if (c) counts.set(c, (counts.get(c) || 0) + 1); });
      var sorted = Array.from(counts.keys()).sort(function (a, b) { return counts.get(b) - counts.get(a); });
      var rootNode = rootId && nodes.filter(function (n) { return n.id === rootId; })[0];
      var rootClan = rootNode ? clanOf(rootNode) : (KWON || '');
      if (rootClan) {
        var i = sorted.indexOf(rootClan);
        if (i > 0) { sorted.splice(i, 1); sorted.unshift(rootClan); }
        else if (i < 0 && rootNode) sorted.unshift(rootClan);
      }
      var pal = patrilinePalette();
      if (!Object.keys(customNames).length) {
        var num = sorted.length ? Math.min(sorted.length, 6) : 3;
        styles.patrilines = [];
        for (var k = 0; k < num; k++) {
          var clan = sorted[k] || '';
          styles.patrilines.push({ id: 'pat_' + k, name: clan ? 'Patriline ' + (k + 1) + ' (' + clan + ')' : 'Patriline ' + (k + 1),
                                   clan: clan, color: pal[k % pal.length], style: LINE_STYLES[k % LINE_STYLES.length], width: 2.0 });
        }
      } else {
        styles.patrilines.forEach(function (p, i) {
          if (sorted[i]) { p.clan = sorted[i]; if (!customNames[i]) p.name = 'Patriline ' + (i + 1) + ' (' + sorted[i] + ')'; }
        });
      }
      emit('patrilines', styles.patrilines);
    }
    function addPatriline(clan) {
      var idx = styles.patrilines.length, pal = patrilinePalette();
      styles.patrilines.push({ id: 'pat_' + Date.now() + '_' + idx, name: clan ? 'Patriline ' + (idx + 1) + ' (' + clan + ')' : 'Patriline ' + (idx + 1),
                               clan: clan || '', color: pal[idx % pal.length], style: LINE_STYLES[idx % LINE_STYLES.length], width: 2.0 });
      emit('patrilines', styles.patrilines); render();
    }
    function removePatriline(i) {
      if (i < 0 || i >= styles.patrilines.length) return;
      styles.patrilines.splice(i, 1); delete customNames[i];
      emit('patrilines', styles.patrilines); render();
    }
    function setPatriline(i, patch) {
      var p = styles.patrilines[i];
      if (!p) return;
      if (patch.name !== undefined) { p.name = patch.name; customNames[i] = true; }
      if (patch.color !== undefined) p.color = patch.color;
      if (patch.style !== undefined) p.style = patch.style;
      if (patch.width !== undefined) p.width = parseFloat(patch.width) || 2.0;
      if (patch.clan !== undefined) p.clan = patch.clan;
      emit('patrilines', styles.patrilines); render();
    }
    function resetPatrilines() {
      customNames = {};
      if (C.nodes.length) detectPatrilines(C.nodes, anchorId());
      else {
        var pal = patrilinePalette();
        styles.patrilines = ['solid', 'dashed', 'dashdot'].map(function (st, i) {
          return { id: 'pat_' + (i + 1), name: 'Patriline ' + (i + 1), clan: '', color: pal[i % pal.length], style: st, width: 2.0 };
        });
        emit('patrilines', styles.patrilines);
      }
      render();
    }
    /* Sebo's fuzzy match: a patriline claims a HAS_SON edge when either end's
       clan contains, or is contained by, its clan key or its name, or shares
       the surname graph. */
    function edgePatrilineIndex(e) {
      if (!styles.patrilineMode || e.baseType !== 'HAS_SON') return -1;
      var a = clanFor(e.source).toLowerCase(), b = clanFor(e.target).toLowerCase();
      for (var i = 0; i < styles.patrilines.length; i++) {
        var p = styles.patrilines[i];
        var key = (p.clan || '').trim().toLowerCase(), nm = (p.name || '').trim().toLowerCase();
        if (matches(a) || matches(b)) return i;
      }
      return -1;
      function matches(c) {
        if (!c) return false;
        if (key && (c.indexOf(key) >= 0 || key.indexOf(c) >= 0)) return true;
        if (nm && (nm.indexOf(c) >= 0 || c.indexOf(nm) >= 0)) return true;
        var sur = c.indexOf(' ') >= 0 ? c.split(' ')[1] : c;
        return !!(sur && nm.indexOf(sur) >= 0);
      }
    }

    /* ═══════════════════════════════════════════════ the canvas state ══ */
    var C = {
      el: null, svg: null, defs: null, root: null, zoom: null,
      gLabels: null, gGuides: null, gEdges: null, gEdgeLabels: null, gNodes: null, gNodeLabels: null,
      nodes: [], edges: [], drawable: [], byId: new Map(),
      roles: { root: null, starts: new Set(), waypoints: new Set(), targets: new Set() },
      hl: { nodes: new Set(), edges: new Set() },
      focus: new Set(),
      selected: null, multi: new Set(),
      layout: 'layered-generation', anchorId: null,
      rows: opts.rows === 'local' ? 'local' : 'index',
      axisX: null, userNavigated: false, fitTimer: null, frame: null,
      floorToastAt: 0, floorTimer: null, floorPending: false,
      tooltip: null, ownTooltip: false, pill: null, actions: opts.actions || [],
      handlers: {}
    };
    function emit(evt) {
      var fns = C.handlers[evt] || [];
      var args = Array.prototype.slice.call(arguments, 1);
      fns.forEach(function (f) { try { f.apply(null, args); } catch (e) { console.error('samhan-graph ' + evt + ' handler', e); } });
    }
    function on(evt, fn) {
      (C.handlers[evt] = C.handlers[evt] || []).push(fn);
      return api;
    }
    function off(evt, fn) {
      if (!C.handlers[evt]) return api;
      C.handlers[evt] = fn ? C.handlers[evt].filter(function (f) { return f !== fn; }) : [];
      return api;
    }
    function anchorId() { return C.anchorId || C.roles.root || C.roles.starts.values().next().value || null; }
    function roleOf(n) {
      var id = n.id;
      if (C.roles.starts.has(id)) return 'start';
      if (C.roles.waypoints.has(id)) return 'waypoint';
      if (C.roles.targets.has(id)) return 'target';
      if (C.roles.root === id) return 'root';
      return '';
    }
    function isSelected(id) { return C.selected === id || C.multi.has(id); }

    function init(el) {
      C.el = typeof el === 'string' ? document.querySelector(el) : el;
      if (!C.el) throw new Error('samhan-graph: container not found');
      C.pfx = opts.idPrefix || ('sg' + seq);
      C.el.classList.add('samhan-graph');
      if (opts.tooltip === null) C.tooltip = null;
      else if (opts.tooltip) C.tooltip = opts.tooltip;
      else { C.tooltip = document.createElement('div'); C.tooltip.className = 'tooltip hidden'; C.ownTooltip = true; C.el.appendChild(C.tooltip); }
      C.svg = d3.select(C.el).append('svg').attr('class', 'samhan-graph-svg')
        .attr('xmlns', 'http://www.w3.org/2000/svg').attr('width', '100%').attr('height', '100%');
      C.defs = C.svg.append('defs');
      C.root = C.svg.append('g').attr('class', 'zoom-root');
      // Sebo's stacking order, back to front; the names in a layer of their
      // own above the figures so the hand-drawn filter never touches type
      C.gLabels = C.root.append('g').attr('class', 'generation-labels');
      C.gGuides = C.root.append('g').attr('class', 'alignment-guides');
      C.gEdges = C.root.append('g').attr('class', 'edges');
      C.gEdgeLabels = C.root.append('g').attr('class', 'edge-labels');
      C.gNodes = C.root.append('g').attr('class', 'nodes');
      C.gNodeLabels = C.root.append('g').attr('class', 'node-labels');
      C.zoom = d3.zoom().scaleExtent([0.04, 4]).on('zoom', function (ev) {
        C.root.attr('transform', ev.transform);
        if (ev.sourceEvent) C.userNavigated = true;
        positionPill();
      });
      C.svg.call(C.zoom).on('dblclick.zoom', null);
      C.svg.on('click', function (ev) {
        if (ev.target === C.svg.node()) { select(null); highlight({ nodes: [], edges: [] }); }
      });
      C.onTheme = function () {
        if (styles.colorScheme === 'default') applyScheme('default');
        else applyScheme(styles.colorScheme);   // the fixed tables also differ by theme
        render();
        emit('scheme', styles.colorScheme);
      };
      document.documentElement.addEventListener('samhan-theme', C.onTheme);
      installHandDrawn();
      applyScheme(opts.scheme || styles.colorScheme);
      return C;
    }

    /* ── the hand-drawn line: one filter for the whole layer, never on type. */
    function installHandDrawn() {
      C.hdId = C.pfx + '-hand';
      var f = C.defs.append('filter').attr('id', C.hdId)
        .attr('x', '-5%').attr('y', '-8%').attr('width', '110%').attr('height', '116%')
        .attr('filterUnits', 'objectBoundingBox').attr('primitiveUnits', 'userSpaceOnUse')
        .attr('color-interpolation-filters', 'sRGB');
      f.append('feTurbulence').attr('type', 'fractalNoise').attr('baseFrequency', '0.03').attr('numOctaves', 2).attr('seed', 7).attr('result', 'grain');
      f.append('feDisplacementMap').attr('in', 'SourceGraphic').attr('in2', 'grain').attr('scale', 1.8).attr('xChannelSelector', 'R').attr('yChannelSelector', 'G');
    }
    function handRef() {
      if (!styles.handDrawn) return null;
      if (document.documentElement.classList.contains('no-handrule')) return null;
      return 'url(#' + C.hdId + ')';
    }
    function handDraw(sel) {
      if (!sel || sel.empty()) return;
      var ref = handRef(), ok = !!ref;
      if (ok) { try { var bb = sel.node().getBBox(); ok = bb.width > 0.5 && bb.height > 0.5; } catch (e) { ok = false; } }
      sel.attr('filter', ok ? ref : null);
    }

    /* ── markers: Sebo's geometry exactly. */
    function markers(P) {
      C.defs.selectAll('marker').remove();
      var set = [['son', P.hasSonColor], ['sil', P.hasSilColor], ['same', P.sameColor]];
      styles.patrilines.forEach(function (p, i) { set.push(['pat-' + i, P.mono ? P.hasSonColor : p.color]); });
      set.forEach(function (d) {
        C.defs.append('marker').attr('id', C.pfx + '-arrow-' + d[0])
          .attr('viewBox', '0 -5 10 10').attr('refX', 8.5).attr('refY', 0)
          .attr('markerUnits', 'userSpaceOnUse').attr('markerWidth', 9).attr('markerHeight', 9).attr('orient', 'auto')
          .append('path').attr('d', 'M 0,-4.5 L 9,0 L 0,4.5 Z').attr('fill', d[1]).attr('opacity', 0.95);
      });
    }
    function edgeColor(e, P) {
      if (e.baseType === 'SAME_PERSON') return P.sameColor;
      var pi = edgePatrilineIndex(e);
      if (pi >= 0) return P.mono ? P.hasSonColor : styles.patrilines[pi].color;
      return e.baseType === 'HAS_SIL' ? P.hasSilColor : P.hasSonColor;
    }
    function edgeStyleName(e) {
      if (e.baseType === 'SAME_PERSON') return 'dashed';
      var pi = edgePatrilineIndex(e);
      if (pi >= 0) return styles.patrilines[pi].style;
      return e.baseType === 'HAS_SIL' ? styles.hasSilStyle : styles.hasSonStyle;
    }
    function edgeWidth(e) {
      var pi = edgePatrilineIndex(e);
      var w = pi >= 0 ? (styles.patrilines[pi].width || styles.edgeWidth) : styles.edgeWidth;
      if (e.baseType === 'HAS_SIL' && pi < 0) w *= 0.72;
      if (edgeStyleName(e) === 'double') w *= 2.2;
      return w;
    }
    function markerFor(e) {
      if (e.baseType === 'SAME_PERSON') return null;
      var pi = edgePatrilineIndex(e);
      if (pi >= 0) return 'url(#' + C.pfx + '-arrow-pat-' + pi + ')';
      return 'url(#' + C.pfx + '-arrow-' + (e.baseType === 'HAS_SIL' ? 'sil' : 'son') + ')';
    }
    function gradId(e) { return C.pfx + '-grad-' + hashKey(e.id); }
    function updateGradients(edges, P) {
      C.defs.selectAll('linearGradient').remove();
      if (!styles.edgeGradient) return;
      edges.forEach(function (e) {
        var s = C.byId.get(e.source), t = C.byId.get(e.target), color = edgeColor(e, P);
        var g = C.defs.append('linearGradient').attr('id', gradId(e)).attr('gradientUnits', 'userSpaceOnUse')
          .attr('x1', s ? s.x : 0).attr('y1', s ? s.y : 0).attr('x2', t ? t.x : 0).attr('y2', t ? t.y : 0);
        g.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.15);
        g.append('stop').attr('offset', '40%').attr('stop-color', color).attr('stop-opacity', Math.min(1, styles.edgeOpacity * 0.75));
        g.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 1);
      });
    }
    function moveGradients() {
      if (!styles.edgeGradient) return;
      C.gEdges.selectAll('path.edge').each(function (e) {
        var s = C.byId.get(e.source), t = C.byId.get(e.target);
        C.defs.select('#' + gradId(e)).attr('x1', s ? s.x : 0).attr('y1', s ? s.y : 0).attr('x2', t ? t.x : 0).attr('y2', t ? t.y : 0);
      });
    }
    function indexParallel(edges) {
      var pairs = new Map();
      edges.forEach(function (e) {
        var k = [e.source, e.target].sort().join('--');
        if (!pairs.has(k)) pairs.set(k, []);
        pairs.get(k).push(e);
      });
      pairs.forEach(function (list) {
        list.sort(function (a, b) { return rankOf(a, C.byId.get(a.target)) - rankOf(b, C.byId.get(b.target)); });
        list.forEach(function (e, i) { e._pi = i; e._pt = list.length; });
      });
    }
    function nodeR(n) {
      if (isGhost(n)) return Math.max(5, styles.nodeSize / 2 - 3);
      return (roleOf(n) || C.hl.nodes.has(n.id)) ? styles.nodeSize / 2 + 3 : styles.nodeSize / 2;
    }

    /* ── the four routing cases, from Sebo. */
    function edgePath(e) {
      var s = C.byId.get(e.source), t = C.byId.get(e.target);
      if (!s || !t || !isFinite(s.x) || !isFinite(t.x)) return '';
      var sr = nodeR(s), tr = nodeR(t);
      var po = ((e._pt - 1) / 2 - e._pi) * PARALLEL_SPREAD;
      var dx = t.x - s.x, dy = t.y - s.y, sx = s.x, sy = s.y, tx = t.x, ty = t.y;
      if (Math.abs(dx) < 2 && po === 0 && e._pt <= 1) return 'M' + sx + ',' + (sy + sr) + 'L' + tx + ',' + (ty - tr);
      if (Math.abs(dy) < 30) {
        var arch = Math.min(55, Math.max(32, Math.abs(dx) * 0.22)) + Math.abs(po);
        var x1 = sx + (tx >= sx ? sr : -sr), x2 = tx + (tx >= sx ? -tr : tr);
        return 'M' + x1 + ',' + sy + 'C' + sx + ',' + (sy - arch) + ' ' + tx + ',' + (sy - arch) + ' ' + x2 + ',' + ty;
      }
      var down = dy > 0, y1 = sy + (down ? sr : -sr), y2 = ty + (down ? -tr : tr);
      if (Math.abs(dy) > ROW_H * 1.35) {
        var lat = e._pt > 1 ? po * 1.25 : (tx >= sx ? 1 : -1) * 55;
        return 'M' + sx + ',' + y1 + 'C' + (sx + lat) + ',' + (sy + (down ? 60 : -60)) + ' ' + (tx + lat) + ',' + (ty + (down ? -60 : 60)) + ' ' + tx + ',' + y2;
      }
      var c1 = sx + po * 1.25, c2 = tx + po * 1.25;
      return 'M' + sx + ',' + y1 + 'C' + c1 + ',' + (sy + (down ? 60 : -60)) + ' ' + c2 + ',' + (ty + (down ? -60 : 60)) + ' ' + tx + ',' + y2;
    }
    function edgeLabelTransform(e) {
      var s = C.byId.get(e.source), t = C.byId.get(e.target);
      if (!s || !t) return 'translate(-9999,-9999)';
      var dx = t.x - s.x, dy = t.y - s.y, po = ((e._pt - 1) / 2 - e._pi) * PARALLEL_SPREAD;
      if (Math.abs(dx) < 2 && e._pt <= 1) return 'translate(' + s.x + ',' + ((s.y + t.y) / 2) + ')';
      if (Math.abs(dy) < 30) {
        var arch = Math.min(55, Math.max(32, Math.abs(dx) * 0.22)) + Math.abs(po);
        return 'translate(' + ((s.x + t.x) / 2) + ',' + (s.y - arch - 4) + ')';
      }
      if (Math.abs(dy) > ROW_H * 1.35) {
        var lat = e._pt > 1 ? po * 1.05 : (t.x >= s.x ? 1 : -1) * 55 * 0.85;
        return 'translate(' + ((s.x + t.x) / 2 + lat) + ',' + ((s.y + t.y) / 2 - 8) + ')';
      }
      return 'translate(' + ((s.x + t.x) / 2 + po * 1.1) + ',' + ((s.y + t.y) / 2 - 8) + ')';
    }
    function labelTextFor(e) {
      var info = kinshipOrder(e, C.byId.get(e.target));
      if (info.label) return info.label;
      if (e._pt > 1) return '#' + (e._pi + 1);
      return '';
    }
    function labelShown(e) {
      var t = C.byId.get(e.target);
      if (e.baseType === 'SAME_PERSON') return true;
      if (isGhost(t)) return false;
      if (!styles.showBirthOrder && e._pt <= 1) return false;
      return !!labelTextFor(e);
    }

    /* ── the generation axis: a rule per row, a draggable badge column. */
    function badgeText(g) {
      if (opts.badgeText) return opts.badgeText(g, C.absOf ? C.absOf(g) : null);
      var abs = C.absOf ? C.absOf(g) : null;
      if (g === 0) return '● ROOT' + (abs !== null ? ' · G' + abs : '');
      return (g < 0 ? '↑ ' + (-g) : '↓ ' + g) + (abs !== null ? ' · G' + abs : '');
    }
    function updateAxis(P) {
      C.gLabels.selectAll('*').remove();
      C.gGuides.selectAll('*').remove();
      if (!C.frame || !styles.showLanes) return;
      var F = C.frame, L = isLight();
      var xs = C.nodes.map(function (n) { return n.x; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var axisLeft = C.axisX !== null ? C.axisX : Math.min(12, minX - BADGE_MARGIN);
      var lineStart = Math.min(axisLeft + BADGE_W + 6, minX - 1000);
      var lineEnd = Math.max(10000, maxX + 3000);
      var rules = C.gLabels.append('g').attr('class', 'gen-axis-rules');
      F.gens.forEach(function (g) {
        var y = F.topPad + (g - F.minGen) * F.rowHeight, isRoot = g === 0;
        rules.append('line').attr('class', 'gen-axis-line').attr('x1', lineStart).attr('x2', lineEnd).attr('y1', y).attr('y2', y)
          .attr('stroke', isRoot ? P.nodeStroke : P.rule).attr('stroke-opacity', isRoot ? (L ? 0.55 : 0.6) : (L ? 0.62 : 0.5))
          .attr('stroke-width', isRoot ? 1.5 : 1);
      });
      handDraw(rules);
      var badges = C.gLabels.append('g').attr('class', 'gen-axis-badges-container').style('cursor', 'grab');
      F.gens.forEach(function (g) {
        var y = F.topPad + (g - F.minGen) * F.rowHeight, isRoot = g === 0;
        var b = badges.append('g').attr('class', 'gen-axis-badge').attr('transform', 'translate(' + axisLeft + ',' + (y - 11) + ')');
        b.append('title').text('Drag horizontally to reposition the axis (snaps to the column grid)');
        b.append('rect').attr('width', BADGE_W).attr('height', 22).attr('rx', 2)
          .attr('fill', P.pn).attr('stroke', isRoot ? P.nodeStroke : alpha(P.faint, 0.55)).attr('stroke-width', 1).attr('filter', handRef());
        b.append('text').attr('x', 8).attr('y', 15).attr('font-family', 'IBM Plex Mono, monospace').attr('font-size', 10)
          .attr('letter-spacing', '0.11em').attr('fill', isRoot ? P.ink : P.faint).text(badgeText(g));
      });
      var start = 0, base = axisLeft;
      badges.call(d3.drag()
        .on('start', function (ev) { start = ev.x; base = axisLeft; })
        .on('drag', function (ev) {
          var raw = base + (ev.x - start), ref = C.nodes[0] ? C.nodes[0].x : 0;
          var grid = ref + Math.round((raw - ref) / SIB) * SIB;
          var x = Math.abs(grid - raw) < SNAP_T ? grid : raw;
          C.axisX = x;
          badges.selectAll('g.gen-axis-badge').attr('transform', function (d, i) {
            return 'translate(' + x + ',' + (F.topPad + (F.gens[i] - F.minGen) * F.rowHeight - 11) + ')';
          });
          rules.selectAll('line.gen-axis-line').attr('x1', Math.min(x + BADGE_W + 6, minX - 1000));
          C.gGuides.selectAll('*').remove();
          if (Math.abs(grid - raw) < SNAP_T) {
            C.gGuides.append('line').attr('x1', grid).attr('x2', grid).attr('y1', F.topPad - 30)
              .attr('y2', F.topPad + (F.maxGen - F.minGen) * F.rowHeight + 50)
              .attr('stroke', P.nodeSelected).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,4').attr('opacity', 0.85);
          }
        })
        .on('end', function () { C.gGuides.selectAll('*').remove(); updateAxis(P); }));
    }

    /* ═════════════════════════════════════════════════════ rendering ══ */
    function setData(sub, o) {
      o = o || {};
      C.nodes = (sub && sub.nodes ? sub.nodes : []).slice();
      C.edges = (sub && sub.edges ? sub.edges : []).slice();
      var r = o.roles || {};
      C.roles = {
        root: r.root || null,
        starts: new Set(r.starts || (sub && sub.starts) || []),
        waypoints: new Set(r.waypoints || []),
        targets: new Set(r.targets || [])
      };
      C.anchorId = o.anchorId || null;
      C.focus = new Set(o.focus || []);
      C.hl = { nodes: new Set(), edges: new Set() };
      C.selected = null; C.multi = new Set();
      C.nodes.forEach(function (n) { delete n.x; delete n.y; delete n.fx; delete n.fy; delete n.idealX; });
      detectPatrilines(C.nodes, anchorId());
      render();
      fit();
      emit('data', data());
    }
    function highlight(h) {
      C.hl = { nodes: new Set(h && h.nodes ? h.nodes : []), edges: new Set(h && h.edges ? h.edges : []) };
      paint();
    }
    function setRoles(r) {
      r = r || {};
      C.roles = { root: r.root || null, starts: new Set(r.starts || []), waypoints: new Set(r.waypoints || []), targets: new Set(r.targets || []) };
      paint();
    }
    function setFocus(ids, refit) {
      C.focus = new Set(ids || []);
      if (refit) { clearTimeout(C.fitTimer); C.userNavigated = false; fit(); }
    }

    /* Colour and weight, re-applied without a relayout: the pickers, a
       selection, a highlight all come through here. */
    function paint() {
      if (!C.svg) return;
      var P = palette();
      var any = C.hl.nodes.size > 0 || C.hl.edges.size > 0;
      var L = isLight();
      C.gNodes.selectAll('g.node circle.ring')
        .attr('r', nodeR)
        .attr('fill', function (n) {
          if (isGhost(n)) return P.mono ? P.pn : P.nodeFill;
          var role = roleOf(n);
          if (P.mono) {
            if (role === 'target') return L ? '#e2e8f0' : '#334155';
            if (role === 'waypoint' || role === 'root') return L ? '#f1f5f9' : '#1e293b';
            if (role === 'start') return L ? '#ffffff' : '#0f172a';
            return P.nodeFill;
          }
          if (role === 'start') return P.nodeStart;
          if (role === 'waypoint') return P.nodeWaypoint;
          if (role === 'target') return P.nodeTarget;
          if (role === 'root') return P.nodeRoot;
          if (isSelected(n.id)) return P.nodeSelected;
          if (KWON && n.choronym && (Array.isArray(n.choronym) ? n.choronym.indexOf(KWON) >= 0 : n.choronym === KWON)) return P.nodeStroke;
          return P.nodeFill;
        })
        .attr('stroke', function (n) {
          if (isGhost(n)) return P.nodeGhost;
          var role = roleOf(n);
          if (P.mono) return P.nodeStroke;
          if (role === 'start') return P.nodeStart;
          if (role === 'waypoint') return P.nodeWaypoint;
          if (role === 'target') return P.nodeTarget;
          if (role === 'root') return P.nodeRoot;
          if (isSelected(n.id)) return P.nodeSelected;
          if (isInferred(n)) return P.nodeGhost;
          return P.nodeStroke;
        })
        .attr('stroke-width', function (n) {
          if (isGhost(n)) return 1.2;
          var role = roleOf(n);
          if (role === 'start' || role === 'waypoint' || role === 'target' || isSelected(n.id)) return 3.5;
          if (role === 'root') return 2.5;
          return 1.5;
        })
        .attr('stroke-dasharray', function (n) { return (isGhost(n) || isInferred(n)) ? '2,2' : null; })
        .attr('opacity', function (n) {
          var base = isGhost(n) ? 0.6 : 1;
          return (!any || C.hl.nodes.has(n.id)) ? base : base * styles.contextFade;
        });
      C.gNodes.selectAll('g.node').attr('opacity', function (n) {
        var inFocus = !C.focus.size || C.focus.has(n.id);
        return inFocus ? 1 : styles.contextFade;
      });
      C.gNodeLabels.selectAll('g.node-label').attr('opacity', function (n) {
        var inFocus = !C.focus.size || C.focus.has(n.id);
        var lit = !any || C.hl.nodes.has(n.id);
        return (inFocus ? 1 : styles.contextFade) * (lit ? 1 : styles.contextFade);
      });
      C.gNodeLabels.selectAll('tspan').attr('fill', function (n) {
        var cls = this.getAttribute('class');
        if (cls === 'node-label-roman' || cls === 'node-label-hanja') return P.ink;
        return P.soft;
      });
      C.gNodeLabels.selectAll('tspan.node-label-roman').attr('font-weight', function (n) { return roleOf(n) ? 600 : 500; });
      markers(P);
      updateGradients(C.drawable, P);
      C.gEdges.selectAll('path.edge')
        .attr('stroke', function (e) { return (styles.edgeGradient && e.baseType !== 'SAME_PERSON') ? 'url(#' + gradId(e) + ')' : edgeColor(e, P); })
        .attr('stroke-width', function (e) { return C.hl.edges.has(e.id) ? edgeWidth(e) + 1.6 : edgeWidth(e); })
        .attr('stroke-dasharray', function (e) { var s = edgeStyleName(e); return s === 'double' ? null : dashArray(s); })
        .attr('marker-end', markerFor)
        .attr('opacity', function (e) { return (!any || C.hl.edges.has(e.id)) ? styles.edgeOpacity : styles.edgeOpacity * styles.contextFade; });
      C.gEdges.selectAll('path.edge-double')
        .style('display', function (e) { return edgeStyleName(e) === 'double' ? null : 'none'; })
        .attr('stroke', P.bg)
        .attr('stroke-width', function (e) { return Math.max(1, edgeWidth(e) / 2.2 * 0.7); });
      C.gEdgeLabels.selectAll('g.edge-label-group')
        .style('display', function (e) { return labelShown(e) ? null : 'none'; })
        .attr('opacity', function (e) { return (!any || C.hl.edges.has(e.id)) ? 1 : styles.contextFade; })
        .each(function (e) {
          var g = d3.select(this), text = labelTextFor(e), same = e.baseType === 'SAME_PERSON';
          var w = same ? 42 : (text.length > 1 ? Math.max(16, text.length * 8 + 8) : 16);
          var col = P.mono ? P.ink : (same ? P.sameColor : (e.baseType === 'HAS_SIL' ? P.hasSilColor : P.hasSonColor));
          g.select('rect').attr('x', -w / 2).attr('width', w).attr('rx', same ? 4 : 8).attr('ry', same ? 4 : 8).attr('fill', P.bg).attr('stroke', col);
          g.select('text').attr('fill', col).text(text);
        });
      updateLegend();
      positionPill();
    }

    function render() {
      if (!C.svg) return;
      var P = palette();
      C.el.setAttribute('data-graph-scheme', styles.colorScheme);
      C.gLabels.selectAll('*').remove(); C.gGuides.selectAll('*').remove();
      C.gEdges.selectAll('*').remove(); C.gEdgeLabels.selectAll('*').remove();
      C.gNodes.selectAll('*').remove(); C.gNodeLabels.selectAll('*').remove();
      if (opts.empty) opts.empty.style.display = C.nodes.length ? 'none' : 'flex';
      if (!C.nodes.length) { C.frame = null; C.drawable = []; updateLegend(); hidePill(); return; }

      clanCache = new Map();
      C.nodes.forEach(function (n) { clanCache.set(n.id, clanOf(n)); });
      C.byId = new Map();
      C.nodes.forEach(function (n) { C.byId.set(n.id, n); });
      var drawable = C.edges.filter(function (e) { return C.byId.has(e.source) && C.byId.has(e.target); });
      C.drawable = drawable;
      indexParallel(drawable);

      var w = C.el.clientWidth || 1200, h = C.el.clientHeight || 700;
      if (w < 20) w = 1200;
      if (h < 20) h = 700;
      var anchorFor = anchorId();
      var rowMap = C.rows === 'local' ? localRows(C.nodes, drawable, anchorFor) : null;
      C.frame = columns(C.nodes, drawable, {
        width: w, height: h, anchorId: anchorFor, focus: C.focus,
        genOf: rowMap ? function (n) { return rowMap.has(n.id) ? rowMap.get(n.id) : n.generation; } : undefined
      });
      C.nodes.forEach(function (n) { n._generation = n._gen; });
      var anchor = C.byId.get(C.frame.anchorId);
      var abs = anchor && anchor.generation != null ? anchor.generation : null;
      C.absOf = abs === null ? function () { return null; } : function (g) { return abs + g; };
      updateAxis(P);

      // ── edges
      var eg = C.gEdges.selectAll('g.edge-container').data(drawable, function (e) { return e.id; })
        .enter().append('g').attr('class', 'edge-container');
      eg.append('path').attr('class', 'edge').attr('fill', 'none').attr('stroke-linecap', 'round')
        .attr('d', edgePath).style('cursor', 'pointer')
        .on('click', function (ev, e) { ev.stopPropagation(); selectEdge(e); })
        .append('title').text(function (e) { return edgeTitle(e); });
      eg.append('path').attr('class', 'edge-double').attr('fill', 'none').style('pointer-events', 'none').attr('d', edgePath);

      // ── edge labels: the pill
      var lg = C.gEdgeLabels.selectAll('g.edge-label-group').data(drawable, function (e) { return e.id; })
        .enter().append('g').attr('class', 'edge-label-group').attr('transform', edgeLabelTransform)
        .style('cursor', 'pointer').on('click', function (ev, e) { ev.stopPropagation(); selectEdge(e); });
      lg.append('rect').attr('class', 'edge-label-bg').attr('height', 16).attr('y', -8).attr('stroke-width', 1);
      lg.append('text').attr('class', 'edge-label-text').attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-family', 'IBM Plex Mono, monospace').attr('font-size', 10.5).attr('font-weight', 700);

      // ── nodes
      var g = C.gNodes.selectAll('g.node').data(C.nodes, function (n) { return n.id; })
        .enter().append('g').attr('class', 'node')
        .attr('transform', function (n) { return 'translate(' + n.x + ',' + n.y + ')'; })
        .on('click', function (ev, n) {
          ev.stopPropagation();
          if (ev.altKey) { emit('remove', n); return; }
          if (ev.shiftKey || ev.metaKey) { toggleSelect(n.id); return; }
          select(n.id);
          emit('click', n);
        })
        .on('dblclick', function (ev, n) { ev.stopPropagation(); ev.preventDefault(); emit('expand', n); })
        .on('mouseenter', function (ev, n) { showTip(ev, n); hoverArcs(n, true); })
        .on('mousemove', moveTip)
        .on('mouseleave', function (ev, n) { hideTip(); hoverArcs(n, false); })
        .call(dragBehaviour());
      g.append('circle').attr('class', 'hit').attr('cy', 12).attr('r', 22).attr('fill', 'transparent');
      g.append('circle').attr('class', 'ring');
      g.append('title').text(nodeTitle);

      // ── labels: the lines the host asked for, in a layer of their own
      var lab = C.gNodeLabels.selectAll('g.node-label').data(C.nodes, function (n) { return n.id; })
        .enter().append('g').attr('class', 'node-label')
        .attr('transform', function (n) { return 'translate(' + n.x + ',' + n.y + ')'; });
      if (styles.showNames) {
        var txt = lab.append('text').attr('text-anchor', 'middle').attr('pointer-events', 'none');
        var lines = styles.labels || ['roman', 'hanja', 'dates'];
        var dyFirst = 22;
        lines.forEach(function (kind, i) {
          var size = kind === 'roman' ? Math.max(10.5, styles.labelSize - 2)
                   : kind === 'hanja' ? Math.max(11, styles.labelSize)
                   : kind === 'hangul' ? Math.max(11, styles.labelSize - 2)
                   : Math.max(9.5, styles.labelSize - 4);
          var family = kind === 'roman' ? 'Georgia, Noto Serif, serif'
                     : kind === 'hangul' ? 'Noto Serif KR, serif'
                     : kind === 'dates' ? 'IBM Plex Mono, monospace'
                     : 'Noto Serif TC, Songti TC, serif';
          txt.append('tspan').attr('class', 'node-label-' + kind).attr('x', 0)
            .attr('font-family', family).attr('font-size', size).attr('font-weight', 500)
            .attr('dy', function (n) { return (i === 0) ? dyFirst : (labelLine(n, lines[i - 1]) ? (kind === 'dates' || kind === 'office' ? 14 : 17) : 0); })
            .text(function (n) { return labelLine(n, kind); });
        });
      }
      paint();
      clearTimeout(C.fitTimer);
      C.userNavigated = false;
      C.fitTimer = setTimeout(function () { if (!C.userNavigated) fit(); }, 800);
      handDraw(C.gEdges); handDraw(C.gNodes);
    }
    function labelLine(n, kind) {
      if (isGhost(n)) return '';
      if (kind === 'roman') return n.roman || n.hangul || n.name || n.id;
      if (kind === 'hanja') return (n.roman || n.hangul) ? (n.name || '') : '';
      if (kind === 'hangul') return n.hangul || '';
      if (kind === 'dates') return datesOf(n);
      if (kind === 'office') return n.office ? (n.office.length > 11 ? n.office.slice(0, 11) + '…' : n.office) : '';
      return '';
    }
    function nodeTitle(n) {
      var cho = Array.isArray(n.choronym) ? n.choronym.join(', ') : (n.choronym || '—');
      var folio = [];
      if (n.vol) folio.push('vol ' + n.vol);
      if (n.leaf) folio.push('leaf ' + n.leaf);
      if (n.side) folio.push('side ' + n.side);
      return [
        (isGhost(n) ? '[conduit] ' : '') + (n.name || n.id) + '  [' + n.id + ']',
        n.roman || null, n.hangul ? '한글: ' + n.hangul : null,
        (n.altNames && n.altNames.length) ? '別名: ' + (Array.isArray(n.altNames) ? n.altNames.join(' · ') : n.altNames) : null,
        '本貫: ' + cho + (isInferred(n) ? ' (inferred)' : ''),
        n.office ? '官職: ' + n.office : null,
        datesOf(n) || null,
        'Generation: ' + (n.generation == null ? (n._gen == null ? '—' : (n._gen > 0 ? '+' : '') + n._gen) : n.generation),
        folio.length ? folio.join(' · ') : null, n.notes ? 'Notes: ' + n.notes : null
      ].filter(Boolean).join('\n');
    }
    function edgeTitle(e) {
      var s = C.byId.get(e.source), t = C.byId.get(e.target);
      var rel = e.baseType === 'SAME_PERSON' ? 'SAME_PERSON 同一人 — one man in two records'
        : e.baseType === 'HAS_SIL' ? 'HAS_SIL 室 — a marriage: the target married a daughter of the source'
        : 'HAS_SON 子 — the target is a recorded son of the source';
      return rel + (e.childOrder ? '  [' + e.childOrder + ']' : '') + '\n' + (s ? s.name : e.source) + ' → ' + (t ? t.name : e.target) + (e.wifeNote ? '\n' + e.wifeNote : '');
    }

    /* ── drag: X only, snapped. Y is the generation and cannot be argued with. */
    function dragBehaviour() {
      var P = palette();
      return d3.drag()
        .on('start', function (ev, d) { d.fy = d.y; })
        .on('drag', function (ev, d) {
          var raw = ev.x, ref = C.nodes.filter(function (n) { return n.id !== d.id; })[0];
          var refX = ref ? ref.x : raw, grid = refX + Math.round((raw - refX) / SIB) * SIB;
          var snapped = Math.abs(grid - raw) < SNAP_T, x = snapped ? grid : raw;
          if (!snapped) for (var i = 0; i < C.nodes.length; i++) {
            var o = C.nodes[i];
            if (o.id !== d.id && Math.abs(o.x - raw) < SNAP_T) { x = o.x; snapped = true; break; }
          }
          d.x = x; d.fx = x; d.y = d.fy;
          C.gGuides.selectAll('*').remove();
          if (snapped && C.frame) {
            C.gGuides.append('line').attr('x1', x).attr('x2', x).attr('y1', C.frame.topPad - 30)
              .attr('y2', C.frame.topPad + (C.frame.maxGen - C.frame.minGen) * C.frame.rowHeight + 50)
              .attr('stroke', P.nodeSelected).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,4').attr('opacity', 0.85);
          }
          renderPositions();
        })
        .on('end', function (ev, d) {
          var ref = C.nodes.filter(function (n) { return n.id !== d.id; })[0], refX = ref ? ref.x : d.x;
          d.x = refX + Math.round((d.x - refX) / SIB) * SIB; d.fx = d.x;
          C.gGuides.selectAll('*').remove();
          renderPositions();
        });
    }
    function renderPositions() {
      C.gNodes.selectAll('g.node').attr('transform', function (n) { return 'translate(' + n.x + ',' + n.y + ')'; });
      C.gNodeLabels.selectAll('g.node-label').attr('transform', function (n) { return 'translate(' + n.x + ',' + n.y + ')'; });
      C.gEdges.selectAll('path.edge').attr('d', edgePath);
      C.gEdges.selectAll('path.edge-double').attr('d', edgePath);
      moveGradients();
      C.gEdgeLabels.selectAll('g.edge-label-group').attr('transform', edgeLabelTransform);
      positionPill();
    }
    function hoverArcs(n, onHover) {
      if (C.hl.nodes.size) return;
      C.gEdges.selectAll('path.edge')
        .attr('opacity', function (e) { if (!onHover) return styles.edgeOpacity; return (e.source === n.id || e.target === n.id) ? 1 : styles.edgeOpacity * 0.25; })
        .attr('stroke-width', function (e) { return onHover && (e.source === n.id || e.target === n.id) ? edgeWidth(e) + 1.2 : edgeWidth(e); });
    }

    /* ── selection, in one place or several. */
    function select(id) {
      C.multi = new Set();
      C.selected = id || null;
      if (C.selected) C.multi.add(C.selected);
      paint();
      var n = id ? C.byId.get(id) : null;
      if (n) showPill(n); else hidePill();
      emit('select', n || null);
      emit('multiselect', Array.from(C.multi));
    }
    function toggleSelect(id) {
      if (C.multi.has(id)) C.multi.delete(id); else C.multi.add(id);
      C.selected = id;
      paint();
      var n = C.byId.get(id);
      if (n && C.multi.has(id)) showPill(n); else hidePill();
      emit('multiselect', Array.from(C.multi));
    }
    function selectEdge(e) {
      highlight({ nodes: [e.source, e.target], edges: [e.id] });
      emit('edge', e);
    }
    function centerOn(id, k) {
      var n = C.byId.get(id);
      if (!n || !C.svg) return;
      var w = C.el.clientWidth, h = C.el.clientHeight;
      k = k || 1;
      C.svg.transition().duration(750).call(C.zoom.transform, d3.zoomIdentity.translate(w / 2 - n.x * k, h / 2 - n.y * k).scale(k));
    }

    /* ── the floating actions on a selected figure (Sebo's pill). */
    function setActions(list) { C.actions = list || []; if (C.selected) showPill(C.byId.get(C.selected)); }
    function showPill(n) {
      if (!C.actions.length || !n) { hidePill(); return; }
      if (!C.pill) { C.pill = document.createElement('div'); C.pill.className = 'floating-node-actions'; C.el.appendChild(C.pill); }
      C.pill.innerHTML = '';
      C.actions.forEach(function (a, i) {
        if (a.sep) { var s = document.createElement('span'); s.className = 'pill-sep'; C.pill.appendChild(s); return; }
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'pill-btn' + (a.danger ? ' pill-btn-danger' : ''); b.title = a.title || '';
        b.innerHTML = (a.icon ? '<span aria-hidden="true">' + esc(a.icon) + '</span> ' : '') + esc(a.label);
        b.addEventListener('click', function (ev) { ev.stopPropagation(); a.run(n, api); });
        C.pill.appendChild(b);
      });
      C.pillFor = n.id;
      positionPill();
    }
    function hidePill() { if (C.pill) { C.pill.remove(); C.pill = null; } C.pillFor = null; }
    function positionPill() {
      if (!C.pill || !C.pillFor || !C.svg) return;
      var n = C.byId.get(C.pillFor);
      if (!n || n.x === undefined) return;
      try {
        var t = d3.zoomTransform(C.svg.node());
        C.pill.style.left = t.applyX(n.x) + 'px';
        C.pill.style.top = t.applyY(n.y) + 'px';
      } catch (e) { /* not yet drawn */ }
    }

    /* ── tooltip. */
    function showTip(ev, n) {
      if (!C.tooltip) return;
      var folio = [];
      if (n.vol) folio.push('vol ' + n.vol);
      if (n.leaf) folio.push('leaf ' + n.leaf);
      if (n.side) folio.push('side ' + n.side);
      var cho = Array.isArray(n.choronym) ? n.choronym.join(' / ') : (n.choronym || '—');
      C.tooltip.innerHTML =
        '<div class="tt-name">' + esc(n.name || n.id) + (n.hangul ? ' <span class="hangul" style="font-size:12px">' + esc(n.hangul) + '</span>' : '') + '</div>' +
        (n.roman ? '<div class="tt-line" style="font-family:inherit;font-style:italic;font-size:12px;letter-spacing:0">' + esc(n.roman) + '</div>' : '') +
        '<div class="tt-line">' + esc(cho) + (isInferred(n) ? ' · inferred' : '') + '</div>' +
        (n.office ? '<div class="tt-line" style="font-family:var(--fh)">' + esc(n.office) + '</div>' : '') +
        (datesOf(n) ? '<div class="tt-line">' + esc(datesOf(n)) + '</div>' : '') +
        '<div class="tt-line">' + esc(n.id) + (n.generation != null ? ' · gen ' + n.generation : '') + '</div>' +
        (folio.length ? '<div class="tt-line">' + esc(folio.join(' · ')) + '</div>' : '');
      C.tooltip.classList.remove('hidden');
      moveTip(ev);
    }
    function moveTip(ev) {
      if (!C.tooltip || C.tooltip.classList.contains('hidden')) return;
      var r = C.el.getBoundingClientRect();
      var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
      if (x + 270 > r.width) x -= 290;
      if (y + 130 > r.height) y -= 150;
      C.tooltip.style.left = x + 'px'; C.tooltip.style.top = y + 'px';
    }
    function hideTip() { if (C.tooltip) C.tooltip.classList.add('hidden'); }

    /* ═══════════════════════════════════════════════════════ legend ══ */
    function legendRows() {
      var P = palette();
      var rows = [];
      if (styles.patrilineMode && styles.patrilines.length) {
        styles.patrilines.forEach(function (p, i) {
          rows.push({ glyph: legendGlyph(p.style, P.mono ? P.hasSonColor : p.color, p.width), rel: p.name, sub: p.clan || 'no choronym', editable: i });
        });
      }
      rows.push({ glyph: legendGlyph(styles.hasSonStyle, P.hasSonColor, styles.edgeWidth), rel: 'HAS_SON 子', sub: 'father → son' });
      rows.push({ glyph: legendGlyph(styles.hasSilStyle, P.hasSilColor, styles.edgeWidth * 0.8), rel: 'HAS_SIL 室', sub: 'father-in-law → son-in-law' });
      if (C.drawable.some(function (e) { return e.baseType === 'SAME_PERSON'; })) {
        rows.push({ glyph: legendGlyph('dashed', P.sameColor, styles.edgeWidth * 0.8), rel: 'SAME_PERSON 同一人', sub: 'one man in two records' });
      }
      if (KWON) rows.push({ glyph: nodeGlyph(P.nodeFill, P.nodeStroke, P.nodeGhost), rel: KWON + ' · other', sub: 'filled / hollow; dotted = lineage inferred', node: true });
      return rows;
    }
    function updateLegend() {
      var host = opts.legend || null;
      if (!host) return;
      var rows = legendRows();
      var html = '<div class="legend-title">' + (styles.patrilineMode ? 'Patrilines <button type="button" class="legend-reset">reset</button>' : 'Legend') + '</div>';
      rows.forEach(function (r) {
        html += '<div class="legend-item">' + r.glyph + '<span class="legend-label">' +
          '<span class="legend-rel"' + (r.editable !== undefined ? ' contenteditable="true" data-i="' + r.editable + '"' : '') + '>' + esc(r.rel) + '</span>' +
          '<span class="legend-sub">' + esc(r.sub) + '</span></span></div>';
      });
      var caption = opts.legendCaption === undefined
        ? 'Rows are generations. A dashed line is a marriage; the arrow runs from the earlier figure to the later one.'
        : opts.legendCaption;
      if (caption) html += '<div class="legend-caption">' + caption + '</div>';
      host.innerHTML = html;
      var reset = host.querySelector('.legend-reset');
      if (reset) reset.addEventListener('click', function () { setOption('patrilineMode', false); emit('patrilineReset'); });
      host.querySelectorAll('.legend-rel[contenteditable]').forEach(function (el) {
        el.addEventListener('blur', function () { setPatriline(+el.getAttribute('data-i'), { name: el.textContent.trim() }); });
        el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } });
      });
    }

    /* ═══════════════════════════════════════════════════ view control ══ */
    function bbox() {
      if (!C.nodes.length) return null;
      var xs = C.nodes.map(function (n) { return n.x; }), ys = C.nodes.map(function (n) { return n.y; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      if (C.frame) { minY = Math.min(minY, C.frame.topPad); maxY = Math.max(maxY, C.frame.topPad + (C.frame.maxGen - C.frame.minGen) * C.frame.rowHeight); }
      var axisLeft = C.axisX !== null ? C.axisX : Math.min(12, minX - BADGE_MARGIN);
      return { x0: Math.min(minX - FIT_PAD, axisLeft - 10), x1: maxX + FIT_PAD, y0: minY - FIT_PAD, y1: maxY + FIT_PAD + 40 };
    }
    function boxOf(list) {
      if (!list || !list.length) return null;
      var xs = list.map(function (n) { return n.x; }), ys = list.map(function (n) { return n.y; });
      return { x0: Math.min.apply(null, xs) - FIT_PAD, x1: Math.max.apply(null, xs) + FIT_PAD, y0: Math.min.apply(null, ys) - FIT_PAD, y1: Math.max.apply(null, ys) + FIT_PAD + 40 };
    }
    function focusNodes() {
      if (!C.focus || !C.focus.size) return [];
      return C.nodes.filter(function (n) { return C.focus.has(n.id) && isFinite(n.x) && isFinite(n.y); });
    }
    function scaleFor(b, w, h) {
      var cw = Math.max(b.x1 - b.x0, 100), ch = Math.max(b.y1 - b.y0, 100);
      return Math.min((w - 120) / cw, (h - 120) / ch, FIT_MAX);
    }
    function wouldFloor() {
      if (!C.el || !C.nodes.length) return false;
      var w = C.el.clientWidth, h = C.el.clientHeight;
      if (!w || !h || w < 20 || h < 20) return false;
      var foc = focusNodes(), b = foc.length ? boxOf(foc) : bbox();
      return !!b && scaleFor(b, w, h) < FIT_MIN;
    }
    function floorToast(floored) {
      clearTimeout(C.floorTimer);
      C.floorPending = !!floored;
      if (!floored) return;
      C.floorTimer = setTimeout(function () {
        if (!C.floorPending || !wouldFloor()) return;
        var now = Date.now();
        if (C.floorToastAt && now - C.floorToastAt < 5000) return;
        C.floorToastAt = now;
        if (opts.onToast) opts.onToast('The drawing is wider than the screen — pan, or zoom out.', 'floor');
      }, 900);
    }
    function rootRowNodes() {
      var all = C.nodes.filter(function (n) { return isFinite(n.x) && isFinite(n.y); });
      var row = all.filter(function (n) { return n._gen === 0; });
      return row.length >= 3 ? row : all;
    }
    function fit() {
      if (!C.el || !C.svg) return;
      var w = C.el.clientWidth, h = C.el.clientHeight;
      if (!w || !h || w < 20 || h < 20) return;
      var whole = bbox();
      if (!whole) return;
      var foc = focusNodes(), b = foc.length ? boxOf(foc) : whole, k = scaleFor(b, w, h);
      if (k < FIT_MIN) {
        var pool = foc.length ? foc : rootRowNodes();
        if (!pool.length) pool = C.nodes;
        k = FIT_MIN;
        b = densestWindow(pool, (w - 120) / k, (h - 120) / k);
        floorToast(true);
      } else floorToast(false);
      k = Math.max(FIT_MIN, Math.min(k, FIT_MAX));
      var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      C.svg.transition().duration(750).call(C.zoom.transform, d3.zoomIdentity.translate(w / 2 - cx * k, h / 2 - cy * k).scale(k));
    }
    function zoomBy(k) { C.svg.transition().duration(300).call(C.zoom.scaleBy, k); }
    function redraw() {
      C.nodes.forEach(function (n) { delete n.x; delete n.y; delete n.fx; delete n.fy; delete n.idealX; });
      render(); fit();
    }
    function redrawAnnounced() {
      redraw();
      if (opts.onToast) opts.onToast('Redrawn and vertically centred — ' + C.nodes.length + ' people, ' + C.edges.length + ' relations.', 'redraw');
    }
    function clear() { setData({ nodes: [], edges: [] }, {}); }
    function setLayout(l) { C.layout = l; render(); fit(); }
    function setOption(k, v) {
      if (k === 'rows') { C.rows = v === 'local' ? 'local' : 'index'; render(); return; }
      if (k === 'handDrawn') { styles.handDrawn = !!v; handDraw(C.gEdges); handDraw(C.gNodes); updateAxis(palette()); return; }
      // Relinkings' names for the label lines, kept: they add or remove a line
      if (k === 'showHangul' || k === 'showOffice') {
        var line = k === 'showHangul' ? 'hangul' : 'office';
        styles.labels = (styles.labels || []).filter(function (x) { return x !== line; });
        if (v) styles.labels.push(line);
        render(); return;
      }
      styles[k] = v;
      if (k === 'patrilineMode') { detectPatrilines(C.nodes, anchorId()); render(); return; }
      var repaintOnly = COLOR_KEYS.indexOf(k) >= 0 || ['hasSonStyle', 'hasSilStyle', 'edgeWidth', 'edgeOpacity', 'showBirthOrder', 'edgeGradient', 'contextFade'].indexOf(k) >= 0;
      if (repaintOnly) paint(); else render();
    }
    function setScheme(s) {
      applyScheme(s);
      render();
      emit('scheme', styles.colorScheme);
    }
    function data() {
      return { nodes: C.nodes, edges: C.edges, starts: Array.from(C.roles.starts),
               roles: { root: C.roles.root, starts: Array.from(C.roles.starts), waypoints: Array.from(C.roles.waypoints), targets: Array.from(C.roles.targets) } };
    }
    function destroy() {
      clearTimeout(C.fitTimer); clearTimeout(C.floorTimer);
      document.documentElement.removeEventListener('samhan-theme', C.onTheme);
      hidePill();
      if (C.svg) C.svg.remove();
      if (C.ownTooltip && C.tooltip && C.tooltip.parentNode) C.tooltip.parentNode.removeChild(C.tooltip);
      C.nodes = []; C.edges = []; C.handlers = {};
    }

    init(el);
    if (opts.options) for (var ok in opts.options) if (Object.prototype.hasOwnProperty.call(opts.options, ok)) styles[ok] = opts.options[ok];
    if (opts.handDrawn) styles.handDrawn = true;

    var api = {
      VERSION: VERSION,
      el: function () { return C.el; },
      setData: setData, clear: clear, highlight: highlight, setFocus: setFocus, setRoles: setRoles,
      roles: function () { return data().roles; },
      focus: function () { return Array.from(C.focus); },
      redraw: redraw, redrawAnnounced: redrawAnnounced, render: render, repaint: paint, fit: fit, zoomBy: zoomBy, centerOn: centerOn,
      setLayout: setLayout, setOption: setOption, setScheme: setScheme,
      scheme: function () { return styles.colorScheme; },
      updateLegend: updateLegend, legendRows: legendRows,
      styles: styles, options: function () { return styles; },
      layout: function () { return C.layout; }, frame: function () { return C.frame; },
      data: data, node: function (id) { return C.byId.get(id) || null; },
      svgNode: function () { return C.svg ? C.svg.node() : null; },
      bbox: bbox, palette: palette,
      select: select, toggleSelect: toggleSelect, selectEdge: selectEdge, selected: function () { return C.selected; },
      selection: function () { return Array.from(C.multi); }, setActions: setActions, repositionActions: positionPill,
      patrilines: function () { return styles.patrilines; }, addPatriline: addPatriline, removePatriline: removePatriline,
      setPatriline: setPatriline, resetPatrilines: resetPatrilines, detectPatrilines: function () { detectPatrilines(C.nodes, anchorId()); render(); },
      patrilinePalette: patrilinePalette, legendGlyph: legendGlyph,
      on: on, off: off, destroy: destroy,
      /* the Relinkings names, kept so its app.js needs no edits */
      onNodeClick: function (fn) { return on('click', fn); },
      onNodeExpand: function (fn) { return on('expand', fn); },
      onNodeRemove: function (fn) { return on('remove', fn); }
    };
    return api;
  }

  var SamhanGraph = { create: create, Layout: Layout, kinshipOrder: kinshipOrder, dashArray: dashArray, legendGlyph: legendGlyph,
                      SCHEMES: SCHEMES, LINE_STYLES: LINE_STYLES, VERSION: VERSION, version: VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = SamhanGraph;
  root.SamhanGraph = SamhanGraph;
})(typeof window !== 'undefined' ? window : this);
