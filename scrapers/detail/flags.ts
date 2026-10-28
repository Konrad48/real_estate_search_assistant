// Amenity detection shared by the detail fetchers. Each site lists its
// features as free-form labels ("Balkon", "winda", "miejsce parkingowe",
// "garaz/miejsce parkingowe"), so we look for keywords in one lowercased
// haystack built from that site's feature list.
//
// A hit means 1 (yes). A miss means null (unknown) — NOT 0 — because a
// feature list that omits "winda" doesn't prove the building has none; only
// an explicit negation ("bez windy") yields 0.

export type FlagKind = "balcony" | "parking" | "elevator";

const KEYWORDS: Record<FlagKind, string[]> = {
  // balkon, taras and ogródek all count as "outdoor space" for the UI column.
  balcony: ["balkon", "taras", "ogrodek", "ogródek", "loggia"],
  parking: ["parking", "postojow", "garaz", "garaż", "hala garaz"],
  elevator: ["winda", "windy", "dzwig osobowy", "lift"],
};

const NEGATIONS: Record<FlagKind, string[]> = {
  balcony: ["bez balkonu", "brak balkonu"],
  parking: ["bez miejsca postojowego", "brak miejsca postojowego", "bez garazu"],
  elevator: ["bez windy", "brak windy", "budynek bez windy"],
};

/** 1 = stated present, 0 = stated absent, null = not stated. */
export function flagFromText(haystack: string, kind: FlagKind): number | null {
  if (!haystack) return null;
  const text = haystack.toLowerCase();
  if (NEGATIONS[kind].some((n) => text.includes(n))) return 0;
  if (KEYWORDS[kind].some((k) => text.includes(k))) return 1;
  return null;
}
