#!/usr/bin/env python3
"""Derive web-sized facsimile pages, thumbnails and notebook renders.

  python3 scripts/build_images.py            # only what is missing
  python3 scripts/build_images.py --force    # everything again

facsimile/jpg/songwabo_vol1_06a.jpg (2481x3509, ~0.7 MB)
  -> web/facsimile/pages/vol1_06a.jpg   long side 1800 px, JPEG q82  (~250 KB)
  -> web/facsimile/thumbs/vol1_06a.jpg  long side 320 px,  JPEG q70   (~15 KB)
  -> web/facsimile/full/vol1_06a.jpg    the scan as it is, for deep zoom (~0.7 MB)
inspection/png/vol1_06a.png (6000x2250)
  -> web/notebook/vol1_06a.png          width 1800 px, palette PNG
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
nb_dir = os.path.join(ROOT, 'inspection', 'png')
for f in sorted(os.listdir(nb_dir)):
    m = re.match(r'(vol\d+_\d+[ab])\.png$', f)
    if not m: continue
    key = m.group(1); src = os.path.join(nb_dir, f); dst = os.path.join(ROOT, 'web', 'notebook', key + '.png')
    if out_of_date(src, dst):
        im = Image.open(src).convert('RGB'); w, h = im.size
        im = im.resize((1800, round(h * 1800 / w)), Image.LANCZOS).quantize(colors=64, method=Image.Quantize.MEDIANCUT)
        im.save(dst, 'PNG', optimize=True); n += 1
print('derived', n, 'files')
