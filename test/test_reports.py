"""The reader-report store and the endpoints — python3 -m unittest test/test_reports.py"""
import json, os, shutil, sys, tempfile, unittest, base64
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import reports


class ReportsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.r = reports.Reports(self.dir)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_password_is_created_once_and_kept_private(self):
        self.assertTrue(os.path.exists(self.r.pw_path))
        self.assertEqual(oct(os.stat(self.r.pw_path).st_mode & 0o777), '0o600')
        self.assertEqual(reports.Reports(self.dir).password, self.r.password)

    def test_submit_and_read(self):
        st, out = self.r.submit(json.dumps({'leaf': 'vol. 1 · 6a', 'person': '權漢功 D206469', 'print_says': '第三子', 'table_says': 'second son'}).encode(), '10.0.0.1')
        self.assertEqual((st, out['ok']), (200, True))
        rows = self.r.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['state'], 'new')
        self.assertEqual(rows[0]['print_says'], '第三子')
        self.assertTrue(self.r.resolve(rows[0]['id'], 'accepted', 'checked'))
        self.assertEqual(self.r.rows('accepted')[0]['editor_note'], 'checked')
        self.assertFalse(self.r.resolve(rows[0]['id'], 'bogus'))
        self.assertIn('checked', self.r.tsv())

    def test_refusals(self):
        self.assertEqual(self.r.submit(b'not json', 'a')[0], 400)
        self.assertEqual(self.r.submit(b'[1,2]', 'a')[0], 400)
        self.assertEqual(self.r.submit(json.dumps({'leaf': 'x'}).encode(), 'a')[0], 400)          # nothing said
        self.assertEqual(self.r.submit(json.dumps({'note': 1}).encode(), 'a')[0], 400)             # not text
        self.assertEqual(self.r.submit(json.dumps({'note': 'x', 'website': 'spam'}).encode(), 'a'), (200, {'ok': True, 'id': 0}))
        self.assertEqual(len(self.r.rows()), 0)

    def test_caps_and_escaping(self):
        st, _ = self.r.submit(json.dumps({'note': '<script>x</script>' + 'a' * 5000}).encode(), 'a')
        self.assertEqual(st, 200)
        self.assertEqual(len(self.r.rows()[0]['note']), 4000)
        html = self.r.admin_html()
        self.assertNotIn('<script>x', html)
        self.assertIn('&lt;script&gt;', html)

    def test_rate_limit(self):
        for i in range(20):
            self.assertEqual(self.r.submit(json.dumps({'note': str(i)}).encode(), 'b')[0], 200)
        self.assertEqual(self.r.submit(json.dumps({'note': 'x'}).encode(), 'b')[0], 429)
        self.assertEqual(self.r.submit(json.dumps({'note': 'x'}).encode(), 'c')[0], 200)

    def test_auth(self):
        good = 'Basic ' + base64.b64encode(('editor:' + self.r.password).encode()).decode()
        bad = 'Basic ' + base64.b64encode(b'editor:nope').decode()
        self.assertTrue(self.r.check_auth(good))
        self.assertFalse(self.r.check_auth(bad))
        self.assertFalse(self.r.check_auth(None))
        self.assertFalse(self.r.check_auth('Bearer x'))


if __name__ == '__main__':
    unittest.main()
