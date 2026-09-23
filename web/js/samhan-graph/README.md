# samhan-graph 2.0

The Graph of samhan.ai as one module: the canvas, the tools sidebar and the
export, shared by Sebo 世譜, Relinkings 連姻 and the Andong Kwŏn 1476 edition.
Version 2 carries the whole of Sebo's Graph view, so the three works offer the
same Graph and a fix lands in all of them. Version: see `VERSION`. This
directory is the source of truth; consumers vendor a copy.

## The three layers

| file | what it is |
| --- | --- |
| `samhan-graph.js` | **The canvas.** Sebo's static generation-row layout, family clusters, the four edge routes, the snapped drag, the draggable axis, the fit (with an optional floor); five colour schemes with a picker for every ink and dash; the figures' roles on a path (start, waypoint, target) and the root; custom patrilines with colour, dash, width and editable legend names; the hand-drawn line; single and multi-selection; the floating actions on a selected figure; tooltip and legend. No element ids, no globals, any number of instances on a page, `destroy()`. |
| `samhan-graph-tools.js` | **The sidebar.** Explore Lineage (autocomplete, disambiguation when a name has several men, depth up and down, collateral in-betweens), Find Paths (any number of figures, context depth, in-between connections), Redraw and Clear, Appearance (scheme, HAS_SON and HAS_SIL colour and dash, node fill and stroke, the six specific node colours, four sliders, five switches), Custom Patrilines (cards to add, remove, recolour, restyle and rename), Export (PNG at 1–3×, SVG, TSV). Plus what the pill on a selected figure does: Parents, Children, All, Hide. It renders Sebo's markup, ids and classes into a host element. |
| `samhan-graph-export.js` | **Taking it away.** SVG and PNG of exactly what is drawn, styles inlined, the legend redrawn natively, CJK faces named; TSV of the rows a host provides. |

And the stylesheets `samhan-graph.css` (canvas, legend, tooltip) and
`samhan-graph-tools.css` (the sidebar widgets, the pill, the merge bar, the
disambiguation dialog), all in samhan tokens with neutral fallbacks — a host
with its own rules for the same classes, as Sebo has, wins by loading them
after.

## The contract with a host

The canvas draws a **kinship subgraph**:

```js
{ nodes: [{ id, name (hanja), roman?, hangul?, office?, born?, died? | dates?, choronym?, choronymInferred?,
            isGhost?, generation?, altNames?, notes?, vol?, leaf?, side? }],
  edges: [{ id, source, target, baseType: 'HAS_SON' | 'HAS_SIL' | 'SAME_PERSON', childOrder?, wifeNote?, notes?, evidence? }] }
```

The tools ask a **provider** for what only the host's data knows:

```js
provider.search(q, limit)               → [{ id, name, roman, hangul, choronym, sub }]
provider.resolve(q)                     → [id]
provider.node(id)                       → node
provider.genealogy(id, up, down, opts)  → { nodes, edges }
provider.paths(ids, opts)               → { nodes, edges, terminalIds, pathCount } | null
provider.neighbors(id)                  → { parents: [node], children: [node] }
provider.edgesAmong(ids)                → [edge]
provider.rows(nodes, edges)             → { nodes: [flat], edges: [flat] }      // for TSV
```
Any of them may return a promise. Two providers ship in `adapters/`:
`sebo-provider.js` (over `SeboData`, and it rebuilds `window.SeboGraph`) and
`engine-provider.js` (over Relinkings' engine; it finds every shortest path
between the named men itself).

## API

```js
var g = SamhanGraph.create(el, {
  legend: el, empty: el, tooltip: el | null,        // hosts; the tooltip is created when omitted
  onToast: fn(msg, kind), legendCaption: 'text',
  rows: 'local' | 'index',                          // rows from the drawn edges, or from node.generation
  fitMin: 0.6,                                      // the floor on the fit; 0 for none (Sebo)
  handDrawn: true, scheme: 'default', homeLineage: '安東 權' | '',
  options: { labels: ['roman', 'hanja', 'dates'], labelSize: 15, ... },
  actions: [{ label, icon, title, danger, run(node, api) }, { sep: true }]
});
g.setData({ nodes, edges }, { roles: { root, starts, waypoints, targets }, focus: [ids], anchorId });
g.on('select', fn(node|null)).on('multiselect', fn([ids])).on('click', fn).on('expand', fn).on('remove', fn)
 .on('edge', fn).on('scheme', fn).on('patrilines', fn).on('patrilineReset', fn).on('data', fn);
g.select(id); g.toggleSelect(id); g.selection(); g.selectEdge(e); g.centerOn(id, k); g.setActions(list);
g.highlight({ nodes, edges }); g.setFocus(ids, refit); g.setRoles(roles);
g.render(); g.repaint(); g.redraw(); g.fit(); g.zoomBy(k); g.clear();
g.setScheme('default'|'classic'|'warm'|'cool'|'monochrome'); g.setOption(key, value);
g.patrilines(); g.addPatriline(clan); g.removePatriline(i); g.setPatriline(i, { name, color, style, width }); g.resetPatrilines();
g.options(); g.data(); g.roles(); g.node(id); g.frame(); g.bbox(); g.palette(); g.legendRows(); g.svgNode(); g.destroy();

var tools = SamhanGraphTools.mount(hostEl, { canvas: g, provider, export: SamhanGraphExport, label: 'name',
                                              toast: fn, onDraw: fn(sub, meta), features: { explore, paths, appearance, patrilines, export, tsv } });
tools.explore(id, up, down, opts); tools.findPaths(ids, opts); tools.toggleKin(id, 'parents'|'children'); tools.hide(id); tools.expandAll(id);
```

Options (`setOption`): the eleven colour keys (`hasSonColor`, `hasSilColor`, `sameColor`, `nodeFill`, `nodeStroke`, `nodeStart`, `nodeWaypoint`, `nodeTarget`, `nodeRoot`, `nodeSelected`, `nodeGhost`), `hasSonStyle`, `hasSilStyle` (solid · double · dashed · dotted · dashdot · longdash · densedot · loosdash), `nodeSize`, `edgeWidth`, `edgeOpacity`, `labelSize`, `contextFade`, `patrilineMode`, `showBirthOrder`, `showNames`, `labels` (an array from `roman`, `hanja`, `hangul`, `dates`, `office`), `showLanes`, `edgeGradient`, `handDrawn`, `rows`; and Relinkings' `showHangul` / `showOffice`, which add or remove a label line.

## Where it came from, and what changed

Sebo's `web/js/graph.js` (195 KB) was the drawing and the tools together, bound
to its page by ids. Relinkings ported the drawing (73 KB) and hardened it;
version 1 of this module extracted that port behind options and events. Version
2 brings the rest of Sebo's Graph across:

| Sebo | samhan-graph 2 |
| --- | --- |
| `SeboGraph.styles` with ten colours, two dashes, four sliders, two switches | the same keys in `options()`, set through `setOption`, read by the tools' pickers |
| schemes samhan / classic / warm / cool / monochrome, hard-coded per theme | the same five tables; `default` reads the sheet's tokens |
| `isPathSource / isPathWaypoint / isPathTarget / isRoot` on nodes | `roles` on `setData` |
| the patrilineal-component generation normaliser | `rows: 'local'` (BFS relaxation over the drawn edges, descent first; a detached family offset by the index) |
| `getKinshipOrderInfo` (child_order, hanja ordinals, notes regexes) | `SamhanGraph.kinshipOrder(edge, target)` — the same tables |
| `installHandDrawnFilter` on the layers, never on type | `handDrawn: true`, honouring `html.no-handrule` |
| the floating pill (Parents / Children / Hide) | `actions` — the host says what the buttons do; the tools give Sebo's four |
| shift/⌘-click multi-select and the merge bar | `multiselect` event; the merge bar stays in Sebo's adapter, being a write |
| `showBranch`, `showMultiPath`, `toggleParents/Children`, `hideNode`, `expandAllSubgraphs` | the tools, over a provider |
| SVG and PNG export | + TSV, in `samhan-graph-export.js` |

Not carried across, on purpose: `SeboData.applyNodeMerge` (a write; adapter),
`SeboDetail` and `SeboTable` (host UI; adapter), the entity-id lookup
(`SEBO_E…`; adapter's `resolve`).

## Adoption

- **Andong Kwŏn 1476** — runs on it (two canvases; the Graph tab is the tools with `engine-provider.js`).
- **Sebo** — staged on the `graph-module` branch (worktree `~/projects/sebo-graph`), previewed read-only at `https://zora.tailb7d1f2.ts.net:8180/web/index.html`. `index.html` loads the module and `adapters/sebo-provider.js` in place of `graph.js` and `export.js`, and `#graph-sidebar-controls` is empty; nothing else changed. To adopt: merge `graph-module` into `master`, then restart the live process (JS changes need only a reload; the branch changes no Python).
- **Relinkings** — staged on the `graph-module` branch (worktree `~/projects/relinkings-graph`), previewed at `https://zora.tailb7d1f2.ts.net:8190/web/index.html`. One script tag swapped for two; `app.js`, `export.js`, `pgraph.js` and `detail.js` untouched.

## Versioning

Semantic versions in `VERSION`. Consumers vendor the directory
(`scripts/vendor.sh` in the edition writes `web/VENDORED`); there is no package
manager on any of the three sites and this keeps it that way.
