// Where an offer sits on the map. Two ways, cheapest first:
//  * OLX search results already carry the ad's map pin (raw_json.map). It is
//    exact only when show_detailed is true; otherwise it marks an area a few km
//    wide, which would look precise as a dot and isn't, so it's ignored.
//  * Everyone else: the street from address_raw, looked up with OpenStreetMap's
//    Nominatim. Its usage policy (operations.osmfoundation.org/policies/nominatim)
//    allows at most 1 request/second from an identified client (lib/http.ts's
//    User-Agent) with results cached — geocode_cache keeps every answer. A result
//    only counts when Nominatim places it in the offer's own district/town, so a
//    same-named street elsewhere, or a neighbourhood name (Gratka's "Okęcie")
//    taken for a street, never lands as a wrong dot.
// Offers that state only a district/town stay off the map on purpose, for the
// same reason as OLX's areas. Sprzedajemy has no address field at all (its
// "address" is the offer title).
import type { GeocodeCandidate } from "../db/geo-repo";
import { fetchText, sleep } from "./http";
import { TOWN_NAMES } from "./towns";
import { WARSAW_DISTRICTS, matchDistrict } from "./warsaw-districts";

export const NOMINATIM_INTERVAL_MS = 1100;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export function olxCoordinates(rawJson: string | null): GeoPoint | null {
  if (!rawJson) return null;
  try {
    const map = (JSON.parse(rawJson) as { map?: { lat?: unknown; lon?: unknown; show_detailed?: unknown } }).map;
    if (!map || map.show_detailed !== true) return null;
    const lat = Number(map.lat);
    const lon = Number(map.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

const TOWN_SET = new Set<string>(TOWN_NAMES);
const LOCATION_NAMES = new Set<string>([...WARSAW_DISTRICTS, ...TOWN_NAMES, "Warszawa"].map((n) => n.toLowerCase()));
const STREET_PREFIX = /^(ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle|rondo)\s+/i;

export interface StreetQuery {
  street: string;
  city: string;
  /** The district/town the result must fall in. */
  location: string;
  /** geocode_cache key. */
  key: string;
}

function isLocationPart(part: string, city: string): boolean {
  const lower = part.toLowerCase();
  if (LOCATION_NAMES.has(lower)) return true;
  // Admin units come lowercase: "mazowieckie", "pruszkowski", "warszawski zachodni".
  if (part === lower) return true;
  // Adresowo leads with "<city> <district or osiedle>": "Warszawa Bemowo", "Pruszków Bąki".
  return lower.startsWith(`${city.toLowerCase()} `);
}

function expandPrefix(street: string): string {
  return street
    .replace(/^(ul\.?|ulica)\s+/i, "")
    .replace(/^al\.?\s+/i, "aleja ")
    .replace(/^pl\.?\s+/i, "plac ")
    .replace(/^os\.?\s+/i, "osiedle ")
    .trim();
}

/**
 * The street to look up for an offer, or null when its address names no street.
 * Address shapes by source: Otodom "ul. X, Bemowo, Warszawa", Gratka
 * "X, Bielany, Warszawa, mazowieckie", Adresowo "Warszawa Bemowo, ul. X",
 * manual rows whatever the user typed.
 */
export function streetQuery(row: {
  source: string;
  address_raw: string | null;
  district: string | null;
}): StreetQuery | null {
  if (!row.address_raw || row.source === "olx" || row.source === "sprzedajemy") return null;
  const location = row.district ?? matchDistrict(row.address_raw);
  if (!location) return null;
  const city = TOWN_SET.has(location) ? location : "Warszawa";

  const parts = row.address_raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const candidates = parts.filter((p) => !isLocationPart(p, city));
  const raw = candidates.find((p) => STREET_PREFIX.test(p)) ?? candidates[0];
  if (!raw) return null;
  const street = expandPrefix(raw);
  if (!/\p{L}{3}/u.test(street)) return null;
  return { street, city, location, key: `${street}|${city}`.toLowerCase() };
}

/** The first candidate Nominatim places in the expected district/town. */
export function pickCandidate(candidates: GeocodeCandidate[], location: string): GeoPoint | null {
  const hit = candidates.find((c) => matchDistrict(c.displayName) === location);
  return hit ? { lat: hit.lat, lon: hit.lon } : null;
}

// Process-wide request gate: requests start at least NOMINATIM_INTERVAL_MS apart
// no matter how many locate runs are alive (an old run can still be finishing
// its last lookup when a newer one takes over).
let lastRequestAt = 0;
let gate: Promise<void> = Promise.resolve();

function waitForTurn(): Promise<void> {
  const turn = gate.then(async () => {
    const wait = lastRequestAt + NOMINATIM_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  gate = turn.catch(() => {});
  return turn;
}

/** null = the request failed (retry later); [] = Nominatim found nothing (worth caching). */
export async function nominatimSearch(query: StreetQuery): Promise<GeocodeCandidate[] | null> {
  const params = new URLSearchParams({
    street: query.street,
    city: query.city,
    countrycodes: "pl",
    format: "jsonv2",
    // Long streets come back as one result per segment (Czerniakowska crosses
    // Śródmieście and Mokotów); enough of them that the offer's district is among them.
    limit: "10",
  });
  await waitForTurn();
  const text = await fetchText(`${NOMINATIM_URL}?${params.toString()}`, { timeoutMs: 10000, retries: 1 });
  if (text == null) return null;
  try {
    const data = JSON.parse(text) as { lat?: string; lon?: string; display_name?: string }[];
    if (!Array.isArray(data)) return null;
    return data.flatMap((d) => {
      const lat = Number(d.lat);
      const lon = Number(d.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) && d.display_name
        ? [{ lat, lon, displayName: d.display_name }]
        : [];
    });
  } catch {
    return null;
  }
}
