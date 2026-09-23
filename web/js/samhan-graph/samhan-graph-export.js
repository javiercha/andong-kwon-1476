/* samhan-graph — taking a drawing away: SVG, PNG and TSV.
 *
 * SVG and PNG of exactly what is on a canvas instance, with the legend redrawn
 * as native SVG from the canvas's own legend rows and every text node given a
 * CJK-capable face, so a PNG of a Korean genealogy never rasterises its hanja
 * in whatever the system has. TSV of the rows the host provides for the
 * people and relations drawn. Nothing leaves the browser.
 *
 *   SamhanGraphExport.svg(canvas, { label })
 *   SamhanGraphExport.png(canvas, { label, scale })
 *   SamhanGraphExport.tsv(rows, { label })          rows = { nodes: [...], edges: [...] } of flat objects
 *   SamhanGraphExport.serialise(canvas) → { text, w, h, bg } | null
 */
(function (root) {
  'use strict';

  var HANJA = "'Noto Serif TC','Noto Serif CJK JP','Noto Serif CJK KR','Songti TC','PingFang TC','Hiragino Mincho ProN',serif";
  var HANGUL = "'Noto Serif KR','Apple SD Gothic Neo','Malgun Gothic',serif";
  var MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
  var LATIN = "Georgia,'Noto Serif','Iowan Old Style',serif";
  var INLINE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
                      'font-family', 'font-size', 'font-weight', 'text-anchor', 'opacity', 'visibility', 'display'];
  var SKIP = { 'none': 1, 'auto': 1, 'normal': 1, '0px': 1 };

  function download(name, mime, text) {
    var blob = text instanceof Blob ? text : new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
  }
  function stamp() {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function inlineStyles(orig, clone) {
    var a = [orig].concat(Array.prototype.slice.call(orig.querySelectorAll('*')));
    var b = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    for (var i = 0; i < a.length && i < b.length; i++) {
      var cs;
      try { cs = window.getComputedStyle(a[i]); } catch (e) { continue; }
      var out = '';
      for (var j = 0; j < INLINE_PROPS.length; j++) {
        var prop = INLINE_PROPS[j], v = cs.getPropertyValue(prop);
        if (!v || SKIP[v.trim()]) continue;
        out += prop + ':' + v.trim() + ';';
      }
      if (out) b[i].setAttribute('style', out + (b[i].getAttribute('style') || ''));
    }
  }
  function inkBounds(src) {
    try {
      var marks = src.querySelectorAll('g.node, g.gen-axis-badge, g.node-label');
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      marks.forEach(function (el) {
        var bb = el.getBBox();
        var t = el.transform && el.transform.baseVal.consolidate();
        var m = t ? t.matrix : { e: 0, f: 0 };
        x0 = Math.min(x0, bb.x + m.e); y0 = Math.min(y0, bb.y + m.f);
        x1 = Math.max(x1, bb.x + bb.width + m.e); y1 = Math.max(y1, bb.y + bb.height + m.f);
      });
      if (isFinite(x0)) return { x0: x0, y0: y0, x1: x1, y1: y1 };
    } catch (e) { /* fall back to the viewport */ }
    return null;
  }

  function serialise(canvas) {
    var src = canvas && canvas.svgNode();
    if (!src || !src.querySelectorAll('g.node').length) return null;
    var P = canvas.palette();
    var clone = src.cloneNode(true);
    inlineStyles(src, clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    var b = inkBounds(src) || canvas.bbox();
    if (!b) return null;
    var pad = 32;
    var w = Math.ceil(b.x1 - b.x0 + pad * 2), h = Math.ceil(b.y1 - b.y0 + pad * 2);
    var vx = Math.floor(b.x0 - pad), vy = Math.floor(b.y0 - pad);
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    clone.setAttribute('viewBox', vx + ' ' + vy + ' ' + w + ' ' + h);
    var zoomRoot = clone.querySelector('g.zoom-root');
    if (zoomRoot) zoomRoot.removeAttribute('transform');
    var NS = 'http://www.w3.org/2000/svg';
    var bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', vx); bg.setAttribute('y', vy);
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%');
    bg.setAttribute('fill', P.bg);
    clone.insertBefore(bg, clone.firstChild);
    var style = document.createElementNS(NS, 'style');
    style.textContent = 'text{font-family:' + HANJA + '}' +
      '.node-label-roman{font-family:' + LATIN + '}' +
      '.node-label-hangul{font-family:' + HANGUL + '}' +
      '.gen-axis-badge text,.edge-label-text{font-family:' + MONO + '}';
    clone.insertBefore(style, clone.firstChild);
    appendLegend(clone, { x: vx, y: vy, w: w, h: h }, P, canvas);
    var out = new XMLSerializer().serializeToString(clone);
    if (out.indexOf('<?xml') !== 0) out = '<?xml version="1.0" encoding="utf-8"?>\n' + out;
    return { text: out, w: w, h: h, bg: P.bg };
  }

  function appendLegend(clone, vb, P, canvas) {
    var rows;
    try { rows = canvas.legendRows(); } catch (e) { return; }
    if (!rows || !rows.length) return;
    rows = rows.filter(function (r) { return !r.node; });
    var W = 236, rowH = 22, H = 26 + rows.length * rowH + 8;
    var NS = 'http://www.w3.org/2000/svg';
    var grp = document.createElementNS(NS, 'g');
    grp.setAttribute('transform', 'translate(' + (vb.x + 16) + ',' + (vb.y + vb.h - H - 16) + ')');
    var panel = document.createElementNS(NS, 'rect');
    panel.setAttribute('width', W); panel.setAttribute('height', H); panel.setAttribute('rx', 2);
    panel.setAttribute('fill', P.pn); panel.setAttribute('stroke', P.rule); panel.setAttribute('stroke-width', 1);
    grp.appendChild(panel);
    var title = document.createElementNS(NS, 'text');
    title.setAttribute('x', 11); title.setAttribute('y', 17);
    title.setAttribute('font-family', MONO); title.setAttribute('font-size', 8.6);
    title.setAttribute('letter-spacing', '0.15em'); title.setAttribute('fill', P.faint);
    title.textContent = 'LEGEND';
    grp.appendChild(title);
    rows.forEach(function (r, i) {
      var y = 26 + i * rowH + 11;
      var tmp = document.createElement('div');
      tmp.innerHTML = r.glyph;
      var svg = tmp.firstChild;
      var line = svg.querySelector('line'), dot = svg.querySelector('circle');
      var colour = (line && line.getAttribute('stroke')) || P.ink;
      var wid = (line && line.getAttribute('stroke-width')) || 2;
      var dash = line && line.getAttribute('stroke-dasharray');
      if (dot) {
        var c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', 12.5); c.setAttribute('cy', y); c.setAttribute('r', 1.6);
        c.setAttribute('fill', colour); c.setAttribute('opacity', 0.85);
        grp.appendChild(c);
      }
      var l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', 12); l.setAttribute('x2', 36.5); l.setAttribute('y1', y); l.setAttribute('y2', y);
      l.setAttribute('stroke', colour); l.setAttribute('stroke-width', wid);
      if (dash) l.setAttribute('stroke-dasharray', dash);
      grp.appendChild(l);
      var a = document.createElementNS(NS, 'path');
      a.setAttribute('d', 'M 36.5,' + (y - 4.2) + ' L 43.5,' + y + ' L 36.5,' + (y + 4.2) + ' Z');
      a.setAttribute('fill', colour);
      grp.appendChild(a);
      var rel = document.createElementNS(NS, 'text');
      rel.setAttribute('x', 51); rel.setAttribute('y', y - 1);
      rel.setAttribute('font-family', MONO); rel.setAttribute('font-size', 9.4); rel.setAttribute('fill', P.ink);
      rel.textContent = r.rel;
      grp.appendChild(rel);
      var sub = document.createElementNS(NS, 'text');
      sub.setAttribute('x', 51); sub.setAttribute('y', y + 8);
      sub.setAttribute('font-family', HANJA); sub.setAttribute('font-size', 8.4); sub.setAttribute('fill', P.faint);
      sub.textContent = r.sub;
      grp.appendChild(sub);
    });
    clone.appendChild(grp);
  }

  function svg(canvas, o) {
    o = o || {};
    var s = serialise(canvas);
    if (!s) return false;
    download((o.label || 'genealogy') + '-' + stamp() + '.svg', 'image/svg+xml;charset=utf-8', s.text);
    return true;
  }
  function png(canvas, o) {
    o = o || {};
    var s = serialise(canvas);
    if (!s) return false;
    var scale = o.scale || 2;
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = Math.max(100, Math.round(s.w * scale));
      c.height = Math.max(100, Math.round(s.h * scale));
      var ctx = c.getContext('2d');
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (blob) { download((o.label || 'genealogy') + '-' + stamp() + '.png', 'image/png', blob); });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function () { if (o.onError) o.onError('The browser refused to rasterise the SVG.'); };
    img.src = URL.createObjectURL(new Blob([s.text], { type: 'image/svg+xml;charset=utf-8' }));
    return true;
  }

  /** Flat objects → TSV text; columns are the union, in first-seen order. */
  function toTSV(rows, columns) {
    if (!rows || !rows.length) return '';
    var cols = columns;
    if (!cols) {
      var seen = Object.create(null); cols = [];
      rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = 1; cols.push(k); } }); });
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
  /** rows = { nodes: [...], edges: [...] } → two downloads. */
  function tsv(rows, o) {
    o = o || {};
    if (!rows || (!(rows.nodes || []).length && !(rows.edges || []).length)) return false;
    var label = o.label || 'genealogy', t = stamp();
    if ((rows.nodes || []).length) download(label + '-nodes-' + t + '.tsv', 'text/tab-separated-values;charset=utf-8', toTSV(rows.nodes, o.nodeColumns));
    if ((rows.edges || []).length) setTimeout(function () {
      download(label + '-edges-' + t + '.tsv', 'text/tab-separated-values;charset=utf-8', toTSV(rows.edges, o.edgeColumns));
    }, 400);
    return true;
  }

  var SamhanGraphExport = { svg: svg, png: png, tsv: tsv, toTSV: toTSV, serialise: serialise, download: download, stamp: stamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = SamhanGraphExport;
  root.SamhanGraphExport = SamhanGraphExport;
})(typeof window !== 'undefined' ? window : this);
