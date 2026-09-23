-- The reader reports, on Cloudflare D1. Same columns as data/reports.sqlite
-- on the preview (reports.py), so a ledger downloaded from either reads the same.
--   npx wrangler d1 create andongkwon1476-reports        (then paste the id into wrangler.toml)
--   npx wrangler d1 execute andongkwon1476-reports --remote --file worker/schema.sql
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL, addr TEXT, leaf TEXT, person TEXT, url TEXT,
  print_says TEXT, table_says TEXT, note TEXT, contact TEXT,
  state TEXT NOT NULL DEFAULT 'new', resolved TEXT, editor_note TEXT
);
CREATE INDEX IF NOT EXISTS reports_addr_created ON reports (addr, created);
CREATE INDEX IF NOT EXISTS reports_state ON reports (state);
