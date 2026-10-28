import { getDb } from "./client";
import type { GeoSource, ListingSourceId } from "./schema";

/** One offer still without a map position. */
export interface PendingLocation {
  id: number;
  source: ListingSourceId;
  address_raw: string | null;
  district: string | null;
  /** Only loaded for OLX — the one source whose search results carry a map pin. */
  raw_json: string | null;
}

/** A Nominatim result, as cached. */
export interface GeocodeCandidate {
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * Visible offers of one list that have never been located. Inactive offers and
 * hidden duplicates are skipped, like enrichment — no point spending a
 * rate-limited lookup on them.
 */
export function listingsNeedingLocation(searchId: number): PendingLocation[] {
  return getDb()
    .prepare(
      `SELECT id, source, address_raw, district,
              CASE WHEN source = 'olx' THEN raw_json END AS raw_json
       FROM listings
       WHERE search_id = ? AND is_active = 1 AND is_duplicate = 0
         AND lat IS NULL AND geocoded_at IS NULL
       ORDER BY id ASC`
    )
    .all(searchId) as PendingLocation[];
}

/** Stores a locate attempt; `point` null records a miss so it isn't retried. */
export function setListingLocation(
  listingId: number,
  point: { lat: number; lon: number } | null,
  geoSource: GeoSource
): void {
  getDb()
    .prepare("UPDATE listings SET lat = @lat, lon = @lon, geo_source = @geoSource, geocoded_at = @now WHERE id = @id")
    .run({
      id: listingId,
      lat: point?.lat ?? null,
      lon: point?.lon ?? null,
      geoSource: point ? geoSource : null,
      now: new Date().toISOString(),
    });
}

/** undefined = never asked; [] = asked, nothing found. */
export function getCachedGeocode(query: string): GeocodeCandidate[] | undefined {
  const row = getDb().prepare("SELECT results_json FROM geocode_cache WHERE query = ?").get(query) as
    | { results_json: string }
    | undefined;
  return row ? (JSON.parse(row.results_json) as GeocodeCandidate[]) : undefined;
}

export function putCachedGeocode(query: string, results: GeocodeCandidate[]): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO geocode_cache (query, results_json, created_at) VALUES (?, ?, ?)")
    .run(query, JSON.stringify(results), new Date().toISOString());
}
