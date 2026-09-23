/* samhan-graph — the Graph tools: Sebo's sidebar, as a module.
 *
 * Everything a reader can do to the canvas from the side of the screen —
 * explore a lineage, find the paths between figures, redraw or clear, set the
 * appearance down to every ink and dash, name custom patrilines, export —
 * rendered into a host element and bound to one canvas instance through a
 * PROVIDER that answers the questions only the host's data can answer:
 *
 *   provider.search(q, limit)                → [{ id, name, roman, hangul, choronym, sub, meta }]
 *   provider.resolve(q)                      → [id]   (exact id, then exact name, then alias, then substring)
 *   provider.node(id)                        → node
 *   provider.genealogy(id, up, down, opts)   → { nodes, edges }
 *   provider.paths(ids, opts)                → { nodes, edges, terminalIds, pathCount } | null
 *   provider.neighbors(id)                   → { parents: [node], children: [node] }
 *   provider.edgesAmong(ids)                 → [edge]
 *   provider.rows(nodes, edges)              → { nodes: [flat], edges: [flat] }     (TSV)
 * Every one of them may return a promise.
 *
 * The markup keeps Sebo's element ids and classes, so Sebo's stylesheet
 * dresses it as it always did and samhan-graph-tools.css dresses it where a
 * host has nothing of its own. One tools instance per page.
 *
 *   var tools = SamhanGraphTools.mount(hostEl, { canvas, provider, export: SamhanGraphExport,
 *                                                 label: 'sebo', toast: fn, onDraw: fn, features: {...} });
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function P(x) { return Promise.resolve(x); }

  var STYLE_OPTIONS = [['solid', 'Solid (—)'], ['double', 'Double Line (══)'], ['dashed', 'Dashed (- -)'], ['dotted', 'Dotted (···)'],
                       ['dashdot', 'Dash-Dot (– · –)'], ['longdash', 'Long Dash (——)'], ['densedot', 'Dense Dot (••••)'], ['loosdash', 'Loose Dash (—  —)']];
  function styleSelect(cls, value, extra) {
    return '<select class="dropdown-input ' + (cls || '') + '" ' + (extra || '') + '>' + STYLE_OPTIONS.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === value ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select>';
  }

  function markup(f, labels) {
    var h = '';
    if (f.explore) h += '' +
      '<div class="tool-group" data-tool="explore"><h3>' + esc(labels.explore) + '</h3>' +
      '<div class="form-group"><label for="branch-node">Figure Name</label>' +
      '<div class="autocomplete-wrapper"><input type="text" id="branch-node" class="text-input w-full" placeholder="Type name (Hanja, Hangul, MR) or id…" autocomplete="off" spellcheck="false"><div class="autocomplete-dropdown hidden"></div></div></div>' +
      '<div class="form-group row"><label for="depth-ancestors">Ancestors ↑</label><input type="number" id="depth-ancestors" class="number-input" min="0" max="12" value="3"></div>' +
      '<div class="form-group row"><label for="depth-descendants">Descendants ↓</label><input type="number" id="depth-descendants" class="number-input" min="0" max="12" value="3"></div>' +
      '<div class="form-group checkbox-group tool-check-row"><label class="tool-check"><input type="checkbox" id="lineage-collateral" checked><span>Include collateral in-betweens</span></label></div>' +
      '<button type="button" id="btn-find-branch" class="btn btn-primary w-full">' + esc(labels.explore) + '</button></div>';
    if (f.paths) h += '' +
      '<div class="tool-group" data-tool="paths"><div class="tool-group-head"><h3>Find Paths</h3>' +
      '<button type="button" id="btn-add-path-node" class="tool-mini-btn" title="Add another figure to find paths between several"><span class="tool-mini-btn-sign" aria-hidden="true">＋</span> Add Figure</button></div>' +
      '<div id="path-nodes-container" class="path-nodes-container"></div>' +
      '<div class="form-group row tool-row-gap"><label for="path-ancestors">Ancestors ↑</label><input type="number" id="path-ancestors" class="number-input" min="0" max="5" value="0"></div>' +
      '<div class="form-group row"><label for="path-descendants">Descendants ↓</label><input type="number" id="path-descendants" class="number-input" min="0" max="5" value="0"></div>' +
      '<div class="form-group checkbox-group tool-check-row"><label class="tool-check"><input type="checkbox" id="path-in-between" checked><span>Include all in-between connections</span></label></div>' +
      '<button type="button" id="btn-find-path" class="btn btn-secondary w-full">Find Paths</button></div>';
    h += '' +
      '<div class="tool-group canvas-control-group" data-tool="canvas"><div class="tool-btn-pair">' +
      '<button type="button" id="btn-redraw-graph" class="btn btn-secondary tool-btn is-accent" title="Redraw and vertically centre the drawing"><span aria-hidden="true">↻</span><span>Redraw</span></button>' +
      '<button type="button" id="btn-clear-graph" class="btn btn-secondary tool-btn is-clearing" title="Clear every figure and connection from the canvas"><span aria-hidden="true">×</span><span>Clear</span></button></div>' +
      '<div class="clear-graph-hint is-centred">Redraw resets positions and vertically centres the rows</div></div>';
    if (f.appearance) h += '' +
      '<div class="tool-group" data-tool="appearance"><h3>Appearance</h3>' +
      '<div class="form-group"><label for="color-scheme">Color Scheme</label><select id="color-scheme" class="dropdown-input">' +
      '<option value="default">samhan.ai</option><option value="classic">Classic</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="monochrome">Monochrome</option></select></div>' +
      '<div class="form-group appearance-row"><label>HAS_SON</label><div class="input-row"><input type="color" id="color-has-son" class="color-picker">' + styleSelect('flex-1', 'solid', 'id="style-has-son"') + '</div></div>' +
      '<div class="form-group appearance-row"><label>HAS_SIL</label><div class="input-row"><input type="color" id="color-has-sil" class="color-picker">' + styleSelect('flex-1', 'dashed', 'id="style-has-sil"') + '</div></div>' +
      '<div class="form-group appearance-row"><label>Node Fill</label><input type="color" id="color-node-fill" class="color-picker"></div>' +
      '<div class="form-group appearance-row"><label>Node Stroke</label><input type="color" id="color-node-stroke" class="color-picker"></div>' +
      '<details class="specific-colors-details"><summary>Specific Node Colors</summary><div class="details-body">' +
      '<div class="form-group appearance-row is-tight"><label>Start Figure</label><input type="color" id="color-node-start" class="color-picker"></div>' +
      '<div class="form-group appearance-row is-tight"><label>Waypoint Figure</label><input type="color" id="color-node-waypoint" class="color-picker"></div>' +
      '<div class="form-group appearance-row is-tight"><label>Target Figure</label><input type="color" id="color-node-target" class="color-picker"></div>' +
      '<div class="form-group appearance-row is-tight"><label>Root Node</label><input type="color" id="color-node-root" class="color-picker"></div>' +
      '<div class="form-group appearance-row is-tight"><label>Selected Node</label><input type="color" id="color-node-selected" class="color-picker"></div>' +
      '<div class="form-group appearance-row is-tight"><label>Ghost / Inferred Node</label><input type="color" id="color-node-ghost" class="color-picker"></div></div></details>' +
      '<div class="form-group"><label for="slider-node-size">Node Size <span class="val" id="val-node-size">15</span></label><input type="range" id="slider-node-size" min="10" max="40" value="15"></div>' +
      '<div class="form-group"><label for="slider-edge-width">Edge Width <span class="val" id="val-edge-width">2</span></label><input type="range" id="slider-edge-width" min="1" max="6" value="2"></div>' +
      '<div class="form-group"><label for="slider-edge-opacity">Edge Opacity <span class="val" id="val-edge-opacity">78</span>%</label><input type="range" id="slider-edge-opacity" min="10" max="100" value="78"></div>' +
      '<div class="form-group"><label for="slider-label-size">Label Size <span class="val" id="val-label-size">15</span></label><input type="range" id="slider-label-size" min="8" max="24" value="15"></div>' +
      '<div class="tool-toggle-block">' +
      '<div class="form-group toggle-row is-tight"><label class="switch" title="Numeric birth-order badges on the lines"><input type="checkbox" id="toggle-birth-order" checked><span class="slider round"></span></label><span class="tool-toggle-label">Birth Order Labels</span></div>' +
      '<div class="form-group toggle-row is-tight"><label class="switch" title="Lines fade toward the father"><input type="checkbox" id="toggle-edge-gradient" checked><span class="slider round"></span></label><span class="tool-toggle-label">Edge Gradient Fade</span></div>' +
      '<div class="form-group toggle-row is-tight"><label class="switch" title="Names on the figures"><input type="checkbox" id="toggle-names" checked><span class="slider round"></span></label><span class="tool-toggle-label">Names</span></div>' +
      '<div class="form-group toggle-row is-tight"><label class="switch" title="One rule per generation"><input type="checkbox" id="toggle-lanes" checked><span class="slider round"></span></label><span class="tool-toggle-label">Generation Rules</span></div>' +
      '<div class="form-group toggle-row is-tight"><label class="switch" title="The hand-drawn line"><input type="checkbox" id="toggle-hand"><span class="slider round"></span></label><span class="tool-toggle-label">Hand-drawn Line</span></div>' +
      '</div></div>';
    if (f.patrilines) h += '' +
      '<div class="tool-group" data-tool="patrilines"><div class="tool-group-head"><h3>Custom Patrilines</h3>' +
      '<label class="switch" title="Distinguish patrilines with their own colours, line styles and labels"><input type="checkbox" id="toggle-patriline-mode"><span class="slider round"></span></label></div>' +
      '<div class="clear-graph-hint">Override the HAS_SON style for particular clans with a colour, a line style, a width and a legend label. Add or remove patrilines as needed.</div>' +
      '<div id="patriline-controls-box" class="patriline-controls-box"><div id="patriline-list-container" class="patriline-list-container"></div>' +
      '<div class="tool-btn-pair"><button type="button" id="btn-add-patriline" class="btn btn-secondary tool-btn is-adding flex-1"><span aria-hidden="true">＋</span><span>Add Patriline</span></button>' +
      '<button type="button" id="btn-reset-patrilines" class="btn btn-secondary tool-btn" title="Reset the patriline styles">Reset</button></div></div></div>';
    if (f.export) h += '' +
      '<div class="tool-group" data-tool="export"><h3>Export</h3>' +
      '<div class="form-group row"><label for="export-scale">Multiplier</label><select id="export-scale" class="dropdown-input w-auto"><option value="1">1x</option><option value="2" selected>2x</option><option value="3">3x</option></select></div>' +
      '<div class="btn-group-h"><button type="button" id="btn-export-png" class="btn btn-secondary flex-1">PNG</button><button type="button" id="btn-export-svg" class="btn btn-secondary flex-1">SVG</button>' +
      (f.tsv ? '<button type="button" id="btn-export-tsv" class="btn btn-secondary flex-1" title="The people and relations drawn, as two TSV files">TSV</button>' : '') + '</div>' +
      '<div class="clear-graph-hint">Exactly what is drawn, with the legend, in faces that can render hanja.' + (f.tsv ? ' TSV writes the rows of the people and the relations shown.' : '') + '</div></div>';
    return h;
  }

  function mount(host, o) {
    host = typeof host === 'string' ? document.querySelector(host) : host;
    if (!host) throw new Error('samhan-graph-tools: host not found');
    var canvas = o.canvas, provider = o.provider, X = o.export || root.SamhanGraphExport;
    var toast = o.toast || function () {};
    var f = Object.assign({ explore: true, paths: true, appearance: true, patrilines: true, export: true, tsv: true }, o.features || {});
    var labels = Object.assign({ explore: 'Explore Lineage' }, o.labels || {});
    var label = o.label || 'genealogy';
    host.classList.add('sg-tools');
    host.innerHTML = markup(f, labels);
    var $ = function (id) { return host.querySelector('#' + id); };
    var state = { kind: null, root: null, terminalIds: [], up: 3, down: 3, options: {} };

    /* ── resolving what the reader typed ── */
    function idFromInput(v) {
      var s = String(v || '').trim();
      var m = s.match(/\(([^)]+)\)$/) || s.match(/\[([^\]]+)\]$/);
      return m ? m[1].trim() : s;
    }
    function inputLabel(n) {
      return (n.roman || n.hangul || n.name || n.id) + (n.name && n.roman ? ' (' + n.name + ')' : '') + ' (' + n.id + ')';
    }
    function resolveOne(raw) {
      var q = idFromInput(raw);
      return P(provider.node(q)).then(function (n) {
        if (n) return n.id;
        return P(provider.resolve(raw)).then(function (ids) {
          ids = ids || [];
          if (ids.length === 1) return ids[0];
          if (!ids.length) { toast('No figure matches "' + raw + '".', 'warning'); return null; }
          return Promise.all(ids.slice(0, 40).map(function (id) { return P(provider.node(id)); })).then(function (cands) {
            return disambiguate(raw, cands.filter(Boolean));
          });
        });
      });
    }
    function disambiguate(q, cands) {
      return new Promise(function (resolve) {
        var back = document.createElement('div');
        back.className = 'sg-disambig-backdrop';
        back.innerHTML = '<div class="sg-disambig" role="dialog" aria-modal="true"><div class="sg-d-head"><h3>Which ' + esc(q) + '?</h3><button type="button" class="icon-btn" aria-label="Cancel">✕</button></div>' +
          '<div class="sg-d-sub">' + cands.length + ' figures answer to that name. Choose one.</div><div class="sg-d-list">' +
          cands.map(function (n, i) {
            var sub = [n.hangul, Array.isArray(n.choronym) ? n.choronym[0] : n.choronym, n.office, n.dates].filter(Boolean).join(' · ');
            return '<button type="button" class="sg-d-item" data-i="' + i + '"><span class="n">' + esc(n.name || n.id) + '</span>' +
              (n.roman ? '<span class="s">' + esc(n.roman) + '</span>' : '') + (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '<span class="m">' + esc(n.id) + '</span></button>';
          }).join('') + '</div></div>';
        document.body.appendChild(back);
        function done(v) { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
        function onKey(ev) { if (ev.key === 'Escape') done(null); }
        document.addEventListener('keydown', onKey);
        back.querySelector('.icon-btn').addEventListener('click', function () { done(null); });
        back.addEventListener('click', function (ev) { if (ev.target === back) done(null); });
        back.querySelectorAll('.sg-d-item').forEach(function (b) {
          b.addEventListener('click', function () { done(cands[+b.getAttribute('data-i')].id); });
        });
      });
    }

    /* ── autocomplete over provider.search ── */
    function autocomplete(input, drop, onPick) {
      var idx = -1, items = [];
      function close() { drop.classList.add('hidden'); idx = -1; }
      function paint() {
        drop.innerHTML = items.map(function (n, i) {
          var c = Array.isArray(n.choronym) ? n.choronym[0] : (n.choronym || '');
          return '<div class="ac-item' + (i === idx ? ' sel' : '') + '" data-i="' + i + '"><span class="ac-name">' + esc(n.name || n.id) + '</span>' +
            (n.roman ? '<span class="ac-sub" style="font-style:italic">' + esc(n.roman) + '</span>' : '') +
            (n.hangul ? '<span class="ac-sub hangul">' + esc(n.hangul) + '</span>' : '') +
            (c ? '<span class="ac-sub hanja">' + esc(c) + '</span>' : '') +
            '<span class="ac-meta">' + esc(n.sub || n.meta || n.id) + '</span></div>';
        }).join('');
        drop.querySelectorAll('.ac-item').forEach(function (el) {
          el.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(+el.getAttribute('data-i')); });
        });
        drop.classList.remove('hidden');
      }
      function pick(i) { var n = items[i]; if (!n) return; close(); input.value = inputLabel(n); onPick(n); }
      var t;
      input.addEventListener('input', function () {
        clearTimeout(t);
        var q = input.value.trim();
        if (q.length < 1) return close();
        t = setTimeout(function () {
          P(provider.search(q, 12)).then(function (list) {
            items = list || []; idx = -1;
            if (!items.length) return close();
            paint();
          });
        }, 80);
      });
      input.addEventListener('keydown', function (ev) {
        if (drop.classList.contains('hidden')) return;
        if (ev.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); paint(); ev.preventDefault(); }
        else if (ev.key === 'ArrowUp') { idx = Math.max(0, idx - 1); paint(); ev.preventDefault(); }
        else if (ev.key === 'Enter' && idx >= 0) { pick(idx); ev.preventDefault(); ev.stopPropagation(); }
        else if (ev.key === 'Escape') close();
      });
      input.addEventListener('blur', function () { setTimeout(close, 120); });
    }

    /* ── drawing ── */
    function draw(sub, meta) {
      canvas.setData(sub, { roles: meta.roles || {}, anchorId: meta.anchorId, focus: meta.focus });
      state.kind = meta.kind; state.root = meta.root || null; state.terminalIds = meta.terminalIds || []; state.roles = meta.roles || {};
      if (o.onDraw) o.onDraw(sub, meta);
    }
    function explore(id, up, down, options) {
      up = up === undefined ? +($('depth-ancestors') && $('depth-ancestors').value) || 0 : up;
      down = down === undefined ? +($('depth-descendants') && $('depth-descendants').value) || 0 : down;
      options = options || { includeCollateral: !$('lineage-collateral') || $('lineage-collateral').checked };
      state.up = up; state.down = down; state.options = options;
      return P(provider.genealogy(id, up, down, options)).then(function (sub) {
        if (!sub || !sub.nodes || !sub.nodes.length) { toast('No genealogical data found for this figure.', 'warning'); return null; }
        draw(sub, { kind: 'lineage', root: id, up: up, down: down, options: options, roles: { root: id }, anchorId: id });
        toast('Loaded lineage: ' + sub.nodes.length + ' individuals, ' + sub.edges.length + ' connections.', 'success');
        return sub;
      });
    }
    function exploreInput() {
      var v = $('branch-node').value;
      if (!v.trim()) return;
      resolveOne(v).then(function (id) {
        if (!id) return;
        P(provider.node(id)).then(function (n) { if (n) $('branch-node').value = inputLabel(n); });
        explore(id);
      });
    }
    function findPaths(ids, options) {
      options = options || {
        ancestors: +($('path-ancestors') && $('path-ancestors').value) || 0,
        descendants: +($('path-descendants') && $('path-descendants').value) || 0,
        inBetween: !$('path-in-between') || $('path-in-between').checked
      };
      return P(provider.paths(ids, options)).then(function (res) {
        if (!res || !res.nodes || !res.nodes.length) { toast('No connecting kinship path found between the specified figures.', 'warning'); return null; }
        var t = res.terminalIds || ids;
        var roles = { starts: [t[0]], targets: t.length > 1 ? [t[t.length - 1]] : [], waypoints: t.slice(1, -1) };
        draw({ nodes: res.nodes, edges: res.edges }, { kind: 'paths', terminalIds: t, pathCount: res.pathCount, options: options, roles: roles, anchorId: t[0] });
        toast('Found ' + (res.pathCount > 1 ? res.pathCount + ' kinship paths' : 'a kinship path') + ' connecting ' + t.length + ' figures (' + res.nodes.length + ' individuals, ' + res.edges.length + ' connections).', 'success');
        return res;
      });
    }
    function findPathsInput() {
      var inputs = Array.from(host.querySelectorAll('.path-node-input'));
      var raws = inputs.map(function (i) { return i.value.trim(); }).filter(Boolean);
      if (raws.length < 2) return toast('Name at least two figures to find the paths between them.', 'warning');
      var ids = [];
      (function next(i) {
        if (i >= raws.length) return findPaths(ids);
        resolveOne(raws[i]).then(function (id) {
          if (!id) return;
          ids.push(id);
          P(provider.node(id)).then(function (n) { var inp = inputs.filter(function (x) { return x.value.trim() === raws[i]; })[0]; if (n && inp) inp.value = inputLabel(n); });
          next(i + 1);
        });
      })(0);
    }

    /* ── the figures around one man: expand, collapse, hide, everything ── */
    function visibleIds() { return new Set(canvas.data().nodes.map(function (n) { return n.id; })); }
    function redrawWith(ids, extraNodes) {
      var byId = new Map();
      canvas.data().nodes.forEach(function (n) { byId.set(n.id, n); });
      (extraNodes || []).forEach(function (n) { if (!byId.has(n.id)) byId.set(n.id, n); });
      var nodes = Array.from(ids).map(function (id) { return byId.get(id); }).filter(Boolean);
      return P(provider.edgesAmong(Array.from(ids))).then(function (edges) {
        var sub = { nodes: nodes, edges: edges || [] };
        var roles = canvas.roles();
        var anchor = roles.root || (roles.starts && roles.starts[0]) || (nodes[0] && nodes[0].id);
        canvas.setData(sub, { roles: roles, anchorId: anchor });
        if (o.onDraw) o.onDraw(sub, { kind: state.kind, root: state.root, terminalIds: state.terminalIds, roles: roles, anchorId: anchor });
        return sub;
      });
    }
    function toggleKin(id, which) {
      var me = canvas.node(id);
      if (!me) return P(null);
      return P(provider.neighbors(id)).then(function (nb) {
        var kin = (which === 'parents' ? nb.parents : nb.children) || [];
        if (!kin.length) { toast('No ' + which + ' recorded for ' + (me.name || id) + '.', 'info'); return null; }
        var vis = visibleIds();
        var missing = kin.filter(function (n) { return !vis.has(n.id); });
        if (missing.length) {
          missing.forEach(function (n) { vis.add(n.id); });
          toast('Expanded ' + which + ' for ' + (me.name || id) + ' (+' + missing.length + ' figures).', 'success');
          return redrawWith(vis, missing);
        }
        var roles = canvas.roles();
        var remove = kin.map(function (n) { return n.id; }).filter(function (k) { return k !== id && k !== roles.root; });
        if (!remove.length) { toast('Cannot collapse the root figure.', 'info'); return null; }
        remove.forEach(function (k) { vis.delete(k); });
        toast('Collapsed ' + which + ' for ' + (me.name || id) + ' (−' + remove.length + ' figures).', 'info');
        return redrawWith(vis);
      });
    }
    function hide(id) {
      var d = canvas.data();
      if (d.nodes.length <= 1) return toast('Cannot hide the only figure in the view.', 'warning');
      var me = canvas.node(id);
      var vis = visibleIds(); vis.delete(id);
      var edges = d.edges.filter(function (e) { return e.source !== id && e.target !== id && vis.has(e.source) && vis.has(e.target); });
      // prune what the removal disconnected from the anchor
      var roles = canvas.roles();
      var anchor = (roles.root && vis.has(roles.root)) ? roles.root : (roles.starts && roles.starts[0] && vis.has(roles.starts[0]) ? roles.starts[0] : null);
      var adj = new Map(); vis.forEach(function (k) { adj.set(k, []); });
      edges.forEach(function (e) { adj.get(e.source).push(e.target); adj.get(e.target).push(e.source); });
      var keep;
      if (anchor) {
        keep = new Set([anchor]); var q = [anchor];
        while (q.length) { var u = q.shift(); adj.get(u).forEach(function (v) { if (!keep.has(v)) { keep.add(v); q.push(v); } }); }
      } else {
        keep = new Set(); edges.forEach(function (e) { keep.add(e.source); keep.add(e.target); });
        if (!keep.size) keep = vis;
      }
      var removed = d.nodes.length - keep.size - 1;
      redrawWith(keep).then(function () {
        toast('Removed ' + (me ? me.name : id) + (removed > 0 ? ' and ' + removed + ' isolated figure' + (removed > 1 ? 's' : '') : '') + ' from view.', 'info');
      });
    }
    function expandAll(id) {
      var me = canvas.node(id);
      var seen = new Set([id]), queue = [id], found = [];
      (function step() {
        if (!queue.length) return finish();
        var cur = queue.shift();
        P(provider.neighbors(cur)).then(function (nb) {
          (nb.parents || []).concat(nb.children || []).forEach(function (n) {
            if (!seen.has(n.id)) { seen.add(n.id); found.push(n); queue.push(n.id); }
          });
          if (seen.size > 1200 && !confirm('This will add ' + seen.size + '+ individuals to the drawing and may be slow. Continue?')) { queue = []; }
          step();
        });
      })();
      function finish() {
        var vis = visibleIds();
        var add = found.filter(function (n) { return !vis.has(n.id); });
        add.forEach(function (n) { vis.add(n.id); });
        redrawWith(vis, add).then(function () {
          toast(add.length ? 'Expanded the whole subgraph for ' + (me ? me.name : id) + ' (+' + add.length + ' individuals).' : 'Every connected kinsman of ' + (me ? me.name : id) + ' is already drawn.', add.length ? 'success' : 'info');
        });
      }
    }

    /* ── wiring ── */
    if (f.explore) {
      autocomplete($('branch-node'), host.querySelector('#branch-node + .autocomplete-dropdown'), function (n) { explore(n.id); });
      $('btn-find-branch').addEventListener('click', exploreInput);
      $('branch-node').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') exploreInput(); });
    }
    if (f.paths) {
      var pc = $('path-nodes-container'), pn = 0;
      function relabel() {
        var rows = pc.querySelectorAll('.path-node-row'), total = rows.length;
        rows.forEach(function (r, i) {
          r.querySelector('.path-node-label').textContent = i === 0 ? 'Figure 1 (Start)' : i === total - 1 ? 'Figure ' + (i + 1) + ' (Target)' : 'Figure ' + (i + 1) + ' (Waypoint)';
          r.querySelector('.path-node-remove-btn').style.display = total > 2 ? '' : 'none';
        });
      }
      function addPathRow(v) {
        var row = document.createElement('div');
        row.className = 'path-node-row';
        var id = 'path-node-' + (pn++);
        row.innerHTML = '<div class="path-node-row-header"><label class="path-node-label" for="' + id + '">Figure</label><button type="button" class="path-node-remove-btn" title="Remove figure">✕</button></div>' +
          '<div class="autocomplete-wrapper"><input type="text" id="' + id + '" class="text-input w-full path-node-input" placeholder="Figure name or id…" autocomplete="off" spellcheck="false" value="' + esc(v || '') + '"><div class="autocomplete-dropdown hidden"></div></div>';
        pc.appendChild(row);
        var inp = row.querySelector('input');
        row.querySelector('.path-node-remove-btn').addEventListener('click', function () { row.remove(); relabel(); });
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') findPathsInput(); });
        autocomplete(inp, row.querySelector('.autocomplete-dropdown'), function () {});
        relabel();
        return inp;
      }
      addPathRow(); addPathRow();
      $('btn-add-path-node').addEventListener('click', function () { addPathRow().focus(); });
      $('btn-find-path').addEventListener('click', findPathsInput);
    }
    $('btn-redraw-graph').addEventListener('click', function () { canvas.redrawAnnounced(); });
    $('btn-clear-graph').addEventListener('click', function () { canvas.clear(); state.kind = null; state.root = null; state.terminalIds = []; if (o.onDraw) o.onDraw(null, { kind: null }); });

    var COLOR_IDS = { 'color-has-son': 'hasSonColor', 'color-has-sil': 'hasSilColor', 'color-node-fill': 'nodeFill', 'color-node-stroke': 'nodeStroke',
                      'color-node-start': 'nodeStart', 'color-node-waypoint': 'nodeWaypoint', 'color-node-target': 'nodeTarget',
                      'color-node-root': 'nodeRoot', 'color-node-selected': 'nodeSelected', 'color-node-ghost': 'nodeGhost' };
    function hex(c) {
      try { var d = root.d3 && root.d3.color(c); return d ? d.formatHex() : (c || '#000000'); } catch (e) { return c || '#000000'; }
    }
    function syncFromCanvas() {
      if (!f.appearance) return;
      var s = canvas.options();
      $('color-scheme').value = s.colorScheme;
      Object.keys(COLOR_IDS).forEach(function (id) { var el = $(id); if (el && s[COLOR_IDS[id]]) el.value = hex(s[COLOR_IDS[id]]); });
      $('style-has-son').value = s.hasSonStyle; $('style-has-sil').value = s.hasSilStyle;
      $('slider-node-size').value = s.nodeSize; $('val-node-size').textContent = s.nodeSize;
      $('slider-edge-width').value = s.edgeWidth; $('val-edge-width').textContent = s.edgeWidth;
      $('slider-edge-opacity').value = Math.round(s.edgeOpacity * 100); $('val-edge-opacity').textContent = Math.round(s.edgeOpacity * 100);
      $('slider-label-size').value = s.labelSize; $('val-label-size').textContent = s.labelSize;
      $('toggle-birth-order').checked = !!s.showBirthOrder; $('toggle-edge-gradient').checked = !!s.edgeGradient;
      $('toggle-names').checked = !!s.showNames; $('toggle-lanes').checked = !!s.showLanes; $('toggle-hand').checked = !!s.handDrawn;
      if (f.patrilines) { $('toggle-patriline-mode').checked = !!s.patrilineMode; $('patriline-controls-box').classList.toggle('on', !!s.patrilineMode); }
    }
    if (f.appearance) {
      $('color-scheme').addEventListener('change', function () { canvas.setScheme(this.value); syncFromCanvas(); });
      Object.keys(COLOR_IDS).forEach(function (id) {
        var el = $(id); if (!el) return;
        el.addEventListener('input', function () { canvas.setOption(COLOR_IDS[id], el.value); });
      });
      $('style-has-son').addEventListener('change', function () { canvas.setOption('hasSonStyle', this.value); });
      $('style-has-sil').addEventListener('change', function () { canvas.setOption('hasSilStyle', this.value); });
      [['slider-node-size', 'nodeSize', 'val-node-size', 1], ['slider-edge-width', 'edgeWidth', 'val-edge-width', 1],
       ['slider-edge-opacity', 'edgeOpacity', 'val-edge-opacity', 100], ['slider-label-size', 'labelSize', 'val-label-size', 1]].forEach(function (t) {
        $(t[0]).addEventListener('input', function () { var v = +this.value; $(t[2]).textContent = v; canvas.setOption(t[1], v / t[3]); });
      });
      [['toggle-birth-order', 'showBirthOrder'], ['toggle-edge-gradient', 'edgeGradient'], ['toggle-names', 'showNames'], ['toggle-lanes', 'showLanes'], ['toggle-hand', 'handDrawn']].forEach(function (t) {
        $(t[0]).addEventListener('change', function () { canvas.setOption(t[1], this.checked); });
      });
    }

    function renderPatrilineCards() {
      if (!f.patrilines) return;
      var box = $('patriline-list-container'), list = canvas.patrilines();
      if (!list.length) { box.innerHTML = '<div class="empty-patrilines">No custom patrilines yet. Press <strong>＋ Add Patriline</strong> to add one.</div>'; return; }
      box.innerHTML = list.map(function (p, i) {
        return '<div class="patriline-card" data-i="' + i + '"><div class="patriline-card-head"><span class="patriline-card-n">Patriline ' + (i + 1) + '</span>' +
          '<button type="button" class="btn-remove-patriline icon-btn" title="Remove this patriline">✕</button></div>' +
          '<input type="text" class="patriline-label-input text-input w-full" value="' + esc(p.name) + '" placeholder="Clan / label (e.g. 仁州 李)">' +
          '<div class="input-row"><input type="color" class="patriline-color-picker color-picker" value="' + hex(p.color) + '" title="Patriline colour">' +
          styleSelect('patriline-style-select flex-1', p.style) +
          '<select class="patriline-width-select dropdown-input">' + [1, 1.5, 2, 2.5, 3, 4].map(function (w) { return '<option value="' + w + '"' + ((p.width || 2) === w ? ' selected' : '') + '>' + w.toFixed(1) + 'px</option>'; }).join('') + '</select></div></div>';
      }).join('');
      box.querySelectorAll('.patriline-card').forEach(function (card) {
        var i = +card.getAttribute('data-i');
        card.querySelector('.patriline-label-input').addEventListener('change', function () { canvas.setPatriline(i, { name: this.value }); });
        card.querySelector('.patriline-color-picker').addEventListener('input', function () { canvas.setPatriline(i, { color: this.value }); });
        card.querySelector('.patriline-style-select').addEventListener('change', function () { canvas.setPatriline(i, { style: this.value }); });
        card.querySelector('.patriline-width-select').addEventListener('change', function () { canvas.setPatriline(i, { width: this.value }); });
        card.querySelector('.btn-remove-patriline').addEventListener('click', function () { canvas.removePatriline(i); });
      });
    }
    if (f.patrilines) {
      $('toggle-patriline-mode').addEventListener('change', function () {
        $('patriline-controls-box').classList.toggle('on', this.checked);
        canvas.setOption('patrilineMode', this.checked);
      });
      $('btn-add-patriline').addEventListener('click', function () { canvas.addPatriline(''); });
      $('btn-reset-patrilines').addEventListener('click', function () { canvas.resetPatrilines(); });
      canvas.on('patrilines', renderPatrilineCards);
      canvas.on('patrilineReset', function () { $('toggle-patriline-mode').checked = false; $('patriline-controls-box').classList.remove('on'); });
      renderPatrilineCards();
    }
    canvas.on('scheme', syncFromCanvas);
    syncFromCanvas();

    if (f.export && X) {
      $('btn-export-svg').addEventListener('click', function () { if (!X.svg(canvas, { label: label })) toast('Draw a graph before exporting it.', 'warning'); });
      $('btn-export-png').addEventListener('click', function () {
        if (!X.png(canvas, { label: label, scale: +$('export-scale').value || 2, onError: function (m) { toast(m, 'error'); } })) toast('Draw a graph before exporting it.', 'warning');
      });
      if (f.tsv && $('btn-export-tsv')) $('btn-export-tsv').addEventListener('click', function () {
        var d = canvas.data();
        if (!d.nodes.length) return toast('Nothing on the canvas to export.', 'warning');
        P(provider.rows(d.nodes, d.edges)).then(function (rows) { X.tsv(rows, { label: label }); });
      });
    }

    // the actions on a selected figure, and a double-click
    canvas.setActions([
      { label: 'Parents', icon: '⬆', title: 'Toggle immediate parents (+1 generation up)', run: function (n) { toggleKin(n.id, 'parents'); } },
      { label: 'Children', icon: '⬇', title: 'Toggle immediate children (−1 generation down)', run: function (n) { toggleKin(n.id, 'children'); } },
      { label: 'All', icon: '⤢', title: 'Draw every connected ancestor and descendant', run: function (n) { expandAll(n.id); } },
      { sep: true },
      { label: 'Hide', icon: '✕', danger: true, title: 'Hide this figure and its connections', run: function (n) { hide(n.id); } }
    ]);
    canvas.on('expand', function (n) { toggleKin(n.id, 'children'); });
    canvas.on('remove', function (n) { hide(n.id); });

    return {
      explore: explore, findPaths: findPaths, toggleKin: toggleKin, hide: hide, expandAll: expandAll, resolve: resolveOne,
      setInput: function (v) { if ($('branch-node')) $('branch-node').value = v || ''; },
      input: function () { return $('branch-node') ? $('branch-node').value : ''; },
      state: function () { return state; }, sync: syncFromCanvas, refreshPatrilines: renderPatrilineCards,
      destroy: function () { host.innerHTML = ''; host.classList.remove('sg-tools'); }
    };
  }

  var SamhanGraphTools = { mount: mount, markup: markup };
  if (typeof module !== 'undefined' && module.exports) module.exports = SamhanGraphTools;
  root.SamhanGraphTools = SamhanGraphTools;
})(typeof window !== 'undefined' ? window : this);
