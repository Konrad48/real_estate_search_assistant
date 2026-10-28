// Towns outside Warsaw (its western suburbs) that a saved list can search in
// addition to, or instead of, Warsaw. The canonical Polish names are the single
// source of truth for the form, the API's zod filter and the listings'
// `district` column (which holds a Warsaw district or one of these). Client-safe:
// no server deps, and deliberately no import of lib/warsaw-districts.ts, which
// imports this file.
//
// Each town also records how every source reaches it — verified live
// 2026-09-14. `null` means the source has no usable page for that town (the
// name resolves to a same-named place elsewhere in Poland, or the site ignores
// the location and serves a nationwide page), so that source skips the town.

export const TOWN_NAMES = [
  "Piastów",
  "Pruszków",
  "Brwinów",
  // Before Michałowice: Komorów lies in gmina Michałowice, and its offers'
  // addresses name both ("Komorów, Michałowice, pruszkowski").
  "Komorów",
  "Michałowice",
  "Milanówek",
  "Grodzisk Mazowiecki",
] as const;

export type TownName = (typeof TOWN_NAMES)[number];

export interface TownSources {
  /** Otodom location path under /mazowieckie/ (powiat/gmina/miejscowość). */
  otodom: string;
  /** OLX city slug; ambiguous names carry OLX's numeric city id suffix. */
  olx: string | null;
  /** Gratka path segment; the county page where Gratka resolves the name elsewhere. */
  gratka: string;
  /** Adresowo /mieszkania/<slug>/ — most towns fall back to a nationwide page. */
  adresowo: string | null;
  /** Sprzedajemy /<slug>/nieruchomosci/mieszkania/sprzedaz. */
  sprzedajemy: string | null;
}

export const TOWNS: Record<TownName, TownSources> = {
  "Piastów": {
    otodom: "pruszkowski/piastow/piastow",
    olx: "piastow",
    gratka: "piastow",
    adresowo: null,
    sprzedajemy: "piastow",
  },
  "Pruszków": {
    otodom: "pruszkowski/pruszkow/pruszkow",
    olx: "pruszkow",
    gratka: "pruszkow",
    adresowo: "pruszkow",
    sprzedajemy: "pruszkow",
  },
  "Brwinów": {
    otodom: "pruszkowski/brwinow/brwinow",
    olx: "brwinow",
    gratka: "brwinow",
    adresowo: null,
    sprzedajemy: "brwinow",
  },
  "Komorów": {
    otodom: "pruszkowski/michalowice/komorow",
    olx: "komorow_117329",
    gratka: "pruszkowski",
    adresowo: null,
    sprzedajemy: null,
  },
  "Michałowice": {
    otodom: "pruszkowski/michalowice/michalowice",
    olx: "michalowice_101993",
    gratka: "pruszkowski",
    adresowo: null,
    sprzedajemy: null,
  },
  "Milanówek": {
    otodom: "grodziski/milanowek/milanowek",
    olx: "milanowek",
    gratka: "milanowek",
    adresowo: null,
    sprzedajemy: null,
  },
  "Grodzisk Mazowiecki": {
    otodom: "grodziski/grodzisk-mazowiecki/grodzisk-mazowiecki",
    olx: "grodzisk-mazowiecki",
    gratka: "grodzisk-mazowiecki",
    adresowo: null,
    sprzedajemy: "grodzisk-mazowiecki",
  },
};

const TOWN_SET = new Set<string>(TOWN_NAMES);

export function isTownName(s: string): s is TownName {
  return TOWN_SET.has(s);
}

/** The location part of a saved list (or of scrape criteria). */
export interface LocationSelection {
  includeWarsaw: boolean;
  districts: string[];
  towns: string[];
}

/**
 * One source-side search a scraper runs: a Warsaw district (null = the whole
 * city) or a town. `label` is for logs.
 */
export type LocationPass =
  | { kind: "warsaw"; district: string | null; label: string }
  | { kind: "town"; town: TownName; label: string };

export function locationPasses(selection: LocationSelection): LocationPass[] {
  const passes: LocationPass[] = [];
  if (selection.includeWarsaw) {
    if (selection.districts.length === 0) {
      passes.push({ kind: "warsaw", district: null, label: "Warszawa" });
    }
    for (const district of selection.districts) {
      passes.push({ kind: "warsaw", district, label: district });
    }
  }
  for (const town of selection.towns) {
    if (isTownName(town)) passes.push({ kind: "town", town, label: town });
  }
  return passes;
}

/** Polish summary, e.g. "Mokotów, Wola, Pruszków" or "Cała Warszawa, Piastów". */
export function describeLocations(selection: LocationSelection): string {
  const parts: string[] = [];
  if (selection.includeWarsaw) {
    parts.push(selection.districts.length > 0 ? selection.districts.join(", ") : "Cała Warszawa");
  }
  parts.push(...selection.towns);
  return parts.join(", ");
}
