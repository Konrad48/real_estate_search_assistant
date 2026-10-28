// Duplicate-detection signature shared by the repo and scripts.
//
// The same flat is routinely cross-posted to several services (Otodom + OLX)
// and sometimes spammed many times on one service. In the real data, true
// duplicates share an identical title and area, so the signature is:
//   normalizedTitle + roundedArea
// Price is deliberately NOT part of the key, so a same-offer-with-different-
// price pair still collapses and the survivor rule ("keep cheapest") applies.

export function normalizeTitle(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^0-9a-ząćęłńóśźż]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns a stable dedup key, or null if the listing lacks the fields needed
 * to safely match (empty title or missing area) — those are never deduped.
 */
export function dedupKey(title: string | null | undefined, areaM2: number | null | undefined): string | null {
  const t = normalizeTitle(title);
  if (!t || areaM2 == null || !Number.isFinite(areaM2)) return null;
  return `${t}|${Math.round(areaM2)}`;
}
