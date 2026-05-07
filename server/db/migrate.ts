import { rawDb } from "./index.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  city TEXT,
  asking_price REAL NOT NULL,
  image_url TEXT,
  ai_brand TEXT,
  ai_model TEXT,
  ai_product TEXT,
  ebay_avg_sold REAL,
  ebay_comp_count INTEGER,
  ebay_search_query TEXT,
  ebay_fees REAL,
  net_profit REAL,
  roi_pct REAL,
  score INTEGER,
  exit_channel TEXT,
  flagged_high_roi INTEGER DEFAULT 0,
  purchase_price REAL,
  sold_price REAL,
  sold_at INTEGER,
  tracking_notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_score ON deals(score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_flagged ON deals(flagged_high_roi);
CREATE INDEX IF NOT EXISTS idx_deals_category ON deals(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_source_url ON deals(source_url);

CREATE TABLE IF NOT EXISTS garage_sales (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  city TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  sale_date TEXT,
  images TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_garage_source_url ON garage_sales(source_url);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function runMigrations() {
  rawDb.exec(SCHEMA_SQL);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runMigrations();
  console.log("Migrations applied.");
  process.exit(0);
}
