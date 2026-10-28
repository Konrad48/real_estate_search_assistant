// Forma własności ("prawo własności") — the legal title a flat is sold with.
// Every source words this differently (Otodom's target.Building_ownership
// enum, OLX's `type_of_building`-ish params, free text in descriptions), so
// everything funnels through normalizeOwnership() into one of the canonical
// Polish labels below. The UI, the export and the AI schema all use these
// exact strings, so a value in the DB is always directly displayable.

export const OWNERSHIP_TYPES = [
  "pełna własność",
  "spółdzielcze własnościowe",
  "spółdzielcze własnościowe z KW",
  "spółdzielcze lokatorskie",
  "udział",
  "inne",
] as const;

export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

const OWNERSHIP_SET = new Set<string>(OWNERSHIP_TYPES);

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Maps a source's raw wording (Otodom enum, OLX param value, a phrase lifted
 * from a description) onto a canonical OwnershipType. Returns null when the
 * text says nothing about ownership — callers must not guess.
 */
export function normalizeOwnership(text: string | null | undefined): OwnershipType | null {
  if (!text) return null;
  if (OWNERSHIP_SET.has(text)) return text as OwnershipType;

  const t = fold(text);
  if (!t) return null;

  // Otodom's Building_ownership enum values.
  if (t.includes("full_ownership")) return "pełna własność";
  if (t.includes("co_operative_ownership_with_a_land_and_mortgage_register")) {
    return "spółdzielcze własnościowe z KW";
  }
  if (t.includes("co_operative_ownership")) return "spółdzielcze własnościowe";
  if (t.includes("share")) return "udział";

  const cooperative = t.includes("spoldziel");
  const hasKw = /(ksiega wieczysta|ksiegi wieczystej|ksiega wiecz|\bkw\b|z kw)/.test(t);

  if (cooperative && t.includes("lokator")) return "spółdzielcze lokatorskie";
  if (cooperative && hasKw) return "spółdzielcze własnościowe z KW";
  if (cooperative) return "spółdzielcze własnościowe";
  if (t.includes("udzial")) return "udział";
  if (t.includes("wlasnosc hipoteczna") || t.includes("pelna wlasnosc") || t.includes("odrebna wlasnosc")) {
    return "pełna własność";
  }
  // Bare "własność" (Otodom/OLX both use it for a normal freehold flat).
  if (t.includes("wlasnosc")) return "pełna własność";
  if (t.includes("inne") || t.includes("other")) return "inne";

  return null;
}
