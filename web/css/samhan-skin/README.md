# samhan-skin

The look of samhan.ai as one module: the tokens (both themes), the type, the
imprint strip, the lemma masthead, the tool tab row, the small-screen rules,
the seam with the index (the arrival and departure), the apparatus bracket,
and the hanji sheet — plus `theme.js`, the light-by-day, dark-by-night theme
with its cookie shared across `*.samhan.ai`.

Canonical copy: this directory. Consumers vendor it and record the version.

| file | |
| --- | --- |
| `samhan.css` | the skin, loaded AFTER a site's own `main.css`; it restates the palette and restyles the header, and removes nothing |
| `theme.js` | pasted inline into `<head>` by each site's assembly step, because it must run before first paint |
| `VERSION` | semantic version |

Class names are still the ones Relinkings coined (`.rl-ap`, `.rl-ap-n`,
`.rl-ap-hj`, `.rl-ap-status`, `.rl-stage`, `.rl-id`, `.rl-tabspacer`) and Sebo's
(`.app-title`, `.app-subtitle`, `.brand-group`, `.samhan-imprint`, `.view-toggles`,
`.btn-toggle`, `.topbar-action`, `.bottom-status-bar`). A 2.0 will rename them
`.sh-*` with aliases kept for one version; until then the names are the contract.

Adoption: the edition loads it from here. Sebo and Relinkings carry their own
copies of the same file at `web/css/samhan.css` and `web/index.html` (theme);
replacing them with this directory is the same vendoring step as the canvas.
