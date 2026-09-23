#!/usr/bin/env python3
"""Assemble web/index.html from web/index.template.html.

Three inline blocks are shared with samhan.ai, Sebo and Relinkings and must
stay verbatim copies: the theme (css/samhan-skin/theme.js on disk is canonical), the
arrival half of the lemma transition, and the hanji mat. This script pastes
them in, so the template holds markers rather than copies that drift.

    python3 scripts/assemble.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
RL = os.path.expanduser('~/projects/relinkings/web/index.html')


def block(text, start_pat, end_pat):
    m = re.search(start_pat, text, re.S)
    if not m:
        sys.exit('marker not found: ' + start_pat)
    rest = text[m.end():]
    e = re.search(end_pat, rest, re.S)
    return rest[:e.start()].rstrip('\n')


def main():
    tpl = open(os.path.join(WEB, 'index.template.html'), encoding='utf-8').read()
    theme = open(os.path.join(WEB, 'css', 'samhan-skin', 'theme.js'), encoding='utf-8').read().rstrip('\n')

    # the other two blocks are taken from Relinkings' page when it is present,
    # and otherwise from the copies kept beside this script
    arrival = hanji = None
    if os.path.exists(RL):
        rl = open(RL, encoding='utf-8').read()
        arrival = block(rl, r'<!-- The arrival half of the lemma transition\..*?-->\n  <script>\n', r'\n  </script>')
        hanji = block(rl, r'<div class="hanji-edge" aria-hidden="true"></div>\n  <script>\n', r'\n  </script>')
        open(os.path.join(ROOT, 'scripts', 'shared', 'arrival.js'), 'w', encoding='utf-8').write(arrival + '\n')
        open(os.path.join(ROOT, 'scripts', 'shared', 'hanji.js'), 'w', encoding='utf-8').write(hanji + '\n')
    else:
        arrival = open(os.path.join(ROOT, 'scripts', 'shared', 'arrival.js'), encoding='utf-8').read().rstrip('\n')
        hanji = open(os.path.join(ROOT, 'scripts', 'shared', 'hanji.js'), encoding='utf-8').read().rstrip('\n')

    out = tpl.replace('<!--@THEME@-->', theme).replace('<!--@ARRIVAL@-->', arrival).replace('<!--@HANJI@-->', hanji)
    if '<!--@' in out:
        sys.exit('a marker was left unreplaced')
    open(os.path.join(WEB, 'index.html'), 'w', encoding='utf-8').write(out)
    print('wrote web/index.html (%d bytes)' % len(out))


if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'scripts', 'shared'), exist_ok=True)
    main()
