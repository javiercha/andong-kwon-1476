"""Smoke test against the running preview: console errors, both tabs, both
themes, four widths. python3 test/smoke.py [base-url]"""
import sys, json
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8160/web/'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, bypass_csp=True)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    page.goto(BASE + '#/leaf/1/6a')
    page.wait_for_load_state('networkidle')
    page.wait_for_function('window.AK && AK.pages && document.getElementById("loading-overlay").classList.contains("hidden")', timeout=30000)
    page.wait_for_timeout(1200)
    info = page.evaluate('''() => ({
      pages: AK.pages.pages.length, nodes: AK.G.stats.nodeCount, edges: AK.G.stats.edgeCount,
      page: AK.Inspection.page().key, people: document.querySelectorAll('#list-people .ent-row').length,
      rels: document.querySelectorAll('#list-relations .ent-row').length,
      notes: document.querySelectorAll('#list-notes .note-item').length,
      drawn: document.querySelectorAll('#page-graph g.node').length,
      legend: document.querySelector('#page-legend').textContent.slice(0,40),
      theme: document.documentElement.getAttribute('data-theme'),
      pos: document.getElementById('fo-pos').textContent,
      imgW: document.getElementById('fac-img').naturalWidth
    })''')
    print(json.dumps(info, ensure_ascii=False))
    page.screenshot(path='test/shots/inspection-1440.png')
    # hover a row, click a row → drawer
    page.hover('#list-people .ent-row >> nth=2')
    page.click('#list-people .ent-row >> nth=2')
    page.wait_for_timeout(300)
    print('drawer:', page.evaluate("document.getElementById('detail-panel').classList.contains('collapsed')") is False,
          page.evaluate("document.querySelector('.d-name').textContent"))
    page.screenshot(path='test/shots/inspection-drawer.png')
    # next leaf via keyboard
    page.keyboard.press('Escape'); page.keyboard.press('ArrowRight'); page.wait_for_timeout(600)
    print('after →:', page.evaluate('AK.Inspection.page().key'), page.url)
    # notes tab, relations tab
    page.click('.insp-tabs .tab[data-list="relations"]'); page.wait_for_timeout(100)
    page.click('#list-relations .ent-row >> nth=0'); page.wait_for_timeout(200)
    print('edge drawer:', page.evaluate("document.querySelector('.d-sub').textContent"))
    page.click('.insp-tabs .tab[data-list="notes"]')
    # search
    page.fill('#fo-search', 'Kwon Haeng'); page.wait_for_timeout(300)
    print('ac items:', page.locator('#fo-drop .ac-item').count())
    page.keyboard.press('Enter'); page.wait_for_timeout(800)
    print('after search:', page.evaluate('AK.Inspection.page().key'), page.url)
    # verify toggle
    # graph tab
    page.click('#btn-graph-view'); page.wait_for_timeout(300)
    page.fill('#branch-node', '權漢功'); page.wait_for_timeout(200); page.keyboard.press('Escape'); page.keyboard.press('Enter'); page.wait_for_timeout(1600)
    print('graph drawn:', page.evaluate("document.querySelectorAll('#graph-container g.node').length"), page.url)
    page.screenshot(path='test/shots/graph-1440.png')
    # find paths between two men
    inputs = page.locator('.path-node-input'); inputs.nth(0).fill('權幸'); page.keyboard.press('Escape'); inputs.nth(1).fill('權漢功'); page.keyboard.press('Escape'); page.keyboard.press('Enter'); page.wait_for_timeout(1600)
    print('paths drawn:', page.evaluate("document.querySelectorAll('#graph-container g.node').length"), page.evaluate("document.getElementById('canvas-breadcrumb').textContent.slice(0,60)"))
    page.screenshot(path='test/shots/graph-paths.png')
    # patrilines, scheme, a picker
    page.evaluate("document.getElementById('toggle-patriline-mode').click()"); page.wait_for_timeout(500)
    print('legend patriline:', page.evaluate("document.querySelector('#graph-legend').textContent.slice(0,30)"), 'cards:', page.locator('.patriline-card').count())
    page.select_option('#color-scheme', 'classic'); page.wait_for_timeout(400)
    print('scheme:', page.evaluate("AK.canvas.scheme()"), 'son colour picker:', page.evaluate("document.getElementById('color-has-son').value"))
    page.screenshot(path='test/shots/graph-patriline.png')
    page.select_option('#color-scheme', 'default'); page.evaluate("document.getElementById('toggle-patriline-mode').click()"); page.wait_for_timeout(300)
    # select a figure: the pill, then expand children via it
    page.evaluate("AK.canvas.select(AK.canvas.data().nodes[0].id)"); page.wait_for_timeout(300)
    print('pill:', page.locator('.floating-node-actions .pill-btn').count(), 'drawer:', page.evaluate("document.querySelector('.d-name') && document.querySelector('.d-name').textContent"))
    # export svg and tsv (download events)
    with page.expect_download() as dl:
        page.click('#btn-export-svg')
    print('download:', dl.value.suggested_filename)
    with page.expect_download() as dl2:
        page.click('#btn-export-tsv')
    print('download tsv:', dl2.value.suggested_filename)
    # light theme
    page.evaluate("SamhanTheme.set('light')"); page.wait_for_timeout(500)
    page.click('#btn-inspection-view'); page.wait_for_timeout(800)
    page.screenshot(path='test/shots/inspection-light-1440.png')
    page.click('#btn-graph-view'); page.wait_for_timeout(800)
    page.screenshot(path='test/shots/graph-light-1440.png')
    page.evaluate("SamhanTheme.clear()")
    # widths
    for w, h in [(1024, 768), (820, 1180), (390, 844)]:
        page.set_viewport_size({'width': w, 'height': h})
        page.goto(BASE + '#/leaf/2/16a'); page.wait_for_function('window.AK && AK.pages && document.getElementById("loading-overlay").classList.contains("hidden")', timeout=30000); page.wait_for_timeout(1200)
        hs = page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
        print('width', w, 'horizontal overflow:', hs, 'drawn:', page.evaluate("document.querySelectorAll('#page-graph g.node').length"))
        page.screenshot(path=f'test/shots/inspection-{w}.png', full_page=(w < 900))
        if w == 390:
            page.evaluate("SamhanTheme.set('light')"); page.wait_for_timeout(400)
            page.screenshot(path='test/shots/inspection-390-light.png', full_page=True)
            page.evaluate("SamhanTheme.clear()")
    # ── 2026-09-23: reports, citation, Relinkings link, the pages, deep zoom
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.goto(BASE + '#/leaf/1/6a/D206469'); page.wait_for_load_state('networkidle'); page.wait_for_timeout(1200)
    page.evaluate("AK.Detail.show(AK.G.node('D206469'))"); page.wait_for_timeout(200)
    assert page.get_attribute('#d-rl', 'href').startswith('https://relinkings.samhan.ai/#q='), 'Relinkings link'
    assert 'D206469' in page.evaluate("AK.Detail.citationOf(AK.G.node('D206469'))"), 'citation'
    page.screenshot(path='test/shots/drawer-cite.png')
    page.click('#fo-report'); page.wait_for_timeout(200)
    assert '6a' in page.text_content('#rp-leaf') and 'D206469' in page.text_content('#rp-person'), 'report prefill'
    page.click('#rp-send'); page.wait_for_timeout(200)
    assert page.text_content('#rp-status'), 'empty report refused'
    page.fill('#rp-note', 'smoke test — ignore'); page.click('#rp-send'); page.wait_for_timeout(1200)
    assert page.evaluate("document.getElementById('report-modal').classList.contains('hidden')"), 'report sent'
    page.screenshot(path='test/shots/report-sent.png')
    for _ in range(7): page.click('#fac-zoom-in'); page.wait_for_timeout(320)   # each step is a 250 ms transition
    page.wait_for_timeout(2500)
    assert '/full/' in page.evaluate("document.getElementById('fac-img').src"), 'deep zoom swapped to the full scan'
    page.screenshot(path='test/shots/deepzoom.png')
    for pg in ['people.html', 'lineages.html', 'data.html']:
        page.goto(BASE + pg); page.wait_for_load_state('networkidle'); page.wait_for_timeout(500)
        assert page.evaluate("document.querySelectorAll('table.idx tbody tr').length") > 0, pg
        page.screenshot(path='test/shots/' + pg.replace('.html', '') + '.png')
    b.close()
print('console errors:', json.dumps(errors, ensure_ascii=False)[:2000] if errors else 'none')
