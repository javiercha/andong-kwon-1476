#!/usr/bin/env python3
"""Derive web-sized facsimile pages and thumbnails; copy the full scans; prepare the notebook's SVG renders.

  python3 scripts/build_images.py            # only what is missing
  python3 scripts/build_images.py --force    # everything again

facsimile/jpg/songwabo_vol1_06a.jpg (2481x3509, ~0.7 MB)
  -> web/facsimile/pages/vol1_06a.jpg   long side 1800 px, JPEG q82  (~250 KB)
  -> web/facsimile/thumbs/vol1_06a.jpg  long side 320 px,  JPEG q70   (~15 KB)
  -> web/facsimile/full/vol1_06a.jpg    the scan as it is, for deep zoom (~0.7 MB)
inspection/png/vol1_06a.png (6000x2250)
  -> web/notebook/vol1_06a.svg          the notebook's SVG render, styles turned into classes, sheet removed (~180 KB)
The originals are never touched. Derivatives are gitignored and rebuilt by this
script; the site serves only the derivatives.
"""
import os, re, shutil, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORCE = '--force' in sys.argv
def out_of_date(src, dst): return FORCE or not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src)
n = 0
for d in ('facsimile/pages', 'facsimile/thumbs', 'facsimile/full', 'notebook'):
    os.makedirs(os.path.join(ROOT, 'web', d), exist_ok=True)
src_dir = os.path.join(ROOT, 'facsimile', 'jpg')
for f in sorted(os.listdir(src_dir)):
    m = re.match(r'songwabo_(vol\d+_\d+[ab])\.jpg$', f)
    if not m: continue
    key = m.group(1); src = os.path.join(src_dir, f)
    page = os.path.join(ROOT, 'web', 'facsimile', 'pages', key + '.jpg')
    thumb = os.path.join(ROOT, 'web', 'facsimile', 'thumbs', key + '.jpg')
    full = os.path.join(ROOT, 'web', 'facsimile', 'full', key + '.jpg')
    if out_of_date(src, full):
        # deep zoom: the scan as it is, byte for byte, fetched only past 1.35x
        shutil.copyfile(src, full); n += 1
    if out_of_date(src, page) or out_of_date(src, thumb):
        im = Image.open(src).convert('RGB')
        big = im.copy(); big.thumbnail((1800, 1800), Image.LANCZOS); big.save(page, 'JPEG', quality=82, optimize=True, progressive=True)
        sm = im.copy(); sm.thumbnail((320, 320), Image.LANCZOS); sm.save(thumb, 'JPEG', quality=70, optimize=True)
        n += 1
# The notebook's SVG renders, made web-native: the XML prologue, the DOCTYPE
# and the metadata go; the white figure sheet goes (the page's own sheet shows
# through); matplotlib's inline styles become classes, so the page can colour
# the lines, the glyphs, the label boxes and the nodes with its theme's tokens.
# Glyphs are already paths (no font is needed). The page inlines the file.
STYLE_CLASS = {
    'fill: #add8e6; fill-opacity: 0.85; stroke: #add8e6; stroke-opacity: 0.85': 'nb-node',
    'stroke: #add8e6; stroke-opacity: 0.85': 'nb-node',
    'stroke: #000000; stroke-width: 2; stroke-linecap: round': 'nb-ink',
    'fill: none; stroke: #000000; stroke-width: 2; stroke-linecap: round': 'nb-line',
    'fill: #ffffff; stroke: #ffffff; stroke-linejoin: miter': 'nb-box',
}
def web_svg(text):
    text = re.sub(r'<\?xml[^>]*\?>\s*', '', text)
    text = re.sub(r'<!DOCTYPE[^>]*>\s*', '', text, flags=re.S)
    text = re.sub(r'\s*<metadata>.*?</metadata>', '', text, flags=re.S)
    # matplotlib's <style>*{…}</style> would apply to the whole page once inlined; app.css restates it scoped
    text = re.sub(r'\s*<defs>\s*<style type="text/css">\*\{[^}]*\}</style>\s*</defs>', '', text, flags=re.S)
    text = re.sub(r'\s*<g id="patch_1">\s*<path d="[^"]*"\s*style="fill: #ffffff"/>\s*</g>', '', text, flags=re.S)
    text = re.sub(r'\s*<g id="patch_1">.*?</g>', '', text, count=1, flags=re.S) if 'id="patch_1"' in text else text
    def cls(m):
        c = STYLE_CLASS.get(m.group(1))
        return 'class="%s"' % c if c else m.group(0)
    text = re.sub(r'style="([^"]*)"', cls, text)
    return text
nb_dir = os.path.join(ROOT, 'inspection', 'svg')
for f in sorted(os.listdir(nb_dir)):
    m = re.match(r'(vol\d+_\d+[ab])\.svg$', f)
    if not m: continue
    key = m.group(1); src = os.path.join(nb_dir, f); dst = os.path.join(ROOT, 'web', 'notebook', key + '.svg')
    if out_of_date(src, dst):
        with open(src, encoding='utf-8') as fh: text = fh.read()
        with open(dst, 'w', encoding='utf-8') as fh: fh.write(web_svg(text))
        n += 1
print('derived', n, 'files')
