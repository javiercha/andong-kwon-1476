/* samhan-graph — Sebo: the provider, and the SeboGraph facade.
 *
 * Load after data.js, detail.js and table.js and INSTEAD of js/graph.js and
 * js/export.js:
 *
 *   <script src="js/samhan-graph/samhan-graph.js"></script>
 *   <script src="js/samhan-graph/samhan-graph-export.js"></script>
 *   <script src="js/samhan-graph/samhan-graph-tools.js"></script>
 *   <script src="js/samhan-graph/adapters/sebo-provider.js"></script>
 *
 * with #graph-sidebar-controls left EMPTY in index.html (the tools render into
 * it). Everything else in Sebo that talks to the graph — app.js, table.js,
 * detail.js, identity.js — keeps calling window.SeboGraph by the names it
 * always used: nodes, edges, styles, selectedNode, init, render, updateData,
 * updateStyles, fitToContent, showBranch, selectEdge, positionFloatingActionPill,
 * onThemeChanged, getSVGElement, highlightNode, _legendEdgeGlyph. Those are
 * the facade at the foot of this file, each a line or two onto the module.
 *
 * What stays Sebo's: the merge bar that rises when two figures are selected
 * (a write to the corpus, so it is not in the module), the detail drawer, the
 * table's scope and selection, the status bar, and the place the reader was.
 */
(function () {
  'use strict';
  if (!window.SamhanGraph || !window.SamhanGraphTools) throw new Error('sebo-provider: load samhan-graph.js and samhan-graph-tools.js first');

  function hanjaOf(n) {
    if (!n) return '';
    if (window.SeboData && typeof window.SeboData.hanjaName === 'function') return window.SeboData.hanjaName(n) || '';
    return n.name_hj || n['姓名'] || n.name || '';
  }
  function isGhostRec(n) {
    if (!n) return false;
    var gh = n.isGhost || n.is_ghost;
    if (gh === true || gh === 1 || gh === 'true' || gh === 'True' || gh === '1') return true;
    var notes = (n.notes || '').toLowerCase();
    if (notes.indexOf('ghost node') >= 0 || notes.indexOf('ghost') >= 0) return true;
    var name = hanjaOf(n);
    if (/之父|之祖|之曾祖|之高祖|之兄|之弟|之子|之孫|之婿|之壻|\[미상\]|\[불명\]|\(실전\)|\(소전\)|\(실계\)|\(실록\)|\[unknown\]|^ghost/i.test(name)) return true;
    return /^ghost_|_G\d+$/i.test(n.ID || '');
  }
  function choronymsOf(n) {
    var out = [];
    ['choronym', 'choronym2', 'choronym3', 'choronym4'].forEach(function (k) {
      if (n[k]) String(n[k]).split(/[,;/]+/).forEach(function (p) { p = p.trim(); if (p && out.indexOf(p) < 0) out.push(p); });
    });
    return out;
  }

  /* A Sebo record → the module's node, keeping every Sebo field (table.js,
     detail.js and the merge bar read ID, name_MR, _corpus and the rest). */
  function toNode(rec) {
    var n = Object.assign({}, rec);
    n.id = rec.ID;
    n.name = hanjaOf(rec);
    n.roman = rec.name_MR || '';
    n.hangul = rec.name_hg || '';
    var ch = choronymsOf(rec);
    n.choronym = ch.length ? (ch.length === 1 ? ch[0] : ch) : (rec._inferredChoronym ? String(rec._inferredChoronym).trim() : null);
    n.choronymInferred = !ch.length && !!rec._inferredChoronym;
    n.isGhost = isGhostRec(rec);
    n.born = rec.birth_year || rec.born || ''; n.died = rec.death_year || rec.died || '';
    n.office = rec.office || '';
    n.altNames = rec.alt_names_list || (rec.alt_name ? String(rec.alt_name).split(/\s*[;|]\s*/) : []);
    n.notes = rec.notes || '';
    return n;
  }
  function toEdge(e) {
    var x = Object.assign({}, e);
    x.id = e._edgeKey || (e.source_id + '|' + e.target_id + '|' + e.relationship);
    x.source = e.source_id; x.target = e.target_id;
    x.baseType = e.relationship; x.type = e.relationship;
    x.childOrder = e.child_order;
    x.evidence = [e.source, e.source_kr].filter(function (s) { return typeof s === 'string'; }).join(' ');
    x.notes = e.notes || '';
    return x;
  }
  function toSub(nodes, edges) {
    var recs = nodes.map(function (n) { return Object.assign({}, n); });
    if (window.SeboData && typeof window.SeboData.inferChoronyms === 'function') {
      try { window.SeboData.inferChoronyms(recs, edges); } catch (e) { /* inference is a courtesy */ }
    }
    var ids = new Set(recs.map(function (n) { return n.ID; }));
    var seen = new Set(), es = [];
    (edges || []).forEach(function (e) {
      if (e._deleted || !ids.has(e.source_id) || !ids.has(e.target_id)) return;
      var x = toEdge(e);
      if (seen.has(x.id)) return;
      seen.add(x.id); es.push(x);
    });
    return { nodes: recs.map(toNode), edges: es };
  }
  function activeNodes() { return window.SeboData && window.SeboData.getActiveNodes ? window.SeboData.getActiveNodes() : []; }
  function activeEdges() { return window.SeboData && window.SeboData.getActiveEdges ? window.SeboData.getActiveEdges() : []; }

  /* ── the provider ── */
  var provider = {
    search: function (q, limit) {
      var s = String(q || '').trim(), fold = window.SeboData && window.SeboData.foldForSearch ? window.SeboData.foldForSearch : function (v) { return String(v || '').toLowerCase(); };
      var fq = fold(s), out = [], all = activeNodes();
      for (var i = 0; i < all.length && out.length < (limit || 12); i++) {
        var n = all[i], hj = hanjaOf(n);
        var hit = hj.indexOf(s) >= 0 || (n.name_hg && n.name_hg.indexOf(s) >= 0) || (n.name_MR && fold(n.name_MR).indexOf(fq) >= 0) ||
                  n.ID === s || (n.alt_name && String(n.alt_name).indexOf(s) >= 0) || (n.courtesy_name && String(n.courtesy_name).indexOf(s) >= 0);
        if (hit) out.push({ id: n.ID, name: hj, roman: n.name_MR, hangul: n.name_hg, choronym: n.choronym, sub: n._corpus + ' · ' + n.ID });
      }
      return out;
    },
    resolve: function (q) {
      var ids = window.SeboData && window.SeboData.resolveNodeIds ? window.SeboData.resolveNodeIds(q) : [];
      var id = String(q || '').trim();
      if (/^SEBO_E\d+$/i.test(id)) {
        return fetch('/api/identity/entities').then(function (r) { return r.ok ? r.json() : { entities: [] }; }).then(function (d) {
          var e = (d.entities || []).filter(function (x) { return String(x.entity_id || '').toUpperCase() === id.toUpperCase(); })[0];
          if (!e) { if (window.showToast) window.showToast('No entity ' + id.toUpperCase() + ' in the registry — derive it in Identity → ⛓ Entities.', 'warning', 6000); return []; }
          var best = e.best_record || (e.records && e.records[0] && (e.records[0].id || e.records[0])) || e.id;
          return best ? [best] : [];
        }).catch(function () { return []; });
      }
      return ids;
    },
    node: function (id) {
      var rec = activeNodes().filter(function (n) { return n.ID === id; })[0];
      return rec ? toNode(rec) : null;
    },
    genealogy: function (id, up, down, o) {
      return Promise.resolve(window.SeboData.getGenealogy(id, up, down, o || {})).then(function (d) {
        if (!d || !d.nodes) return null;
        return toSub(d.nodes, d.edges);
      });
    },
    paths: function (ids, o) {
      return Promise.resolve(window.SeboData.findMultiPath(ids, {
        includeInBetween: o.inBetween, inBetween: o.inBetween, ancestorDepth: o.ancestors, descendantDepth: o.descendants, ancestors: o.ancestors, descendants: o.descendants
      })).then(function (d) {
        if (!d || !d.nodes || !d.nodes.length) return null;
        var sub = toSub(d.nodes, d.edges);
        return { nodes: sub.nodes, edges: sub.edges, terminalIds: d.terminalIds || [d.sourceId, d.targetId].filter(Boolean), pathCount: d.pathCount || 1 };
      });
    },
    neighbors: function (id) {
      var byId = new Map(activeNodes().map(function (n) { return [n.ID, n]; }));
      var parents = [], children = [], ps = new Set(), cs = new Set();
      activeEdges().forEach(function (e) {
        if (e._deleted) return;
        if (e.target_id === id && byId.has(e.source_id) && !ps.has(e.source_id)) { ps.add(e.source_id); parents.push(toNode(byId.get(e.source_id))); }
        if (e.source_id === id && byId.has(e.target_id) && !cs.has(e.target_id)) { cs.add(e.target_id); children.push(toNode(byId.get(e.target_id))); }
      });
      return { parents: parents, children: children };
    },
    edgesAmong: function (ids) {
      var set = new Set(ids), seen = new Set(), out = [];
      activeEdges().forEach(function (e) {
        if (e._deleted || !set.has(e.source_id) || !set.has(e.target_id)) return;
        var x = toEdge(e);
        if (seen.has(x.id)) return;
        seen.add(x.id); out.push(x);
      });
      return out;
    },
    rows: function (nodes, edges) {
      return {
        nodes: nodes.map(function (n) {
          return { ID: n.ID || n.id, '姓名': n.name, name: n.roman, '성명': n.hangul, '姓貫': Array.isArray(n.choronym) ? n.choronym.join('; ') : (n.choronym || ''),
                   '字': n.courtesy_name || n['字'] || '', '號': n.art_name || n['號'] || '', '諡號': n.posthumous_name || n['諡號'] || '', alt_names: Array.isArray(n.altNames) ? n.altNames.join('; ') : (n.alt_names || ''),
                   born: n.born, died: n.died, generation: n._gen, corpus: n._corpus, document_id: n.document_id, is_inspected: n.is_inspected || '', notes: n.notes };
        }),
        edges: edges.map(function (e) {
          return { source_id: e.source, source_name: e.source_name, target_id: e.target, target_name: e.target_name, relationship: e.baseType,
                   child_order: e.child_order || '', document_id: e.document_id, corpus: e._corpus, is_inspected: e.is_inspected || '', source: e.source_text || e.source_kr ? '' : '', notes: e.notes };
        })
      };
    }
  };

  /* ── the facade ── */
  var canvas = null, tools = null, mergeBar = null;

  function toast(m, kind) { if (window.showToast) window.showToast(m, kind === 'floor' || kind === 'redraw' ? 'info' : (kind || 'info')); }
  function statusSelection(html) { var el = document.getElementById('status-selection'); if (el) el.innerHTML = html; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function renderMergeBar(ids) {
    if (mergeBar) { mergeBar.remove(); mergeBar = null; }
    if (ids.length !== 2) return;
    var n1 = canvas.node(ids[0]), n2 = canvas.node(ids[1]);
    var name1 = n1 ? (n1.roman || n1.name || n1.id) : ids[0], name2 = n2 ? (n2.roman || n2.name || n2.id) : ids[1];
    mergeBar = document.createElement('div');
    mergeBar.id = 'multi-select-merge-bar';
    mergeBar.className = 'graph-merge-bar';
    mergeBar.innerHTML = '<span>🤝 Merge: <strong>' + esc(name1) + '</strong> ← <strong>' + esc(name2) + '</strong></span>' +
      '<button type="button" class="merge-go" id="btn-graph-merge">Merge</button><button type="button" class="merge-swap" id="btn-graph-swap">⇄ Swap</button>' +
      '<button type="button" class="merge-x" id="btn-graph-cancel-multi" aria-label="Cancel">✕</button>';
    document.body.appendChild(mergeBar);
    mergeBar.querySelector('#btn-graph-merge').onclick = function () {
      if (window.SeboData && typeof window.SeboData.applyNodeMerge === 'function') {
        window.SeboData.applyNodeMerge(ids[0], ids[1], 'Manual graph merge', '', '', true);
        canvas.select(null);
        SeboGraph.updateData();
        if (window.SeboTable && window.SeboTable.updateAllBadges) window.SeboTable.updateAllBadges();
        toast('Merged ' + ids[1] + ' → ' + ids[0], 'success');
      }
    };
    mergeBar.querySelector('#btn-graph-swap').onclick = function () { canvas.select(null); canvas.toggleSelect(ids[1]); canvas.toggleSelect(ids[0]); };
    mergeBar.querySelector('#btn-graph-cancel-multi').onclick = function () { canvas.select(null); };
  }

  var SeboGraph = {
    get nodes() { return canvas ? canvas.data().nodes : []; },
    get edges() { return canvas ? canvas.data().edges : []; },
    get styles() { return canvas ? canvas.options() : {}; },
    get selectedNode() { return canvas ? canvas.selected() : null; },
    set selectedNode(id) { if (canvas) canvas.select(id || null); },
    get rootId() { return canvas ? canvas.roles().root : null; },
    canvas: function () { return canvas; },
    tools: function () { return tools; },
    provider: provider,

    init: function () {
      var container = document.getElementById('graph-container');
      if (!container || typeof d3 === 'undefined') { console.warn('SeboGraph: no #graph-container or no d3; graph disabled.'); return; }
      canvas = window.SamhanGraph.create(container, {
        legend: document.getElementById('graph-legend'),
        tooltip: document.getElementById('graph-tooltip') || undefined,
        onToast: toast, homeLineage: '', rows: 'local', handDrawn: true, fitMin: 0,   // Sebo's fit has never had a floor
        legendCaption: 'Each line is a relationship <em>between two people</em>; the arrow points from the earlier figure to the later one.',
        options: { labels: ['roman', 'hanja', 'dates'], labelSize: 12, edgeOpacity: 0.75, showBirthOrder: true },
        scheme: (function () { try { var s = localStorage.getItem('sebo_graph_scheme'); return s === 'samhan' ? 'default' : (s || 'default'); } catch (e) { return 'default'; } })()
      });
      canvas.on('scheme', function (s) { try { localStorage.setItem('sebo_graph_scheme', s); } catch (e) {} });
      var host = document.getElementById('graph-sidebar-controls');
      if (host) {
        tools = window.SamhanGraphTools.mount(host, {
          canvas: canvas, provider: provider, export: window.SamhanGraphExport, label: 'sebo_kinship_graph', toast: toast,
          onDraw: function (sub, meta) {
            if (window.SeboTable && window.SeboTable.refresh) window.SeboTable.refresh();
            if (!sub) { statusSelection('No selection'); return; }
            if (meta.kind === 'lineage') {
              window.SeboApp && window.SeboApp.rememberPlace && window.SeboApp.rememberPlace({ graph: { branch: meta.root, up: meta.up, down: meta.down, options: meta.options, input: tools ? tools.input() : '' } });
            } else if (meta.kind === 'paths') {
              var names = (meta.terminalIds || []).map(function (id) { var n = canvas.node(id); return n ? (n.name + ' (' + n.id + ')') : id; });
              statusSelection('Found <strong>' + (meta.pathCount > 1 ? meta.pathCount + ' Kinship Paths' : 'Kinship Path') + '</strong> connecting <strong>' + names.map(esc).join(' ➔ ') + '</strong> (' + sub.nodes.length + ' figures, ' + sub.edges.length + ' connections)');
            }
          }
        });
      }
      canvas.on('select', function (n) {
        var panel = document.getElementById('detail-content');
        if (window.SeboTable) {
          window.SeboTable.selectedRowId = n ? n.id : null;
          if (window.SeboTable.currentTab === 'nodes' && window.SeboTable.highlightSelectedRow) window.SeboTable.highlightSelectedRow();
        }
        if (n) {
          if (panel && window.SeboDetail) window.SeboDetail.renderNode(panel, n, true);
          statusSelection('Selected: <strong>' + esc(n.name) + '</strong> ' + (n.roman ? esc(n.roman) + ' ' : '') + '(' + esc(n.hangul || '') + ')');
          if (window.updateStatusBar) window.updateStatusBar('👤 Selected Figure: ' + n.name + ' ' + (n.roman || '') + ' (' + (n.hangul || '') + ') | ' + (n.choronym || 'No clan') + ' | ' + n.id, 'info');
        } else {
          if (panel) panel.innerHTML = '<div class="detail-empty">Select a figure or kinship connection to view source verification details</div>';
          statusSelection('No selection');
        }
      });
      canvas.on('multiselect', renderMergeBar);
      canvas.on('edge', function (e) {
        if (window.SeboTable) {
          window.SeboTable.selectedRowId = e._edgeKey || e.id;
          if (window.SeboTable.currentTab === 'edges' && window.SeboTable.highlightSelectedRow) window.SeboTable.highlightSelectedRow();
        }
        var panel = document.getElementById('detail-content');
        if (panel && window.SeboDetail) window.SeboDetail.renderEdge(panel, e, true);
        var s = canvas.node(e.source), t = canvas.node(e.target);
        var u = e.source_name || (s && s.name) || e.source, v = e.target_name || (t && t.name) || e.target;
        statusSelection('Selected: <strong>' + esc(u) + ' ➔ ' + esc(v) + '</strong> (' + esc(e.baseType) + ')');
        if (window.updateStatusBar) window.updateStatusBar('🔗 Selected Kinship: ' + u + ' ➔ ' + v + ' (' + e.baseType + ')', 'info');
      });
      if (window.SeboDismiss && window.SeboDismiss.register) {
        var isNodeClick = function (t) { return !!(t && t.closest && (t.closest('.node') || t.closest('.floating-node-actions'))); };
        window.SeboDismiss.register('#multi-select-merge-bar', { anchor: isNodeClick, close: function () { canvas.select(null); } });
      }
      // a way back to the Tools from the canvas on a narrow screen, as before
      var floatBar = document.querySelector('#graph-view .canvas-floating-toolbar');
      if (floatBar && !document.getElementById('btn-float-tools')) {
        var b = document.createElement('button');
        b.type = 'button'; b.id = 'btn-float-tools'; b.className = 'canvas-float-btn canvas-float-tools'; b.title = 'Show the Tools sidebar';
        b.innerHTML = '<span aria-hidden="true">🛠️</span>';
        b.addEventListener('click', function () { var hook = document.getElementById('btn-toggle-tools'); if (hook) hook.click(); });
        floatBar.insertBefore(b, floatBar.firstChild);
      }
      ['btn-float-redraw', 'btn-float-fit', 'btn-float-zoom-in', 'btn-float-zoom-out'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', function () {
          if (id === 'btn-float-redraw') canvas.redrawAnnounced();
          else if (id === 'btn-float-fit') canvas.fit();
          else if (id === 'btn-float-zoom-in') canvas.zoomBy(1.3);
          else canvas.zoomBy(0.75);
        });
      });
    },

    /* Sebo-shaped nodes and edges in, as showMultiPath and updateData always passed them. */
    render: function (nodes, edges, rootId) {
      if (!canvas) return;
      var sub = toSub(nodes || [], edges || []);
      var starts = nodes.filter(function (n) { return n.isPathSource; }).map(function (n) { return n.ID; });
      var targets = nodes.filter(function (n) { return n.isPathTarget; }).map(function (n) { return n.ID; });
      var ways = nodes.filter(function (n) { return n.isPathWaypoint; }).map(function (n) { return n.ID; });
      canvas.setData(sub, { roles: { root: rootId || null, starts: starts, waypoints: ways, targets: targets }, anchorId: rootId || starts[0] || null });
      if (window.SeboTable && window.SeboTable.refresh) window.SeboTable.refresh();
    },
    updateData: function () {
      if (!canvas) return;
      var d = canvas.data();
      if (!d.nodes.length) return;
      var active = new Map(activeNodes().map(function (n) { return [n.ID, n]; }));
      var corpora = (window.SeboData && window.SeboData.corpora) || {};
      var resolveId = function (id) {
        var seen = new Set();
        while (id && !active.has(id) && !seen.has(id)) {
          seen.add(id);
          var next = null;
          for (var key in corpora) { var rec = (corpora[key].nodes || []).filter(function (n) { return n.ID === id; })[0]; if (rec) { next = rec._mergedInto || null; break; } }
          if (!next) return null;
          id = next;
        }
        return id && active.has(id) ? id : null;
      };
      var ids = new Set();
      d.nodes.forEach(function (n) { var r = resolveId(n.id); if (r) ids.add(r); });
      if (!ids.size) { canvas.clear(); return; }
      var roles = canvas.roles();
      var nodes = Array.from(ids).map(function (id) { return active.get(id); });
      var edges = activeEdges().filter(function (e) { return ids.has(e.source_id) && ids.has(e.target_id); });
      var root = ids.has(roles.root) ? roles.root : (resolveId(roles.root) || nodes[0].ID);
      var sub = toSub(nodes, edges);
      canvas.setData(sub, { roles: Object.assign({}, roles, { root: root }), anchorId: root });
    },
    updateStyles: function () { if (canvas) canvas.repaint(); },
    fitToContent: function () { if (canvas) canvas.fit(); },
    showBranch: function (id, up, down, options) {
      if (!tools) return Promise.resolve(null);
      return tools.resolve(id).then(function (rid) {
        if (!rid) return null;
        var n = provider.node(rid);
        if (n && !tools.input()) tools.setInput((n.roman || n.hangul || n.name || n.id) + (n.name && n.roman ? ' (' + n.name + ')' : '') + ' (' + n.id + ')');
        return tools.explore(rid, up === undefined ? 3 : up, down === undefined ? 3 : down, options || { includeCollateral: true });
      });
    },
    showPath: function (a, b, options) { return tools ? tools.findPaths([a, b], options) : null; },
    showMultiPath: function (ids, options) { return tools ? tools.findPaths(ids, options) : null; },
    selectEdge: function (e) { if (canvas) canvas.selectEdge(e.id ? e : Object.assign({}, e, { id: e._edgeKey, source: e.source_id, target: e.target_id, baseType: e.relationship })); },
    positionFloatingActionPill: function () { if (canvas) canvas.repositionActions(); },
    onThemeChanged: function () { /* the canvas listens to samhan-theme itself */ },
    getSVGElement: function () { return canvas ? canvas.svgNode() : null; },
    highlightNode: function (id) { if (!canvas) return; canvas.select(id); canvas.centerOn(id, 1); },
    clearGraph: function () { if (canvas) canvas.clear(); },
    redrawGraph: function () { if (canvas) canvas.redrawAnnounced(); },
    toggleParents: function (id) { if (tools) tools.toggleKin(id, 'parents'); },
    toggleChildren: function (id) { if (tools) tools.toggleKin(id, 'children'); },
    hideNode: function (id) { if (tools) tools.hide(id); },
    expandAllSubgraphs: function (id) { if (tools) tools.expandAll(id); },
    isGhostNode: isGhostRec,
    _legendEdgeGlyph: function (style, color, width) { return window.SamhanGraph.legendGlyph(style, color, width); }
  };
  window.SeboGraph = SeboGraph;

  /* export.js used to bind the buttons itself; the tools do now. Kept so a
     caller of SeboExport does not break. */
  window.SeboExport = window.SeboExport || {
    init: function () {},
    exportSVG: function () { if (canvas) window.SamhanGraphExport.svg(canvas, { label: 'sebo_kinship_graph' }); },
    exportPNG: function (scale) { if (canvas) window.SamhanGraphExport.png(canvas, { label: 'sebo_kinship_graph', scale: scale || 2 }); }
  };
})();
