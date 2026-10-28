import { TOWN_NAMES } from "./towns";

// Warsaw's 18 official districts (dzielnice). Proper Polish display names
// (with diacritics) are the single source of truth - matchDistrict() below
// normalizes both sides so scraped names with or without diacritics still map
// back to these canonical Polish spellings, which are what the UI shows.
// Towns outside Warsaw live in lib/towns.ts; a listing's `district` column holds
// either a district from here or one of those town names.
export const WARSAW_DISTRICTS = [
  "Bemowo",
  "Białołęka",
  "Bielany",
  "Mokotów",
  "Ochota",
  "Praga-Południe",
  "Praga-Północ",
  "Rembertów",
  "Śródmieście",
  "Targówek",
  "Ursus",
  "Ursynów",
  "Wawer",
  "Wesoła",
  "Wilanów",
  "Włochy",
  "Wola",
  "Żoliborz",
] as const;

export type WarsawDistrict = (typeof WARSAW_DISTRICTS)[number];

// Every value a listing's `district` can hold, in display order.
export const ALL_LOCATIONS: readonly string[] = [...WARSAW_DISTRICTS, ...TOWN_NAMES];

const TOWN_SET = new Set<string>(TOWN_NAMES);

// Otodom encodes a district as a URL path segment: ASCII-lowercased and
// hyphenated (e.g. "Śródmieście" -> "srodmiescie", "Praga-Północ" ->
// "praga-polnoc"). Derived from the canonical names via slugify().
export const OTODOM_DISTRICT_SLUG: Record<string, string> = Object.fromEntries(
  WARSAW_DISTRICTS.map((d) => [d, slugify(d)])
);

// OLX filters by a numeric district_id query param (search[district_id]=NNN).
// Harvested live from the OLX Warsaw filters list on 2026-07-18.
export const OLX_DISTRICT_ID: Record<string, number> = {
  "Śródmieście": 351,
  "Mokotów": 353,
  "Ochota": 355,
  "Włochy": 357,
  "Wola": 359,
  "Rembertów": 361,
  "Żoliborz": 363,
  "Białołęka": 365,
  "Bemowo": 367,
  "Bielany": 369,
  "Ursus": 371,
  "Ursynów": 373,
  "Wilanów": 375,
  "Targówek": 377,
  "Praga-Północ": 379,
  "Praga-Południe": 381,
  "Wawer": 383,
  "Wesoła": 533,
};

function normalizeForMatch(s: string): string {
  return s
    // U+0142/U+0141 (l/L with stroke) has no NFD decomposition, unlike most
    // other Polish diacritics, so it must be replaced explicitly.
    .replace(/[łŁ]/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();
}

// Space-padded words, so " piastow " can be matched as a whole word and not
// inside "Piastowska" / "Pruszkowska" street names.
function wordsForMatch(s: string): string {
  return ` ${normalizeForMatch(s).replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function slugify(s: string): string {
  return s
    .replace(/[łŁ]/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function matchWarsawDistrict(addressText: string): string | null {
  const normalized = normalizeForMatch(addressText);
  for (const district of WARSAW_DISTRICTS) {
    if (normalized.includes(normalizeForMatch(district))) {
      return district;
    }
  }
  return null;
}

// TOWN_NAMES order matters: "Komorów, Michałowice, pruszkowski" is Komorów.
function matchTown(words: string): string | null {
  for (const town of TOWN_NAMES) {
    if (words.includes(wordsForMatch(town))) return town;
  }
  return null;
}

/**
 * The canonical location of an offer: a Warsaw district or a town from
 * lib/towns.ts, or null when the address names neither.
 */
export function matchDistrict(addressText: string | undefined | null): string | null {
  if (!addressText) return null;
  const words = wordsForMatch(addressText);
  const town = matchTown(words);
  // A town name only wins outright when the address doesn't place the offer in
  // Warsaw — Bielany has a "Piastów Śląskich" street, for one.
  if (town && !words.includes(" warszawa ")) return town;
  return matchWarsawDistrict(addressText) ?? town;
}

/** True when the address resolves to one of the towns outside Warsaw. */
export function isTownAddress(addressText: string | undefined | null): boolean {
  const location = matchDistrict(addressText);
  return location != null && TOWN_SET.has(location);
}
