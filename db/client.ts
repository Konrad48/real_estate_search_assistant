import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "listings.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

let dbInstance: Database.Database | null = null;

function runMigrations(db: Database.Database) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    db.exec(sql);
  }
}

// Non-destructive column additions for DBs created before a column existed.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we check table_info first. This
// preserves existing scraped data instead of requiring a DB wipe.
function ensureColumns(db: Database.Database) {
  const searchCols = new Set(
    (db.prepare("PRAGMA table_info(searches)").all() as { name: string }[]).map((c) => c.name)
  );
  const searchAdditions: { name: string; ddl: string }[] = [
    { name: "include_warsaw", ddl: "ALTER TABLE searches ADD COLUMN include_warsaw INTEGER NOT NULL DEFAULT 1" },
    { name: "towns", ddl: "ALTER TABLE searches ADD COLUMN towns TEXT NOT NULL DEFAULT '[]'" },
  ];
  for (const { name, ddl } of searchAdditions) {
    if (!searchCols.has(name)) db.exec(ddl);
  }

  const cols = new Set(
    (db.prepare("PRAGMA table_info(listings)").all() as { name: string }[]).map((c) => c.name)
  );
  const additions: { name: string; ddl: string }[] = [
    { name: "is_duplicate", ddl: "ALTER TABLE listings ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0" },
    { name: "duplicate_of", ddl: "ALTER TABLE listings ADD COLUMN duplicate_of INTEGER" },
    { name: "is_disliked", ddl: "ALTER TABLE listings ADD COLUMN is_disliked INTEGER NOT NULL DEFAULT 0" },
    { name: "comment", ddl: "ALTER TABLE listings ADD COLUMN comment TEXT" },
    { name: "contact_name", ddl: "ALTER TABLE listings ADD COLUMN contact_name TEXT" },
    { name: "contact_phone", ddl: "ALTER TABLE listings ADD COLUMN contact_phone TEXT" },
    { name: "czynsz", ddl: "ALTER TABLE listings ADD COLUMN czynsz REAL" },
    { name: "ownership_type", ddl: "ALTER TABLE listings ADD COLUMN ownership_type TEXT" },
    { name: "floor_num", ddl: "ALTER TABLE listings ADD COLUMN floor_num INTEGER" },
    { name: "total_floors", ddl: "ALTER TABLE listings ADD COLUMN total_floors INTEGER" },
    { name: "year_built", ddl: "ALTER TABLE listings ADD COLUMN year_built INTEGER" },
    { name: "condition_state", ddl: "ALTER TABLE listings ADD COLUMN condition_state TEXT" },
    { name: "has_balcony", ddl: "ALTER TABLE listings ADD COLUMN has_balcony INTEGER" },
    { name: "has_parking", ddl: "ALTER TABLE listings ADD COLUMN has_parking INTEGER" },
    { name: "has_elevator", ddl: "ALTER TABLE listings ADD COLUMN has_elevator INTEGER" },
    { name: "has_land_register", ddl: "ALTER TABLE listings ADD COLUMN has_land_register INTEGER" },
    { name: "land_register_number", ddl: "ALTER TABLE listings ADD COLUMN land_register_number TEXT" },
    { name: "land_regulated", ddl: "ALTER TABLE listings ADD COLUMN land_regulated INTEGER" },
    { name: "has_encumbrance", ddl: "ALTER TABLE listings ADD COLUMN has_encumbrance INTEGER" },
    { name: "layout", ddl: "ALTER TABLE listings ADD COLUMN layout TEXT" },
    { name: "price_negotiable", ddl: "ALTER TABLE listings ADD COLUMN price_negotiable INTEGER" },
    { name: "flooring", ddl: "ALTER TABLE listings ADD COLUMN flooring TEXT" },
    { name: "wiring", ddl: "ALTER TABLE listings ADD COLUMN wiring TEXT" },
    { name: "commission_terms", ddl: "ALTER TABLE listings ADD COLUMN commission_terms TEXT" },
    { name: "has_tenants", ddl: "ALTER TABLE listings ADD COLUMN has_tenants INTEGER" },
    { name: "sale_reason", ddl: "ALTER TABLE listings ADD COLUMN sale_reason TEXT" },
    { name: "description", ddl: "ALTER TABLE listings ADD COLUMN description TEXT" },
    { name: "enriched_at", ddl: "ALTER TABLE listings ADD COLUMN enriched_at TEXT" },
    { name: "enrich_status", ddl: "ALTER TABLE listings ADD COLUMN enrich_status TEXT" },
    { name: "enrich_model", ddl: "ALTER TABLE listings ADD COLUMN enrich_model TEXT" },
    { name: "lat", ddl: "ALTER TABLE listings ADD COLUMN lat REAL" },
    { name: "lon", ddl: "ALTER TABLE listings ADD COLUMN lon REAL" },
    { name: "geo_source", ddl: "ALTER TABLE listings ADD COLUMN geo_source TEXT" },
    { name: "geocoded_at", ddl: "ALTER TABLE listings ADD COLUMN geocoded_at TEXT" },
  ];
  for (const { name, ddl } of additions) {
    if (!cols.has(name)) db.exec(ddl);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_listings_duplicate ON listings(is_duplicate)");
  // Enrichment picks pending rows by (search_id, enriched_at IS NULL).
  db.exec("CREATE INDEX IF NOT EXISTS idx_listings_enriched ON listings(search_id, enriched_at)");
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  runMigrations(db);
  ensureColumns(db);

  dbInstance = db;
  return db;
}
