import { getDb } from "./client";
import { dedupKey } from "../lib/dedup";
import type {
  EnrichStatus,
  EnrichedFields,
  ListingRow,
  ListingSourceId,
  NormalizedListing,
  PriceHistoryRow,
  SourceId,
} from "./schema";

const INSERT_SQL = `
  INSERT INTO listings (
    search_id, source, source_id, source_url, title, price_pln, area_m2, price_per_m2,
    district, address_raw, rooms, floor, listing_date,
    first_scraped_at, last_scraped_at, is_active, is_starred, raw_json
  ) VALUES (
    @searchId, @source, @sourceId, @sourceUrl, @title, @pricePln, @areaM2, @pricePerM2,
    @district, @addressRaw, @rooms, @floor, @listingDate,
    @now, @now, 1, 0, @rawJson
  )
`;

// When an offer's address changes, its geocoded map position (and the record of
// having tried) is dropped so the new address gets located. A position taken
// from the site itself (OLX's map pin) doesn't depend on the address text and is
// kept. SQLite evaluates every SET expression against the old row.
const GEO_RESET = (changed: string) => `
    lat = CASE WHEN ${changed} THEN NULL ELSE lat END,
    lon = CASE WHEN ${changed} THEN NULL ELSE lon END,
    geo_source = CASE WHEN ${changed} THEN NULL ELSE geo_source END,
    geocoded_at = CASE WHEN ${changed} THEN NULL ELSE geocoded_at END`;

const UPDATE_SQL = `
  UPDATE listings SET
    source_url = @sourceUrl,
    title = @title,
    price_pln = @pricePln,
    area_m2 = @areaM2,
    price_per_m2 = @pricePerM2,
    district = @district,
    address_raw = @addressRaw,
    rooms = @rooms,
    floor = @floor,
    listing_date = @listingDate,
    last_scraped_at = @now,
    is_active = 1,
    raw_json = @rawJson,
    ${GEO_RESET("(address_raw IS NOT @addressRaw AND COALESCE(geo_source, '') <> 'source')")}
  WHERE id = @id
`;

/**
 * Upsert a scrape run's listings into one saved search. Records a price_history
 * row on first insert and whenever a listing's price changes between scrapes.
 * Preserves is_starred and first_scraped_at on existing rows.
 */
export function upsertMany(searchId: number, listings: NormalizedListing[]): number {
  const db = getDb();
  const now = new Date().toISOString();

  const findExisting = db.prepare(
    "SELECT id, price_pln FROM listings WHERE search_id = ? AND source = ? AND source_id = ?"
  );
  const insertStmt = db.prepare(INSERT_SQL);
  const updateStmt = db.prepare(UPDATE_SQL);
  const insertHistory = db.prepare(
    "INSERT INTO price_history (listing_id, price_pln, recorded_at) VALUES (?, ?, ?)"
  );

  const run = db.transaction((rows: NormalizedListing[]) => {
    for (const l of rows) {
      const params = {
        searchId,
        source: l.source,
        sourceId: l.sourceId,
        sourceUrl: l.sourceUrl,
        title: l.title,
        pricePln: l.pricePln,
        areaM2: l.areaM2,
        pricePerM2: l.pricePerM2,
        district: l.district,
        addressRaw: l.addressRaw,
        rooms: l.rooms,
        floor: l.floor,
        listingDate: l.listingDate,
        now,
        rawJson: JSON.stringify(l.raw ?? {}),
      };

      const existing = findExisting.get(searchId, l.source, l.sourceId) as
        | { id: number; price_pln: number | null }
        | undefined;

      if (!existing) {
        const res = insertStmt.run(params);
        insertHistory.run(Number(res.lastInsertRowid), l.pricePln, now);
      } else {
        if (existing.price_pln !== l.pricePln) {
          insertHistory.run(existing.id, l.pricePln, now);
        }
        updateStmt.run({ ...params, id: existing.id });
      }
    }
  });

  run(listings);
  return listings.length;
}

/**
 * Mark listings for this (search, source) that were NOT seen in the latest
 * scrape run as inactive (is_active = 0) - "no longer listed" / nieaktualne.
 * They are kept (with price history) rather than deleted.
 */
export function markGoneExcept(searchId: number, source: SourceId, seenSourceIds: string[]): void {
  const db = getDb();
  if (seenSourceIds.length === 0) {
    db.prepare("UPDATE listings SET is_active = 0 WHERE search_id = ? AND source = ?").run(
      searchId,
      source
    );
    return;
  }
  const placeholders = seenSourceIds.map(() => "?").join(", ");
  db.prepare(
    `UPDATE listings SET is_active = 0
     WHERE search_id = ? AND source = ? AND source_id NOT IN (${placeholders})`
  ).run(searchId, source, ...seenSourceIds);
}

/** One offer still awaiting enrichment (detail-page fetch + AI). */
export interface PendingEnrichment {
  id: number;
  source: ListingSourceId;
  source_url: string;
  title: string | null;
}

/**
 * Offers of one saved list that have never been enriched. Manual rows and
 * hidden duplicates are skipped - there's no offer page to read for the
 * former and no point spending a fetch on the latter.
 */
export function listingsNeedingEnrichment(searchId: number, limit: number): PendingEnrichment[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, source, source_url, title FROM listings
       WHERE search_id = @searchId AND enriched_at IS NULL AND is_active = 1
         AND is_duplicate = 0 AND source <> 'manual' AND source_url <> ''
       ORDER BY id ASC LIMIT @limit`
    )
    .all({ searchId, limit }) as PendingEnrichment[];
}

/** A listing whose stored description may still answer some empty columns. */
export interface GapRow {
  id: number;
  title: string | null;
  description: string | null;
  ownership_type: string | null;
  floor_num: number | null;
  total_floors: number | null;
  czynsz: number | null;
  year_built: number | null;
  condition_state: string | null;
  has_balcony: number | null;
  has_parking: number | null;
  has_elevator: number | null;
}

/**
 * Already-enriched offers that still have empty columns but do have a stored
 * description — the AI can be re-run on them without re-fetching the offer
 * page (npm run enrich -- --ai-only, e.g. after adding an OPENAI_API_KEY).
 *
 * Offers the model has already been asked about (enrich_model IS NOT NULL) are
 * excluded: an answer of "the description doesn't say" won't change on a second
 * ask, so re-asking would only cost money. `retryAiTried` overrides that.
 */
export function listingsWithGaps(
  searchId: number,
  limit: number,
  opts: { retryAiTried?: boolean } = {}
): GapRow[] {
  const db = getDb();
  const aiClause = opts.retryAiTried ? "" : "AND enrich_model IS NULL";
  return db
    .prepare(
      `SELECT id, title, description, ownership_type, floor_num, total_floors, czynsz,
              year_built, condition_state, has_balcony, has_parking, has_elevator
       FROM listings
       WHERE search_id = @searchId AND is_active = 1 AND is_duplicate = 0
         AND description IS NOT NULL AND description <> ''
         ${aiClause}
         AND (ownership_type IS NULL OR floor_num IS NULL OR total_floors IS NULL
              OR czynsz IS NULL OR year_built IS NULL OR condition_state IS NULL
              OR has_balcony IS NULL OR has_parking IS NULL OR has_elevator IS NULL)
       ORDER BY id ASC LIMIT @limit`
    )
    .all({ searchId, limit }) as GapRow[];
}

/** Same set, but for one listing regardless of its enrichment state (retry). */
export function getPendingEnrichment(listingId: number): PendingEnrichment | undefined {
  const db = getDb();
  return db
    .prepare("SELECT id, source, source_url, title FROM listings WHERE id = ?")
    .get(listingId) as PendingEnrichment | undefined;
}

/**
 * Writes one listing's enrichment result. Only fills columns that are still
 * empty, so a value the user typed by hand (or an earlier, better scrape)
 * always wins over a later automated guess. The scraped `floor` text is left
 * alone - the UI derives its "3/8" label from floor_num/total_floors instead,
 * because a re-scrape rewrites `floor` and would wipe anything stored there.
 */
export function updateEnrichment(
  listingId: number,
  fields: Partial<EnrichedFields>,
  meta: { status: EnrichStatus; model: string | null; description: string | null }
): void {
  const db = getDb();
  db.prepare(
    `UPDATE listings SET
       ownership_type  = COALESCE(ownership_type, @ownershipType),
       floor_num       = COALESCE(floor_num, @floorNum),
       total_floors    = COALESCE(total_floors, @totalFloors),
       czynsz          = COALESCE(czynsz, @czynsz),
       year_built      = COALESCE(year_built, @yearBuilt),
       condition_state = COALESCE(condition_state, @conditionState),
       has_balcony     = COALESCE(has_balcony, @hasBalcony),
       has_parking     = COALESCE(has_parking, @hasParking),
       has_elevator    = COALESCE(has_elevator, @hasElevator),
       description     = COALESCE(@description, description),
       enriched_at     = @now,
       enrich_status   = @status,
       enrich_model    = @model
     WHERE id = @id`
  ).run({
    id: listingId,
    ownershipType: fields.ownershipType ?? null,
    floorNum: fields.floorNum ?? null,
    totalFloors: fields.totalFloors ?? null,
    czynsz: fields.czynsz ?? null,
    yearBuilt: fields.yearBuilt ?? null,
    conditionState: fields.conditionState ?? null,
    hasBalcony: fields.hasBalcony ?? null,
    hasParking: fields.hasParking ?? null,
    hasElevator: fields.hasElevator ?? null,
    description: meta.description,
    now: new Date().toISOString(),
    status: meta.status,
    model: meta.model,
  });
}

export interface ListingSort {
  column:
    | "price_pln"
    | "area_m2"
    | "price_per_m2"
    | "district"
    | "source"
    | "rooms"
    | "last_scraped_at";
  direction: "asc" | "desc";
}

export function queryListings(
  searchId: number,
  opts: { starredOnly?: boolean; activeOnly?: boolean; sort?: ListingSort; includeDuplicates?: boolean } = {}
): ListingRow[] {
  const db = getDb();
  const clauses = ["search_id = @searchId"];
  if (!opts.includeDuplicates) clauses.push("is_duplicate = 0");
  if (opts.starredOnly) clauses.push("is_starred = 1");
  // "Ukryj nieaktywne" hides both offers that are gone and offers the user rejected.
  if (opts.activeOnly) clauses.push("is_active = 1 AND is_disliked = 0");
  const sortColumn = opts.sort?.column ?? "price_per_m2";
  const sortDir = opts.sort?.direction === "desc" ? "DESC" : "ASC";
  const sql = `SELECT * FROM listings WHERE ${clauses.join(" AND ")} ORDER BY ${sortColumn} ${sortDir}`;
  return db.prepare(sql).all({ searchId }) as ListingRow[];
}

export function toggleStar(listingId: number): boolean {
  const db = getDb();
  const row = db.prepare("SELECT is_starred FROM listings WHERE id = ?").get(listingId) as
    | { is_starred: number }
    | undefined;
  if (!row) return false;
  const next = row.is_starred ? 0 : 1;
  // Starring and rejecting exclude each other: a star un-rejects the offer.
  db.prepare(
    "UPDATE listings SET is_starred = @next, is_disliked = CASE WHEN @next = 1 THEN 0 ELSE is_disliked END WHERE id = @id"
  ).run({ next, id: listingId });
  return next === 1;
}

/** Toggles "odrzucone" (archived by the user). Rejecting an offer also removes its star. */
export function toggleDislike(listingId: number): boolean {
  const db = getDb();
  const row = db.prepare("SELECT is_disliked FROM listings WHERE id = ?").get(listingId) as
    | { is_disliked: number }
    | undefined;
  if (!row) return false;
  const next = row.is_disliked ? 0 : 1;
  db.prepare(
    "UPDATE listings SET is_disliked = @next, is_starred = CASE WHEN @next = 1 THEN 0 ELSE is_starred END WHERE id = @id"
  ).run({ next, id: listingId });
  return next === 1;
}

export interface ListingFieldsInput {
  title: string | null;
  pricePln: number | null;
  areaM2: number | null;
  district: string | null;
  addressRaw: string | null;
  rooms: number | null;
  floor: string | null;
  listingDate: string | null;
  sourceUrl: string | null;
  comment: string | null;
  contactName: string | null;
  contactPhone: string | null;
  czynsz: number | null;
  ownershipType: string | null;
  floorNum: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  conditionState: string | null;
  hasBalcony: number | null;
  hasParking: number | null;
  hasElevator: number | null;
  hasLandRegister: number | null;
  landRegisterNumber: string | null;
  landRegulated: number | null;
  hasEncumbrance: number | null;
  layout: string | null;
  priceNegotiable: number | null;
  flooring: string | null;
  wiring: string | null;
  commissionTerms: string | null;
  hasTenants: number | null;
  saleReason: string | null;
}

function computePricePerM2(pricePln: number | null, areaM2: number | null): number | null {
  return pricePln && areaM2 ? Math.round((pricePln / areaM2) * 100) / 100 : null;
}

/**
 * Updates every user-editable field on an existing listing (both scraped and
 * manual rows). Records a price_history entry when price_pln changes, same
 * as a re-scrape would.
 */
export function updateListingFields(listingId: number, fields: ListingFieldsInput): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const pricePerM2 = computePricePerM2(fields.pricePln, fields.areaM2);

  const existing = db.prepare("SELECT price_pln FROM listings WHERE id = ?").get(listingId) as
    | { price_pln: number | null }
    | undefined;
  if (!existing) return false;

  const tx = db.transaction(() => {
    if (existing.price_pln !== fields.pricePln) {
      db.prepare("INSERT INTO price_history (listing_id, price_pln, recorded_at) VALUES (?, ?, ?)").run(
        listingId,
        fields.pricePln,
        now
      );
    }
    db.prepare(
      `UPDATE listings SET
         title = @title, price_pln = @pricePln, area_m2 = @areaM2, price_per_m2 = @pricePerM2,
         district = @district, address_raw = @addressRaw, rooms = @rooms, floor = @floor,
         listing_date = @listingDate, source_url = @sourceUrl,
         comment = @comment, contact_name = @contactName, contact_phone = @contactPhone, czynsz = @czynsz,
         ownership_type = @ownershipType, floor_num = @floorNum, total_floors = @totalFloors,
         year_built = @yearBuilt, condition_state = @conditionState,
         has_balcony = @hasBalcony, has_parking = @hasParking, has_elevator = @hasElevator,
         has_land_register = @hasLandRegister, land_register_number = @landRegisterNumber,
         land_regulated = @landRegulated, has_encumbrance = @hasEncumbrance, layout = @layout,
         price_negotiable = @priceNegotiable, flooring = @flooring, wiring = @wiring,
         commission_terms = @commissionTerms, has_tenants = @hasTenants, sale_reason = @saleReason,
         ${GEO_RESET(
           "((address_raw IS NOT @addressRaw OR district IS NOT @district) AND COALESCE(geo_source, '') <> 'source')"
         )}
       WHERE id = @id`
    ).run({ ...fields, pricePerM2, sourceUrl: fields.sourceUrl ?? "", id: listingId });
  });
  tx();
  return true;
}

/** Creates a user-entered listing not backed by any scraper. */
export function createManualListing(searchId: number, fields: ListingFieldsInput): ListingRow {
  const db = getDb();
  const now = new Date().toISOString();
  const pricePerM2 = computePricePerM2(fields.pricePln, fields.areaM2);
  const sourceId = `manual-${now}-${Math.random().toString(36).slice(2, 10)}`;

  const insert = db.prepare(
    `INSERT INTO listings (
       search_id, source, source_id, source_url, title, price_pln, area_m2, price_per_m2,
       district, address_raw, rooms, floor, listing_date,
       first_scraped_at, last_scraped_at, is_active, is_starred,
       comment, contact_name, contact_phone, czynsz,
       ownership_type, floor_num, total_floors, year_built, condition_state,
       has_balcony, has_parking, has_elevator,
       has_land_register, land_register_number, land_regulated, has_encumbrance, layout,
       price_negotiable, flooring, wiring, commission_terms, has_tenants, sale_reason, raw_json
     ) VALUES (
       @searchId, 'manual', @sourceId, @sourceUrl, @title, @pricePln, @areaM2, @pricePerM2,
       @district, @addressRaw, @rooms, @floor, @listingDate,
       @now, @now, 1, 0,
       @comment, @contactName, @contactPhone, @czynsz,
       @ownershipType, @floorNum, @totalFloors, @yearBuilt, @conditionState,
       @hasBalcony, @hasParking, @hasElevator,
       @hasLandRegister, @landRegisterNumber, @landRegulated, @hasEncumbrance, @layout,
       @priceNegotiable, @flooring, @wiring, @commissionTerms, @hasTenants, @saleReason, '{}'
     )`
  );

  let newId = 0;
  const tx = db.transaction(() => {
    const res = insert.run({
      ...fields,
      pricePerM2,
      sourceUrl: fields.sourceUrl ?? "",
      searchId,
      sourceId,
      now,
    });
    newId = Number(res.lastInsertRowid);
    db.prepare("INSERT INTO price_history (listing_id, price_pln, recorded_at) VALUES (?, ?, ?)").run(
      newId,
      fields.pricePln,
      now
    );
  });
  tx();

  return db.prepare("SELECT * FROM listings WHERE id = ?").get(newId) as ListingRow;
}

export function getPriceHistory(listingId: number): PriceHistoryRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM price_history WHERE listing_id = ? ORDER BY recorded_at ASC, id ASC")
    .all(listingId) as PriceHistoryRow[];
}

/** Latest two distinct-timestamp prices, used to show a per-listing delta badge. */
export function getPreviousPrices(searchId: number): Map<number, number | null> {
  const db = getDb();
  // For each listing, the price recorded before its most recent one.
  const rows = db
    .prepare(
      `SELECT ph.listing_id AS listingId, ph.price_pln AS price, ph.recorded_at AS recordedAt
       FROM price_history ph
       JOIN listings l ON l.id = ph.listing_id
       WHERE l.search_id = ?
       ORDER BY ph.listing_id ASC, ph.recorded_at DESC, ph.id DESC`
    )
    .all(searchId) as { listingId: number; price: number | null; recordedAt: string }[];

  const prev = new Map<number, number | null>();
  const seenCount = new Map<number, number>();
  for (const r of rows) {
    const n = seenCount.get(r.listingId) ?? 0;
    // index 0 = current price, index 1 = previous price
    if (n === 1) prev.set(r.listingId, r.price);
    seenCount.set(r.listingId, n + 1);
  }
  return prev;
}

export interface AlsoOn {
  source: ListingSourceId;
  price_pln: number | null;
  source_url: string;
}

/**
 * Collapses duplicate offers within one search. Groups active+inactive listings
 * by dedupKey(title, area); in each group of >1 keeps a single survivor and
 * marks the rest is_duplicate=1 / duplicate_of=survivor.id. Fully idempotent:
 * resets prior dedup state first, so it can be re-run on every scrape.
 *
 * Survivor order: starred first, then active, then cheapest (nulls last), then
 * lowest id ("first"). The survivor inherits the star from any group member and
 * the hidden rows are unstarred, so the star "moves" to the visible row. A
 * rejection (is_disliked) moves the same way - the cross-posted copy of a flat
 * the user rejected is rejected too - unless the group is starred, where the
 * star wins.
 */
export function recomputeDuplicates(searchId: number): { groups: number; hidden: number } {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, title, area_m2, price_pln, is_active, is_starred, is_disliked FROM listings WHERE search_id = ?"
    )
    .all(searchId) as Pick<
    ListingRow,
    "id" | "title" | "area_m2" | "price_pln" | "is_active" | "is_starred" | "is_disliked"
  >[];

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = dedupKey(r.title, r.area_m2);
    if (!key) continue; // rows without a safe key are never deduped
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const resetAll = db.prepare("UPDATE listings SET is_duplicate = 0, duplicate_of = NULL WHERE search_id = ?");
  const markDup = db.prepare("UPDATE listings SET is_duplicate = 1, duplicate_of = ? WHERE id = ?");
  const setStar = db.prepare("UPDATE listings SET is_starred = ? WHERE id = ?");
  const setDisliked = db.prepare("UPDATE listings SET is_disliked = ? WHERE id = ?");

  let groupCount = 0;
  let hiddenCount = 0;

  const tx = db.transaction(() => {
    resetAll.run(searchId);
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      groupCount++;

      const sorted = [...members].sort((a, b) => {
        if (a.is_starred !== b.is_starred) return b.is_starred - a.is_starred;
        if (a.is_active !== b.is_active) return b.is_active - a.is_active;
        const ap = a.price_pln ?? Infinity;
        const bp = b.price_pln ?? Infinity;
        if (ap !== bp) return ap - bp;
        return a.id - b.id;
      });

      const survivor = sorted[0];
      const anyStarred = members.some((m) => m.is_starred === 1);
      const anyDisliked = members.some((m) => m.is_disliked === 1);

      for (const m of sorted.slice(1)) {
        markDup.run(survivor.id, m.id);
        if (m.is_starred === 1) setStar.run(0, m.id); // move the star to the survivor
        if (m.is_disliked === 1) setDisliked.run(0, m.id); // ...and the rejection
        hiddenCount++;
      }
      if (anyStarred && survivor.is_starred !== 1) setStar.run(1, survivor.id);
      const survivorDisliked = anyDisliked && !anyStarred ? 1 : 0;
      if (survivor.is_disliked !== survivorDisliked) setDisliked.run(survivorDisliked, survivor.id);
    }
  });
  tx();

  return { groups: groupCount, hidden: hiddenCount };
}

/** For each survivor id, the hidden duplicates merged into it (source/price/url). */
export function getDuplicateInfo(searchId: number): Map<number, AlsoOn[]> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT duplicate_of AS survivorId, source, price_pln, source_url FROM listings WHERE search_id = ? AND is_duplicate = 1 AND duplicate_of IS NOT NULL"
    )
    .all(searchId) as { survivorId: number; source: ListingSourceId; price_pln: number | null; source_url: string }[];

  const map = new Map<number, AlsoOn[]>();
  for (const r of rows) {
    const entry: AlsoOn = { source: r.source, price_pln: r.price_pln, source_url: r.source_url };
    const arr = map.get(r.survivorId);
    if (arr) arr.push(entry);
    else map.set(r.survivorId, [entry]);
  }
  return map;
}
