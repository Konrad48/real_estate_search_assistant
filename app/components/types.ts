import type { ListingRow, ListingSourceId, PriceHistoryRow, Search, SourceId } from "../../db/schema";

export type { ListingRow, ListingSourceId, PriceHistoryRow, Search, SourceId };

export interface AlsoOn {
  source: ListingSourceId;
  price_pln: number | null;
  source_url: string;
}

export interface ListingWithPrev extends ListingRow {
  previous_price_pln: number | null;
  also_on: AlsoOn[];
}

export const ALL_SOURCES: SourceId[] = ["otodom", "olx", "adresowo", "sprzedajemy", "gratka"];

export const SOURCE_LABELS: Record<ListingSourceId, string> = {
  otodom: "Otodom",
  olx: "OLX",
  adresowo: "Adresowo",
  sprzedajemy: "Sprzedajemy",
  gratka: "Gratka",
  manual: "Ręcznie dodane",
};

export type SortColumn =
  | "price_pln"
  | "area_m2"
  | "price_per_m2"
  | "district"
  | "source"
  | "rooms"
  | "last_scraped_at"
  | "floor"
  | "listing_date"
  | "address_raw"
  | "comment"
  | "contact_name"
  | "contact_phone"
  | "czynsz"
  | "ownership_type"
  | "total_floors"
  | "year_built"
  | "condition_state"
  | "has_balcony"
  | "has_parking"
  | "has_elevator";

export interface SortState {
  column: SortColumn;
  direction: "asc" | "desc";
}

export interface SearchFormValues {
  name: string;
  includeWarsaw: boolean;
  districts: string[];
  towns: string[];
  sources: SourceId[];
  minPrice: string;
  maxPrice: string;
  minArea: string;
  maxArea: string;
}

export function searchToFormValues(s: Search): SearchFormValues {
  return {
    name: s.name,
    includeWarsaw: s.includeWarsaw,
    districts: s.districts,
    towns: s.towns,
    sources: s.sources,
    minPrice: s.minPrice != null ? String(s.minPrice) : "",
    maxPrice: s.maxPrice != null ? String(s.maxPrice) : "",
    minArea: s.minArea != null ? String(s.minArea) : "",
    maxArea: s.maxArea != null ? String(s.maxArea) : "",
  };
}

export const EMPTY_FORM: SearchFormValues = {
  name: "",
  includeWarsaw: true,
  districts: [],
  towns: [],
  sources: [...ALL_SOURCES],
  minPrice: "",
  maxPrice: "",
  minArea: "",
  maxArea: "",
};

export function formToPayload(v: SearchFormValues) {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    name: v.name.trim() || undefined,
    includeWarsaw: v.includeWarsaw,
    // The form keeps ticked districts while Warszawa is off, so re-ticking it
    // restores them — but they aren't part of the saved list until then.
    districts: v.includeWarsaw ? v.districts : [],
    towns: v.towns,
    sources: v.sources,
    minPrice: num(v.minPrice),
    maxPrice: num(v.maxPrice),
    minArea: num(v.minArea),
    maxArea: num(v.maxArea),
  };
}
