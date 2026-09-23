/* Andong Kwŏn 1476 — the application shell.
 *
 * Loads the two tables, builds the graph with Relinkings' engine (vendored,
 * unchanged), indexes the leaves of the print, and runs the two tabs:
 * Inspection (js/inspection.js) and Graph (this file, with the shared
 * samhan-graph canvas). Nothing here writes anywhere: the edition is read-only
 * and the only state kept is the reader's own — the right-pane choice and the theme
 * decisions in localStorage, the theme in a cookie shared across samhan.ai.
 */
(function () {
  'use strict';
  var AK = (window.AK = window.AK || {});
  var $ = function (id) { return document.getElementById(id); };
  var Engine;

  var S = { view: null, canvasLabel: '', sidebarClosed: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function toast(msg, warn) {
    var host = $('toast-container');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast' + (warn ? ' warn' : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 3400);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3800);
  }
  function status(msg) { var el = $('status-message'); if (el) el.textContent = msg; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pageKey(v, l, s) { return 'vol' + v + '_' + pad2(l) + s; }

  /* ───────────────────────────────────────────────────────────── loading */

  function progress(pct, text, sub) {
    var b = $('loading-progress-bar'); if (b) b.style.width = pct + '%';
    var t = $('loading-text'); if (t && text) t.textContent = text;
    var s = $('loading-sub'); if (s && sub !== undefined) s.textContent = sub;
  }
  function chk(r) {
    if (!r.ok) throw new Error(r.status + ' ' + r.url);
    return r.text();
  }

  function boot() {
    Engine = window.Relinkings && window.Relinkings.Engine;
    if (!Engine || !window.SamhanGraph) {
      progress(100, 'A script is missing', !Engine ? 'js/engine.js did not load.' : 'js/samhan-graph/samhan-graph.js did not load.');
      $('loading-sub').classList.add('err');
      return;
    }
    progress(6, 'Fetching the tables', 'andongkwon_1476_nodes_20250707.tsv · andongkwon_1476_edges_20250707.tsv');
    Promise.all([
      fetch('../data/andongkwon_1476_nodes_20250707.tsv').then(chk),
      fetch('../data/andongkwon_1476_edges_20250707.tsv').then(chk)
    ]).then(function (texts) {
      progress(34, 'Parsing', (texts[0].length + texts[1].length).toLocaleString() + ' bytes');
      var nodeRows = Engine.loadTSV(texts[0]);
      var edgeRows = Engine.loadTSV(texts[1]);
      progress(52, 'Building the graph', nodeRows.length + ' node rows · ' + edgeRows.length + ' edge rows');
      setTimeout(function () {
        var G = Engine.build(nodeRows, edgeRows);
        AK.G = G;
        AK.gen = G.generations() || {};
        progress(80, 'Indexing the leaves', 'three volumes');
        setTimeout(function () {
          AK.pages = indexPages(G);
          progress(96, 'Ready', AK.pages.pages.length + ' leaves · ' + G.stats.nodeCount.toLocaleString() + ' people');
          ready(G);
        }, 16);
      }, 16);
    }).catch(function (err) {
      console.error(err);
      progress(100, 'Load failed', String(err.message || err));
      var s = $('loading-sub'); if (s) s.classList.add('err');
      var ap = document.querySelector('.rl-ap-status');
      if (ap) { ap.textContent = 'ERROR'; ap.setAttribute('data-state', 'error'); ap.removeAttribute('hidden'); }
    });
  }

  /* The leaves. A leaf is a (volume, leaf, side) the edge table cites; the
     people on it are the ends of those edges, plus anyone whose own row is
     filed there. `own` is the set of men the node table places on this leaf;
     the rest are restated from another leaf — a father at the head of the
     page, say — and Inspection draws them faded. */
  function indexPages(G) {
    var map = new Map();
    function page(v, l, s) {
      var key = pageKey(v, l, s), p = map.get(key);
      if (!p) {
        p = { key: key, vol: v, leaf: l, side: s, edges: [], ids: new Set(), own: new Set() };
        map.set(key, p);
      }
      return p;
    }
    G.edges.forEach(function (e) {
      if (!e.vol || !e.leaf || !e.side) return;
      var p = page(e.vol, e.leaf, e.side);
      p.edges.push(e); p.ids.add(e.source); p.ids.add(e.target);
    });
    G.nodes.forEach(function (n) {
      if (!n.vol || !n.leaf || !n.side) return;
      var p = page(n.vol, n.leaf, n.side);
      p.ids.add(n.id); p.own.add(n.id);
    });
    var pages = Array.from(map.values()).sort(function (a, b) {
      return a.vol - b.vol || a.leaf - b.leaf || (a.side < b.side ? -1 : a.side > b.side ? 1 : 0);
    });
    pages.forEach(function (p, i) { p.index = i; p.label = 'vol. ' + p.vol + ' · ' + p.leaf + p.side; });
    return { pages: pages, byKey: map, key: pageKey };
  }

  function ready(G) {
    var st = G.stats;
    var p = $('ap-pages'); if (p) p.textContent = AK.pages.pages.length;
    var ap = document.querySelector('.rl-ap-status');
    if (ap) ap.setAttribute('hidden', '');

    initCanvas();
    initSidebar();
    AK.Inspection.init();
    initChrome();
    route(true);
    if ('serviceWorker' in navigator) {                      // the offline experiment is withdrawn: let go of its cache
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
      if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { if (k.indexOf('ak1476') === 0) caches.delete(k); }); }).catch(function () {});
    }
    window.addEventListener('hashchange', function () { route(false); });

    var ov = $('loading-overlay');
    if (ov) { ov.style.transition = 'opacity .25s'; ov.style.opacity = '0'; setTimeout(function () { ov.classList.add('hidden'); }, 260); }
    status('Ready — ' + AK.pages.pages.length + ' leaves in three volumes.');
  }

  /* ─────────────────────────────────────────────────────── the Graph tab */

  function initCanvas() {
    AK.canvas = window.SamhanGraph.create($('graph-container'), {
      legend: $('graph-legend'),
      empty: $('canvas-empty'),
      onToast: toast,
      rows: 'local',
      legendCaption: 'Rows are generations. A dashed line is a marriage; the arrow runs from the bride\'s father to her husband, because the 1476 print records daughters only through their men.',
      options: { labels: ['roman', 'hanja', 'office'], labelSize: 15 }
    });
    AK.canvas
      .on('click', function (node) { AK.Detail.show(node); statusSel(node); })
      .on('edge', function (e) { AK.Detail.showEdge(e); });
    // the Inspection canvas follows the scheme chosen here
    AK.canvas.on('scheme', function (s) { if (AK.Inspection && AK.Inspection.canvas()) AK.Inspection.canvas().setScheme(s); });
  }
  function statusSel(node) {
    var el = $('status-sel');
    if (el) el.textContent = node ? (node.name || node.id) + ' · ' + node.id : 'no selection';
  }

  function setCanvas(sub, label) {
    S.canvasLabel = label || '';
    AK.canvas.setData(sub, { roles: { starts: sub.starts || [] } });
    $('status-nodes').textContent = sub.nodes.length.toLocaleString();
    $('status-edges').textContent = sub.edges.length.toLocaleString();
  }
  function breadcrumb(what, name, detail) {
    var el = $('canvas-breadcrumb');
    if (!el) return;
    if (!what) { el.className = 'canvas-breadcrumb empty'; el.innerHTML = ''; return; }
    el.className = 'canvas-breadcrumb';
    el.innerHTML = '<span class="bc-what">' + esc(what) + '</span>' +
      '<span class="bc-hj">' + esc(name || '') + '</span>' +
      (detail ? '<span style="color:var(--color-text-faint)">' + esc(detail) + '</span>' : '');
  }

  /* One man and the kin around him, so many generations each way — the
     tools' own Explore, so the sidebar, the canvas and the address agree. */
  function focusOn(node, up, down) {
    if (!node || !AK.tools) return;
    showView('graph');
    AK.tools.explore(node.id, up === undefined ? 2 : up, down === undefined ? 2 : down, { includeCollateral: true }).then(function (sub) {
      if (!sub) return;
      AK.Detail.show(node);
      writeHash('#/person/' + encodeURIComponent(node.id));
    });
  }
  /* A whole leaf, drawn on the big canvas. */
  function drawPage(page) {
    var sub = AK.Inspection.subgraphOf(page);
    setCanvas(sub, page.key);
    breadcrumb('Leaf', page.label, sub.nodes.length + ' people · ' + sub.edges.length + ' relations');
    showView('graph');
  }
  function expandNode(node) { if (AK.tools) AK.tools.toggleKin(node.id, 'children'); }
  function removeNode(node) { if (AK.tools) AK.tools.hide(node.id); }

  /* The autocomplete both tabs use: name, hangul, romanization (diacritics
     optional), office or biographical number, through the engine's search. */
  function autocomplete(input, drop, onPick) {
    var idx = -1, items = [];
    function close() { drop.classList.add('hidden'); idx = -1; }
    function paint() {
      drop.innerHTML = items.map(function (n, i) {
        var c = Array.isArray(n.choronym) ? n.choronym[0] + '…' : (n.choronym || '');
        var f = n.vol ? 'vol. ' + n.vol + ' · ' + n.leaf + n.side : '';
        return '<div class="ac-item' + (i === idx ? ' sel' : '') + '" data-i="' + i + '"><span class="ac-name">' + esc(n.name || n.id) + '</span>' +
               (n.roman ? '<span style="font-size:11px;font-style:italic;color:var(--color-text-secondary)">' + esc(n.roman) + '</span>' : '') +
               (c ? '<span class="hanja" style="font-size:11px;color:var(--color-text-secondary)">' + esc(c) + '</span>' : '') +
               '<span class="ac-meta">' + esc(f || n.id) + '</span></div>';
      }).join('');
      drop.querySelectorAll('.ac-item').forEach(function (el) {
        el.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(+el.getAttribute('data-i')); });
      });
      drop.classList.remove('hidden');
    }
    function pick(i) {
      var n = items[i];
      if (!n) return;
      close();
      onPick(n);
    }
    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (q.length < 1) return close();
      items = AK.G.search(q, { limit: 12 });
      idx = -1;
      if (!items.length) return close();
      paint();
    });
    input.addEventListener('keydown', function (ev) {
      if (drop.classList.contains('hidden')) { if (ev.key === 'Enter' && input.value.trim()) { items = AK.G.search(input.value.trim(), { limit: 1 }); if (items.length) pick(0); } return; }
      if (ev.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); paint(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { idx = Math.max(0, idx - 1); paint(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { pick(idx < 0 ? 0 : idx); ev.preventDefault(); }
      else if (ev.key === 'Escape') close();
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
  }
  AK.autocomplete = autocomplete;

  function initSidebar() {
    AK.provider = window.SamhanGraphEngineProvider.create(AK.G);
    AK.tools = window.SamhanGraphTools.mount($('graph-sidebar-controls'), {
      canvas: AK.canvas, provider: AK.provider, export: window.SamhanGraphExport, label: 'andongkwon1476', toast: toast,
      labels: { explore: 'Draw a person and his kin' },
      onDraw: function (sub, meta) {
        if (!sub) { breadcrumb(null); $('status-nodes').textContent = '0'; $('status-edges').textContent = '0'; S.canvasLabel = ''; writeHash('#/graph'); return; }
        $('status-nodes').textContent = sub.nodes.length.toLocaleString();
        $('status-edges').textContent = sub.edges.length.toLocaleString();
        if (meta.kind === 'lineage') {
          var n = AK.G.node(meta.root);
          S.canvasLabel = 'person-' + meta.root;
          breadcrumb('Person', n ? (n.name || n.id) : meta.root, meta.up + ' up · ' + meta.down + ' down · ' + sub.nodes.length + ' people');
          writeHash('#/person/' + encodeURIComponent(meta.root));
        } else if (meta.kind === 'paths') {
          S.canvasLabel = 'paths';
          breadcrumb('Paths between', (meta.terminalIds || []).map(function (id) { var n = AK.G.node(id); return n ? n.name : id; }).join(' · '),
                     (meta.pathCount > 1 ? meta.pathCount + ' paths · ' : '') + sub.nodes.length + ' people');
        }
      }
    });
    $('btn-reset').addEventListener('click', function () {
      AK.canvas.clear(); breadcrumb(null); AK.Detail.clear(); AK.tools.setInput(''); writeHash('#/graph');
    });
    $('btn-toggle-sidebar').addEventListener('click', function () { $('sidebar').classList.add('collapsed'); $('btn-toggle-tools').style.display = ''; });
    $('btn-toggle-tools').addEventListener('click', function () { $('sidebar').classList.remove('collapsed'); $('btn-toggle-tools').style.display = 'none'; });

    // floating toolbar
    $('btn-float-redraw').addEventListener('click', function () { AK.canvas.redrawAnnounced(); });
    $('btn-float-fit').addEventListener('click', function () { AK.canvas.fit(); });
    $('btn-float-zoom-in').addEventListener('click', function () { AK.canvas.zoomBy(1.25); });
    $('btn-float-zoom-out').addEventListener('click', function () { AK.canvas.zoomBy(0.8); });
    $('btn-float-clear').addEventListener('click', function () { AK.canvas.clear(); breadcrumb(null); });
  }

  /* ─────────────────────────────────────────────────────────── the shell */

  function showView(v) {
    var prev = S.view;
    S.view = v;
    ['inspection', 'graph'].forEach(function (x) {
      $(x + '-view').classList.toggle('active', x === v);
      $('btn-' + x + '-view').classList.toggle('active', x === v);
      $('btn-' + x + '-view').setAttribute('aria-selected', x === v ? 'true' : 'false');
    });
    var sb = $('sidebar');
    if (v === 'graph') {
      sb.classList.toggle('collapsed', S.sidebarClosed === true);
      $('btn-toggle-tools').style.display = S.sidebarClosed ? '' : 'none';
      AK.canvas.redraw();
    } else {
      if (prev === 'graph') S.sidebarClosed = sb.classList.contains('collapsed');
      sb.classList.add('collapsed');
      $('btn-toggle-tools').style.display = 'none';
      AK.Inspection.onShow();
    }
    $('btn-float-tools') && ($('btn-float-tools').style.display = v === 'graph' ? '' : 'none');
  }
  function activeCanvas() { return S.view === 'graph' ? AK.canvas : AK.Inspection.canvas(); }
  function activeLabel() { return S.view === 'graph' ? ('andongkwon1476-' + (S.canvasLabel || 'graph')) : ('andongkwon1476-' + (AK.Inspection.page() ? AK.Inspection.page().key : 'leaf')); }

  var routing = false;
  function writeHash(h) {
    if (routing) return;
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
  }
  function route(first) {
    var h = location.hash || '';
    var m;
    routing = true;
    try {
      if ((m = /^#\/leaf\/(\d+)\/(\d+)([ab])(?:\/([^/]+))?/.exec(h))) {
        showView('inspection');
        AK.Inspection.go(+m[1], +m[2], m[3], { select: m[4] ? decodeURIComponent(m[4]) : null });
      } else if ((m = /^#\/person\/([^/]+)/.exec(h))) {
        var n = AK.G.node(decodeURIComponent(m[1]));
        if (n) focusOn(n); else { toast('No such person: ' + m[1], true); showView('inspection'); AK.Inspection.go(1, 1, 'a'); }
      } else if (/^#\/graph/.test(h)) {
        showView('graph');
      } else {
        showView('inspection');
        var p = AK.pages.pages[0];
        AK.Inspection.go(p.vol, p.leaf, p.side, {});
      }
    } finally { routing = false; }
    if (first && !location.hash) { /* leave the address clean on first load */ }
  }
  function goLeaf(vol, leaf, side, opts) {
    showView('inspection');
    AK.Inspection.go(vol, leaf, side, opts || {});
  }

  function initChrome() {
    $('btn-inspection-view').addEventListener('click', function () { showView('inspection'); var p = AK.Inspection.page(); if (p) writeHash('#/leaf/' + p.vol + '/' + p.leaf + p.side); });
    $('btn-graph-view').addEventListener('click', function () { showView('graph'); if (!/^#\/person/.test(location.hash)) writeHash('#/graph'); });
    $('btn-toggle-detail').addEventListener('click', function () { $('detail-panel').classList.add('collapsed'); });

    /* Sebo's toggle, and it decides nothing: SamhanTheme.cycle() writes the
       cookie shared across *.samhan.ai, applies the attribute and fires
       `samhan-theme`. auto → light → dark → auto. */
    var mod = window.SamhanTheme;
    $('btn-theme-toggle').addEventListener('click', function () {
      if (mod && mod.cycle) mod.cycle();
      else {
        var cur = document.documentElement.getAttribute('data-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
      }
      syncThemeButton();
    });
    document.documentElement.addEventListener('samhan-theme', syncThemeButton);
    syncThemeButton();

    window.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('report-modal').classList.contains('hidden')) { $('report-modal').classList.add('hidden'); return; }
      if (/input|select|textarea/i.test(ev.target.tagName || '') || ev.target.isContentEditable) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === '1') { showView('inspection'); }
      else if (ev.key === '2') { showView('graph'); }
      else if (ev.key === 'f') { activeCanvas().fit(); }
      else if (ev.key === 'Escape') $('detail-panel').classList.add('collapsed');
      else if (S.view === 'inspection') AK.Inspection.key(ev);
    });
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { activeCanvas().render(); if (S.view === 'inspection') AK.Inspection.onResize(); }, 120);
    });
  }
  function syncThemeButton() {
    var mod = window.SamhanTheme;
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    var isAuto = !mod || !mod.isAuto || mod.isAuto();
    var icon = $('theme-icon'), b = $('btn-theme-toggle');
    if (icon) icon.textContent = isAuto ? '🌗' : (light ? '☀️' : '🌙');
    if (b) {
      var now = light ? 'light' : 'dark';
      var daylight = (mod && mod.sun) ? mod.sun() : now;
      var where = isAuto
        ? 'Following your local daylight — ' + now + ' just now. Press to hold ' + (light ? 'dark' : 'light') + '.'
        : 'Held ' + now + ' until midnight. Press to ' + (now === daylight ? 'follow your local daylight again' : 'hold ' + daylight) + '.';
      b.title = where; b.setAttribute('aria-label', where);
    }
  }

  AK.App = {
    toast: toast, status: status, showView: showView, focusOn: focusOn, drawPage: drawPage,
    expandNode: expandNode, removeNode: removeNode, setCanvas: setCanvas, breadcrumb: breadcrumb,
    goLeaf: goLeaf, writeHash: writeHash, activeCanvas: activeCanvas, activeLabel: activeLabel,
    view: function () { return S.view; }, esc: esc, pageKey: pageKey
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
