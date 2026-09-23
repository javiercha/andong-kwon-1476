/* =============================================================================
   Relinkings — graph engine
   -----------------------------------------------------------------------------
   A dependency-free, synchronous in-memory graph engine for the Andong Kwŏn
   Genealogy of 1476 (安東權氏成化譜).  It replicates, in plain JavaScript, the
   Neo4j/APOC import pipeline and the structural-endogamy queries that were
   originally written as Cypher in the project's Jupyter notebooks.

   Loads as a classic browser script (sets window.Relinkings.Engine) and also
   works under Node (module.exports) so it can be unit-tested.
   ========================================================================== */
(function (root) {
  'use strict';

  var KWON = '安東 權';                // the Andong Kwŏn choronym
  var APEX = 'C206438'; // 權幸, apical ancestor of the Andong Kwŏn

  /* ---------------------------------------------------------------- helpers */

  function nfkc(s) {
    if (s === null || s === undefined) return '';
    s = String(s);
    try { return s.normalize('NFKC'); } catch (e) { return s; }
  }

  function blank(s) { return s === null || s === undefined || s === ''; }

  /** Fold a romanization for matching: lower-case, breves and other marks
   *  stripped, apostrophes and hyphens dropped — so "kwon haeng", "Kwŏn Haeng"
   *  and "ch'oe" / "choe" all meet. */
  function fold(s) {
    s = nfkc(s).toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return s.replace(/[\u2019'ʼ`\-]/g, '');
  }

  function toIntOrNull(s) {
    if (blank(s)) return null;
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }

  /** Primary choronym of a node: choronym may be a string, an array (after
   *  propagation found several candidates), or null. */
  function choronymOf(node) {
    if (!node) return null;
    var c = node.choronym;
    if (c === null || c === undefined || c === '') return null;
    if (Array.isArray(c)) return c.length ? c[0] : null;
    return c;
  }

  /** All choronyms of a node as an array (possibly empty). */
  function choronymsOf(node) {
    if (!node) return [];
    var c = node.choronym;
    if (c === null || c === undefined || c === '') return [];
    return Array.isArray(c) ? c.slice() : [c];
  }

  function choronymMatches(node, want) {
    if (!want) return true;
    var list = choronymsOf(node);
    for (var i = 0; i < list.length; i++) if (list[i] === want) return true;
    return false;
  }

  function pushMap(map, key, val) {
    var a = map.get(key);
    if (!a) { a = []; map.set(key, a); }
    a.push(val);
    return a;
  }

  /* ------------------------------------------------------------------ TSV   */

  /**
   * Engine.loadTSV(text) -> array of row objects.
   * Tab separated, first line is the header. All cells NFKC-normalised and
   * trimmed of stray CR. Blank trailing lines are dropped.
   */
  function loadTSV(text) {
    if (!text) return [];
    var lines = String(text).split(/\r\n|\n|\r/);
    var rows = [];
    var header = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === '' ) continue;
      var cells = line.split('\t');
      if (!header) {
        header = cells.map(function (h) { return nfkc(h).trim(); });
        continue;
      }
      var row = {};
      for (var j = 0; j < header.length; j++) {
        row[header[j]] = nfkc(cells[j] === undefined ? '' : cells[j]).trim();
      }
      rows.push(row);
    }
    return rows;
  }

  /** Generic TSV writer for an array of flat objects. */
  function rowsToTSV(rows, columns) {
    if (!rows || !rows.length) return '';
    var cols = columns;
    if (!cols) {
      var seen = Object.create(null);
      cols = [];
      rows.forEach(function (r) {
        Object.keys(r).forEach(function (k) {
          if (!seen[k]) { seen[k] = 1; cols.push(k); }
        });
      });
    }
    var out = [cols.join('\t')];
    rows.forEach(function (r) {
      out.push(cols.map(function (c) {
        var v = r[c];
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return v.join('; ');
        return String(v).replace(/[\t\r\n]+/g, ' ');
      }).join('\t'));
    });
    return out.join('\n');
  }

  /* ------------------------------------------------------------------ build */

  function makeNode(id) {
    return {
      id: id,
      name: '',
      hangul: '',
      altNames: [],
      roman: '',
      choronym: null,
      choronymInferred: false,
      office: '',
      reference: '',
      vol: null,
      leaf: null,
      side: '',
      notes: '',
      generation: null
    };
  }

  /** Fill empty fields only (apoc.refactor.mergeNodes {properties:'combine'} —
   *  we keep the first non-empty value for each property). */
  /** First argument that is not blank, else ''. */
  function first() {
    for (var i = 0; i < arguments.length; i++) if (!blank(arguments[i])) return arguments[i];
    return '';
  }

  function mergeInto(node, patch) {
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var v = patch[k];
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v)) {                      // altNames: union, in order
        var cur0 = Array.isArray(node[k]) ? node[k] : [];
        node[k] = cur0.concat(v.filter(function (x) { return cur0.indexOf(x) < 0; }));
        continue;
      }
      var cur = node[k];
      if (cur === null || cur === undefined || cur === '') node[k] = v;
    }
  }

  /**
   * Engine.build(nodeRows, edgeRows) -> Graph
   */
  function build(nodeRows, edgeRows) {
    var nodes = new Map();

    // --- 1. node table -------------------------------------------------
    var duplicateNodeRows = [];
    (nodeRows || []).forEach(function (r) {
      var id = r.biog_id;
      if (blank(id)) return;
      var n = nodes.get(id);
      if (!n) { n = makeNode(id); nodes.set(id, n); }
      else if (duplicateNodeRows.indexOf(id) < 0) duplicateNodeRows.push(id);
      // The 20250707 node table renamed its headers (x姓名, alt_name, 姓貫,
      // page) and gave `name` to the McCune-Reischauer romanization; in the
      // original table `name` held the hanja. Both are accepted.
      var newHeaders = Object.prototype.hasOwnProperty.call(r, 'x姓名');
      var choronym = first(r['姓貫'], r.choronym);
      mergeInto(n, {
        name: newHeaders ? r['x姓名'] : r.name,
        hangul: r['성명'],
        roman: newHeaders ? r.name : r.roman,
        altNames: [first(r.alt_name, r.name_alt), first(r.alt_name2, r.name_alt2)]
          .filter(function (x) { return !blank(x); }),
        choronym: blank(choronym) ? null : choronym,
        office: r.office,
        reference: r.reference,
        vol: toIntOrNull(r.vol),
        leaf: toIntOrNull(first(r.page, r.leaf)),
        side: r.side,
        notes: r.notes
      });
    });

    // --- 2. edges: MERGE endpoints, retype, dedupe ---------------------
    var edges = [];
    var edgeOnlyNodes = [];
    var duplicateEdges = [];
    var edgeSeen = new Map();
    var byType = { HAS_SON: 0, HAS_SIL: 0 };
    var kwonEdges = 0, kwonSonEdges = 0;
    var mergedEdges = 0;

    (edgeRows || []).forEach(function (r) {
      var s = r.source, t = r.target;
      if (blank(s) || blank(t)) return;
      var sn = nodes.get(s);
      if (!sn) {
        sn = makeNode(s); nodes.set(s, sn); edgeOnlyNodes.push(s);
        mergeInto(sn, {
          name: r.source_name, reference: r.reference,
          vol: toIntOrNull(r.vol), leaf: toIntOrNull(r.leaf), side: r.side
        });
      }
      var tn = nodes.get(t);
      if (!tn) {
        tn = makeNode(t); nodes.set(t, tn); edgeOnlyNodes.push(t);
        mergeInto(tn, {
          name: r.target_name, reference: r.reference,
          vol: toIntOrNull(r.vol), leaf: toIntOrNull(r.leaf), side: r.side
        });
      }

      // Edge type is exactly the relation recorded in the source. Kwon-to-Kwon
      // descent survives only as a derived styling flag, computed from the
      // choronyms as given in the node table (before any propagation).
      var baseType = r.type;
      var type = baseType;
      var kwon = (sn.choronym === KWON && tn.choronym === KWON);

      var key = s + '' + t + '' + type;
      if (edgeSeen.has(key)) {
        mergedEdges++;
        duplicateEdges.push(edgeSeen.get(key));
        return;
      }

      var e = {
        id: key,
        source: s,
        target: t,
        type: type,
        baseType: baseType,
        kwon: kwon,
        childOrder: toIntOrNull(r.child_order),
        wifeNote: r.wife_note || '',
        vol: toIntOrNull(r.vol),
        leaf: toIntOrNull(r.leaf),
        side: r.side || '',
        checked: toIntOrNull(r.checked),
        reference: r.reference || '',
        notes: r.notes || ''
      };
      edgeSeen.set(key, e);
      edges.push(e);
      if (byType[type] === undefined) byType[type] = 0;
      byType[type]++;
      if (kwon) { kwonEdges++; if (baseType === 'HAS_SON') kwonSonEdges++; }
    });

    // --- 3. adjacency ---------------------------------------------------
    var out = new Map(), inn = new Map();
    nodes.forEach(function (n, id) { out.set(id, []); inn.set(id, []); });
    edges.forEach(function (e) {
      out.get(e.source).push(e);
      inn.get(e.target).push(e);
    });

    // --- 4. choronym propagation along HAS_SON* chains, <= 5 hops -------
    var sonAdj = new Map(); // undirected adjacency over HAS_SON* edges
    edges.forEach(function (e) {
      if (e.baseType !== 'HAS_SON') return;
      pushMap(sonAdj, e.source, e.target);
      pushMap(sonAdj, e.target, e.source);
    });

    var original = new Map(); // snapshot of pre-propagation choronyms
    nodes.forEach(function (n, id) { original.set(id, n.choronym); });

    var inferred = 0;
    nodes.forEach(function (n, id) {
      if (n.choronym !== null && n.choronym !== undefined && n.choronym !== '') return;
      var nbrs = sonAdj.get(id);
      if (!nbrs) return;
      // bounded BFS (<= 5 hops) over HAS_SON edges, undirected
      var found = [];
      var foundSet = Object.create(null);
      var visited = new Set([id]);
      var frontier = [id];
      for (var depth = 1; depth <= 5 && frontier.length; depth++) {
        var next = [];
        for (var i = 0; i < frontier.length; i++) {
          var adj = sonAdj.get(frontier[i]);
          if (!adj) continue;
          for (var j = 0; j < adj.length; j++) {
            var v = adj[j];
            if (visited.has(v)) continue;
            visited.add(v);
            next.push(v);
            var c = original.get(v);
            if (c) {
              var list = Array.isArray(c) ? c : [c];
              for (var k = 0; k < list.length; k++) {
                if (!foundSet[list[k]]) { foundSet[list[k]] = 1; found.push(list[k]); }
              }
            }
          }
        }
        frontier = next;
      }
      if (!found.length) return;
      found.sort();
      n.choronym = found.length === 1 ? found[0] : found;
      n.choronymInferred = true;
      inferred++;
    });

    // --- 5. indexes -----------------------------------------------------
    var byName = new Map(), byChoronym = new Map();
    nodes.forEach(function (n) {
      if (n.name) pushMap(byName, n.name, n);
      choronymsOf(n).forEach(function (c) { pushMap(byChoronym, c, n); });
    });

    var g = new Graph({
      provenance: {
        duplicateNodeRows: duplicateNodeRows,
        edgeOnlyNodes: edgeOnlyNodes,
        duplicateEdges: duplicateEdges
      },
      nodes: nodes,
      edges: edges,
      out: out,
      in: inn,
      byName: byName,
      byChoronym: byChoronym,
      stats: {
        nodeCount: nodes.size,
        edgeCount: edges.length,
        byType: byType,
        kwonEdges: kwonEdges,
        kwonSonEdges: kwonSonEdges,
        mergedEdges: mergedEdges,
        duplicateNodeRows: duplicateNodeRows.length,
        edgeOnlyNodes: edgeOnlyNodes.length,
        choronymsInferred: inferred
      }
    });
    g.generations();
    return g;
  }

  /* ------------------------------------------------------------------ Graph */

  function Graph(fields) {
    this.provenance = fields.provenance ||
      { duplicateNodeRows: [], edgeOnlyNodes: [], duplicateEdges: [] };
    this.nodes = fields.nodes;
    this.edges = fields.edges;
    this.out = fields.out;
    this.in = fields.in;
    this.byName = fields.byName;
    this.byChoronym = fields.byChoronym;
    this.stats = fields.stats;
    this._alt = null;
  }

  Graph.prototype.node = function (id) { return this.nodes.get(id) || null; };
  Graph.prototype.outEdges = function (id) { return this.out.get(id) || []; };
  Graph.prototype.inEdges = function (id) { return this.in.get(id) || []; };
  Graph.prototype.outDeg = function (id) { var a = this.out.get(id); return a ? a.length : 0; };
  Graph.prototype.inDeg = function (id) { var a = this.in.get(id); return a ? a.length : 0; };
  Graph.prototype.choronymOf = function (n) {
    return choronymOf(typeof n === 'string' ? this.nodes.get(n) : n);
  };
  Graph.prototype.choronymsOf = function (n) {
    return choronymsOf(typeof n === 'string' ? this.nodes.get(n) : n);
  };

  /** Index of every alternative surface form -> nodes. Built lazily. */
  Graph.prototype._altIndex = function () {
    if (this._alt) return this._alt;
    var m = new Map();
    this.nodes.forEach(function (n) {
      ['name', 'hangul', 'roman'].forEach(function (f) {
        if (n[f]) pushMap(m, n[f], n);
      });
      if (n.roman) pushMap(m, fold(n.roman), n);
      (n.altNames || []).forEach(function (a) { pushMap(m, a, n); });
    });
    this._alt = m;
    return m;
  };

  /**
   * Graph.resolve(query) -> Node[]  (exact matches first, then substring)
   * Accepts a biog_id, a name, a hangul reading, or an alternative name.
   */
  Graph.prototype.resolve = function (query) {
    if (blank(query)) return [];
    var q = nfkc(String(query)).trim();
    var direct = this.nodes.get(q);
    if (direct) return [direct];
    var exact = this._altIndex().get(q) || this._altIndex().get(fold(q));
    if (exact && exact.length) return exact.slice();
    var res = [], seen = new Set(), fq = fold(q);
    this.nodes.forEach(function (n) {
      if (seen.has(n.id)) return;
      if ((n.name && n.name.indexOf(q) >= 0) ||
          (n.hangul && n.hangul.indexOf(q) >= 0) ||
          (n.roman && fold(n.roman).indexOf(fq) >= 0) ||
          (n.altNames || []).some(function (a) { return a.indexOf(q) >= 0; })) {
        seen.add(n.id); res.push(n);
      }
    });
    return res;
  };

  /**
   * Graph.search(q, {limit}) -> Node[]
   * Searches id, name, hangul, alt names, office and choronym.
   */
  Graph.prototype.search = function (q, opts) {
    opts = opts || {};
    var limit = opts.limit === undefined ? 50 : opts.limit;
    if (blank(q)) return [];
    var s = nfkc(String(q)).trim(), fs = fold(s);
    var exact = [], part = [];
    this.nodes.forEach(function (n) {
      var fields = [n.id, n.name, n.hangul, n.office].concat(n.altNames || []);
      if (n.roman) { fields.push(n.roman); fields.push(fold(n.roman)); }
      choronymsOf(n).forEach(function (c) { fields.push(c); });
      var hitExact = false, hitPart = false;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f) continue;
        if (f === s || f === fs) { hitExact = true; break; }
        if (f.indexOf(s) >= 0 || f.indexOf(fs) >= 0) hitPart = true;
      }
      if (hitExact) exact.push(n);
      else if (hitPart) part.push(n);
    });
    var all = exact.concat(part);
    return limit ? all.slice(0, limit) : all;
  };

  /* ------------------------------------------------------------- subgraphs */

  /** Graph.subgraph(ids) -> Subgraph (induced) */
  Graph.prototype.subgraph = function (ids, starts) {
    var set = ids instanceof Set ? ids : new Set(ids);
    var nodes = [], self = this;
    set.forEach(function (id) {
      var n = self.nodes.get(id);
      if (n) nodes.push(n);
    });
    var edges = [];
    // iterate over out-edges of members only (cheaper than scanning all edges)
    set.forEach(function (id) {
      var oe = self.out.get(id);
      if (!oe) return;
      for (var i = 0; i < oe.length; i++) if (set.has(oe[i].target)) edges.push(oe[i]);
    });
    return { nodes: nodes, edges: edges, starts: (starts || []).slice() };
  };

  /* ------------------------------------------------------------ ego network */

  /**
   * Graph.egoNetwork({starts, exclude, ancestorDepth, descendantDepth, prune})
   * prune: 'none' | 'degree' | 'issue' | 'circuits'
   */
  Graph.prototype.egoNetwork = function (opts) {
    opts = opts || {};
    var self = this;
    var ancestorDepth = opts.ancestorDepth === undefined ? 5 : opts.ancestorDepth;
    var descendantDepth = opts.descendantDepth === undefined ? 6 : opts.descendantDepth;
    var prune = opts.prune || 'none';

    // excluded: names or ids
    var excl = new Set();
    (opts.exclude || []).forEach(function (x) {
      if (blank(x)) return;
      var q = nfkc(String(x)).trim();
      excl.add(q);
      var hits = self.resolve(q);
      hits.forEach(function (n) { excl.add(n.id); });
    });
    function isExcluded(id) {
      if (excl.has(id)) return true;
      var n = self.nodes.get(id);
      return !!(n && n.name && excl.has(n.name));
    }

    // seeds
    var startIds = [], startSeen = new Set();
    (opts.starts || []).forEach(function (s) {
      self.resolve(s).forEach(function (n) {
        if (startSeen.has(n.id) || isExcluded(n.id)) return;
        startSeen.add(n.id); startIds.push(n.id);
      });
    });

    var keep = new Set(startIds);

    function expand(depth, dirMap, endpoint) {
      var frontier = startIds.slice();
      for (var d = 0; d < depth && frontier.length; d++) {
        var next = [];
        for (var i = 0; i < frontier.length; i++) {
          var es = dirMap.get(frontier[i]);
          if (!es) continue;
          for (var j = 0; j < es.length; j++) {
            var v = es[j][endpoint];
            if (keep.has(v) || isExcluded(v)) continue;
            keep.add(v); next.push(v);
          }
        }
        frontier = next;
      }
    }
    expand(descendantDepth, this.out, 'target');
    expand(ancestorDepth, this.in, 'source');

    var sub = this.subgraph(keep, startIds);
    if (prune === 'none' || !sub.nodes.length) return sub;

    var kept = this._pruneSubgraph(sub, prune);
    var out = this.subgraph(kept, startIds.filter(function (id) { return kept.has(id); }));
    out.pruned = prune;
    return out;
  };

  /** Returns a Set of node ids surviving the requested prune rule. */
  Graph.prototype._pruneSubgraph = function (sub, prune) {
    var ids = new Set(sub.nodes.map(function (n) { return n.id; }));
    if (prune === 'degree') {
      var nbrs = new Map();
      ids.forEach(function (id) { nbrs.set(id, new Set()); });
      sub.edges.forEach(function (e) {
        if (e.source === e.target) return;
        nbrs.get(e.source).add(e.target);
        nbrs.get(e.target).add(e.source);
      });
      var out = new Set();
      nbrs.forEach(function (s, id) { if (s.size > 1) out.add(id); });
      return out;
    }
    if (prune === 'issue') {
      var od = new Map(), idg = new Map();
      ids.forEach(function (id) { od.set(id, 0); idg.set(id, 0); });
      sub.edges.forEach(function (e) {
        od.set(e.source, od.get(e.source) + 1);
        idg.set(e.target, idg.get(e.target) + 1);
      });
      var res = new Set();
      ids.forEach(function (id) { if (od.get(id) > 0 || idg.get(id) > 1) res.add(id); });
      return res;
    }
    if (prune === 'circuits') {
      // nodes lying on at least one cycle of the induced undirected graph =
      // nodes belonging to a biconnected component with >= 2 edges.
      var comps = biconnectedComponents(ids, sub.edges);
      var keep = new Set();
      comps.forEach(function (c) {
        if (c.edges.length >= 2) c.nodes.forEach(function (id) { keep.add(id); });
      });
      return keep;
    }
    return ids;
  };

  /* ------------------------------------------------- Q1: same-choronym paths */

  /**
   * Extension of the contract (additive): the notebook's first query —
   * directed paths of length 1..maxLen between two persons of one choronym
   * (安東 權 by default).
   */
  Graph.prototype.choronymPaths = function (opts) {
    opts = opts || {};
    var choronym = opts.choronym || KWON;
    var maxLen = opts.maxLen === undefined ? 1 : opts.maxLen;
    var limit = opts.limit === undefined ? 5000 : opts.limit;
    var self = this;
    var results = [], truncated = false;

    var seeds = this.byChoronym.get(choronym) || [];
    for (var i = 0; i < seeds.length && !truncated; i++) {
      var ego = seeds[i];
      var stack = [{ nodes: [ego.id], edges: [], visited: new Set([ego.id]) }];
      while (stack.length) {
        var st = stack.pop();
        if (st.edges.length >= maxLen) continue;
        var oe = self.out.get(st.nodes[st.nodes.length - 1]) || [];
        for (var j = 0; j < oe.length; j++) {
          var e = oe[j];
          if (st.visited.has(e.target)) continue;
          var tn = self.nodes.get(e.target);
          var np = { nodes: st.nodes.concat([e.target]), edges: st.edges.concat([e]) };
          if (choronymMatches(tn, choronym)) {
            results.push(np);
            if (results.length >= limit) { truncated = true; break; }
          }
          if (np.edges.length < maxLen) {
            var v = new Set(st.visited); v.add(e.target);
            stack.push({ nodes: np.nodes, edges: np.edges, visited: v });
          }
        }
        if (truncated) break;
      }
    }
    return { paths: results, truncated: truncated };
  };

  /* -------------------------------------------------- Q2: relinking chains */

  /**
   * Graph.relinkingChains({minLen, maxLen, egoChoronym, dstChoronym,
   *                        sameChoronym, requireMarriage, requireDistinctPaths,
   *                        limit})
   *   -> {pairs:[{ego, dst, paths:[{nodes, edges}], isCircuit}], stats}
   *
   * A path is kept when the ego is a branching point (outDeg > 1), the
   * destination is a convergence point (inDeg > 1), and every intermediate
   * node has outDeg > 0 (implied: it has an out-edge on the path).  Two
   * node-disjoint paths from the same ego to the same destination constitute a
   * genealogical circuit — White's "relinking".
   */
  Graph.prototype.relinkingChains = function (opts) {
    opts = opts || {};
    var minLen = opts.minLen === undefined ? 2 : opts.minLen;
    var maxLen = opts.maxLen === undefined ? 8 : opts.maxLen;
    var egoChoronym = opts.egoChoronym || null;
    var dstChoronym = opts.dstChoronym || null;
    var sameChoronym = opts.sameChoronym === undefined ? false : !!opts.sameChoronym;
    var requireMarriage = opts.requireMarriage === undefined ? true : !!opts.requireMarriage;
    var requireDistinctPaths = opts.requireDistinctPaths === undefined
      ? true : !!opts.requireDistinctPaths;
    var limit = opts.limit === undefined ? 5000 : opts.limit;

    var self = this;
    var pairMap = new Map();
    var pathCount = 0, truncated = false;

    var egos = [];
    this.nodes.forEach(function (n) {
      if (self.outDeg(n.id) <= 1) return;
      if (choronymOf(n) === null) return;
      if (egoChoronym && !choronymMatches(n, egoChoronym)) return;
      egos.push(n);
    });
    egos.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });

    // iterative DFS over simple paths
    var pathNodes = new Array(maxLen + 1);
    var pathEdges = new Array(maxLen);

    for (var i = 0; i < egos.length && !truncated; i++) {
      var ego = egos[i];
      var egoChors = choronymsOf(ego);
      var visited = new Set();
      pathNodes[0] = ego.id;
      visited.add(ego.id);
      truncated = dfs(0);
      visited.clear();
    }

    function dfs(depth) {
      var u = pathNodes[depth];
      var oe = self.out.get(u);
      if (!oe) return false;
      for (var k = 0; k < oe.length; k++) {
        var e = oe[k];
        var v = e.target;
        if (visited.has(v)) continue;
        var d = depth + 1;
        pathNodes[d] = v;
        pathEdges[depth] = e;
        if (d >= minLen && v !== pathNodes[0]) {
          var vn = self.nodes.get(v);
          if (self.inDeg(v) > 1 &&
              (!dstChoronym || choronymMatches(vn, dstChoronym)) &&
              (!sameChoronym || shareChoronym(egoChors, vn))) {
            var key = pathNodes[0] + '' + v;
            var pair = pairMap.get(key);
            if (!pair) {
              pair = { ego: pathNodes[0], dst: v, paths: [], isCircuit: false };
              pairMap.set(key, pair);
            }
            pair.paths.push({
              nodes: pathNodes.slice(0, d + 1),
              edges: pathEdges.slice(0, d)
            });
            pathCount++;
            if (pathCount >= limit) return true;
          }
        }
        if (d < maxLen) {
          visited.add(v);
          var stop = dfs(d);
          visited.delete(v);
          if (stop) return true;
        }
      }
      return false;
    }

    function shareChoronym(list, node) {
      var other = choronymsOf(node);
      for (var a = 0; a < list.length; a++) {
        for (var b = 0; b < other.length; b++) if (list[a] === other[b]) return true;
      }
      return false;
    }

    // ---- pair-level filtering & circuit detection
    var pairs = [];
    var circuits = 0;
    pairMap.forEach(function (pair) {
      if (requireMarriage) {
        var hasSil = false;
        for (var a = 0; a < pair.paths.length && !hasSil; a++) {
          var es = pair.paths[a].edges;
          for (var b = 0; b < es.length; b++) {
            if (es[b].baseType === 'HAS_SIL') { hasSil = true; break; }
          }
        }
        if (!hasSil) return;
      }
      var dj = pair.paths.length > 1 ? disjointPairIndices(pair.paths) : null;
      pair.isCircuit = !!dj;
      if (requireDistinctPaths && !pair.isCircuit) return;
      if (pair.isCircuit) {
        circuits++;
        pair.circuit = circuitFromPaths(pair.paths[dj[0]], pair.paths[dj[1]]);
        Object.defineProperty(pair.circuit, 'graph', { value: self, enumerable: false });
        pair.classification = classifyLoop(pair.circuit, self);
      } else {
        pair.circuit = null;
        pair.classification = null;
      }
      pairs.push(pair);
    });

    pairs.sort(function (a, b) {
      if (b.paths.length !== a.paths.length) return b.paths.length - a.paths.length;
      return a.ego < b.ego ? -1 : a.ego > b.ego ? 1 : 0;
    });

    return {
      pairs: pairs,
      stats: {
        pathCount: pathCount,
        pairCount: pairs.length,
        circuitCount: circuits,
        egoCount: egos.length,
        truncated: truncated,
        minLen: minLen, maxLen: maxLen
      },
      truncated: truncated
    };
  };

  /**
   * Indices [a, b] of two paths that are node-disjoint apart from their shared
   * endpoints, or null. Two such paths close a genealogical circuit.
   */
  function disjointPairIndices(paths) {
    var n = paths.length;
    var cap = 60; // guard against combinatorial blow-up on huge pair groups
    var m = Math.min(n, cap);
    var mids = [];
    for (var i = 0; i < m; i++) {
      var p = paths[i].nodes;
      var s = new Set();
      for (var j = 1; j < p.length - 1; j++) s.add(p[j]);
      mids.push(s);
    }
    for (var a = 0; a < m; a++) {
      for (var b = a + 1; b < m; b++) {
        var A = mids[a], B = mids[b], clash = false;
        var small = A.size <= B.size ? A : B, big = A.size <= B.size ? B : A;
        small.forEach(function (x) { if (big.has(x)) clash = true; });
        if (!clash) return [a, b];
      }
    }
    return null;
  }

  /**
   * Splice two node-disjoint ego -> dst paths into the cycle they close, in the
   * {nodes, edges} form Engine.classifyLoop expects: edges[i] joins nodes[i]
   * and nodes[(i+1) % n].
   */
  function circuitFromPaths(A, B) {
    var nodes = A.nodes.slice();                       // ego .. dst
    for (var i = B.nodes.length - 2; i >= 1; i--) nodes.push(B.nodes[i]);
    var edges = A.edges.slice();                       // ego -> .. -> dst
    for (var j = B.edges.length - 1; j >= 0; j--) edges.push(B.edges[j]);
    return { nodes: nodes, edges: edges, length: nodes.length };
  }

  /* ------------------------------------------------------------ loop census */

  /**
   * Graph.loops({maxLen, requireMarriage, limit, minMarriages})
   * -> [{nodes, edges, marriages, lineages, generations, length}]
   *
   * Enumerates simple cycles of the undirected kinship graph up to maxLen
   * (default 12).  Cycles are canonicalised (lowest-indexed node first, and the
   * lexicographically smaller of the two traversal directions) so each cycle is
   * emitted exactly once.
   */
  Graph.prototype.loops = function (opts) {
    opts = opts || {};
    var maxLen = opts.maxLen === undefined ? 12 : opts.maxLen;
    var requireMarriage = opts.requireMarriage === undefined ? true : !!opts.requireMarriage;
    var limit = opts.limit === undefined ? 5000 : opts.limit;
    var minMarriages = opts.minMarriages === undefined ? (requireMarriage ? 1 : 0) : opts.minMarriages;
    var budgetMs = opts.budgetMs === undefined ? 1800 : opts.budgetMs;
    var deadline = Date.now() + budgetMs;
    var ticks = 0;
    var self = this;

    // Only non-bridge edges can lie on a cycle: restrict the search to the
    // union of biconnected components that contain at least two edges. This
    // discards the ~60% of the genealogy that is pure tree.
    var cyclic = [], nodeSet = new Set();
    this.bicomponents().forEach(function (c) {
      if (c.edges.length < 2) return;
      c.edges.forEach(function (e) {
        cyclic.push(e); nodeSet.add(e.source); nodeSet.add(e.target);
      });
    });

    var order = [];
    nodeSet.forEach(function (id) { order.push(id); });
    order.sort();
    var idx = new Map();
    order.forEach(function (id, i) { idx.set(id, i); });

    // undirected simple adjacency, with a representative edge per pair
    var adj = new Map();     // id -> [neighbourId]
    var pairEdge = new Map(); // "ab" -> representative edge (marriage wins)
    order.forEach(function (id) { adj.set(id, []); });
    cyclic.forEach(function (e) {
      if (e.source === e.target) return;
      var a = e.source, b = e.target;
      var k = idx.get(a) < idx.get(b) ? a + '' + b : b + '' + a;
      var cur = pairEdge.get(k);
      if (!cur) {
        pairEdge.set(k, e);
        adj.get(a).push(b);
        adj.get(b).push(a);
      } else if (cur.baseType !== 'HAS_SIL' && e.baseType === 'HAS_SIL') {
        pairEdge.set(k, e);
      }
    });
    order.forEach(function (id) {
      adj.get(id).sort(function (x, y) { return idx.get(x) - idx.get(y); });
    });

    function edgeOf(a, b) {
      return pairEdge.get(idx.get(a) < idx.get(b) ? a + '' + b : b + '' + a);
    }

    var results = [];
    var seen = new Set();
    var truncated = false;
    var path = [];
    var onPath = new Set();

    for (var si = 0; si < order.length && !truncated; si++) {
      var s = order[si];
      if ((adj.get(s) || []).length < 2) continue;
      path.length = 0; path.push(s); onPath.clear(); onPath.add(s);
      if (walk(s, si)) truncated = true;
    }

    function walk(s, si) {
      if ((++ticks & 8191) === 0 && Date.now() > deadline) return true;
      var u = path[path.length - 1];
      var nbrs = adj.get(u) || [];
      for (var i = 0; i < nbrs.length; i++) {
        var v = nbrs[i];
        if (v === s) {
          if (path.length >= 3) {
            // canonical direction: second node index < last node index
            if (idx.get(path[1]) < idx.get(path[path.length - 1])) {
              if (record(path)) return true;
            }
          }
          continue;
        }
        if (idx.get(v) < si) continue;
        if (onPath.has(v)) continue;
        if (path.length >= maxLen) continue;
        path.push(v); onPath.add(v);
        var stop = walk(s, si);
        onPath.delete(v); path.pop();
        if (stop) return true;
      }
      return false;
    }

    function record(cyc) {
      var key = cyc.join('>');
      if (seen.has(key)) return false;
      seen.add(key);
      var edges = [], marriages = 0;
      for (var i = 0; i < cyc.length; i++) {
        var e = edgeOf(cyc[i], cyc[(i + 1) % cyc.length]);
        edges.push(e);
        if (e && e.baseType === 'HAS_SIL') marriages++;
      }
      if (marriages < minMarriages) return false;
      var lset = Object.create(null), lineages = [];
      var gmin = null, gmax = null;
      for (var j = 0; j < cyc.length; j++) {
        var n = self.nodes.get(cyc[j]);
        var c = choronymOf(n);
        if (c && !lset[c]) { lset[c] = 1; lineages.push(c); }
        if (n && n.generation !== null && n.generation !== undefined) {
          if (gmin === null || n.generation < gmin) gmin = n.generation;
          if (gmax === null || n.generation > gmax) gmax = n.generation;
        }
      }
      lineages.sort();
      var loop = {
        nodes: cyc.slice(),
        edges: edges,
        length: cyc.length,
        marriages: marriages,
        lineages: lineages,
        generations: (gmin === null) ? 0 : (gmax - gmin)
      };
      // back-reference to the graph, hidden from JSON serialisation, so that
      // Engine.classifyLoop(loop) works without an explicit graph argument
      Object.defineProperty(loop, 'graph', { value: self, enumerable: false });
      loop.classification = classifyLoop(loop, self);
      results.push(loop);
      return results.length >= limit;
    }

    results.sort(function (a, b) {
      if (a.length !== b.length) return a.length - b.length;
      return a.nodes[0] < b.nodes[0] ? -1 : a.nodes[0] > b.nodes[0] ? 1 : 0;
    });
    results.truncated = truncated;
    return results;
  };

  /* ---------------------------------------------------------- bicomponents */

  /**
   * Iterative Tarjan biconnected components over an undirected view of the
   * given edge list. Every edge belongs to exactly one component.
   * Returns [{nodes:id[], edges:Edge[]}] sorted by node count desc.
   */
  function biconnectedComponents(nodeIds, edges) {
    var ids = [];
    (nodeIds instanceof Set ? nodeIds : new Set(nodeIds)).forEach(function (id) { ids.push(id); });
    ids.sort();

    var adj = new Map();
    ids.forEach(function (id) { adj.set(id, []); });
    var elist = [];
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (e.source === e.target) continue;
      if (!adj.has(e.source) || !adj.has(e.target)) continue;
      var ei = elist.length;
      elist.push(e);
      adj.get(e.source).push({ to: e.target, e: ei });
      adj.get(e.target).push({ to: e.source, e: ei });
    }

    var disc = new Map(), low = new Map(), timer = 0;
    var estack = [], comps = [];

    for (var r = 0; r < ids.length; r++) {
      var root = ids[r];
      if (disc.has(root)) continue;
      disc.set(root, ++timer); low.set(root, timer);
      var st = [{ u: root, pe: -1, it: 0 }];
      while (st.length) {
        var f = st[st.length - 1];
        var nb = adj.get(f.u);
        if (f.it < nb.length) {
          var arc = nb[f.it++];
          if (arc.e === f.pe) continue;
          if (!disc.has(arc.to)) {
            estack.push(arc.e);
            disc.set(arc.to, ++timer); low.set(arc.to, timer);
            st.push({ u: arc.to, pe: arc.e, it: 0 });
          } else if (disc.get(arc.to) < disc.get(f.u)) {
            estack.push(arc.e);
            if (disc.get(arc.to) < low.get(f.u)) low.set(f.u, disc.get(arc.to));
          }
        } else {
          st.pop();
          if (st.length) {
            var p = st[st.length - 1];
            if (low.get(f.u) < low.get(p.u)) low.set(p.u, low.get(f.u));
            if (low.get(f.u) >= disc.get(p.u)) {
              var comp = [];
              while (estack.length) {
                var ei2 = estack.pop();
                comp.push(ei2);
                if (ei2 === f.pe) break;
              }
              if (comp.length) comps.push(comp);
            }
          }
        }
      }
    }

    var out = comps.map(function (comp) {
      var ns = new Set(), es = [];
      comp.forEach(function (ei) {
        var e = elist[ei];
        es.push(e); ns.add(e.source); ns.add(e.target);
      });
      var arr = [];
      ns.forEach(function (x) { arr.push(x); });
      arr.sort();
      return { nodes: arr, edges: es };
    });
    out.sort(function (a, b) {
      if (b.nodes.length !== a.nodes.length) return b.nodes.length - a.nodes.length;
      return b.edges.length - a.edges.length;
    });
    return out;
  }

  Graph.prototype.bicomponents = function () {
    if (!this._bicomps) {
      this._bicomps = biconnectedComponents(new Set(this.nodes.keys()), this.edges);
    }
    return this._bicomps;
  };

  /** Largest bicomponent = the structurally endogamous core. */
  Graph.prototype.endogamyCore = function () {
    var comps = this.bicomponents();
    var core = comps.length ? comps[0] : { nodes: [], edges: [] };
    var self = this;
    var n = core.nodes.length, m = core.edges.length;
    var byChor = new Map(), marriages = 0;
    core.edges.forEach(function (e) { if (e.baseType === 'HAS_SIL') marriages++; });
    core.nodes.forEach(function (id) {
      var c = choronymOf(self.nodes.get(id)) || '?';
      byChor.set(c, (byChor.get(c) || 0) + 1);
    });
    var comp = [];
    byChor.forEach(function (v, k) { comp.push({ choronym: k, count: v }); });
    comp.sort(function (a, b) { return b.count - a.count; });
    return {
      nodes: core.nodes,
      edges: core.edges,
      stats: {
        nodeCount: n,
        edgeCount: m,
        marriageEdges: marriages,
        density: n > 1 ? (2 * m) / (n * (n - 1)) : 0,
        componentCount: comps.length,
        choronyms: comp
      }
    };
  };

  /* -------------------------------------------------------- lineage matrix */

  /**
   * Graph.lineageMatrix() -> {lineages, counts, pairs}
   * counts is a plain object keyed "ab"; pairs lists {a,b,count,edges}.
   * The sum of all counts equals the number of HAS_SIL edges.
   */
  Graph.prototype.lineageMatrix = function () {
    var self = this;
    var counts = Object.create(null);
    var pairMap = new Map();
    var lset = Object.create(null), lineages = [];
    var total = 0;

    this.edges.forEach(function (e) {
      if (e.baseType !== 'HAS_SIL') return;
      var a = choronymOf(self.nodes.get(e.source)) || '?';
      var b = choronymOf(self.nodes.get(e.target)) || '?';
      if (!lset[a]) { lset[a] = 1; lineages.push(a); }
      if (!lset[b]) { lset[b] = 1; lineages.push(b); }
      var k = a + '' + b;
      counts[k] = (counts[k] || 0) + 1;
      var p = pairMap.get(k);
      if (!p) { p = { a: a, b: b, count: 0, edges: [] }; pairMap.set(k, p); }
      p.count++; p.edges.push(e);
      total++;
    });

    lineages.sort();
    var pairs = [];
    pairMap.forEach(function (p) { pairs.push(p); });
    pairs.sort(function (x, y) {
      if (y.count !== x.count) return y.count - x.count;
      return x.a < y.a ? -1 : x.a > y.a ? 1 : (x.b < y.b ? -1 : 1);
    });
    return {
      lineages: lineages,
      counts: counts,
      pairs: pairs,
      total: total,
      get: function (a, b) { return counts[a + '' + b] || 0; }
    };
  };

  /* ----------------------------------------------------------- generations */

  /**
   * Graph.generations() — assigns node.generation. The apex 權幸 (C206438) is
   * generation 1; his descendants get BFS depth over HAS_SON edges. Everyone
   * else gets a longest-path depth from a root of their own HAS_SON component;
   * nodes on a (data-error) cycle stay null.
   */
  Graph.prototype.generations = function () {
    var self = this;
    this.nodes.forEach(function (n) { n.generation = null; });

    // Signed undirected adjacency over ALL kinship edges. For every edge
    // s -> t (HAS_SON*, HAS_SIL) the constraint is generation(t) = generation(s) + 1:
    // a son is one generation below his father, and a son-in-law stands in his
    // wife's generation, i.e. one below her father. Traversing an edge backwards
    // therefore yields generation(s) = generation(t) - 1.
    var adj = new Map();
    this.nodes.forEach(function (n, id) { adj.set(id, []); });
    this.edges.forEach(function (e) {
      if (e.source === e.target) return;
      adj.get(e.source).push({ to: e.target, d: 1 });
      adj.get(e.target).push({ to: e.source, d: -1 });
    });

    var gen = new Map();
    var inconsistent = new Set();

    /* BFS relaxation from one anchor. The BFS order means the value that
       survives for each node is the one carried by the shortest chain of
       constraints back to the anchor; any later, conflicting constraint marks
       the node inconsistent but does not overwrite it. Returns the component
       members in BFS order. */
    function relaxFrom(anchor, value) {
      gen.set(anchor, value);
      var seen = new Set([anchor]);
      var queue = [anchor], head = 0;
      while (head < queue.length) {
        var u = queue[head++];
        var gu = gen.get(u);
        var arcs = adj.get(u) || [];
        for (var i = 0; i < arcs.length; i++) {
          var v = arcs[i].to, want = gu + arcs[i].d;
          if (!seen.has(v)) {
            seen.add(v);
            gen.set(v, want);
            queue.push(v);
          } else if (gen.get(v) !== want) {
            inconsistent.add(v);
          }
        }
      }
      return queue;
    }

    /* Longest descending chain below a node, over out-edges only. */
    function downDepth(start) {
      var seen = new Set([start]), level = [start], depth = 0;
      while (level.length) {
        var next = [];
        for (var i = 0; i < level.length; i++) {
          var oe = self.out.get(level[i]) || [];
          for (var j = 0; j < oe.length; j++) {
            if (seen.has(oe[j].target)) continue;
            seen.add(oe[j].target); next.push(oe[j].target);
          }
        }
        if (next.length) depth++;
        level = next;
      }
      return depth;
    }

    // --- 1. the apex component, anchored on 權幸 = generation 1 -----------
    var apexComponent = this.nodes.has(APEX) ? relaxFrom(APEX, 1) : [];
    var inApex = new Set(apexComponent);

    // --- 2. every other weak component, anchored on its topmost root ------
    var unanchored = 0, isolated = 0;
    var ids = [];
    this.nodes.forEach(function (n, id) { ids.push(id); });
    ids.sort();
    for (var a = 0; a < ids.length; a++) {
      if (gen.has(ids[a])) continue;
      // collect the weak component
      var comp = [], seenC = new Set([ids[a]]), q = [ids[a]], h = 0;
      while (h < q.length) {
        var u2 = q[h++]; comp.push(u2);
        var arcs2 = adj.get(u2) || [];
        for (var i2 = 0; i2 < arcs2.length; i2++) {
          if (seenC.has(arcs2[i2].to)) continue;
          seenC.add(arcs2[i2].to); q.push(arcs2[i2].to);
        }
      }
      if (comp.length === 1) { gen.set(comp[0], 1); isolated++; continue; }
      // topmost root: no in-edges, longest descending chain
      var roots = comp.filter(function (x) { return (self.in.get(x) || []).length === 0; });
      if (!roots.length) roots = [comp[0]];
      var bestRoot = roots[0], bestDepth = -1;
      for (var r = 0; r < roots.length; r++) {
        var d = downDepth(roots[r]);
        if (d > bestDepth) { bestDepth = d; bestRoot = roots[r]; }
      }
      relaxFrom(bestRoot, 1);
      // shift so the component's topmost person really is generation 1
      var mn = null;
      for (var c = 0; c < comp.length; c++) {
        var gv = gen.get(comp[c]);
        if (gv !== undefined && (mn === null || gv < mn)) mn = gv;
      }
      if (mn !== null && mn !== 1) {
        for (var c2 = 0; c2 < comp.length; c2++) {
          if (gen.has(comp[c2])) gen.set(comp[c2], gen.get(comp[c2]) + (1 - mn));
        }
      }
      unanchored++;
    }

    var bfsConflicts = inconsistent.size;
    var conflictIds = new Set(inconsistent);
    var repairedBy = new Map();

    // --- 3. monotone repair: no kinship edge may ever point upwards -------
    // The BFS values place affines on the right swimlane but, where the data
    // over-determines a node, a few edges can still come out flat or inverted.
    // The kin digraph is a DAG, so one pass in topological order enforcing
    // generation(t) >= generation(s) + 1 fixes them. It only ever raises a
    // value, so the apex (which has no in-edges) stays at 1.
    var indeg = new Map();
    this.nodes.forEach(function (n, id) { indeg.set(id, 0); });
    this.edges.forEach(function (e) {
      if (e.source === e.target) return;
      indeg.set(e.target, indeg.get(e.target) + 1);
    });
    var kq = [], topo = [];
    indeg.forEach(function (v, k) { if (v === 0) kq.push(k); });
    while (kq.length) {
      var ku = kq.pop();
      topo.push(ku);
      var koe = self.out.get(ku) || [];
      for (var ki = 0; ki < koe.length; ki++) {
        if (koe[ki].source === koe[ki].target) continue;
        var kv = koe[ki].target;
        indeg.set(kv, indeg.get(kv) - 1);
        if (indeg.get(kv) === 0) kq.push(kv);
      }
    }
    var raised = 0;
    for (var ti = 0; ti < topo.length; ti++) {
      var tid = topo[ti];
      var cur = gen.get(tid);
      if (cur === undefined) continue;
      var ie = this.in.get(tid) || [];
      var best = cur;
      for (var ii = 0; ii < ie.length; ii++) {
        if (ie[ii].source === ie[ii].target) continue;
        var gp = gen.get(ie[ii].source);
        if (gp !== undefined && gp + 1 > best) best = gp + 1;
      }
      if (best !== cur) {
        repairedBy.set(tid, best - cur);
        gen.set(tid, best); inconsistent.add(tid); raised++;
      }
    }

    // --- 4. write back ----------------------------------------------------
    var assigned = 0, maxGen = 0, minGen = null;
    this.nodes.forEach(function (n, id) {
      var g = gen.get(id);
      n.generation = (g === undefined) ? null : g;
      if (n.generation === null) return;
      assigned++;
      if (n.generation > maxGen) maxGen = n.generation;
      if (minGen === null || n.generation < minGen) minGen = n.generation;
    });

    var result = {
      assigned: assigned,
      maxGeneration: maxGen,
      minGeneration: minGen === null ? 0 : minGen,
      inconsistent: inconsistent.size,
      conflicts: bfsConflicts,
      unanchoredComponents: unanchored,
      repaired: raised,
      isolatedNodes: isolated,
      apexComponentSize: apexComponent.length
    };
    this.stats.generationsAssigned = assigned;
    this.stats.maxGeneration = maxGen;
    this.stats.minGeneration = result.minGeneration;
    this.stats.generationsInconsistent = inconsistent.size;
    this.stats.generationsRepaired = raised;
    this.stats.unanchoredComponents = unanchored;
    this.stats.apexComponentSize = apexComponent.length;
    this.generationStats = result;
    this.generationConflicts = conflictIds;
    this.generationRepairs = repairedBy;
    return result;
  };

  /* --------------------------------------------------------- pathsBetween */

  /** Graph.pathsBetween(a, b, {maxLen, limit}) -> [{nodes, edges}] */
  Graph.prototype.pathsBetween = function (a, b, opts) {
    opts = opts || {};
    var maxLen = opts.maxLen === undefined ? 8 : opts.maxLen;
    var limit = opts.limit === undefined ? 500 : opts.limit;
    var undirected = !!opts.undirected;
    var self = this;
    var src = (this.nodes.has(a) ? a : (this.resolve(a)[0] || {}).id);
    var dst = (this.nodes.has(b) ? b : (this.resolve(b)[0] || {}).id);
    if (!src || !dst) return [];

    var res = [];
    var nodes = [src], edges = [], onPath = new Set([src]);

    (function go(u) {
      if (res.length >= limit) return true;
      if (edges.length >= maxLen) return false;
      var arcs = (self.out.get(u) || []).map(function (e) { return { e: e, to: e.target }; });
      if (undirected) {
        (self.in.get(u) || []).forEach(function (e) { arcs.push({ e: e, to: e.source }); });
      }
      for (var i = 0; i < arcs.length; i++) {
        var v = arcs[i].to;
        if (onPath.has(v)) continue;
        nodes.push(v); edges.push(arcs[i].e);
        if (v === dst) {
          res.push({ nodes: nodes.slice(), edges: edges.slice() });
        } else {
          onPath.add(v);
          var stop = go(v);
          onPath.delete(v);
          if (stop) { nodes.pop(); edges.pop(); return true; }
        }
        nodes.pop(); edges.pop();
      }
      return false;
    })(src);

    res.sort(function (x, y) { return x.edges.length - y.edges.length; });
    return res;
  };

  /* ------------------------------------------------------------------ TSV out */

  var NODE_COLS = ['id', 'name', 'hangul', 'roman', 'alt_names', 'choronym',
                   'choronymInferred', 'office', 'generation', 'reference',
                   'vol', 'leaf', 'side', 'notes'];
  var EDGE_COLS = ['source', 'source_name', 'target', 'target_name', 'type',
                   'baseType', 'child_order', 'wife_note', 'vol', 'leaf', 'side',
                   'reference', 'notes'];

  /**
   * Graph.toTSV(subgraphOrRows) -> string
   * - array of plain objects  -> a single TSV table
   * - Subgraph {nodes, edges} -> "# nodes" table, blank line, "# edges" table
   */
  Graph.prototype.toTSV = function (x) {
    var self = this;
    if (!x) return '';
    if (Array.isArray(x)) return rowsToTSV(x);
    if (x.nodes && x.edges) {
      var nrows = x.nodes.map(function (n) {
        return {
          id: n.id, name: n.name, hangul: n.hangul, roman: n.roman,
          alt_names: (n.altNames || []).join('; '),
          choronym: Array.isArray(n.choronym) ? n.choronym.join('; ') : (n.choronym || ''),
          choronymInferred: n.choronymInferred ? 1 : 0,
          office: n.office, generation: n.generation === null ? '' : n.generation,
          reference: n.reference, vol: n.vol, leaf: n.leaf, side: n.side
        };
      });
      var erows = x.edges.map(function (e) {
        var s = self.nodes.get(e.source), t = self.nodes.get(e.target);
        return {
          source: e.source, source_name: s ? s.name : '',
          target: e.target, target_name: t ? t.name : '',
          type: e.type, baseType: e.baseType,
          child_order: e.childOrder === null ? '' : e.childOrder,
          wife_note: e.wifeNote, vol: e.vol, leaf: e.leaf, side: e.side,
          reference: e.reference
        };
      });
      return '# nodes\n' + rowsToTSV(nrows, NODE_COLS) +
             '\n\n# edges\n' + rowsToTSV(erows, EDGE_COLS) + '\n';
    }
    return rowsToTSV([x]);
  };

  /* =========================================================================
     ROUND 2 — (1) patrilateral / matrilateral relinking classification
     =========================================================================

     KINSHIP SEMANTICS OF THIS SOURCE (audit note for historians)
     ------------------------------------------------------------
     The 成化譜 records only men. Two relations are encoded:

       HAS_SON  p -> s   s is p's son.
       HAS_SIL  f -> h   h married a daughter of f (室 = wife). The daughter
                         herself is NOT a node; the edge stands in for her.

     Everything below follows from that asymmetry:

       * Going UP from a man m via a HAS_SON in-edge reaches his FATHER.
         Written F. This is an agnatic (patrilineal) step.
       * Going UP from a man m via a HAS_SIL in-edge reaches his WIFE'S FATHER.
         Written WF. If we arrived at m from one of his sons, that same man is
         the son's MOTHER'S FATHER — hence the reduction FW -> M below, and
         hence the brief's shorthand "M = up via HAS_SIL".
       * Going DOWN from a man m via a HAS_SON out-edge reaches his SON (S).
       * Going DOWN from a man m via a HAS_SIL out-edge reaches his DAUGHTER'S
         HUSBAND. Written DH.

     A relinking loop is walked away from the groom of each marriage edge until
     the bride's father is reached; concatenating the letters above and
     appending D (the bride, that man's daughter) gives a raw kin-type string.
     Reducing it with the standard identities

         FW -> M   (father's wife is mother)
         FD -> Z   FS -> B   MD -> Z   MS -> B
         HD -> D   HS -> S   WD -> D   WS -> S   (a spouse's child is one's own)

     yields White-style notation: MBD, FZD, FBD, MZ, FZ, MMBSD, ...

     Worked example — matrilateral cross-cousin marriage (MBD). Loop
         p -HAS_SON-> h,  X -HAS_SIL-> p,  X -HAS_SON-> B,  B -HAS_SIL-> h
     Walk from the groom h, avoiding the marriage B->h:
         h ->(up HAS_SON) p        letter F   raw "F"
         p ->(up HAS_SIL) X        letter M   raw "F" + "WF"
         X ->(down HAS_SON) B      letter S   raw "FWF" + "S"
         bride = B's daughter                 raw "FWFS" + "D"
         reduce: FWFSD -> MFSD -> MBD.
     X is h's mother's father, B is h's mother's brother, so h married his
     MBD. The ascent letters after the initial F are [M]: matrilateral.

     Worked example — patrilateral cross-cousin marriage (FZD). Loop
         p -HAS_SON-> h,  PF -HAS_SON-> p,  PF -HAS_SIL-> ZH,  ZH -HAS_SIL-> h
     Walk from h: F, F, DH, then D  ->  "FFDHD" -> "FZHD" -> "FZD".
     Ascent letters after the initial F are [F]: patrilateral.

     The lateral label therefore ignores the groom's first step to his own
     father (every ascent starts there) and looks at what happens above it,
     exactly as the brief specifies: "the next step is either p's father
     (patrilateral) or p's father-in-law (matrilateral)".
  */

  var SEP = String.fromCharCode(1);

  var KIN_RULES = [
    ['FW', 'M'], ['FD', 'Z'], ['FS', 'B'],
    ['MD', 'Z'], ['MS', 'B'],
    ['HD', 'D'], ['HS', 'S'],
    ['WD', 'D'], ['WS', 'S']
  ];

  /** Reduce a raw kin string to canonical anthropological notation. */
  function reduceKin(s) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < s.length - 1 && !changed; i++) {
        var pair = s.charAt(i) + s.charAt(i + 1);
        for (var r = 0; r < KIN_RULES.length; r++) {
          if (pair === KIN_RULES[r][0]) {
            s = s.slice(0, i) + KIN_RULES[r][1] + s.slice(i + 2);
            changed = true;
            break;
          }
        }
      }
    }
    return s;
  }

  var UP = { F: 1, M: 1 }, DOWN = { S: 1, D: 1 };
  var FLIP = { F: 'S', S: 'F', M: 'D', D: 'M' };
  var RAW = { F: 'F', M: 'WF', S: 'S', D: 'DH' };

  /**
   * Engine.classifyLoop(loop, graph)
   *   loop  — {nodes:id[], edges:Edge[]} where edges[i] joins nodes[i] and
   *           nodes[(i+1) % n] in either direction (the shape Graph.loops()
   *           produces).
   *   graph — optional; taken from loop.graph when omitted. Only needed for
   *           lineages and generationOffset.
   * -> {type, alliance, marriages:[{edge, side, kinType, steps, monotone,
   *     groom, brideFather, giver, taker}], marriageCount, signature,
   *     lineages, generationOffset}
   */
  function classifyLoop(loop, graph) {
    graph = graph || (loop && loop.graph) || null;
    if (!loop || !loop.nodes || !loop.edges) return null;
    var nodes = loop.nodes, edges = loop.edges, n = nodes.length;
    if (n < 3 || edges.length !== n) return null;

    // step letters, travelling nodes[i] -> nodes[i+1]
    var steps = new Array(n);
    for (var i = 0; i < n; i++) {
      var e = edges[i], a = nodes[i], b = nodes[(i + 1) % n];
      if (!e) return null;
      if (e.source === a && e.target === b) {
        steps[i] = (e.baseType === 'HAS_SIL') ? 'D' : 'S';
      } else if (e.source === b && e.target === a) {
        steps[i] = (e.baseType === 'HAS_SIL') ? 'M' : 'F';
      } else {
        return null; // malformed cycle
      }
    }

    function nodeOf(id) { return graph ? graph.node(id) : null; }
    function chor(id) { return graph ? choronymOf(graph.node(id)) : null; }

    var marriages = [];
    for (var mi = 0; mi < n; mi++) {
      var me = edges[mi];
      if (me.baseType !== 'HAS_SIL') continue;
      var groom = me.target, brideFather = me.source;
      var gi = (nodes[mi] === groom) ? mi : (mi + 1) % n;
      var bi = (gi === mi) ? (mi + 1) % n : mi;

      // walk from the groom AWAY from this marriage edge, to the bride's father
      var letters = [], raw = '';
      var dir = (((gi + 1) % n) === bi) ? -1 : 1;
      var cur = gi;
      for (var guard = 0; guard < n; guard++) {
        var letter;
        if (dir === 1) { letter = steps[cur]; cur = (cur + 1) % n; }
        else { var prev = (cur - 1 + n) % n; letter = FLIP[steps[prev]]; cur = prev; }
        letters.push(letter);
        raw += RAW[letter];
        if (cur === bi) break;
      }

      // lateral side: skip the groom's own step to his father, look above it
      var ups = letters.filter(function (L) { return UP[L]; });
      var tail = (ups.length > 1 && ups[0] === 'F') ? ups.slice(1) : ups;
      var side;
      if (!tail.length) side = 'mixed';
      else if (tail.every(function (L) { return L === 'F'; })) side = 'patri';
      else if (tail.every(function (L) { return L === 'M'; })) side = 'matri';
      else side = 'mixed';

      // kin type only for a clean ascent-then-descent walk
      var monotone = true, sawDown = false;
      for (var li = 0; li < letters.length; li++) {
        if (DOWN[letters[li]]) sawDown = true;
        else if (sawDown) { monotone = false; break; }
      }
      var kinType = monotone ? reduceKin(raw + 'D') : null;

      marriages.push({
        edge: me,
        side: side,
        kinType: kinType,
        steps: letters.join(''),
        monotone: monotone,
        groom: groom,
        brideFather: brideFather,
        giver: chor(brideFather),
        taker: chor(groom)
      });
    }

    // ---- loop-level type -------------------------------------------------
    var dirSet = Object.create(null), exchange = false;
    marriages.forEach(function (m) {
      if (m.giver && m.taker && m.giver !== m.taker) dirSet[m.giver + SEP + m.taker] = 1;
    });
    Object.keys(dirSet).forEach(function (key) {
      var parts = key.split(SEP);
      if (dirSet[parts[1] + SEP + parts[0]]) exchange = true;
    });

    var sides = marriages.map(function (m) { return m.side; });
    var type;
    if (exchange) type = 'exchange';
    else if (sides.length && sides.every(function (s) { return s === 'patri'; })) type = 'patrilateral';
    else if (sides.length && sides.every(function (s) { return s === 'matri'; })) type = 'matrilateral';
    else type = 'bilateral';

    // ---- signature: rotation- and reflection-invariant step string -------
    var fwd = steps.join('');
    var revArr = [];
    for (var ri = n - 1; ri >= 0; ri--) revArr.push(FLIP[steps[ri]]);
    var rev = revArr.join('');
    var best = null;
    [fwd, rev].forEach(function (s) {
      for (var k = 0; k < n; k++) {
        var rot = s.slice(k) + s.slice(0, k);
        if (best === null || rot < best) best = rot;
      }
    });

    // ---- lineages and generational offset --------------------------------
    var lset = Object.create(null), lineages = [];
    for (var ni = 0; ni < n; ni++) {
      var c = chor(nodes[ni]);
      if (c && !lset[c]) { lset[c] = 1; lineages.push(c); }
    }
    lineages.sort();

    var gmin = null, gmax = null;
    marriages.forEach(function (m) {
      var gn = nodeOf(m.groom);
      if (!gn || gn.generation === null || gn.generation === undefined) return;
      if (gmin === null || gn.generation < gmin) gmin = gn.generation;
      if (gmax === null || gn.generation > gmax) gmax = gn.generation;
    });

    return {
      type: type,
      alliance: exchange ? 'exchange' : (marriages.length > 1 ? 'repeated' : 'single'),
      marriages: marriages,
      marriageCount: marriages.length,
      signature: best,
      lineages: lineages,
      generationOffset: (gmin === null) ? null : (gmax - gmin)
    };
  }

  Graph.prototype.classifyLoop = function (loop) { return classifyLoop(loop, this); };

  /**
   * Graph.relinkingCensus({maxLen, limit}) — the loop census tallied by
   * structural type, by White-style kin type, and by lineage pair.
   */
  Graph.prototype.relinkingCensus = function (opts) {
    opts = opts || {};
    var maxLen = opts.maxLen === undefined ? 12 : opts.maxLen;
    var loops = this.loops({
      maxLen: maxLen,
      requireMarriage: opts.requireMarriage === undefined ? true : opts.requireMarriage,
      limit: opts.limit === undefined ? 20000 : opts.limit,
      budgetMs: opts.budgetMs
    });

    var byType = Object.create(null);
    var byKinType = Object.create(null);
    var bySide = Object.create(null);
    var byMarriageCount = Object.create(null);
    var pairMap = new Map();

    loops.forEach(function (L) {
      var c = L.classification;
      if (!c) return;
      byType[c.type] = (byType[c.type] || 0) + 1;
      byMarriageCount[c.marriageCount] = (byMarriageCount[c.marriageCount] || 0) + 1;
      c.marriages.forEach(function (m) {
        bySide[m.side] = (bySide[m.side] || 0) + 1;
        if (m.kinType) byKinType[m.kinType] = (byKinType[m.kinType] || 0) + 1;
      });
      var lin = c.lineages;
      var key = lin.join(SEP);
      var p = pairMap.get(key);
      if (!p) {
        p = {
          lineages: lin.slice(),
          a: lin.length === 2 ? lin[0] : null,
          b: lin.length === 2 ? lin[1] : null,
          count: 0,
          byType: Object.create(null)
        };
        pairMap.set(key, p);
      }
      p.count++;
      p.byType[c.type] = (p.byType[c.type] || 0) + 1;
    });

    var byLineagePair = [];
    pairMap.forEach(function (p) { byLineagePair.push(p); });
    byLineagePair.sort(function (x, y) {
      if (y.count !== x.count) return y.count - x.count;
      return x.lineages.join() < y.lineages.join() ? -1 : 1;
    });

    return {
      byType: byType,
      byKinType: byKinType,
      bySide: bySide,
      byMarriageCount: byMarriageCount,
      byLineagePair: byLineagePair,
      loopCount: loops.length,
      truncated: !!loops.truncated,
      maxLen: maxLen
    };
  };

  /* =========================================================================
     ROUND 2 — (2) P-graph (parenté graph; White & Jorion 1992)
     =========================================================================

     A P-graph inverts the usual convention: NODES are marriages (couples) and
     EDGES are individuals, drawn from the couple a person was born into to the
     couple that person formed. Cycles in a P-graph are exactly relinkings.

     Deriving couples from this source (audit note):
       * Every HAS_SIL edge f -> h IS a marriage: the couple (h, a daughter of
         f). Its identity is the edge itself, so a man with two recorded wives
         yields two couple nodes.
       * A man with no HAS_SIL in-edge has no recorded wife; he becomes a
         singleton node (m, none) so that his sons still have a natal couple.
       * A person's NATAL couple is his father's couple. When the father has
         several recorded wives the source rarely says which one bore whom, so
         we take the union recorded with a wife_note if there is one and
         otherwise the first — the one modelling assumption in the transform,
         flagged as `primaryAssumed` on the node.
       * Son edge: father's couple -> each couple the son formed (or his
         singleton). Daughter edge: her father's couple -> the couple she
         formed. Daughters have no biog_id, so the edge carries a synthetic
         person id "D:<father>:<husband>".
       * Self-referential kin edges (one exists in the source) are dropped.

     Almost every cycle in the resulting P-graph is a relinking. The exception
     is double filiation — a man entered under two fathers, which in a Korean
     genealogy normally records an adoption as heir (繼後) — and such a cycle
     is purely agnatic, passing through no second couple node.
  */

  Graph.prototype.pgraph = function (scope) {
    var self = this;
    var P = null;
    if (scope) {
      if (scope instanceof Set) P = scope;
      else if (Array.isArray(scope)) P = new Set(scope);
      else if (scope.nodes) P = new Set(scope.nodes.map(function (n) { return n.id || n; }));
    }
    function has(id) { return P ? P.has(id) : self.nodes.has(id); }

    var marriagesOf = new Map();
    var sil = [], son = [];
    this.edges.forEach(function (e) {
      // a self-referential kin edge is a transcription error; it cannot be a
      // marriage or a filiation, and it would produce a degenerate couple node
      if (e.source === e.target) return;
      if (!has(e.source) || !has(e.target)) return;
      if (e.baseType === 'HAS_SIL') { sil.push(e); pushMap(marriagesOf, e.target, e); }
      else son.push(e);
    });

    var nodes = [], index = new Map();
    function coupleId(e) { return 'C:' + e.source + ':' + e.target; }
    function singleId(p) { return 'S:' + p; }

    sil.forEach(function (e) {
      var h = self.nodes.get(e.target), f = self.nodes.get(e.source);
      var nd = {
        id: coupleId(e),
        kind: 'couple',
        husband: e.target,
        husbandName: h ? h.name : '',
        wifeFather: e.source,
        wifeFatherName: f ? f.name : '',
        wifeNote: e.wifeNote || '',
        generation: h ? h.generation : null,
        lineages: [choronymOf(h), choronymOf(f)],
        edge: e,
        primaryAssumed: false
      };
      nodes.push(nd); index.set(nd.id, nd);
    });

    var persons = [];
    if (P) P.forEach(function (id) { if (self.nodes.has(id)) persons.push(id); });
    else self.nodes.forEach(function (n, id) { persons.push(id); });
    persons.forEach(function (id) {
      if (marriagesOf.has(id)) return;
      var m = self.nodes.get(id);
      var nd = {
        id: singleId(id),
        kind: 'single',
        husband: id,
        husbandName: m ? m.name : '',
        wifeFather: null,
        wifeFatherName: '',
        wifeNote: '',
        generation: m ? m.generation : null,
        lineages: [choronymOf(m), null],
        edge: null,
        primaryAssumed: false
      };
      nodes.push(nd); index.set(nd.id, nd);
    });

    var primary = new Map();
    persons.forEach(function (id) {
      var ms = marriagesOf.get(id);
      if (!ms || !ms.length) { primary.set(id, singleId(id)); return; }
      var pick = ms[0], assumed = ms.length > 1;
      for (var i = 0; i < ms.length; i++) if (ms[i].wifeNote) { pick = ms[i]; break; }
      primary.set(id, coupleId(pick));
      if (assumed) { var nd2 = index.get(coupleId(pick)); if (nd2) nd2.primaryAssumed = true; }
    });

    var edges = [];
    sil.forEach(function (e) {
      var src = primary.get(e.source);
      if (!src || src === coupleId(e)) return;
      edges.push({
        id: 'p' + edges.length,
        source: src,
        target: coupleId(e),
        person: 'D:' + e.source + ':' + e.target,
        personLabel: '女 (' + ((self.nodes.get(e.source) || {}).name || e.source) + ')',
        sex: 'F',
        type: 'daughter',
        kinEdge: e
      });
    });
    son.forEach(function (e) {
      var src = primary.get(e.source);
      if (!src) return;
      var targets = marriagesOf.get(e.target);
      var list = targets ? targets.map(coupleId) : [singleId(e.target)];
      list.forEach(function (t) {
        if (t === src) return;
        edges.push({
          id: 'p' + edges.length,
          source: src,
          target: t,
          person: e.target,
          personLabel: (self.nodes.get(e.target) || {}).name || e.target,
          sex: 'M',
          type: 'son',
          kinEdge: e
        });
      });
    });

    var sons = 0, daughters = 0;
    edges.forEach(function (x) { if (x.type === 'son') sons++; else daughters++; });

    return {
      nodes: nodes,
      edges: edges,
      index: index,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        couples: sil.length,
        singles: nodes.length - sil.length,
        sons: sons,
        daughters: daughters
      }
    };
  };

  /**
   * Generic undirected simple-cycle enumeration, canonicalised so each cycle is
   * emitted once (lowest-index start, smaller-indexed second node). Only
   * non-bridge edges can lie on a cycle, so the search is confined to the
   * biconnected components holding two or more edges.
   */
  function enumerateCycles(nodeIds, edgeList, opts) {
    opts = opts || {};
    var maxLen = opts.maxLen === undefined ? 12 : opts.maxLen;
    var limit = opts.limit === undefined ? 5000 : opts.limit;
    var deadline = Date.now() + (opts.budgetMs === undefined ? 1500 : opts.budgetMs);

    var comps = biconnectedComponents(nodeIds, edgeList);
    var keepEdges = [], nodeSet = new Set();
    comps.forEach(function (c) {
      if (c.edges.length < 2) return;
      c.edges.forEach(function (e) {
        keepEdges.push(e); nodeSet.add(e.source); nodeSet.add(e.target);
      });
    });

    var order = [];
    nodeSet.forEach(function (id) { order.push(id); });
    order.sort();
    var idx = new Map();
    order.forEach(function (id, i) { idx.set(id, i); });

    var adj = new Map(), pairEdge = new Map();
    order.forEach(function (id) { adj.set(id, []); });
    keepEdges.forEach(function (e) {
      if (e.source === e.target) return;
      var k = idx.get(e.source) < idx.get(e.target)
        ? e.source + SEP + e.target : e.target + SEP + e.source;
      if (pairEdge.has(k)) return;
      pairEdge.set(k, e);
      adj.get(e.source).push(e.target);
      adj.get(e.target).push(e.source);
    });
    order.forEach(function (id) {
      adj.get(id).sort(function (a, b) { return idx.get(a) - idx.get(b); });
    });
    function edgeOf(a, b) {
      return pairEdge.get(idx.get(a) < idx.get(b) ? a + SEP + b : b + SEP + a);
    }

    var out = [], truncated = false, path = [], onPath = new Set(), ticks = 0;

    for (var si = 0; si < order.length && !truncated; si++) {
      if ((adj.get(order[si]) || []).length < 2) continue;
      path.length = 0; path.push(order[si]); onPath.clear(); onPath.add(order[si]);
      if (walk(order[si], si)) truncated = true;
    }

    function walk(s, si) {
      if ((++ticks & 8191) === 0 && Date.now() > deadline) return true;
      var u = path[path.length - 1], nbrs = adj.get(u) || [];
      for (var i = 0; i < nbrs.length; i++) {
        var v = nbrs[i];
        if (v === s) {
          if (path.length >= 3 && idx.get(path[1]) < idx.get(path[path.length - 1])) {
            var cyc = path.slice(), es = [];
            for (var j = 0; j < cyc.length; j++) es.push(edgeOf(cyc[j], cyc[(j + 1) % cyc.length]));
            out.push({ nodes: cyc, edges: es, length: cyc.length });
            if (out.length >= limit) return true;
          }
          continue;
        }
        if (idx.get(v) < si || onPath.has(v) || path.length >= maxLen) continue;
        path.push(v); onPath.add(v);
        var stop = walk(s, si);
        onPath.delete(v); path.pop();
        if (stop) return true;
      }
      return false;
    }

    out.sort(function (a, b) { return a.length - b.length; });
    out.truncated = truncated;
    return out;
  }

  /**
   * Graph.pgraphCycles(scope, {maxLen, limit}) — cycles of the P-graph, i.e.
   * the relinkings themselves, each recording the couples it passes through
   * and the underlying HAS_SIL marriages.
   */
  Graph.prototype.pgraphCycles = function (scope, opts) {
    opts = opts || {};
    var pg = (scope && scope.nodes && scope.index) ? scope : this.pgraph(scope);
    var ids = new Set(pg.nodes.map(function (n) { return n.id; }));
    var cycles = enumerateCycles(ids, pg.edges, {
      maxLen: opts.maxLen === undefined ? 10 : opts.maxLen,
      limit: opts.limit === undefined ? 5000 : opts.limit,
      budgetMs: opts.budgetMs === undefined ? 1500 : opts.budgetMs
    });
    var res = cycles.map(function (c) {
      var couples = [], marriages = [], persons = [], lset = Object.create(null), lineages = [];
      c.nodes.forEach(function (id) {
        var nd = pg.index.get(id);
        if (!nd) return;
        if (nd.kind === 'couple') { couples.push(id); marriages.push(nd.edge); }
        (nd.lineages || []).forEach(function (L) {
          if (L && !lset[L]) { lset[L] = 1; lineages.push(L); }
        });
      });
      c.edges.forEach(function (e) { if (e) persons.push(e.person); });
      lineages.sort();
      return {
        nodes: c.nodes, edges: c.edges, length: c.length,
        couples: couples, marriages: marriages, persons: persons, lineages: lineages
      };
    });
    res.truncated = !!cycles.truncated;
    res.pgraph = pg;
    return res;
  };

  /* =========================================================================
     ROUND 2 — (3) Block model (CONCOR)
     ========================================================================= */

  function pearson(a, b) {
    var n = a.length, sa = 0, sb = 0;
    for (var i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
    var ma = sa / n, mb = sb / n, num = 0, da = 0, db = 0;
    for (var j = 0; j < n; j++) {
      var x = a[j] - ma, y = b[j] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    if (da === 0 || db === 0) return 0;
    var r = num / Math.sqrt(da * db);
    return (r !== r) ? 0 : r;
  }

  /**
   * Correlation matrix of the rows. Rows are centred and scaled to unit norm
   * once, so each pairwise correlation is a single dot product.
   */
  function correlate(rows) {
    var n = rows.length, len = n ? rows[0].length : 0;
    var z = [];
    for (var i = 0; i < n; i++) {
      var src = rows[i], sum = 0;
      for (var p = 0; p < len; p++) sum += src[p];
      var mean = len ? sum / len : 0, ss = 0;
      var v = new Float64Array(len);
      for (var q = 0; q < len; q++) { var x = src[q] - mean; v[q] = x; ss += x * x; }
      if (ss > 0) {
        var inv = 1 / Math.sqrt(ss);
        for (var t = 0; t < len; t++) v[t] *= inv;
      }
      z.push(v);
    }
    var C = [];
    for (var a = 0; a < n; a++) C.push(new Float64Array(n));
    for (var u = 0; u < n; u++) {
      C[u][u] = 1;
      var zu = z[u];
      for (var w = u + 1; w < n; w++) {
        var zw = z[w], dot = 0;
        for (var d = 0; d < len; d++) dot += zu[d] * zw[d];
        if (dot !== dot) dot = 0;
        C[u][w] = dot; C[w][u] = dot;
      }
    }
    return C;
  }

  /** One CONCOR bisection of `members` (indices into the profile matrix). */
  function concorSplit(members, profile, maxIter) {
    if (members.length < 2) return [members, []];
    var rows = members.map(function (m) { return profile[m]; });
    var C = correlate(rows);
    for (var it = 0; it < (maxIter || 15); it++) {
      var next = correlate(C);
      var converged = true;
      for (var i = 0; i < next.length && converged; i++) {
        for (var j = 0; j < next.length; j++) {
          if (Math.abs(Math.abs(next[i][j]) - 1) > 1e-6) { converged = false; break; }
        }
      }
      C = next;
      if (converged) break;
    }
    var A = [], B = [];
    for (var t = 0; t < members.length; t++) (C[t][0] >= 0 ? A : B).push(members[t]);
    if (!A.length || !B.length) {
      A = members.slice(0, Math.ceil(members.length / 2));
      B = members.slice(Math.ceil(members.length / 2));
    }
    return [A, B];
  }

  /**
   * Graph.blockmodel({level, k, minMarriages, method, cap})
   * level 'lineage' (default): units are choronyms with >= minMarriages
   *   HAS_SIL involvements; the relation is directed wife-giving, counted from
   *   the bride's father's lineage to the groom's lineage.
   * level 'person': units are the highest-degree members of the endogamy core
   *   (capped by `cap`, default 200); the relation is undirected kinship.
   * Partitioned by CONCOR (iterated correlation, recursive bisection to k).
   */
  Graph.prototype.blockmodel = function (opts) {
    opts = opts || {};
    var level = opts.level || 'lineage';
    var k = opts.k === undefined ? 4 : opts.k;
    var minMarriages = opts.minMarriages === undefined ? 5 : opts.minMarriages;
    var cap = opts.cap === undefined ? 200 : opts.cap;
    var self = this;

    var units = [], M = [], directed = true;

    if (level === 'person') {
      directed = false;
      var core = this.endogamyCore();
      var deg = new Map();
      core.nodes.forEach(function (id) { deg.set(id, 0); });
      core.edges.forEach(function (e) {
        deg.set(e.source, (deg.get(e.source) || 0) + 1);
        deg.set(e.target, (deg.get(e.target) || 0) + 1);
      });
      units = core.nodes.slice().sort(function (a, b) {
        var d = deg.get(b) - deg.get(a);
        return d !== 0 ? d : (a < b ? -1 : 1);
      }).slice(0, cap);
      var pos = new Map();
      units.forEach(function (id, i) { pos.set(id, i); });
      M = units.map(function () { return new Array(units.length).fill(0); });
      core.edges.forEach(function (e) {
        var i = pos.get(e.source), j = pos.get(e.target);
        if (i === undefined || j === undefined) return;
        M[i][j] = 1; M[j][i] = 1;
      });
    } else {
      var involve = new Map(), tie = new Map();
      this.edges.forEach(function (e) {
        if (e.baseType !== 'HAS_SIL') return;
        var a = choronymOf(self.nodes.get(e.source)), b = choronymOf(self.nodes.get(e.target));
        if (!a || !b) return;
        involve.set(a, (involve.get(a) || 0) + 1);
        involve.set(b, (involve.get(b) || 0) + 1);
        var key = a + SEP + b;
        tie.set(key, (tie.get(key) || 0) + 1);
      });
      involve.forEach(function (v, key) { if (v >= minMarriages) units.push(key); });
      units.sort();
      var posL = new Map();
      units.forEach(function (id, i) { posL.set(id, i); });
      M = units.map(function () { return new Array(units.length).fill(0); });
      tie.forEach(function (v, key) {
        var parts = key.split(SEP);
        var i = posL.get(parts[0]), j = posL.get(parts[1]);
        if (i === undefined || j === undefined) return;
        M[i][j] = v;
      });
    }

    var n = units.length;
    if (!n) {
      return { level: level, method: opts.method || 'concor', k: 0, blocks: [],
               image: [], imageBinary: [], alpha: 0, partition: new Map(),
               matrix: [], order: [], units: [], directed: directed };
    }

    // structural-equivalence profile: rows of [M | M'] (out-ties then in-ties)
    var profile = [];
    for (var i2 = 0; i2 < n; i2++) {
      var row = new Array(2 * n);
      for (var j2 = 0; j2 < n; j2++) { row[j2] = M[i2][j2]; row[n + j2] = M[j2][i2]; }
      profile.push(row);
    }

    var depth = Math.max(0, Math.round(Math.log(k) / Math.log(2)));
    var rootIdx = [];
    for (var g = 0; g < n; g++) rootIdx.push(g);
    var tree = { path: 'B', idx: rootIdx, children: [] };
    var frontier = [tree];
    for (var d = 0; d < depth; d++) {
      var next2 = [];
      frontier.forEach(function (nd) {
        if (nd.idx.length < 2) { next2.push(nd); return; }
        var sp = concorSplit(nd.idx, profile, opts.maxIter || 15);
        if (!sp[0].length || !sp[1].length) { next2.push(nd); return; }
        nd.children = [
          { path: nd.path + '0', idx: sp[0], children: [] },
          { path: nd.path + '1', idx: sp[1], children: [] }
        ];
        next2.push(nd.children[0], nd.children[1]);
      });
      frontier = next2;
    }
    var groups = frontier.map(function (nd) { return nd.idx; })
                         .filter(function (g2) { return g2.length; });
    (function decorateTree(nd) {
      nd.members = nd.idx.map(function (u) { return units[u]; });
      nd.size = nd.idx.length;
      var ties = 0, cells = 0;
      for (var a = 0; a < nd.idx.length; a++) {
        for (var b = 0; b < nd.idx.length; b++) {
          if (a === b) continue;
          ties += M[nd.idx[a]][nd.idx[b]]; cells++;
        }
      }
      nd.density = cells ? ties / cells : 0;
      delete nd.idx;
      nd.children.forEach(decorateTree);
    })(tree);

    var partition = new Map(), order = [];
    var blocks = groups.map(function (grp, bi) {
      grp.forEach(function (u) { partition.set(units[u], bi); order.push(units[u]); });
      return {
        id: bi,
        label: 'B' + (bi + 1),
        members: grp.map(function (u) { return units[u]; }),
        size: grp.length
      };
    });

    var kk = blocks.length;
    var image = [];
    for (var a2 = 0; a2 < kk; a2++) image.push(new Array(kk).fill(0));
    for (var bi2 = 0; bi2 < kk; bi2++) {
      for (var bj = 0; bj < kk; bj++) {
        var sum = 0, cnt = 0;
        var gi2 = groups[bi2], gj = groups[bj];
        for (var u2 = 0; u2 < gi2.length; u2++) {
          for (var v2 = 0; v2 < gj.length; v2++) {
            if (gi2[u2] === gj[v2]) continue;
            sum += M[gi2[u2]][gj[v2]]; cnt++;
          }
        }
        image[bi2][bj] = cnt ? sum / cnt : 0;
      }
    }
    var total = 0, possible = 0;
    for (var x = 0; x < n; x++) for (var y = 0; y < n; y++) if (x !== y) { total += M[x][y]; possible++; }
    var alpha = possible ? total / possible : 0;
    var imageBinary = image.map(function (r) {
      return r.map(function (v) { return (v >= alpha && v > 0) ? 1 : 0; });
    });

    var upos = new Map();
    units.forEach(function (id, i) { upos.set(id, i); });
    var matrix = order.map(function () { return new Array(order.length).fill(0); });
    for (var r2 = 0; r2 < order.length; r2++) {
      for (var c2 = 0; c2 < order.length; c2++) {
        matrix[r2][c2] = M[upos.get(order[r2])][upos.get(order[c2])];
      }
    }

    return {
      level: level,
      method: opts.method || 'concor',
      k: kk,
      blocks: blocks,
      image: image,
      imageBinary: imageBinary,
      alpha: alpha,
      partition: partition,
      matrix: matrix,
      order: order,
      units: units,
      directed: directed,
      // the nested CONCOR split tree that produced the blocks; always present,
      // requested explicitly with {nested:true}
      tree: tree,
      nested: !!opts.nested
    };
  };

  /* =========================================================================
     ROUND 3 — (E2) the apparatus: Graph.audit()
     =========================================================================

     "What the print does not say." Every item is something the 成化譜 leaves
     implicit, something the transcription had to decide, or something the
     import pipeline inferred. None of it changes the graph; it is the critical
     apparatus that lets a historian see where the model is standing on soft
     ground, always with a folio citation (vol / leaf / side) back to the print.
  */

  var REMARRIAGE_NOTE = /(前夫|後夫|初室|前室|中室|後室|先室|三室|第二室|側室|後出|전실)/;
  // graphic variants that are the same surname, and titles that replace one
  var SURNAME_VARIANTS = [['裵', '裴'], ['曺', '曹']];
  var TITLE_RE = /(君|公主|翁主|大王|世宗|太宗|世祖|成宗|朝鮮|王后|王妃|嬪)/;

  function sameSurname(a, b) {
    if (!a || !b) return true;
    var x = a.charAt(0), y = b.charAt(0);
    if (x === y) return true;
    for (var i = 0; i < SURNAME_VARIANTS.length; i++) {
      var v = SURNAME_VARIANTS[i];
      if ((x === v[0] && y === v[1]) || (x === v[1] && y === v[0])) return true;
    }
    return false;
  }
  function isVariantPair(a, b) {
    var x = a.charAt(0), y = b.charAt(0);
    for (var i = 0; i < SURNAME_VARIANTS.length; i++) {
      var v = SURNAME_VARIANTS[i];
      if ((x === v[0] && y === v[1]) || (x === v[1] && y === v[0])) return true;
    }
    return false;
  }

  /**
   * Graph.audit({kinds, limit}) -> {items, counts, bySeverity, kinds}
   * Each item: {kind, severity:'error'|'warning'|'note', message, ids, names,
   *             folio:{vol,leaf,side}, edge?, node?, detail?}
   */
  Graph.prototype.audit = function (opts) {
    opts = opts || {};
    if (!this._auditCache) this._auditCache = buildAudit(this);
    var all = this._auditCache;
    var items = all.items;
    if (opts.kinds && opts.kinds.length) {
      var want = new Set(opts.kinds);
      items = items.filter(function (it) { return want.has(it.kind); });
    }
    if (opts.limit) items = items.slice(0, opts.limit);
    return {
      items: items,
      counts: all.counts,
      bySeverity: all.bySeverity,
      kinds: all.kinds,
      total: all.items.length
    };
  };

  /** Audit items mentioning a person. */
  Graph.prototype.auditForNode = function (id) {
    if (!this._auditCache) this._auditCache = buildAudit(this);
    return (this._auditCache.byNode.get(id) || []).slice();
  };

  /** Audit items attached to one edge (by Edge.id). */
  Graph.prototype.auditForEdge = function (id) {
    if (!this._auditCache) this._auditCache = buildAudit(this);
    return (this._auditCache.byEdge.get(id) || []).slice();
  };

  function buildAudit(g) {
    var items = [];

    function folioOf(x) {
      return { vol: x ? x.vol : null, leaf: x ? x.leaf : null, side: x ? x.side : '' };
    }
    function nm(id) { var n = g.nodes.get(id); return n && n.name ? n.name : id; }

    function addEdge(kind, severity, e, message, detail) {
      items.push({
        kind: kind, severity: severity, message: message,
        ids: [e.source, e.target], names: [nm(e.source), nm(e.target)],
        folio: folioOf(e), edge: e, node: null, detail: detail || null
      });
    }
    function addNode(kind, severity, id, message, detail, extraIds) {
      var n = g.nodes.get(id);
      items.push({
        kind: kind, severity: severity, message: message,
        ids: [id].concat(extraIds || []),
        names: [nm(id)].concat((extraIds || []).map(nm)),
        folio: folioOf(n), edge: null, node: n, detail: detail || null
      });
    }

    // --- 1. HAS_SON edges whose endpoint surnames differ ------------------
    g.edges.forEach(function (e) {
      if (e.baseType !== 'HAS_SON') return;
      var a = g.nodes.get(e.source), b = g.nodes.get(e.target);
      if (!a || !b || !a.name || !b.name) return;
      if (a.name.charAt(0) === b.name.charAt(0)) return;
      var variant = isVariantPair(a.name, b.name);
      var titled = TITLE_RE.test(a.name) || TITLE_RE.test(b.name);
      var severity = (variant || titled) ? 'note' : 'warning';
      var why = variant ? 'graphic variant of the same surname'
        : titled ? 'one name is a royal title rather than a surname'
        : 'father and son are printed under different surnames';
      addEdge('surname-mismatch', severity, e,
        a.name + ' → ' + b.name + ': ' + why + '.', {
          sourceSurname: a.name.charAt(0),
          targetSurname: b.name.charAt(0),
          variant: variant,
          title: titled
        });
    });

    // --- 2. Kwon descent leading out of the Kwon patriline ----------------
    g.edges.forEach(function (e) {
      if (e.baseType !== 'HAS_SON') return;
      var a = choronymOf(g.nodes.get(e.source)), b = choronymOf(g.nodes.get(e.target));
      if (a !== KWON || b === KWON || !b) return;
      addEdge('kwon-descent-to-other-choronym', 'warning', e,
        nm(e.source) + ' (' + KWON + ') is printed as the father of ' + nm(e.target) +
        ' (' + b + '); a son cannot leave his father’s patriline, so this is ' +
        'most likely a marriage (HAS_SIL) recorded as descent.', { targetChoronym: b });
    });

    // --- 3. self-loops -----------------------------------------------------
    g.edges.forEach(function (e) {
      if (e.source !== e.target) return;
      addEdge('self-loop', 'error', e,
        nm(e.source) + ' is recorded as his own ' +
        (e.baseType === 'HAS_SIL' ? 'son-in-law' : 'son') + '.');
    });

    // --- 4. double filiation (adoption as heir, 繼後) ----------------------
    g.nodes.forEach(function (n, id) {
      var fathers = (g.in.get(id) || []).filter(function (e) { return e.baseType === 'HAS_SON'; });
      if (fathers.length < 2) return;
      addNode('double-filiation', 'note', id,
        nm(id) + ' is entered under ' + fathers.length + ' fathers (' +
        fathers.map(function (e) { return nm(e.source); }).join(', ') +
        '); in a Korean genealogy this normally records adoption as heir (繼後).',
        { fathers: fathers.map(function (e) { return e.source; }) },
        fathers.map(function (e) { return e.source; }));
    });

    // --- 5. duplicate rows merged on import -------------------------------
    g.provenance.duplicateNodeRows.forEach(function (id) {
      addNode('duplicate-node-row', 'note', id,
        nm(id) + ' appears on more than one row of the node table; the rows were ' +
        'merged, keeping the first non-empty value of each field.');
    });
    g.provenance.duplicateEdges.forEach(function (e) {
      addEdge('duplicate-edge-row', 'note', e,
        'The relation ' + nm(e.source) + ' → ' + nm(e.target) + ' (' + e.type +
        ') is printed more than once; the duplicate rows were merged into one edge.');
    });

    // --- 6. persons known only from the edge table ------------------------
    g.provenance.edgeOnlyNodes.forEach(function (id) {
      addNode('node-from-edge-table', 'note', id,
        nm(id) + ' has no row in the person table; everything known about him ' +
        'comes from the relation that names him.');
    });

    // --- 7. inferred choronyms --------------------------------------------
    g.nodes.forEach(function (n, id) {
      if (!n.choronymInferred) return;
      var many = Array.isArray(n.choronym);
      addNode('choronym-inferred', many ? 'warning' : 'note', id,
        many
          ? nm(id) + ' has no choronym in the print; the surrounding patriline ' +
            'gives more than one candidate (' + n.choronym.join(', ') +
            '), and the first is used as the primary.'
          : nm(id) + ' has no choronym in the print; it was inferred as ' +
            n.choronym + ' from the surrounding patriline (within five ' +
            'father-son steps).',
        { choronym: n.choronym, ambiguous: many });
    });

    // --- 8. generations raised to keep the diagram monotone ---------------
    if (g.generationRepairs) {
      g.generationRepairs.forEach(function (delta, id) {
        var n = g.nodes.get(id);
        addNode('generation-repair', 'note', id,
          nm(id) + ' was moved down ' + delta + ' generation' + (delta === 1 ? '' : 's') +
          ' (to ' + (n ? n.generation : '?') + ') so that no recorded kin tie ' +
          'points upwards; the print itself gives no generation numbers.',
          { delta: delta, generation: n ? n.generation : null });
      });
    }

    // --- 9. wife notes -----------------------------------------------------
    g.edges.forEach(function (e) {
      if (!e.wifeNote) return;
      var remarriage = REMARRIAGE_NOTE.test(e.wifeNote);
      addEdge('wife-note', 'note', e,
        (remarriage
          ? 'The print qualifies this marriage: '
          : 'The transcriber left an editorial note on this marriage: ') +
        e.wifeNote,
        { note: e.wifeNote, remarriage: remarriage });
    });

    // --- 10. men with more than one recorded wife -------------------------
    g.nodes.forEach(function (n, id) {
      var wives = (g.in.get(id) || []).filter(function (e) { return e.baseType === 'HAS_SIL'; });
      if (wives.length < 2) return;
      addNode('multiple-wives', 'note', id,
        nm(id) + ' has ' + wives.length + ' recorded marriages (fathers-in-law: ' +
        wives.map(function (e) { return nm(e.source); }).join(', ') +
        '); the print rarely says which union bore which child.',
        { wifeFathers: wives.map(function (e) { return e.source; }) },
        wives.map(function (e) { return e.source; }));
    });

    // --- 11. unnamed persons ----------------------------------------------
    g.nodes.forEach(function (n, id) {
      if (n.name) return;
      addNode('unnamed-person', 'warning', id,
        'This person carries no name in either table; only the relation that ' +
        'places him in the genealogy is known.');
    });

    // --- index and tally ---------------------------------------------------
    var KIND_ORDER = [
      'self-loop', 'kwon-descent-to-other-choronym', 'surname-mismatch',
      'unnamed-person', 'choronym-inferred', 'double-filiation', 'multiple-wives',
      'wife-note', 'duplicate-node-row', 'duplicate-edge-row',
      'node-from-edge-table', 'generation-repair'
    ];
    var rank = {};
    KIND_ORDER.forEach(function (k, i) { rank[k] = i; });
    items.sort(function (a, b) {
      var ra = rank[a.kind], rb = rank[b.kind];
      if (ra !== rb) return ra - rb;
      var va = a.folio.vol === null ? 1e9 : a.folio.vol;
      var vb = b.folio.vol === null ? 1e9 : b.folio.vol;
      if (va !== vb) return va - vb;
      var la = a.folio.leaf === null ? 1e9 : a.folio.leaf;
      var lb = b.folio.leaf === null ? 1e9 : b.folio.leaf;
      if (la !== lb) return la - lb;
      if (a.folio.side !== b.folio.side) return a.folio.side < b.folio.side ? -1 : 1;
      return a.ids[0] < b.ids[0] ? -1 : a.ids[0] > b.ids[0] ? 1 : 0;
    });

    var counts = Object.create(null), bySeverity = Object.create(null);
    var byNode = new Map(), byEdge = new Map();
    items.forEach(function (it) {
      counts[it.kind] = (counts[it.kind] || 0) + 1;
      bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1;
      var seenId = Object.create(null);
      it.ids.forEach(function (id) {
        if (seenId[id]) return;
        seenId[id] = 1;
        pushMap(byNode, id, it);
      });
      if (it.edge) pushMap(byEdge, it.edge.id, it);
    });

    return {
      items: items,
      counts: counts,
      bySeverity: bySeverity,
      kinds: KIND_ORDER.filter(function (k) { return counts[k]; }),
      byNode: byNode,
      byEdge: byEdge
    };
  }

  /* =========================================================================
     ROUND 3 — (E3) sub-block structure of the endogamy core
     ========================================================================= */

  /**
   * k-core decomposition of an undirected edge list (Batagelj & Zaversnik
   * linear-time peeling). Returns each node's coreness plus, for each k, the
   * set of nodes surviving in the k-core.
   */
  function kcoreDecomposition(nodeIds, edges) {
    var ids = nodeIds.slice();
    var n = ids.length;
    var pos = new Map();
    ids.forEach(function (id, i) { pos.set(id, i); });

    var adj = [], deg = new Array(n).fill(0);
    for (var a = 0; a < n; a++) adj.push([]);
    edges.forEach(function (e) {
      if (e.source === e.target) return;
      var u = pos.get(e.source), v = pos.get(e.target);
      if (u === undefined || v === undefined) return;
      adj[u].push(v); adj[v].push(u);
      deg[u]++; deg[v]++;
    });

    var maxDeg = 0;
    for (var d0 = 0; d0 < n; d0++) if (deg[d0] > maxDeg) maxDeg = deg[d0];

    // counting sort of the vertices by degree
    var bin = new Array(maxDeg + 2).fill(0);
    for (var b = 0; b < n; b++) bin[deg[b]]++;
    var start = 0;
    for (var dd = 0; dd <= maxDeg; dd++) { var c = bin[dd]; bin[dd] = start; start += c; }
    var order = new Array(n), vpos = new Array(n);
    for (var v0 = 0; v0 < n; v0++) { vpos[v0] = bin[deg[v0]]; order[vpos[v0]] = v0; bin[deg[v0]]++; }
    for (var dz = maxDeg; dz > 0; dz--) bin[dz] = bin[dz - 1];
    bin[0] = 0;

    var core = new Array(n);
    for (var i2 = 0; i2 < n; i2++) {
      var vtx = order[i2];
      core[vtx] = deg[vtx];
      var nb = adj[vtx];
      for (var q = 0; q < nb.length; q++) {
        var u2 = nb[q];
        if (deg[u2] <= deg[vtx]) continue;
        var du = deg[u2], pu = vpos[u2], pw = bin[du], w = order[pw];
        if (u2 !== w) {
          order[pu] = w; vpos[w] = pu;
          order[pw] = u2; vpos[u2] = pw;
        }
        bin[du]++;
        deg[u2]--;
      }
    }

    var coreness = new Map(), maxK = 0;
    for (var r = 0; r < n; r++) {
      coreness.set(ids[r], core[r]);
      if (core[r] > maxK) maxK = core[r];
    }
    var kcores = Object.create(null);
    for (var kk = 1; kk <= maxK; kk++) kcores[kk] = [];
    coreness.forEach(function (cv, id) {
      for (var kk2 = 1; kk2 <= cv; kk2++) kcores[kk2].push(id);
    });
    for (var kk3 = 1; kk3 <= maxK; kk3++) kcores[kk3].sort();
    return { coreness: coreness, kcores: kcores, maxK: maxK };
  }

  /**
   * Graph.coreStructure({depth, cap}) — nested CONCOR splits of the
   * structurally endogamous core, plus its k-core decomposition.
   *
   * The core is the largest bicomponent: everyone who lies on some marital
   * circuit. Splitting it repeatedly by structural equivalence shows whether
   * that core is one dense mass or several sub-groups that marry inside
   * themselves; the k-cores show how deep the nesting goes.
   */
  Graph.prototype.coreStructure = function (opts) {
    opts = opts || {};
    var depth = opts.depth === undefined ? 3 : opts.depth;
    var cap = opts.cap === undefined ? 400 : opts.cap;
    var self = this;
    var core = this.endogamyCore();

    // k-cores over the whole core, not the capped sample
    var kc = kcoreDecomposition(core.nodes, core.edges);

    // capped sample by degree for the CONCOR tree
    var deg = new Map();
    core.nodes.forEach(function (id) { deg.set(id, 0); });
    core.edges.forEach(function (e) {
      deg.set(e.source, (deg.get(e.source) || 0) + 1);
      deg.set(e.target, (deg.get(e.target) || 0) + 1);
    });
    var units = core.nodes.slice().sort(function (a, b) {
      var d = deg.get(b) - deg.get(a);
      return d !== 0 ? d : (a < b ? -1 : 1);
    }).slice(0, cap);
    var pos = new Map();
    units.forEach(function (id, i) { pos.set(id, i); });
    var n = units.length;

    var M = [];
    for (var i = 0; i < n; i++) M.push(new Array(n).fill(0));
    var innerEdges = [];
    core.edges.forEach(function (e) {
      var a = pos.get(e.source), b = pos.get(e.target);
      if (a === undefined || b === undefined || a === b) return;
      M[a][b] = 1; M[b][a] = 1;
      innerEdges.push(e);
    });

    var profile = [];
    for (var r = 0; r < n; r++) {
      var row = new Array(2 * n);
      for (var c = 0; c < n; c++) { row[c] = M[r][c]; row[n + c] = M[c][r]; }
      profile.push(row);
    }

    function densityOf(idxs) {
      if (idxs.length < 2) return 0;
      var ties = 0;
      for (var a = 0; a < idxs.length; a++) {
        for (var b = a + 1; b < idxs.length; b++) if (M[idxs[a]][idxs[b]]) ties++;
      }
      return (2 * ties) / (idxs.length * (idxs.length - 1));
    }
    function lineageProfile(idxs) {
      var m = new Map();
      idxs.forEach(function (ix) {
        var ch = choronymOf(self.nodes.get(units[ix])) || '?';
        m.set(ch, (m.get(ch) || 0) + 1);
      });
      var out = [];
      m.forEach(function (v, k) { out.push({ choronym: k, count: v }); });
      out.sort(function (x, y) { return y.count - x.count; });
      return out;
    }
    function decorate(node) {
      node.members = node.idx.map(function (ix) { return units[ix]; });
      node.size = node.idx.length;
      node.density = densityOf(node.idx);
      node.lineageProfile = lineageProfile(node.idx);
      node.names = node.members.slice(0, 12).map(function (id) {
        var nn = self.nodes.get(id);
        return nn && nn.name ? nn.name : id;
      });
      delete node.idx;
    }

    var all = [];
    for (var z = 0; z < n; z++) all.push(z);
    var root = { path: 'B', idx: all, children: [] };
    var frontier = [root], cuts = [];
    for (var d = 0; d < depth; d++) {
      var next = [];
      for (var f = 0; f < frontier.length; f++) {
        var node = frontier[f];
        if (node.idx.length < 4) { next.push(node); continue; }
        var sp = concorSplit(node.idx, profile, opts.maxIter || 15);
        if (!sp[0].length || !sp[1].length) { next.push(node); continue; }
        var kids = [
          { path: node.path + '0', idx: sp[0], children: [] },
          { path: node.path + '1', idx: sp[1], children: [] }
        ];
        // cut edges between the two siblings
        var setA = new Set(sp[0]), setB = new Set(sp[1]);
        var cutEdges = innerEdges.filter(function (e) {
          var a = pos.get(e.source), b = pos.get(e.target);
          return (setA.has(a) && setB.has(b)) || (setA.has(b) && setB.has(a));
        });
        cuts.push({
          path: node.path,
          a: kids[0].path, b: kids[1].path,
          sizes: [sp[0].length, sp[1].length],
          count: cutEdges.length,
          marriages: cutEdges.filter(function (e) { return e.baseType === 'HAS_SIL'; }).length,
          edges: cutEdges
        });
        node.children = kids;
        next.push(kids[0], kids[1]);
      }
      frontier = next;
    }

    var leaves = frontier.slice();
    (function walk(nd) {
      decorate(nd);
      nd.children.forEach(walk);
    })(root);

    var kdist = {};
    for (var kk2 = 1; kk2 <= kc.maxK; kk2++) kdist[kk2] = kc.kcores[kk2].length;

    return {
      tree: root,
      leaves: leaves,
      cuts: cuts,
      kcores: kc.kcores,
      coreness: kc.coreness,
      maxK: kc.maxK,
      kcoreSizes: kdist,
      units: units,
      stats: {
        coreNodes: core.nodes.length,
        coreEdges: core.edges.length,
        sampled: n,
        depth: depth,
        leafCount: leaves.length,
        maxK: kc.maxK
      }
    };
  };

  /* =========================================================================
     ROUND 3 — (E4) null model for kin-type frequencies
     =========================================================================

     The question a historian actually asks of a relinking census is: is this
     more relinking than you would get by chance, given who was alive when and
     the rule that you may not marry your own surname?

     The null model answers it by re-dealing the marriages. Each HAS_SIL edge
     (bride's father -> groom) is kept, but the fathers are shuffled among the
     grooms WITHIN a generation stratum (a groom of generation g can only be
     given a bride by a father who already gave a daughter to that generation).
     Every father keeps the number of daughters he gave and every groom keeps
     the number of wives he took; descent (HAS_SON) is untouched. Two ties are
     forbidden, mirroring the marriage rules: a man cannot marry his own
     daughter, and he cannot marry a woman of his own choronym (surname
     exogamy, 同姓不婚).
  */

  /** mulberry32 — small deterministic PRNG so runs are reproducible. */
  function makeRng(seed) {
    var a = (seed === undefined || seed === null) ? 0x9e3779b9 : (seed >>> 0);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleInPlace(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /**
   * Re-deal the marriages of `g` and return a new Graph that shares the person
   * objects (so choronyms and generations are untouched) but carries the
   * rewired HAS_SIL edges.
   */
  function rewireMarriages(g, rng) {
    var sil = [], son = [];
    g.edges.forEach(function (e) {
      if (e.source === e.target) return;
      if (e.baseType === 'HAS_SIL') sil.push(e); else son.push(e);
    });

    var strata = new Map();
    sil.forEach(function (e) {
      var t = g.nodes.get(e.target);
      var key = (t && t.generation !== null && t.generation !== undefined)
        ? String(t.generation) : 'x';
      pushMap(strata, key, e);
    });

    var used = new Set();
    function ok(f, h) {
      if (f === h) return false;
      if (used.has(f + SEP + h)) return false;
      var cf = choronymOf(g.nodes.get(f)), ch = choronymOf(g.nodes.get(h));
      if (cf && ch && cf === ch) return false;
      return true;
    }

    var out = [], rejected = 0;
    strata.forEach(function (list) {
      var fathers = list.map(function (e) { return e.source; });
      var grooms = list.map(function (e) { return e.target; });
      shuffleInPlace(fathers, rng);
      for (var i = 0; i < list.length; i++) {
        if (!ok(fathers[i], grooms[i])) {
          var fixed = false;
          for (var tries = 0; tries < 50 && !fixed; tries++) {
            var j = i + 1 + Math.floor(rng() * Math.max(1, fathers.length - i - 1));
            if (j <= i || j >= fathers.length) continue;
            if (ok(fathers[j], grooms[i])) {
              var t = fathers[i]; fathers[i] = fathers[j]; fathers[j] = t;
              fixed = true;
            }
          }
          if (!fixed) rejected++;   // keep the drawn pair; rare
        }
        used.add(fathers[i] + SEP + grooms[i]);
        var tpl = list[i];
        out.push({
          id: fathers[i] + SEP + grooms[i] + SEP + 'HAS_SIL',
          source: fathers[i], target: grooms[i],
          type: 'HAS_SIL', baseType: 'HAS_SIL',
          kwon: false,
          childOrder: tpl.childOrder, wifeNote: tpl.wifeNote,
          vol: tpl.vol, leaf: tpl.leaf, side: tpl.side,
          checked: tpl.checked, reference: tpl.reference
        });
      }
    });

    var edges = son.concat(out);
    var outMap = new Map(), inMap = new Map();
    g.nodes.forEach(function (n, id) { outMap.set(id, []); inMap.set(id, []); });
    edges.forEach(function (e) {
      outMap.get(e.source).push(e);
      inMap.get(e.target).push(e);
    });

    var clone = new Graph({
      nodes: g.nodes,               // shared: generations and choronyms stand
      edges: edges,
      out: outMap,
      in: inMap,
      byName: g.byName,
      byChoronym: g.byChoronym,
      stats: {
        nodeCount: g.nodes.size, edgeCount: edges.length,
        byType: { HAS_SON: son.length, HAS_SIL: out.length },
        rewired: true, rejectedDraws: rejected
      }
    });
    return clone;
  }

  var NULL_TYPES = ['patrilateral', 'matrilateral', 'bilateral', 'exchange'];
  var NULL_SIDES = ['patri', 'matri', 'mixed'];

  /** Extract the comparable statistics from one graph. */
  function nullStats(g, maxLen, keys) {
    var census = g.relinkingCensus({ maxLen: maxLen, limit: 20000, budgetMs: 4000 });
    var lm = g.lineageMatrix();
    var core = g.endogamyCore();
    var s = Object.create(null);

    s['loopCount'] = census.loopCount;
    NULL_TYPES.forEach(function (t) { s['type.' + t] = census.byType[t] || 0; });
    NULL_SIDES.forEach(function (t) { s['side.' + t] = census.bySide[t] || 0; });
    Object.keys(census.byMarriageCount).forEach(function (k) {
      s['marriages.' + k] = census.byMarriageCount[k];
    });
    Object.keys(census.byKinType).forEach(function (k) {
      s['kin.' + k] = census.byKinType[k];
    });
    census.byLineagePair.forEach(function (p) {
      s['pair.' + p.lineages.join(' + ')] = p.count;
    });
    var repeated = 0;
    lm.pairs.forEach(function (p) {
      if (p.count >= 2 && p.a !== '?' && p.b !== '?') repeated++;
    });
    s['repeatedAlliances'] = repeated;
    s['coreSize'] = core.stats.nodeCount;
    s['coreEdges'] = core.stats.edgeCount;
    s['coreMarriages'] = core.stats.marriageEdges;

    if (!keys) return s;
    var picked = Object.create(null);
    keys.forEach(function (k) { picked[k] = s[k] || 0; });
    return picked;
  }

  /** Which statistics are worth reporting, given the observed run. */
  function nullKeys(observed, opts) {
    var keys = ['loopCount'];
    NULL_TYPES.forEach(function (t) { keys.push('type.' + t); });
    NULL_SIDES.forEach(function (t) { keys.push('side.' + t); });
    Object.keys(observed).forEach(function (k) {
      if (k.indexOf('marriages.') === 0) keys.push(k);
    });
    Object.keys(observed).forEach(function (k) {
      if (k.indexOf('kin.') === 0 && observed[k] >= (opts.minKinType || 2)) keys.push(k);
    });
    var pairs = Object.keys(observed).filter(function (k) { return k.indexOf('pair.') === 0; });
    pairs.sort(function (a, b) { return observed[b] - observed[a]; });
    pairs.slice(0, opts.topPairs || 10).forEach(function (k) { keys.push(k); });
    keys.push('repeatedAlliances', 'coreSize', 'coreEdges', 'coreMarriages');
    return keys;
  }

  function summarise(observed, samples, keys) {
    var out = Object.create(null), n = samples.length;
    keys.forEach(function (k) {
      var vals = samples.map(function (s) { return s[k] || 0; });
      var sum = 0;
      for (var i = 0; i < n; i++) sum += vals[i];
      var mean = n ? sum / n : 0;
      var v = 0;
      for (var j = 0; j < n; j++) v += (vals[j] - mean) * (vals[j] - mean);
      var sd = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
      var obs = observed[k] || 0;
      var dev = Math.abs(obs - mean), extreme = 0;
      for (var m = 0; m < n; m++) if (Math.abs(vals[m] - mean) >= dev - 1e-12) extreme++;
      out[k] = {
        key: k,
        observed: obs,
        mean: mean,
        sd: sd,
        z: sd > 0 ? (obs - mean) / sd : null,
        p: n ? (1 + extreme) / (n + 1) : null,
        n: n,
        min: n ? Math.min.apply(null, vals) : null,
        max: n ? Math.max.apply(null, vals) : null
      };
    });
    return out;
  }

  function startNullModel(g, opts) {
    opts = opts || {};
    var permutations = opts.permutations === undefined ? 100 : opts.permutations;
    var maxLen = opts.maxLen === undefined ? 8 : opts.maxLen;
    var seed = opts.seed === undefined ? 20240829 : opts.seed;
    var rng = makeRng(seed);
    var t0 = Date.now();

    var observed = nullStats(g, maxLen, null);
    var keys = nullKeys(observed, opts);
    var samples = [];
    var i = 0;

    return {
      n: permutations,
      get i() { return i; },
      get done() { return i >= permutations; },
      /** Run one permutation. Returns {done, i, n, elapsedMs}. */
      step: function () {
        if (i < permutations) {
          var clone = rewireMarriages(g, rng);
          samples.push(nullStats(clone, maxLen, keys));
          i++;
        }
        return { done: i >= permutations, i: i, n: permutations, elapsedMs: Date.now() - t0 };
      },
      /** Aggregate what has been sampled so far (final once done). */
      result: function () {
        return {
          stats: summarise(observed, samples, keys),
          keys: keys,
          observed: observed,
          permutations: samples.length,
          requested: permutations,
          maxLen: maxLen,
          seed: seed,
          preserve: opts.preserve || 'generation',
          elapsedMs: Date.now() - t0,
          done: i >= permutations
        };
      }
    };
  }

  /**
   * Graph.nullModel(opts) — one-shot; Graph.nullModel.start(opts) — iterator
   * with {step(), result(), i, n, done} so a Web Worker can drive a progress
   * bar. Both are per-instance, so `g.nullModel.start(...)` knows its graph.
   */
  Object.defineProperty(Graph.prototype, 'nullModel', {
    configurable: true,
    get: function () {
      if (!this._nullModelFn) {
        var self = this;
        var fn = function (opts) {
          var run = startNullModel(self, opts);
          while (!run.step().done) { /* run to completion */ }
          return run.result();
        };
        fn.start = function (opts) { return startNullModel(self, opts); };
        Object.defineProperty(this, '_nullModelFn', { value: fn, enumerable: false });
      }
      return this._nullModelFn;
    }
  });

  /** Exposed for tests and for workers that want a single rewired graph. */
  Graph.prototype.rewireMarriages = function (seed) {
    return rewireMarriages(this, makeRng(seed === undefined ? 1 : seed));
  };

  /* ------------------------------------------------------------------ export */

  var Engine = {
    KWON: KWON,
    APEX: APEX,
    loadTSV: loadTSV,
    fold: fold,
    build: build,
    Graph: Graph,
    nfkc: nfkc,
    choronymOf: choronymOf,
    choronymsOf: choronymsOf,
    biconnectedComponents: biconnectedComponents,
    enumerateCycles: enumerateCycles,
    classifyLoop: classifyLoop,
    reduceKin: reduceKin,
    rowsToTSV: rowsToTSV,
    kcoreDecomposition: kcoreDecomposition,
    makeRng: makeRng,
    VERSION: '1.3.0',
    version: '1.3.0'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  root.Relinkings = root.Relinkings || {};
  root.Relinkings.Engine = Engine;

})(typeof globalThis !== 'undefined' ? globalThis
   : (typeof window !== 'undefined' ? window : this));
