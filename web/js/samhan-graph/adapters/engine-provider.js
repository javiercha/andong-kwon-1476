/* samhan-graph — a provider over Relinkings' engine (the edition, Relinkings).
 *
 *   var provider = SamhanGraphEngineProvider.create(G);      // G = Engine.build(...)
 *   SamhanGraphTools.mount(host, { canvas, provider, ... });
 *
 * The engine already answers search, ego networks and induced subgraphs; the
 * paths between figures are found here — every shortest path between each
 * pair of the named men over the undirected kinship graph, the union of the
 * legs, with the context of so many generations up and down if asked, and
 * every edge among the members when in-between connections are wanted.
 */
(function (root) {
  'use strict';

  function create(G, o) {
    o = o || {};
    var adj = new Map();
    G.nodes.forEach(function (n, id) { adj.set(id, []); });
    G.edges.forEach(function (e) {
      if (e.source === e.target) return;
      adj.get(e.source).push({ to: e.target, e: e, dir: 1 });
      adj.get(e.target).push({ to: e.source, e: e, dir: -1 });
    });

    /* All shortest paths from a to b: BFS distances from a, then walk back
       from b along neighbours one step nearer. Returns the set of node ids
       and edge ids on them, or null. */
    function shortestPaths(a, b, maxLen) {
      if (!adj.has(a) || !adj.has(b)) return null;
      var dist = new Map([[a, 0]]), q = [a], h = 0;
      while (h < q.length) {
        var u = q[h++];
        if (u === b) break;
        var d = dist.get(u);
        if (d >= (maxLen || 12)) continue;
        adj.get(u).forEach(function (arc) { if (!dist.has(arc.to)) { dist.set(arc.to, d + 1); q.push(arc.to); } });
      }
      if (!dist.has(b)) return null;
      var nodes = new Set([b]), edges = new Set(), stack = [b], count = 0;
      var paths = 0;
      // count paths by dynamic programming over the DAG of nearer neighbours
      var ways = new Map([[a, 1]]);
      var order = Array.from(dist.entries()).sort(function (x, y) { return x[1] - y[1]; }).map(function (x) { return x[0]; });
      order.forEach(function (v) {
        if (v === a) return;
        var w = 0;
        adj.get(v).forEach(function (arc) { if (dist.has(arc.to) && dist.get(arc.to) === dist.get(v) - 1) w += ways.get(arc.to) || 0; });
        ways.set(v, w);
      });
      paths = ways.get(b) || 1;
      while (stack.length) {
        var v = stack.pop();
        if (v === a) continue;
        adj.get(v).forEach(function (arc) {
          if (dist.has(arc.to) && dist.get(arc.to) === dist.get(v) - 1) {
            edges.add(arc.e.id);
            if (!nodes.has(arc.to)) { nodes.add(arc.to); stack.push(arc.to); }
          }
        });
      }
      return { nodes: nodes, edges: edges, count: paths, length: dist.get(b) };
    }
    function context(ids, up, down) {
      var out = new Set(ids);
      var frontier = Array.from(ids);
      for (var i = 0; i < (up || 0) && frontier.length; i++) {
        var next = [];
        frontier.forEach(function (id) { (G.in.get(id) || []).forEach(function (e) { if (!out.has(e.source)) { out.add(e.source); next.push(e.source); } }); });
        frontier = next;
      }
      frontier = Array.from(ids);
      for (var j = 0; j < (down || 0) && frontier.length; j++) {
        var nxt = [];
        frontier.forEach(function (id) { (G.out.get(id) || []).forEach(function (e) { if (!out.has(e.target)) { out.add(e.target); nxt.push(e.target); } }); });
        frontier = nxt;
      }
      return out;
    }
    function subOf(ids, edgeIds) {
      var nodes = [], edges = [];
      ids.forEach(function (id) { var n = G.node(id); if (n) nodes.push(n); });
      if (edgeIds) {
        var want = edgeIds;
        G.edges.forEach(function (e) { if (want.has(e.id)) edges.push(e); });
      } else edges = G.subgraph(ids).edges;
      return { nodes: nodes, edges: edges };
    }

    return {
      search: function (q, limit) {
        return G.search(q, { limit: limit || 12 }).map(function (n) {
          return { id: n.id, name: n.name, roman: n.roman, hangul: n.hangul, choronym: n.choronym, office: n.office,
                   sub: n.vol ? 'vol. ' + n.vol + ' · ' + n.leaf + n.side : n.id };
        });
      },
      resolve: function (q) {
        var s = String(q || '').trim();
        if (G.node(s)) return [s];
        var hits = G.search(s, { limit: 0 });
        var exact = hits.filter(function (n) { return n.name === s || n.hangul === s || (n.roman && n.roman.toLowerCase() === s.toLowerCase()) || (n.altNames || []).indexOf(s) >= 0; });
        if (exact.length) return exact.map(function (n) { return n.id; });
        return hits.map(function (n) { return n.id; });
      },
      node: function (id) { return G.node(id); },
      genealogy: function (id, up, down, opts) {
        return G.egoNetwork({ starts: [id], ancestorDepth: up, descendantDepth: down, prune: 'none' });
      },
      paths: function (ids, opts) {
        var nodes = new Set(), edges = new Set(), count = 0;
        for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
          var r = shortestPaths(ids[i], ids[j], 14);
          if (!r) continue;
          r.nodes.forEach(function (x) { nodes.add(x); }); r.edges.forEach(function (x) { edges.add(x); }); count += r.count;
        }
        if (!nodes.size) return null;
        var members = nodes;
        if (opts && (opts.ancestors || opts.descendants)) members = context(nodes, opts.ancestors, opts.descendants);
        var sub = (opts && opts.inBetween === false) ? subOf(members, edges) : subOf(members);
        return { nodes: sub.nodes, edges: sub.edges, terminalIds: ids.filter(function (id) { return G.node(id); }), pathCount: count };
      },
      neighbors: function (id) {
        var parents = [], children = [];
        (G.in.get(id) || []).forEach(function (e) { var n = G.node(e.source); if (n && parents.indexOf(n) < 0) parents.push(n); });
        (G.out.get(id) || []).forEach(function (e) { var n = G.node(e.target); if (n && children.indexOf(n) < 0) children.push(n); });
        return { parents: parents, children: children };
      },
      edgesAmong: function (ids) { return G.subgraph(ids).edges; },
      rows: function (nodes, edges) {
        return {
          nodes: nodes.map(function (n) {
            return { biog_id: n.id, 'x姓名': n.name, '성명': n.hangul, name: n.roman, alt_name: (n.altNames || []).join('; '),
                     '姓貫': Array.isArray(n.choronym) ? n.choronym.join('; ') : (n.choronym || ''), choronym_inferred: n.choronymInferred ? 1 : '',
                     office: n.office, generation: n.generation, vol: n.vol, page: n.leaf, side: n.side, notes: n.notes };
          }),
          edges: edges.map(function (e) {
            return { source: e.source, target: e.target, type: e.baseType, child_order: e.childOrder, wife_note: e.wifeNote,
                     vol: e.vol, leaf: e.leaf, side: e.side, checked: e.checked, notes: e.notes };
          })
        };
      }
    };
  }

  var SamhanGraphEngineProvider = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = SamhanGraphEngineProvider;
  root.SamhanGraphEngineProvider = SamhanGraphEngineProvider;
})(typeof window !== 'undefined' ? window : this);
