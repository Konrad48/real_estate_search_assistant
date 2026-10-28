import type { NormalizedListing } from "../db/schema";
import type { SearchCriteria } from "./types";
import { WARSAW_DISTRICTS } from "./warsaw-districts";

const WARSAW_SET = new Set<string>(WARSAW_DISTRICTS);

/**
 * Whether a listing's matched location (Warsaw district, town, or null) is one
 * the search asked for. A selected town always counts. Warsaw counts only when
 * includeWarsaw is on: restricted to the chosen districts if any, otherwise the
 * whole city — where unmatched (null) rows still pass as they always have, but
 * an offer placed in a town the list didn't select does not.
 */
function inLocation(
  district: string | null,
  criteria: SearchCriteria,
  districtSet: Set<string> | null,
  townSet: Set<string>
): boolean {
  if (district && townSet.has(district)) return true;
  if (!criteria.includeWarsaw) return false;
  if (districtSet) return district != null && districtSet.has(district);
  return district == null || WARSAW_SET.has(district);
}

/**
 * Shared post-filter applied to every source's normalized results, so that
 * a saved search's locations/price/area are honored even for sources that
 * can't filter at the source URL (Adresowo, Sprzedajemy). For Otodom/OLX the
 * bounds are already applied at source; this just enforces them uniformly.
 *
 * Location filtering uses the already-matched `district` field (from
 * matchDistrict in normalize), which holds a Warsaw district or a town name.
 */
export function applyCriteria(
  listings: NormalizedListing[],
  criteria: SearchCriteria
): NormalizedListing[] {
  const districtSet =
    criteria.districts.length > 0 ? new Set(criteria.districts) : null;
  const townSet = new Set(criteria.towns);

  return listings.filter((l) => {
    if (!inLocation(l.district, criteria, districtSet, townSet)) return false;
    if (criteria.minPrice != null && (l.pricePln == null || l.pricePln < criteria.minPrice)) return false;
    if (criteria.maxPrice != null && (l.pricePln == null || l.pricePln > criteria.maxPrice)) return false;
    if (criteria.minArea != null && (l.areaM2 == null || l.areaM2 < criteria.minArea)) return false;
    if (criteria.maxArea != null && (l.areaM2 == null || l.areaM2 > criteria.maxArea)) return false;
    return true;
  });
}
