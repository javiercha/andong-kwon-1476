/* Andong Kwŏn 1476 — export, over the shared samhan-graph-export module.
 * SVG and PNG of the active canvas; TSV of its rows through the engine provider. */
(function () {
  'use strict';
  var AK = (window.AK = window.AK || {});
  function canvas() { return AK.App.activeCanvas(); }
  function label() { return AK.App.activeLabel() || 'andongkwon1476'; }
  function svg() { if (!window.SamhanGraphExport.svg(canvas(), { label: label() })) AK.App.toast('Draw something before exporting it.', true); }
  function png(scale) { if (!window.SamhanGraphExport.png(canvas(), { label: label(), scale: scale || 2, onError: function (m) { AK.App.toast(m, true); } })) AK.App.toast('Draw something before exporting it.', true); }
  function tsv() {
    var g = canvas(), d = g ? g.data() : null;
    if (!d || !d.nodes.length) return AK.App.toast('Nothing on the canvas to export.', true);
    window.SamhanGraphExport.tsv(AK.provider.rows(d.nodes, d.edges), { label: label() });
  }
  AK.Export = { svg: svg, png: png, tsv: tsv, download: function (n, m, t) { window.SamhanGraphExport.download(n, m, t); } };
})();
