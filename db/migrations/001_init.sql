CREATE TABLE IF NOT EXISTS searches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  include_warsaw  INTEGER NOT NULL DEFAULT 1, -- 1 = search Warsaw (narrowed by districts)
  districts       TEXT NOT NULL,          -- JSON array of canonical district names ([] = whole city)
  towns           TEXT NOT NULL DEFAULT '[]', -- JSON array of towns outside Warsaw (lib/towns.ts)
  sources         TEXT NOT NULL,          -- JSON array of SourceId
  min_price       REAL,
  max_price       REAL,
  min_area        REAL,
  max_area        REAL,
  created_at      TEXT NOT NULL,
  last_scraped_at TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id         INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  source            TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  title             TEXT,
  price_pln         REAL,
  area_m2           REAL,
  price_per_m2      REAL,
  district          TEXT,
  address_raw       TEXT,
  rooms             INTEGER,
  floor             TEXT,
  listing_date      TEXT,
  first_scraped_at  TEXT NOT NULL,
  last_scraped_at   TEXT NOT NULL,
  is_active         INTEGER NOT NULL DEFAULT 1,   -- 0 = no longer listed (nieaktualne)
  is_starred        INTEGER NOT NULL DEFAULT 0,
  is_disliked       INTEGER NOT NULL DEFAULT 0,    -- 1 = user rejected it (odrzucone), hidden like nieaktualne
  is_duplicate      INTEGER NOT NULL DEFAULT 0,    -- 1 = collapsed into another offer (hidden)
  duplicate_of      INTEGER,                       -- survivor listing id this row was merged into
  comment           TEXT,                          -- user note, never touched by scrapers
  contact_name      TEXT,
  contact_phone     TEXT,
  czynsz            REAL,                          -- monthly admin/service fee (PLN): user-entered or from enrichment
  ownership_type    TEXT,                          -- forma własności, canonical label from lib/ownership.ts
  floor_num         INTEGER,                       -- 0 = parter, -1 = piwnica/suterena, NULL = unknown
  total_floors      INTEGER,                       -- number of floors in the building
  year_built        INTEGER,
  condition_state   TEXT,                          -- do zamieszkania / do wykończenia / do remontu
  has_balcony       INTEGER,                       -- 0/1/NULL (balkon, taras or ogródek)
  has_parking       INTEGER,                       -- 0/1/NULL
  has_elevator      INTEGER,                       -- 0/1/NULL
  -- Kwestionariusz (answers from calling the seller) - user-entered only, lib/questionnaire.ts
  has_land_register    INTEGER,                    -- 0/1/NULL czy jest księga wieczysta
  land_register_number TEXT,                       -- numer KW
  land_regulated       INTEGER,                    -- 0/1/NULL czy grunty uregulowane
  has_encumbrance      INTEGER,                    -- 0/1/NULL hipoteka lub inne obciążenia
  layout               TEXT,                       -- układ mieszkania
  price_negotiable     INTEGER,                    -- 0/1/NULL
  flooring             TEXT,                       -- rodzaj podłogi
  wiring               TEXT,                       -- instalacja elektryczna: miedziana / aluminiowa / mieszana
  commission_terms     TEXT,                       -- warunki prowizji
  has_tenants          INTEGER,                    -- 0/1/NULL czy są lokatorzy
  sale_reason          TEXT,                       -- dlaczego mieszkanie jest sprzedawane
  description       TEXT,                          -- offer description from the detail page (AI input + cache)
  enriched_at       TEXT,                          -- ISO timestamp; NULL = still pending enrichment
  enrich_status     TEXT,                          -- structured | ai | mixed | failed
  enrich_model      TEXT,                          -- OpenAI model used, when AI was involved
  lat               REAL,                          -- map position (lib/geocode.ts); NULL = not located
  lon               REAL,
  geo_source        TEXT,                          -- source (the site's own pin) | geocoded (street via Nominatim)
  geocoded_at       TEXT,                          -- ISO timestamp of the last locate attempt, hit or miss
  raw_json          TEXT NOT NULL,
  UNIQUE (search_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_search ON listings(search_id);
CREATE INDEX IF NOT EXISTS idx_listings_price_per_m2 ON listings(price_per_m2);
CREATE INDEX IF NOT EXISTS idx_listings_starred ON listings(is_starred);
-- idx_listings_duplicate is created by ensureColumns() in db/client.ts so it
-- also applies to DBs whose listings table predates the is_duplicate column.

CREATE TABLE IF NOT EXISTS price_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price_pln    REAL,
  recorded_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id);

-- Nominatim answers keyed by "<street>|<city>" (lowercased), shared by every
-- list. results_json is the candidate array ([] = nothing found) — kept so the
-- per-offer district check can reuse it without asking again.
CREATE TABLE IF NOT EXISTS geocode_cache (
  query        TEXT PRIMARY KEY,
  results_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
