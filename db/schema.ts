export type SourceId = "olx" | "otodom" | "adresowo" | "sprzedajemy" | "gratka";

// A listing's source is normally a scraped SourceId, but user-entered rows use
// "manual" - kept distinct from SourceId so scrapers/registry.ts's
// Record<SourceId, Scraper> doesn't need a fake entry for it.
export type ListingSourceId = SourceId | "manual";

export interface SearchRow {
  id: number;
  name: string;
  include_warsaw: number; // 1/0
  districts: string; // JSON array
  towns: string; // JSON array
  sources: string; // JSON array
  min_price: number | null;
  max_price: number | null;
  min_area: number | null;
  max_area: number | null;
  created_at: string;
  last_scraped_at: string | null;
}

export interface Search {
  id: number;
  name: string;
  /** Search Warsaw at all; `districts` narrows it ([] = whole city). */
  includeWarsaw: boolean;
  districts: string[];
  /** Towns outside Warsaw (canonical names from lib/towns.ts). */
  towns: string[];
  sources: SourceId[];
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  maxArea: number | null;
  createdAt: string;
  lastScrapedAt: string | null;
}

export interface ListingRow {
  id: number;
  search_id: number;
  source: ListingSourceId;
  source_id: string;
  source_url: string;
  title: string | null;
  price_pln: number | null;
  area_m2: number | null;
  price_per_m2: number | null;
  district: string | null;
  address_raw: string | null;
  rooms: number | null;
  floor: string | null;
  listing_date: string | null;
  first_scraped_at: string;
  last_scraped_at: string;
  is_active: number;
  is_starred: number;
  is_disliked: number;
  is_duplicate: number;
  duplicate_of: number | null;
  comment: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  czynsz: number | null;
  // Kwestionariusz — answers from calling the seller, user-entered only.
  // Flags are 1/0/null (null = not asked / unknown).
  has_land_register: number | null;
  land_register_number: string | null;
  land_regulated: number | null;
  has_encumbrance: number | null;
  layout: string | null;
  price_negotiable: number | null;
  flooring: string | null;
  wiring: string | null;
  commission_terms: string | null;
  has_tenants: number | null;
  sale_reason: string | null;
  // Enrichment (detail page + AI) — never written by the search-results upsert.
  ownership_type: string | null;
  floor_num: number | null;
  total_floors: number | null;
  year_built: number | null;
  condition_state: string | null;
  has_balcony: number | null;
  has_parking: number | null;
  has_elevator: number | null;
  description: string | null;
  enriched_at: string | null;
  enrich_status: EnrichStatus | null;
  enrich_model: string | null;
  // Map position (lib/geocode.ts). lat/lon NULL = not located; geocoded_at is
  // stamped on every attempt, hit or miss, so an address is looked up once.
  lat: number | null;
  lon: number | null;
  geo_source: GeoSource | null;
  geocoded_at: string | null;
  raw_json: string;
}

export type EnrichStatus = "structured" | "ai" | "mixed" | "failed";

/** source = the site's own map pin (OLX); geocoded = street looked up via Nominatim. */
export type GeoSource = "source" | "geocoded";

/**
 * The facts enrichment tries to establish for a listing — first from the
 * offer's detail page (structured), then from its description via AI for
 * whatever is still missing. `null` always means "unknown", never "no".
 */
export interface EnrichedFields {
  ownershipType: string | null;
  floorNum: number | null;
  totalFloors: number | null;
  czynsz: number | null;
  yearBuilt: number | null;
  conditionState: string | null;
  hasBalcony: number | null;
  hasParking: number | null;
  hasElevator: number | null;
}

export const ENRICHED_FIELD_KEYS: (keyof EnrichedFields)[] = [
  "ownershipType",
  "floorNum",
  "totalFloors",
  "czynsz",
  "yearBuilt",
  "conditionState",
  "hasBalcony",
  "hasParking",
  "hasElevator",
];

export interface NormalizedListing {
  source: SourceId;
  sourceId: string;
  sourceUrl: string;
  title: string | null;
  pricePln: number | null;
  areaM2: number | null;
  pricePerM2: number | null;
  district: string | null;
  addressRaw: string | null;
  rooms: number | null;
  floor: string | null;
  listingDate: string | null;
  raw: Record<string, unknown>;
}

export interface PriceHistoryRow {
  id: number;
  listing_id: number;
  price_pln: number | null;
  recorded_at: string;
}
