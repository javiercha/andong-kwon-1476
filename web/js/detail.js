/* Andong Kwŏn 1476 — the record drawer.
 *
 * What the 1476 print says about one man, and where it says it. Adapted from
 * Relinkings' detail.js: the same fields, shown even when empty, because an
 * absent office or an absent folio is itself a fact about the print. Two
 * changes for an edition read leaf by leaf: every folio is a link that opens
 * that leaf in Inspection, and every kinsman is a button that opens *his*
 * record — the drawer is a way of walking the genealogy without leaving the
 * page one is checking.
 */
(function () {
  'use strict';
  var AK = (window.AK = window.AK || {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function chor(n) {
    if (n.choronym == null || n.choronym === '') return null;
    return Array.isArray(n.choronym) ? n.choronym.join(' / ') : n.choronym;
  }
  function hasFolio(x) { return x && x.vol && x.leaf && x.side; }
  function folioText(x) {
    if (!hasFolio(x)) return '';
    return 'vol. ' + x.vol + ' · leaf ' + x.leaf + x.side;
  }
  function folioLink(x) {
    if (!hasFolio(x)) return '<span class="empty">not recorded</span>';
    return '<a class="d-folio" data-vol="' + x.vol + '" data-leaf="' + x.leaf + '" data-side="' + esc(x.side) + '" ' +
      'title="Open this leaf in Inspection">' + esc(folioText(x)) + '</a>';
  }
  function ord(n) {
    var i = parseInt(n, 10);
    var W = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
    return (i > 0 && i < W.length) ? W[i] : (isNaN(i) ? '' : i + 'th');
  }
  function kinRow(n, meta) {
    return '<button type="button" data-id="' + esc(n.id) + '">' +
      '<span class="k-name">' + esc(n.name || n.id) + '</span>' +
      (n.roman ? '<span class="k-roman">' + esc(n.roman) + '</span>' : '') +
      (n.office ? '<span class="hanja" style="font-size:11px;color:var(--color-text-faint)">' + esc(n.office) + '</span>' : '') +
      '<span class="k-meta">' + esc(meta || n.id) + '</span></button>';
  }

  var current = null;

  function open() {
    var drawer = document.getElementById('detail-panel');
    if (drawer) drawer.classList.remove('collapsed');
  }
  function wire(el, node) {
    el.querySelectorAll('.d-kin button').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = AK.G.node(b.getAttribute('data-id'));
        if (n) show(n);
      });
    });
    el.querySelectorAll('a.d-folio').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        AK.App.goLeaf(+a.getAttribute('data-vol'), +a.getAttribute('data-leaf'), a.getAttribute('data-side'),
                      node ? { select: node.id } : {});
      });
    });
    var draw = el.querySelector('#d-draw');
    if (draw && node) draw.addEventListener('click', function () { AK.App.focusOn(node); });
    var cite = el.querySelector('#d-cite');
    if (cite && node) cite.addEventListener('click', function () { copyCitation(node); });
  }

  /* Relinkings reads its query from the hash: #q= base64 of the JSON state,
     as its own Copy-URL writes it. The ego query is the one a person opens. */
  function relinkingsURL(node) {
    var q = { t: 'ego', starts: [node.id], ancestorDepth: 2, descendantDepth: 2 };
    var b64 = '';
    try { b64 = btoa(unescape(encodeURIComponent(JSON.stringify(q)))).replace(/=+$/, ''); } catch (e) {}
    return 'https://relinkings.samhan.ai/#q=' + b64;
  }
  function citationOf(node) {
    var leaf = hasFolio(node) ? 'vol. ' + node.vol + ' leaf ' + node.leaf + node.side : 'no leaf recorded';
    var url = location.origin + location.pathname + (hasFolio(node) ? '#/leaf/' + node.vol + '/' + node.leaf + node.side + '/' : '#/person/') + encodeURIComponent(node.id);
    return 'Cha, Javier. The Andong Kwŏn Genealogy of 1476 (安東權氏成化譜), v0.9, ' + leaf + ', ' + (node.name || node.id) +
      (node.roman ? ' (' + node.roman + ')' : '') + ' [' + node.id + ']. samhan.ai, 2026. ' + url;
  }
  function copyCitation(node) {
    var text = citationOf(node);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { AK.App.toast('Citation copied.'); }, function () { AK.App.toast(text); });
    } else AK.App.toast(text);
  }

  function show(node) {
    var G = AK.G, el = document.getElementById('detail-content');
    if (!el || !G || !node) return;
    current = node;
    open();

    var sons = [], sils = [], fathers = [], fils = [];
    (G.out.get(node.id) || []).forEach(function (e) {
      var t = G.node(e.target);
      if (t) (e.baseType === 'HAS_SIL' ? sils : sons).push({ n: t, e: e });
    });
    (G.in.get(node.id) || []).forEach(function (e) {
      var s = G.node(e.source);
      if (s) (e.baseType === 'HAS_SIL' ? fils : fathers).push({ n: s, e: e });
    });
    sons.sort(function (a, b) { return (a.e.childOrder || 999) - (b.e.childOrder || 999); });
    sils.sort(function (a, b) { return (a.e.childOrder || 999) - (b.e.childOrder || 999); });

    var c = chor(node);
    var html = '';
    html += '<div class="d-name">' + esc(node.name || node.id) +
            (node.hangul ? '<span class="d-hangul hangul">' + esc(node.hangul) + '</span>' : '') + '</div>';
    if (node.roman) html += '<div class="d-roman">' + esc(node.roman) + '</div>';
    html += '<div class="d-sub">' + esc(node.id) +
            (node.generation != null ? ' · GENERATION ' + node.generation : ' · GENERATION —') + '</div>';

    html += '<dl class="d-fields">';
    html += '<dt>lineage</dt><dd class="' + (c ? 'hj' : 'empty') + '">' + (c ? esc(c) : '—') +
            (node.choronymInferred ? ' <span class="d-inferred">INFERRED</span>' : '') + '</dd>';
    html += '<dt>office</dt><dd class="' + (node.office ? 'hj' : 'empty') + '">' + (node.office ? esc(node.office) : '—') + '</dd>';
    var alts = node.altNames || [];
    html += '<dt>alt. names</dt><dd class="' + (alts.length ? 'hj' : 'empty') + '">' +
            (alts.length ? alts.map(esc).join(' · ') : '—') + '</dd>';
    html += '<dt>leaf</dt><dd class="mono">' + folioLink(node) + '</dd>';
    html += '<dt>source</dt><dd class="' + (node.reference ? 'hj' : 'empty') + '">' + (node.reference ? esc(node.reference) : '—') + '</dd>';
    if (node.notes) html += '<dt>notes</dt><dd>' + esc(node.notes) + '</dd>';
    html += '<dt>ties</dt><dd class="mono">' + (G.out.get(node.id) || []).length + ' downward · ' +
            (G.in.get(node.id) || []).length + ' upward</dd>';
    html += '</dl>';

    function sec(title, list, meta) {
      if (!list.length) return '';
      var s = '<div class="d-sec"><h4>' + title + ' <span style="color:var(--color-text-faint)">' + list.length + '</span></h4><div class="d-kin">';
      list.forEach(function (x) { s += kinRow(x.n, meta(x)); });
      return s + '</div></div>';
    }
    html += sec('Father 父', fathers, function (x) {
      return x.e.childOrder ? 'his ' + ord(x.e.childOrder) + ' son' : 'father';
    });
    html += sec('Father-in-law 舅', fils, function (x) {
      return x.e.wifeNote ? 'wife’s father · ' + x.e.wifeNote : 'wife’s father';
    });
    html += sec('Sons 子', sons, function (x) {
      return (x.e.childOrder ? 'son no. ' + x.e.childOrder : 'son') + (hasFolio(x.e) && folioText(x.e) !== folioText(node) ? ' · ' + folioText(x.e) : '');
    });
    html += sec('Sons-in-law 壻', sils, function (x) {
      return (x.e.wifeNote ? 'married a daughter · ' + x.e.wifeNote : 'married a daughter') +
        (hasFolio(x.e) && folioText(x.e) !== folioText(node) ? ' · ' + folioText(x.e) : '');
    });

    html += '<div class="d-sec"><div class="btn-row d-cite-row">' +
      '<button type="button" class="btn btn-sm btn-primary" id="d-draw">Draw his kin in Graph</button>' +
      '<button type="button" class="btn btn-sm" id="d-cite" title="Copy a citation of this man in the edition, with his leaf and a stable link">Cite him</button>' +
      '<a class="btn btn-sm d-rl" id="d-rl" href="' + esc(relinkingsURL(node)) + '" target="_blank" rel="noopener" title="Open his ego network in Relinkings, where the lines that close on him can be argued">Relinkings ↗</a>' +
      '</div><div class="tool-note" style="margin-top:6px">Two generations up and down, on the Graph tab. ' +
      'The leaf citation above opens the page of the print he stands on. Nothing here alters the record.</div></div>';

    el.innerHTML = html;
    wire(el, node);
  }

  function showEdge(e) {
    var G = AK.G, el = document.getElementById('detail-content');
    if (!el || !G || !e) return;
    current = null;
    open();
    var s = G.node(e.source), t = G.node(e.target);
    var marriage = e.baseType === 'HAS_SIL';
    var html = '';
    html += '<div class="d-name">' + esc(s ? (s.name || s.id) : e.source) +
            '<span class="d-arrow">' + (marriage ? '室' : '子') + '</span>' +
            esc(t ? (t.name || t.id) : e.target) + '</div>';
    if ((s && s.roman) || (t && t.roman)) {
      html += '<div class="d-roman">' + esc(s && s.roman ? s.roman : e.source) + ' → ' +
              esc(t && t.roman ? t.roman : e.target) + '</div>';
    }
    html += '<div class="d-sub">' + esc(e.baseType) + ' · ' +
            (marriage ? 'MARRIAGE' : 'DESCENT') + (e.kwon ? ' · BOTH ANDONG KWŎN' : '') + '</div>';
    html += '<dl class="d-fields">';
    html += '<dt>relation</dt><dd>' + (marriage
      ? 'the second married a daughter of the first'
      : 'the second is a recorded son of the first') + '</dd>';
    html += '<dt>' + (marriage ? 'daughter' : 'birth order') + '</dt><dd class="' + (e.childOrder ? 'mono' : 'empty') + '">' +
            (e.childOrder ? (marriage ? 'daughter no. ' : 'son no. ') + e.childOrder : '—') + '</dd>';
    html += '<dt>qualifier</dt><dd class="' + (e.wifeNote ? 'hj' : 'empty') + '">' + (e.wifeNote ? esc(e.wifeNote) : '—') + '</dd>';
    html += '<dt>leaf</dt><dd class="mono">' + folioLink(e) + '</dd>';
    html += '<dt>source</dt><dd class="' + (e.reference ? 'hj' : 'empty') + '">' + (e.reference ? esc(e.reference) : '—') + '</dd>';
    html += '<dt>checked</dt><dd class="' + (e.checked != null ? 'mono' : 'empty') + '">' +
            (e.checked != null ? (e.checked ? 'yes' : 'no') : '—') + '</dd>';
    if (e.notes) html += '<dt>notes</dt><dd>' + esc(e.notes) + '</dd>';
    html += '</dl>';
    html += '<div class="d-sec"><h4>' + (marriage ? 'Father of the bride 舅' : 'Father 父') + '</h4><div class="d-kin">' +
            (s ? kinRow(s, s.id) : '<span class="k-name mono">' + esc(e.source) + '</span>') + '</div></div>';
    html += '<div class="d-sec"><h4>' + (marriage ? 'Husband 壻' : 'Son 子') + '</h4><div class="d-kin">' +
            (t ? kinRow(t, t.id) : '<span class="k-name mono">' + esc(e.target) + '</span>') + '</div></div>';
    el.innerHTML = html;
    wire(el, null);
  }

  function clear() {
    var el = document.getElementById('detail-content');
    if (el) el.innerHTML = '<div class="detail-empty">Click a figure on the leaf or the canvas to read his record.</div>';
    current = null;
  }

  AK.Detail = { citationOf: citationOf, relinkingsURL: relinkingsURL, show: show, showEdge: showEdge, clear: clear, current: function () { return current; } };
})();
