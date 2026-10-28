import type { NormalizedListing } from "../db/schema";
import type { RawListing } from "./types";
import { matchDistrict } from "./warsaw-districts";

export function parsePricePLN(text: string | undefined | null): number | null {
  if (!text) return null;
  const digitsOnly = text.replace(/[^\d,.\s]/g, "").replace(/\s/g, "");
  if (!digitsOnly) return null;
  const normalized = digitsOnly.replace(",", ".");
  const value = parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseAreaM2(text: string | undefined | null): number | null {
  if (!text) return null;
  const match = text.replace(",", ".").match(/[\d.]+/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseRooms(text: string | undefined | null): number | null {
  if (!text) return null;
  const match = text.match(/\d+/);
  if (!match) return null;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const CONDITION_STATES = ["do zamieszkania", "do wykończenia", "do remontu"] as const;
export type ConditionState = (typeof CONDITION_STATES)[number];

const CONDITION_SET = new Set<string>(CONDITION_STATES);

/**
 * Maps a source's finish-state wording (Otodom's Construction_status enum,
 * OLX param values, description phrasing) onto one of CONDITION_STATES.
 * Returns null when nothing is stated — never guesses.
 */
export function parseCondition(text: string | undefined | null): ConditionState | null {
  if (!text) return null;
  if (CONDITION_SET.has(text)) return text as ConditionState;
  const t = text.toLowerCase().replace(/ł/g, "l");
  if (t.includes("ready") || t.includes("do zamieszkania") || t.includes("bardzo dobry")) {
    return "do zamieszkania";
  }
  if (t.includes("to_completion") || t.includes("wykonczenia") || t.includes("deweloperski")) {
    return "do wykończenia";
  }
  if (t.includes("to_renovation") || t.includes("remontu") || t.includes("do odswiezenia")) {
    return "do remontu";
  }
  return null;
}

/**
 * A floor as an integer: 0 = parter, -1 = piwnica/suterena, null = unknown.
 * Accepts everything the sources say ("parter", "3", "3/8", "poddasze",
 * Otodom's FLOOR_MAP output, OLX's "Piętro 4").
 */
export function parseFloorNum(text: string | undefined | null): number | null {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/ł/g, "l").trim();
  if (!t) return null;
  if (t.includes("parter") || t === "0" || t.includes("ground")) return 0;
  if (t.includes("suteren") || t.includes("piwnic") || t.includes("cellar")) return -1;
  // "poddasze"/"garret" has no number — leave unknown rather than inventing one.
  const match = t.match(/-?\d+/);
  if (!match) return null;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) && value >= -1 && value <= 100 ? value : null;
}

/** The building's floor count out of a "3/8"-style or "z 8 pięter" text. */
export function parseTotalFloors(text: string | undefined | null): number | null {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/ł/g, "l");
  const slash = t.match(/\d+\s*\/\s*(\d+)/);
  const from = slash ?? t.match(/(?:z|na)\s+(\d+)\s*(?:pieter|pietra|pietrach)?/);
  if (!from) return null;
  const value = parseInt(from[1], 10);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

/** A plain positive whole number ("8", "8 pięter") — e.g. a building's floor count. */
export function parsePositiveInt(text: string | number | undefined | null): number | null {
  if (text == null) return null;
  const match = String(text).match(/\d+/);
  if (!match) return null;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

/** "3/8" / "parter" / "3" — the human-readable label kept in listings.floor. */
export function floorLabel(floorNum: number | null, totalFloors: number | null): string | null {
  if (floorNum == null) return null;
  const base = floorNum === 0 ? "parter" : floorNum === -1 ? "suterena" : String(floorNum);
  return totalFloors != null ? `${base}/${totalFloors}` : base;
}

/** A year of construction, sanity-bounded so stray numbers don't slip in. */
export function parseYearBuilt(text: string | number | undefined | null): number | null {
  if (text == null) return null;
  const match = String(text).match(/(1[89]\d{2}|20\d{2})/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return value >= 1800 && value <= new Date().getFullYear() + 6 ? value : null;
}

export function normalizeListing(raw: RawListing): NormalizedListing {
  const pricePln = parsePricePLN(raw.priceText);
  const areaM2 = parseAreaM2(raw.areaText);
  const pricePerM2 = pricePln && areaM2 ? Math.round((pricePln / areaM2) * 100) / 100 : null;

  return {
    source: raw.source,
    sourceId: raw.sourceId,
    sourceUrl: raw.sourceUrl,
    title: raw.title?.trim() || null,
    pricePln,
    areaM2,
    pricePerM2,
    district: matchDistrict(raw.addressText),
    addressRaw: raw.addressText?.trim() || null,
    rooms: parseRooms(raw.roomsText),
    floor: raw.floorText?.trim() || null,
    listingDate: raw.listingDateText?.trim() || null,
    raw: raw.raw,
  };
}
