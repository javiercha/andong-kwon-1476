/* Andong Kwŏn 1476 — Inspection: a leaf of the print beside the men it records.
 *
 * This is the Jupyter notebook's page-by-page inspection, as a page. The
 * notebook took a (volume, leaf, side), asked Neo4j for every relationship
 * cited there, and drew the result with graphviz beside the scan so that a
 * reader could check the transcription against the original. Here the same
 * question is asked of the in-browser graph and drawn with the shared
 * samhan-graph canvas — generation rows, the eldest at the right, marriages
 * dashed — with the facsimile on the left, and beneath the drawing the rows
 * themselves: the people, the relations, the transcriber's notes.
 *
 * Three ways of reading a leaf are kept in step: hover a row and the figure
 * lights on the drawing; click a figure and his record opens; a man whose own
 * row is filed on another leaf is drawn faded and his row links there. A
 */
(function () {
  'use strict';
  var AK = (window.AK = window.AK || {});
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return AK.App.esc(s); };

  var VERSION = '0.9', FULL_AT = 1.35;   // zoom factor past which the full-resolution scan replaces the derivative
  var SHELFMARK = 'AKS JE A 55020';

  var RIGHT = 'ak1476.rightpane.v1';
  var S = {
    page: null, pc: null, zoom: null, nbZoom: null, nbW: 0, nbH: 0, rview: 'notebook',
    imgW: 0, imgH: 0, tab: 'people', sel: null, selEdge: null,
    stripVol: null, sub: null, audit: null, auditByKey: null
  };


  function pageOf(vol, leaf, side) { return AK.pages.byKey.get(AK.App.pageKey(vol, leaf, side)) || null; }
  function canvas() { return S.pc; }
  function page() { return S.page; }

  /* The subgraph of one leaf: its edges, their ends, and anyone filed there. */
  function subgraphOf(p) {
    var G = AK.G, nodes = [];
    p.ids.forEach(function (id) { var n = G.node(id); if (n) nodes.push(n); });
    return { nodes: nodes, edges: p.edges.slice(), starts: [] };
  }
  /* The man the rows hang from: no father on this leaf, highest generation,
     then the most issue. The print restates him at the head of the page. */
  function anchorOf(p, sub) {
    var hasFather = new Set();
    p.edges.forEach(function (e) { if (e.baseType === 'HAS_SON') hasFather.add(e.target); });
    var best = null, bestKey = null;
    sub.nodes.forEach(function (n) {
      if (hasFather.has(n.id)) return;
      var outs = p.edges.filter(function (e) { return e.source === n.id; }).length;
      var key = [(n.generation == null ? 999 : n.generation), -outs];
      if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = n; bestKey = key; }
    });
    return best ? best.id : null;
  }

  /* ─────────────────────────────────────────────────────────────── init */

  function init() {
    S.pc = window.SamhanGraph.create($('page-graph'), {
      legend: $('page-legend'),
      empty: $('page-empty'),
      onToast: function (m, kind) { if (kind !== 'floor') AK.App.toast(m); },
      fitMin: 0.12,
      legendCaption: 'The men this leaf records, in the rows of their generations, the eldest son at the right as the print has him. ' +
                     'A faded figure is filed on another leaf and restated here.',
      options: { labelSize: 14, labels: ['roman', 'hanja', 'office'], contextFade: 0.38 },
      rows: 'local'
    });
    try { S.rview = localStorage.getItem(RIGHT) === 'drawing' ? 'drawing' : 'notebook'; } catch (e) {}
    document.querySelectorAll('.pane-switch button').forEach(function (b) {
      b.addEventListener('click', function () { setRightView(b.getAttribute('data-view')); });
    });
    S.nbZoom = d3.zoom().scaleExtent([0.08, 8]).on('zoom', function (ev) {
      $('nb-img').style.transform = 'translate(' + ev.transform.x + 'px,' + ev.transform.y + 'px) scale(' + ev.transform.k + ')';
    });
    d3.select('#nb-stage').call(S.nbZoom).on('dblclick.zoom', null);
    touchPolicy('#nb-stage');
    $('nb-stage').addEventListener('dblclick', fitNb);
    $('nb-img').addEventListener('load', function () { S.nbW = this.naturalWidth; S.nbH = this.naturalHeight; this.classList.remove('loading'); fitNb(); });
    $('nb-img').addEventListener('error', function () { this.classList.remove('loading'); });
    setRightView(S.rview, true);
    S.pc.on('click', function (n) { select(n.id, true); AK.Detail.show(n); })
        .on('expand', function (n) { AK.App.focusOn(n); })
        .on('remove', function () { AK.App.toast('A leaf is read as printed; nothing is taken off it.'); })
        .on('edge', function (e) { selectEdge(e.id, true); AK.Detail.showEdge(e); });

    var vols = Array.from(new Set(AK.pages.pages.map(function (p) { return p.vol; }))).sort();
    $('fo-vol').innerHTML = vols.map(function (v) { return '<option value="' + v + '">' + v + '</option>'; }).join('');

    $('fo-prev').addEventListener('click', function () { step(-1); });
    $('fo-next').addEventListener('click', function () { step(1); });
    $('fo-vol').addEventListener('change', function () { go(+this.value, 1, 'a', {}); });
    $('fo-leaf').addEventListener('change', function () { go(+$('fo-vol').value, +this.value || 1, S.page ? S.page.side : 'a', {}); });
    $('fo-leaf').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { this.blur(); } });
    $('fo-side-a').addEventListener('click', function () { if (S.page) go(S.page.vol, S.page.leaf, 'a', {}); });
    $('fo-side-b').addEventListener('click', function () { if (S.page) go(S.page.vol, S.page.leaf, 'b', {}); });
    $('fo-open-graph').addEventListener('click', function () { if (S.page) AK.App.drawPage(S.page); });
    $('fo-link').addEventListener('click', copyLink);
    $('fo-report').addEventListener('click', report);
    $('report-close').addEventListener('click', closeReport);
    $('rp-cancel').addEventListener('click', closeReport);
    $('report-form').addEventListener('submit', sendReport);
    $('report-modal').addEventListener('click', function (ev) { if (ev.target === $('report-modal')) closeReport(); });
    $('fo-export').addEventListener('click', function () { AK.Export.tsv(); });

    AK.autocomplete($('fo-search'), $('fo-drop'), function (n) {
      $('fo-search').value = '';
      if (n.vol && n.leaf && n.side) go(n.vol, n.leaf, n.side, { select: n.id, push: true });
      else { AK.App.toast((n.name || n.id) + ' has no leaf recorded; drawing his kin instead.'); AK.App.focusOn(n); }
    });

    // the facsimile: pan and zoom on the sheet
    S.zoom = d3.zoom().scaleExtent([0.08, 8]).on('zoom', function (ev) {
      $('fac-img').style.transform = 'translate(' + ev.transform.x + 'px,' + ev.transform.y + 'px) scale(' + ev.transform.k + ')';
      if (ev.transform.k > FULL_AT) deepZoom();
    });
    d3.select('#fac-stage').call(S.zoom).on('dblclick.zoom', null);
    touchPolicy('#fac-stage');
    $('fac-stage').addEventListener('dblclick', function () { fitImage(); });
    $('fac-img').addEventListener('load', function () {
      this.classList.remove('loading');
      if (S.full === 'loading') { S.full = 'shown'; return; }          // the sharper source in the same box: no refit
      S.imgW = this.naturalWidth; S.imgH = this.naturalHeight;
      this.style.width = S.imgW + 'px'; this.style.height = S.imgH + 'px';
      fitImage();
    });
    $('fac-img').addEventListener('error', function () { this.classList.remove('loading'); AK.App.toast('The image for this leaf did not load.', true); });
    $('fac-fit').addEventListener('click', fitImage);
    $('fac-zoom-in').addEventListener('click', function () { d3.select('#fac-stage').transition().duration(250).call(S.zoom.scaleBy, 1.3); });
    $('fac-zoom-out').addEventListener('click', function () { d3.select('#fac-stage').transition().duration(250).call(S.zoom.scaleBy, 1 / 1.3); });
    $('fac-one').addEventListener('click', function () {
      var st = $('fac-stage'), W = st.clientWidth, H = st.clientHeight;
      d3.select('#fac-stage').transition().duration(300).call(S.zoom.transform, d3.zoomIdentity.translate((W - S.imgW) / 2, Math.min(0, (H - S.imgH) / 2)).scale(1));
    });

    // the drawing's own buttons
    $('pg-fit').addEventListener('click', function () { if (S.rview === 'drawing') S.pc.fit(); else fitNb(); });
    $('pg-zoom-in').addEventListener('click', function () { if (S.rview === 'drawing') S.pc.zoomBy(1.25); else d3.select('#nb-stage').transition().duration(250).call(S.nbZoom.scaleBy, 1.3); });
    $('pg-zoom-out').addEventListener('click', function () { if (S.rview === 'drawing') S.pc.zoomBy(0.8); else d3.select('#nb-stage').transition().duration(250).call(S.nbZoom.scaleBy, 1 / 1.3); });
    $('pg-redraw').addEventListener('click', function () { S.pc.redraw(); });
    $('pg-svg').addEventListener('click', function () { AK.Export.svg(); });

    // lists
    document.querySelectorAll('.insp-tabs .tab[data-list]').forEach(function (t) {
      t.addEventListener('click', function () { showTab(t.getAttribute('data-list')); });
    });

    // the gutter between the sheet and the men
    gutter();
  }

  function gutter() {
    var g = $('insp-gutter'), split = $('insp-split'), dragging = false;
    g.addEventListener('mousedown', function (ev) { dragging = true; g.classList.add('on'); ev.preventDefault(); });
    window.addEventListener('mousemove', function (ev) {
      if (!dragging) return;
      var r = split.getBoundingClientRect();
      var pct = Math.max(22, Math.min(78, (ev.clientX - r.left) / r.width * 100));
      split.style.setProperty('--fac-w', pct.toFixed(1) + '%');
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false; g.classList.remove('on');
      onResize();
    });
    // keyboard: the separator is focusable and moves by 4% a press
    g.setAttribute('tabindex', '0');
    g.addEventListener('keydown', function (ev) {
      var cur = parseFloat(getComputedStyle(split).getPropertyValue('--fac-w')) || 50;
      if (ev.key === 'ArrowLeft') { split.style.setProperty('--fac-w', Math.max(22, cur - 4) + '%'); onResize(); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { split.style.setProperty('--fac-w', Math.min(78, cur + 4) + '%'); onResize(); ev.preventDefault(); }
    });
  }

  /* ──────────────────────────────────────────────────────────── the leaf */

  function go(vol, leaf, side, opts) {
    opts = opts || {};
    var p = pageOf(vol, leaf, side);
    if (!p) {
      // a leaf the print has but the tables do not cite: step to the nearest
      var near = AK.pages.pages.filter(function (x) { return x.vol === vol; }).sort(function (a, b) {
        return Math.abs(a.leaf - leaf) - Math.abs(b.leaf - leaf) || (a.side === side ? -1 : 1);
      })[0];
      AK.App.toast('No rows are cited on vol. ' + vol + ' leaf ' + leaf + side + (near ? '; showing ' + near.label + '.' : '.'), true);
      if (!near) return;
      p = near;
    }
    S.page = p;
    S.sel = opts.select || null; S.selEdge = null;

    // the controls
    $('fo-vol').value = String(p.vol);
    $('fo-leaf').value = String(p.leaf);
    $('fo-side-a').classList.toggle('on', p.side === 'a');
    $('fo-side-b').classList.toggle('on', p.side === 'b');
    $('fo-prev').disabled = p.index === 0;
    $('fo-next').disabled = p.index === AK.pages.pages.length - 1;
    document.title = 'The Andong Kwŏn Genealogy of 1476 — vol. ' + p.vol + ' leaf ' + p.leaf + p.side;

    // the sheet
    showImage();
    strip(p);

    // the notebook render, and the drawing
    var nb = $('nb-img');
    nb.classList.add('loading');
    nb.alt = 'The notebook rendering (June 2025) of ' + p.label;
    nb.src = 'notebook/' + p.key + '.png';

    S.sub = subgraphOf(p);
    var touched = new Set();
    S.sub.edges.forEach(function (e) { touched.add(e.source); touched.add(e.target); });
    S.sub.nodes.forEach(function (n) { n._loose = !touched.has(n.id); });
    var anchor = anchorOf(p, { nodes: S.sub.nodes.filter(function (n) { return !n._loose; }), edges: S.sub.edges });
    /* A man filed on this leaf with no relation cited on it has nowhere to
       hang: he is listed, marked, and left off the drawing. */
    S.pc.setData({ nodes: S.sub.nodes.filter(function (n) { return !n._loose; }), edges: S.sub.edges, starts: [] },
                 { focus: Array.from(p.own), anchorId: anchor });

    // the rows
    renderLists(p, S.sub);
    var carried = S.sub.nodes.filter(function (n) { return !p.own.has(n.id); }).length;
    $('fo-pos').innerHTML = 'leaf <strong>' + (p.index + 1) + '</strong> / ' + AK.pages.pages.length +
      ' · <strong>' + S.sub.nodes.length + '</strong> people · <strong>' + S.sub.edges.length + '</strong> relations' +
      (carried ? ' · <strong>' + carried + '</strong> restated from other leaves' : '');
    $('status-nodes').textContent = S.sub.nodes.length;
    $('status-edges').textContent = S.sub.edges.length;
    AK.App.status(p.label + (p.own.size ? ' · ' + p.own.size + ' men filed on this leaf' : ''));

    if (S.sel) { select(S.sel, false); var n = AK.G.node(S.sel); if (n) AK.Detail.show(n); }
    AK.App.writeHash('#/leaf/' + p.vol + '/' + p.leaf + p.side + (S.sel ? '/' + encodeURIComponent(S.sel) : ''));
  }
  function step(d) {
    if (!S.page) return;
    var p = AK.pages.pages[S.page.index + d];
    if (p) go(p.vol, p.leaf, p.side, {});
  }
  function onShow() {
    if (!S.page) return;
    if (S.rview === 'drawing') { S.pc.render(); S.pc.fit(); } else fitNb();
    fitImage();
  }
  function onResize() { if (S.page) { if (S.rview === 'drawing') { S.pc.render(); S.pc.fit(); } else fitNb(); fitImage(); } }
  function setRightView(v, silent) {
    S.rview = v === 'drawing' ? 'drawing' : 'notebook';
    try { localStorage.setItem(RIGHT, S.rview); } catch (e) {}
    $('page-wrap').setAttribute('data-view', S.rview);
    document.querySelectorAll('.pane-switch button').forEach(function (b) {
      var on = b.getAttribute('data-view') === S.rview;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (S.page && !silent) { if (S.rview === 'drawing') { S.pc.render(); S.pc.fit(); } else fitNb(); }
  }
  function fitNb() {
    var st = $('nb-stage'), W = st.clientWidth, H = st.clientHeight;
    if (!S.nbW || !S.nbH || !W || !H) return;
    var k = Math.min(W / S.nbW, H / S.nbH) * 0.98;
    var tx = (W - S.nbW * k) / 2, ty = (H - S.nbH * k) / 2;
    d3.select('#nb-stage').transition().duration(250).call(S.nbZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }
  function key(ev) {
    if (ev.key === 'ArrowLeft' || ev.key === 'k') step(-1);
    else if (ev.key === 'ArrowRight' || ev.key === 'j') step(1);
    else if (ev.key === 'n') showTab('notes');
    else if (ev.key === 'p') showTab('people');
    else if (ev.key === 'r') showTab('relations');
  }

  /* On a touch screen d3-zoom writes touch-action: none on the stage, which
     would trap a finger that is only trying to scroll past the sheet on a
     phone. Below 900px, where the panes stack, a vertical drag is the page's;
     a horizontal drag and a pinch are the stage's. */
  function touchPolicy(sel) {
    var apply = function () { d3.select(sel).style('touch-action', window.innerWidth <= 900 ? 'pan-y' : 'none'); };
    apply();
    window.addEventListener('resize', apply);
  }

  /* ─────────────────────────────────────────────────────────── the sheet */

  function showImage() {
    if (!S.page) return;
    var img = $('fac-img');
    img.classList.add('loading');
    img.alt = 'Facsimile, ' + SHELFMARK + ', ' + S.page.label;
    img.style.width = img.style.height = '';
    S.full = S.fullMissing ? 'none' : '';
    img.src = 'facsimile/pages/' + S.page.key + '.jpg';
    $('fac-cite').textContent = SHELFMARK + ' · vol. ' + S.page.vol + ' · leaf ' + S.page.leaf + (S.page.side === 'a' ? ' recto' : ' verso');
  }
  /* Deep zoom: past FULL_AT the 1800-pixel derivative is swapped for the scan at
     its full 2481×3509, drawn into the same box so the transform holds. The
     first miss (no full/ directory built) turns the swap off for the session. */
  function deepZoom() {
    if (!S.page || S.full || !S.imgW) return;
    S.full = 'loading';
    var key = S.page.key, probe = new Image();
    probe.onload = function () { if (S.page && S.page.key === key) { $('fac-img').src = probe.src; } else S.full = ''; };
    probe.onerror = function () { S.full = 'none'; S.fullMissing = true; };
    probe.src = 'facsimile/full/' + key + '.jpg';
  }
  function fitImage() {
    var st = $('fac-stage'), W = st.clientWidth, H = st.clientHeight;
    if (!S.imgW || !S.imgH || !W || !H) return;
    var k = Math.min(W / S.imgW, H / S.imgH) * 0.98;
    var tx = (W - S.imgW * k) / 2, ty = (H - S.imgH * k) / 2;
    d3.select('#fac-stage').transition().duration(250).call(S.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }
  function strip(p) {
    var host = $('fac-strip');
    if (S.stripVol !== p.vol) {
      S.stripVol = p.vol;
      host.innerHTML = AK.pages.pages.filter(function (x) { return x.vol === p.vol; }).map(function (x) {
        return '<button type="button" class="strip-item" data-key="' + x.key + '" title="' + esc(x.label) + '">' +
          '<img loading="lazy" decoding="async" src="facsimile/thumbs/' + x.key + '.jpg" alt="">' +
          '<span>' + x.leaf + x.side + '</span></button>';
      }).join('');
      host.querySelectorAll('.strip-item').forEach(function (b) {
        b.addEventListener('click', function () { var x = AK.pages.byKey.get(b.getAttribute('data-key')); if (x) go(x.vol, x.leaf, x.side, {}); });
      });
    }
    host.querySelectorAll('.strip-item').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-key') === p.key); });
    var on = host.querySelector('.strip-item.on');
    if (on) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  /* ──────────────────────────────────────────────────────────── the rows */

  function folio(x) { return x && x.vol ? 'vol. ' + x.vol + ' · ' + x.leaf + x.side : ''; }

  function renderLists(p, sub) {
    var G = AK.G;
    // people, in the print's order: generation, then right to left across the row
    var people = sub.nodes.slice().sort(function (a, b) {
      var ga = a._gen == null ? 0 : a._gen, gb = b._gen == null ? 0 : b._gen;
      return ga - gb || (b.x || 0) - (a.x || 0);
    });
    $('list-people').innerHTML = people.length ? people.map(function (n) {
      var own = p.own.has(n.id);
      return '<div class="ent-row' + (own ? '' : ' ctx') + (n._loose ? ' loose' : '') + '" data-id="' + esc(n.id) + '" tabindex="0">' +
        '<span class="e-name">' + esc(n.name || n.id) + (n.hangul ? '<span class="e-hg">' + esc(n.hangul) + '</span>' : '') + '</span>' +
        '<span class="e-roman">' + esc(n.roman || '') + '</span>' +
        '<span class="e-office">' + esc(n.office || '') + '</span>' +
        '<span class="e-meta"><span class="e-gen">G' + (n.generation == null ? '—' : n.generation) + '</span><span>' + esc(n.id) + '</span>' +
        (own ? '' : '<span class="e-fol" data-vol="' + n.vol + '" data-leaf="' + n.leaf + '" data-side="' + esc(n.side) + '" title="Filed on another leaf — open it">' + esc(folio(n) || 'no leaf') + '</span>') +
        (n._loose ? '<span class="e-note" title="filed on this leaf by the node table, but no relation is cited here — not drawn" style="color:var(--color-text-faint)">∅</span>' : '') +
        (n.notes ? '<span class="e-note" title="' + esc(n.notes) + '">✎</span>' : '') +
        (n.choronymInferred ? '<span class="e-note" title="lineage inferred by the engine, not stated by the print" style="color:var(--color-text-faint)">?</span>' : '') +
        '</span></div>';
    }).join('') : '<div class="ent-empty">No people.</div>';

    // relations, as the table has them
    var rels = sub.edges.slice().sort(function (a, b) {
      var sa = G.node(a.source), sb = G.node(b.source);
      var ga = sa && sa._gen != null ? sa._gen : 0, gb = sb && sb._gen != null ? sb._gen : 0;
      return ga - gb || (sb && sa ? (sb.x || 0) - (sa.x || 0) : 0) || (a.baseType < b.baseType ? -1 : 1) || (a.childOrder || 99) - (b.childOrder || 99);
    });
    $('list-relations').innerHTML = rels.length ? rels.map(function (e) {
      var s = G.node(e.source), t = G.node(e.target), sil = e.baseType === 'HAS_SIL';
      return '<div class="ent-row rel" data-eid="' + esc(e.id) + '" tabindex="0">' +
        '<span class="e-name">' + esc(s ? s.name : e.source) + '</span>' +
        '<span class="e-arrow' + (sil ? ' sil' : '') + '"><span class="hj">' + (sil ? '女夫' : '子') + '</span>' +
          (e.childOrder ? ' ' + e.childOrder : '') + (e.wifeNote ? ' <span class="hj">' + esc(e.wifeNote) + '</span>' : '') + ' →</span>' +
        '<span class="e-name tgt">' + esc(t ? t.name : e.target) + '</span>' +
        '<span class="e-meta">' + (e.checked ? '<span title="checked in the table">✓</span>' : '') +
          (e.notes ? '<span class="e-note" title="' + esc(e.notes) + '">✎</span>' : '') + '<span>' + esc(e.baseType) + '</span></span></div>';
    }).join('') : '<div class="ent-empty">No relations.</div>';

    // notes: the transcriber's, then the engine's apparatus for this leaf
    var notes = [];
    sub.nodes.forEach(function (n) { if (n.notes && p.own.has(n.id)) notes.push({ kind: 'transcriber', who: n.name || n.id, text: n.notes, id: n.id }); });
    sub.edges.forEach(function (e) {
      if (!e.notes) return;
      var s = G.node(e.source), t = G.node(e.target);
      notes.push({ kind: 'transcriber', who: (s ? s.name : e.source) + ' → ' + (t ? t.name : e.target), text: e.notes, eid: e.id });
    });
    auditFor(p).forEach(function (it) { notes.push(it); });
    $('list-notes').innerHTML = notes.length ? notes.map(function (x) {
      return '<div class="note-item"' + (x.id ? ' data-id="' + esc(x.id) + '"' : '') + (x.eid ? ' data-eid="' + esc(x.eid) + '"' : '') + '>' +
        '<span class="n-kind' + (x.kind === 'engine' ? ' machine' : '') + '">' + esc(x.kind) + (x.severity ? ' · ' + esc(x.severity) : '') + '</span>' +
        '<span class="n-who">' + esc(x.who) + '</span>' +
        '<span class="n-text">' + esc(x.text) + '</span></div>';
    }).join('') : '<div class="ent-empty">Nothing noted on this leaf — by the transcriber or by the engine.</div>';
    $('cnt-people').textContent = people.length;
    $('cnt-relations').textContent = rels.length;
    $('cnt-notes').textContent = notes.length;

    // wiring: hover lights the figure, click opens the record
    var host = $('list-people');
    host.querySelectorAll('.ent-row').forEach(function (row) {
      var id = row.getAttribute('data-id');
      row.addEventListener('mouseenter', function () { if (!S.sel && !S.selEdge) S.pc.highlight({ nodes: [id], edges: incident(id, sub) }); });
      row.addEventListener('mouseleave', function () { if (!S.sel && !S.selEdge) S.pc.highlight({ nodes: [], edges: [] }); });
      row.addEventListener('click', function (ev) {
        if (ev.target.classList.contains('e-fol')) return;
        var n = G.node(id);
        select(id, true); if (n) AK.Detail.show(n);
      });
      row.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') row.click(); });
      var f = row.querySelector('.e-fol');
      if (f) f.addEventListener('click', function (ev) { ev.stopPropagation(); go(+f.getAttribute('data-vol'), +f.getAttribute('data-leaf'), f.getAttribute('data-side'), { select: id, push: true }); });
    });
    $('list-relations').querySelectorAll('.ent-row').forEach(function (row) {
      var eid = row.getAttribute('data-eid');
      var e = sub.edges.filter(function (x) { return x.id === eid; })[0];
      row.addEventListener('mouseenter', function () { if (!S.sel && !S.selEdge && e) S.pc.highlight({ nodes: [e.source, e.target], edges: [eid] }); });
      row.addEventListener('mouseleave', function () { if (!S.sel && !S.selEdge) S.pc.highlight({ nodes: [], edges: [] }); });
      row.addEventListener('click', function () { if (e) { selectEdge(eid, true); AK.Detail.showEdge(e); } });
      row.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') row.click(); });
    });
    $('list-notes').querySelectorAll('.note-item').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-id'), eid = row.getAttribute('data-eid');
        if (id) { select(id, true); var n = G.node(id); if (n) AK.Detail.show(n); }
        else if (eid) { var e = sub.edges.filter(function (x) { return x.id === eid; })[0]; if (e) { selectEdge(eid, true); AK.Detail.showEdge(e); } }
      });
    });
  }
  function incident(id, sub) {
    return sub.edges.filter(function (e) { return e.source === id || e.target === id; }).map(function (e) { return e.id; });
  }
  function select(id, scroll) {
    S.sel = id; S.selEdge = null;
    S.pc.highlight({ nodes: id ? [id] : [], edges: id ? incident(id, S.sub) : [] });
    document.querySelectorAll('#list-people .ent-row, #list-relations .ent-row').forEach(function (r) {
      r.classList.toggle('on', r.getAttribute('data-id') === id);
    });
    var sn = AK.G.node(id);
    var st = $('status-sel'); if (st) st.textContent = sn ? (sn.name || sn.id) + ' · ' + sn.id : 'no selection';
    if (scroll) { var r = document.querySelector('#list-people .ent-row.on'); if (r && S.tab === 'people') r.scrollIntoView({ block: 'nearest' }); }
    if (S.page) AK.App.writeHash('#/leaf/' + S.page.vol + '/' + S.page.leaf + S.page.side + (id ? '/' + encodeURIComponent(id) : ''));
  }
  function selectEdge(eid, scroll) {
    S.selEdge = eid; S.sel = null;
    var e = S.sub.edges.filter(function (x) { return x.id === eid; })[0];
    S.pc.highlight({ nodes: e ? [e.source, e.target] : [], edges: e ? [eid] : [] });
    document.querySelectorAll('#list-people .ent-row, #list-relations .ent-row').forEach(function (r) {
      r.classList.toggle('on', r.getAttribute('data-eid') === eid);
    });
    if (scroll) { var r = document.querySelector('#list-relations .ent-row.on'); if (r && S.tab === 'relations') r.scrollIntoView({ block: 'nearest' }); }
  }
  function showTab(name) {
    S.tab = name;
    document.querySelectorAll('.insp-tabs .tab[data-list]').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-list') === name); });
    ['people', 'relations', 'notes'].forEach(function (x) { $('list-' + x).classList.toggle('hidden', x !== name); });
  }

  /* The engine's apparatus — Relinkings' Graph.audit() — filtered to a leaf.
     Computed once, on first use; every item names the edge or node it is
     about, and that carries the folio. */
  function auditFor(p) {
    if (!S.auditByKey) {
      S.auditByKey = new Map();
      try {
        var res = (typeof AK.G.audit === 'function') ? AK.G.audit() : null;
        var items = res ? (Array.isArray(res) ? res : (res.items || [])) : [];
        items.forEach(function (it) {
          var f = it.folio || it.edge || it.node;
          if (!f || !f.vol || !f.leaf || !f.side) return;
          var key = AK.App.pageKey(f.vol, f.leaf, f.side);
          var G = AK.G;
          var who = it.edge
            ? ((G.node(it.edge.source) || {}).name || it.edge.source) + ' → ' + ((G.node(it.edge.target) || {}).name || it.edge.target)
            : (it.node ? (it.node.name || it.node.id) : ((it.names || it.ids || []).join(' · ')));
          var list = S.auditByKey.get(key);
          if (!list) { list = []; S.auditByKey.set(key, list); }
          list.push({ kind: 'engine', severity: it.severity || 'note', who: who, text: it.message || it.kind || '',
                      id: it.node ? it.node.id : null, eid: it.edge ? it.edge.id : null });
        });
      } catch (e) { console.warn('audit unavailable', e); }
    }
    return S.auditByKey.get(p.key) || [];
  }

  /* ───────────────────────────────────────────────────── link and report */

  function copyLink() {
    var url = location.href;
    var cite = 'Andong Kwŏn ssi Sŏnghwabo 安東權氏成化譜 (1476), ' + SHELFMARK + ', ' + (S.page ? S.page.label : '') +
      '. Digital edition by Javier Cha, v' + VERSION + ', tables of 2025-07-07. ' + url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cite).then(function () { AK.App.toast('Citation and link copied.'); }, function () { AK.App.toast('Copy refused; the URL bar holds the link.'); });
    } else AK.App.toast('The URL bar holds the link.');
  }
  function report() {
    if (!S.page) return;
    var m = $('report-modal');
    $('rp-leaf').textContent = S.page.label + ' · ' + SHELFMARK;
    var who = S.sel && AK.G.node(S.sel);
    $('rp-person').textContent = who ? (who.name || who.id) + (who.roman ? ' · ' + who.roman : '') + ' · ' + who.id : '— (no one selected)';
    $('rp-status').textContent = ''; $('rp-status').classList.remove('err');
    $('rp-send').disabled = false;
    m.classList.remove('hidden');
    setTimeout(function () { $('rp-print').focus(); }, 30);
  }
  function closeReport() { $('report-modal').classList.add('hidden'); }
  function sendReport(ev) {
    ev.preventDefault();
    if (!S.page) return;
    var who = S.sel && AK.G.node(S.sel);
    var body = {
      leaf: S.page.label, person: who ? (who.name || '') + ' ' + who.id : '', url: location.href,
      print_says: $('rp-print').value, table_says: $('rp-table').value, note: $('rp-note').value,
      contact: $('rp-contact').value, website: $('rp-website').value
    };
    if (!(body.print_says.trim() || body.table_says.trim() || body.note.trim())) {
      $('rp-status').textContent = 'Say what the print says, what the table says, or leave a note.'; $('rp-status').classList.add('err'); return;
    }
    $('rp-send').disabled = true; $('rp-status').textContent = 'Sending…'; $('rp-status').classList.remove('err');
    fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || 'refused');
        ['rp-print', 'rp-table', 'rp-note'].forEach(function (id) { $(id).value = ''; });
        closeReport();
        AK.App.toast('Report received' + (res.j.id ? ' as no. ' + res.j.id : '') + '. Thank you.');
      })
      .catch(function (e) { $('rp-send').disabled = false; $('rp-status').textContent = 'Not sent: ' + e.message + '.'; $('rp-status').classList.add('err'); });
  }

  AK.Inspection = {
    init: init, go: go, step: step, onShow: onShow, onResize: onResize, key: key,
    canvas: canvas, page: page, subgraphOf: subgraphOf, showTab: showTab
  };
})();
