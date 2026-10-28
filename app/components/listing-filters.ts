// Client-side filtering for the listings table ("Filtry" next to "Kolumny").
//
// Filters are applied in the browser over the rows already fetched for the
// active list — no API round-trip — and are persisted in localStorage so they
// survive a reload, a restart of the dev server, and switching between lists.
//
// Every column the table can show is filterable, plus floor_num (the table
// renders floor as one "3/8" label but filtering by storey number is what you
// actually want). Each filter kind knows how to test a row and whether it is
// currently doing anything (an "empty" filter is dropped on save).
import { ALL_LOCATIONS } from "../../lib/warsaw-districts";
import { CONDITION_STATES } from "../../lib/normalize";
import { OWNERSHIP_TYPES } from "../../lib/ownership";
import { ALL_SOURCES, SOURCE_LABELS, type ListingWithPrev } from "./types";

/** Enum option standing for "the offer never said" (a NULL in the DB). */
export const NULL_OPTION = "__null__";

export type FilterKind = "number" | "text" | "enum" | "flag" | "date";

export interface NumberFilter {
  min: string;
  max: string;
}
export interface DateFilter {
  from: string;
  to: string;
}
/** "" = off, "1" = tak, "0" = nie, NULL_OPTION = brak danych. */
export type FlagFilter = "" | "1" | "0" | typeof NULL_OPTION;

export type FilterValue = NumberFilter | DateFilter | FlagFilter | string | string[];

export type FilterKey =
  | "source"
  | "title"
  | "price_pln"
  | "area_m2"
  | "price_per_m2"
  | "rooms"
  | "district"
  | "address_raw"
  | "floor_num"
  | "total_floors"
  | "ownership_type"
  | "czynsz"
  | "year_built"
  | "condition_state"
  | "has_balcony"
  | "has_parking"
  | "has_elevator"
  | "listing_date"
  | "last_scraped_at"
  | "contact_name"
  | "contact_phone"
  | "comment";

export interface FilterDef {
  key: FilterKey;
  label: string;
  kind: FilterKind;
  /** enum only: allowed values, in display order. */
  options?: { value: string; label: string }[];
  /** number only: unit shown next to the inputs. */
  unit?: string;
}

const enumOptions = (values: readonly string[]) => [
  ...values.map((v) => ({ value: v, label: v })),
  { value: NULL_OPTION, label: "(brak danych)" },
];

export const FILTER_DEFS: FilterDef[] = [
  {
    key: "source",
    label: "Źródło",
    kind: "enum",
    options: [
      ...ALL_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] })),
      { value: "manual", label: SOURCE_LABELS.manual },
    ],
  },
  { key: "title", label: "Tytuł zawiera", kind: "text" },
  { key: "price_pln", label: "Cena", kind: "number", unit: "zł" },
  { key: "area_m2", label: "Powierzchnia", kind: "number", unit: "m²" },
  { key: "price_per_m2", label: "Cena/m²", kind: "number", unit: "zł" },
  { key: "rooms", label: "Pokoje", kind: "number" },
  {
    key: "district",
    label: "Lokalizacja",
    kind: "enum",
    options: enumOptions(ALL_LOCATIONS),
  },
  { key: "address_raw", label: "Adres zawiera", kind: "text" },
  { key: "floor_num", label: "Piętro (0 = parter)", kind: "number" },
  { key: "total_floors", label: "Pięter w budynku", kind: "number" },
  {
    key: "ownership_type",
    label: "Prawo własności",
    kind: "enum",
    options: enumOptions(OWNERSHIP_TYPES),
  },
  { key: "czynsz", label: "Czynsz", kind: "number", unit: "zł" },
  { key: "year_built", label: "Rok budowy", kind: "number" },
  {
    key: "condition_state",
    label: "Stan wykończenia",
    kind: "enum",
    options: enumOptions(CONDITION_STATES),
  },
  { key: "has_balcony", label: "Balkon / taras", kind: "flag" },
  { key: "has_parking", label: "Miejsce postojowe", kind: "flag" },
  { key: "has_elevator", label: "Winda", kind: "flag" },
  { key: "listing_date", label: "Data ogłoszenia zawiera", kind: "text" },
  { key: "last_scraped_at", label: "Pobrano", kind: "date" },
  { key: "contact_name", label: "Kontakt — imię zawiera", kind: "text" },
  { key: "contact_phone", label: "Kontakt — telefon zawiera", kind: "text" },
  { key: "comment", label: "Komentarz zawiera", kind: "text" },
];

const DEF_BY_KEY = new Map(FILTER_DEFS.map((d) => [d.key, d]));

export type ListingFilters = Partial<Record<FilterKey, FilterValue>>;

export function emptyValue(kind: FilterKind): FilterValue {
  switch (kind) {
    case "number":
      return { min: "", max: "" };
    case "date":
      return { from: "", to: "" };
    case "enum":
      return [];
    case "flag":
      return "";
    case "text":
      return "";
  }
}

/** Whether a filter value would actually exclude anything. */
export function isActive(kind: FilterKind, value: FilterValue | undefined): boolean {
  if (value == null) return false;
  switch (kind) {
    case "number": {
      const v = value as NumberFilter;
      return v.min.trim() !== "" || v.max.trim() !== "";
    }
    case "date": {
      const v = value as DateFilter;
      return v.from.trim() !== "" || v.to.trim() !== "";
    }
    case "enum":
      return (value as string[]).length > 0;
    case "flag":
    case "text":
      return String(value).trim() !== "";
  }
}

export function countActive(filters: ListingFilters): number {
  return FILTER_DEFS.filter((d) => isActive(d.kind, filters[d.key])).length;
}

function matchesNumber(cell: unknown, filter: NumberFilter): boolean {
  const min = filter.min.trim() === "" ? null : Number(filter.min);
  const max = filter.max.trim() === "" ? null : Number(filter.max);
  // A row with no value can't satisfy a numeric bound — treat it as excluded,
  // which is what "cena od 500 000" intuitively means.
  if (typeof cell !== "number") return false;
  if (min != null && Number.isFinite(min) && cell < min) return false;
  if (max != null && Number.isFinite(max) && cell > max) return false;
  return true;
}

function matchesText(cell: unknown, needle: string): boolean {
  const text = cell == null ? "" : String(cell);
  return text.toLowerCase().includes(needle.trim().toLowerCase());
}

function matchesEnum(cell: unknown, selected: string[]): boolean {
  if (cell == null || cell === "") return selected.includes(NULL_OPTION);
  return selected.includes(String(cell));
}

function matchesFlag(cell: unknown, filter: FlagFilter): boolean {
  if (filter === NULL_OPTION) return cell == null;
  return cell != null && String(cell) === filter;
}

function matchesDate(cell: unknown, filter: DateFilter): boolean {
  if (cell == null) return false;
  // Stored as an ISO timestamp; a plain yyyy-mm-dd compares correctly as a
  // prefix, and "to" is inclusive of the whole day.
  const day = String(cell).slice(0, 10);
  if (filter.from.trim() !== "" && day < filter.from) return false;
  if (filter.to.trim() !== "" && day > filter.to) return false;
  return true;
}

function matches(row: ListingWithPrev, def: FilterDef, value: FilterValue): boolean {
  const cell = (row as unknown as Record<string, unknown>)[def.key];
  switch (def.kind) {
    case "number":
      return matchesNumber(cell, value as NumberFilter);
    case "text":
      return matchesText(cell, value as string);
    case "enum":
      return matchesEnum(cell, value as string[]);
    case "flag":
      return matchesFlag(cell, value as FlagFilter);
    case "date":
      return matchesDate(cell, value as DateFilter);
  }
}

/** Keeps rows satisfying every active filter (AND across fields). */
export function applyFilters(rows: ListingWithPrev[], filters: ListingFilters): ListingWithPrev[] {
  const active = FILTER_DEFS.filter((d) => isActive(d.kind, filters[d.key]));
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((def) => matches(row, def, filters[def.key] as FilterValue)));
}

export const FILTERS_KEY = "listingsTable.filters";

/** Drops anything that isn't a filter this build knows about. */
function sanitize(parsed: unknown): ListingFilters {
  if (!parsed || typeof parsed !== "object") return {};
  const out: ListingFilters = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const def = DEF_BY_KEY.get(key as FilterKey);
    if (!def) continue;
    const expected = emptyValue(def.kind);
    if (Array.isArray(expected) !== Array.isArray(value)) continue;
    if (typeof expected === "object" && !Array.isArray(expected)) {
      if (typeof value !== "object" || value == null) continue;
    } else if (typeof expected === "string" && typeof value !== "string") {
      continue;
    }
    if (isActive(def.kind, value as FilterValue)) out[def.key] = value as FilterValue;
  }
  return out;
}

export function loadFilters(): ListingFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveFilters(filters: ListingFilters): void {
  if (typeof window === "undefined") return;
  // Only active filters are stored, so a stale empty value can never linger.
  window.localStorage.setItem(FILTERS_KEY, JSON.stringify(sanitize(filters)));
}
