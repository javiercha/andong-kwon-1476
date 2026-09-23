/* samhan-graph — Relinkings adapter.
 *
 * Rebuilds RL.Canvas and RL.Layout on top of one samhan-graph instance, so
 * Relinkings can drop its own js/graph.js without touching app.js, export.js,
 * pgraph.js or detail.js. Load order in index.html:
 *
 *   <script src="js/d3.v7.min.js"></script>
 *   <script src="js/engine.js"></script>
 *   <script src="js/gloss.js"></script>
 *   <script src="js/samhan-graph/samhan-graph.js"></script>
 *   <script src="js/samhan-graph/adapters/relinkings-canvas.js"></script>   ← replaces js/graph.js
 *   <script src="js/detail.js"></script> …
 *
 * RL.Canvas.init(el) is the only call whose behaviour differs: it now creates
 * the instance and copies its methods onto RL.Canvas. Everything app.js calls
 * afterwards — setData, highlight, setFocus, redraw, fit, zoomBy, setOption,
 * setScheme, setLayout, data, frame, svgNode, bbox, palette, legendRows,
 * styles, onNodeClick/Expand/Remove — is there under the same name.
 */
(function () {
  'use strict';
  var RL = (window.RL = window.RL || {});
  if (!window.SamhanGraph) throw new Error('relinkings-canvas adapter: load samhan-graph.js first');

  RL.Layout = window.SamhanGraph.Layout;

  var inst = null;
  RL.Canvas = {
    init: function (el) {
      inst = window.SamhanGraph.create(el, {
        legend: document.getElementById('graph-legend'),
        tooltip: document.getElementById('graph-tooltip'),
        empty: document.getElementById('canvas-empty'),
        onToast: function (m) { if (RL.App && RL.App.toast) RL.App.toast(m); }
      });
      inst.on('edge', function (e) { if (RL.Detail && RL.Detail.showEdge) RL.Detail.showEdge(e); });
      inst.on('patrilineReset', function () {
        var t = document.getElementById('opt-patriline');
        if (t) { t.checked = false; t.dispatchEvent(new Event('change')); }
        else inst.setOption('patrilineMode', false);
      });
      Object.keys(inst).forEach(function (k) {
        if (typeof inst[k] === 'function' && k !== 'el') RL.Canvas[k] = inst[k];
      });
      RL.Canvas.styles = inst.options();
      RL.Canvas.instance = inst;
      return inst;
    }
  };
})();
