// OLX.pl scraper — JSON-first strategy.
// Last verified working: 2026-09-14, by fetching live Warsaw and town
// real-estate search pages and inspecting window.__PRERENDERED_STATE__ (a
// JSON-encoded string assigned to a global in an inline <script> tag). This is
// the same data OLX's own React app hydrates from, so it's far more robust than
// CSS-selector scraping. Ad list lives at listing.listing.{ads,totalPages}.
// If this stops working, re-fetch a live page and check whether the state
// is still exposed under this variable name / JSON-encoding scheme.
//
// Towns are their own city slug in the path (/sprzedaz/pruszkow/, see
// lib/towns.ts). OLX answers quick consecutive requests with 403, so passes
// are spaced out a little more than the default polite delay.
import { fetchText, politeDelay } from "../lib/http";
import { makeLogger } from "../lib/logger";
import { extractPrerenderedState } from "../lib/page-json";
import { TOWNS, locationPasses, type LocationPass } from "../lib/towns";
import { OLX_DISTRICT_ID, isTownAddress } from "../lib/warsaw-districts";
import type { RawListing, Scraper, SearchCriteria } from "./types";

const log = makeLogger("olx");

const BASE_URL = "https://www.olx.pl/nieruchomosci/mieszkania/sprzedaz";

const ROOMS_MAP: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  more: 7,
};

// null when OLX has no usable city slug for the town.
function passBaseUrl(pass: LocationPass): string | null {
  if (pass.kind === "warsaw") return `${BASE_URL}/warszawa/`;
  const slug = TOWNS[pass.town].olx;
  return slug ? `${BASE_URL}/${slug}/` : null;
}

// OLX filters a Warsaw district at source via search[district_id]=<numericId>.
// districtId is undefined for a whole-city or town search.
function buildSearchUrl(criteria: SearchCriteria, page: number, baseUrl: string, districtId?: number): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (criteria.minPrice) params.set("search[filter_float_price:from]", String(criteria.minPrice));
  if (criteria.maxPrice) params.set("search[filter_float_price:to]", String(criteria.maxPrice));
  if (criteria.minArea) params.set("search[filter_float_m:from]", String(criteria.minArea));
  if (criteria.maxArea) params.set("search[filter_float_m:to]", String(criteria.maxArea));
  if (districtId) params.set("search[district_id]", String(districtId));
  const qs = params.toString();
  return qs ? `${baseUrl}?${qs}` : baseUrl;
}

export interface OlxAdParam {
  key: string;
  value?: string;
  normalizedValue?: string;
}

interface OlxAd {
  id: number | string;
  title?: string;
  url: string;
  createdTime?: string;
  params: OlxAdParam[];
  price?: {
    displayValue?: string;
    regularPrice?: { value?: number };
  };
  location?: {
    districtName?: string;
    cityName?: string;
    pathName?: string;
  };
}

interface OlxListingPayload {
  pageNumber: number;
  totalPages: number;
  ads: OlxAd[];
}

function getListing(state: unknown): OlxListingPayload | null {
  const payload = state as { listing?: { listing?: OlxListingPayload } };
  return payload?.listing?.listing ?? null;
}

export function findParam(params: OlxAdParam[], key: string): OlxAdParam | undefined {
  return params.find((p) => p.key === key);
}

function adToRawListing(ad: OlxAd): RawListing | null {
  if (!ad.url) return null;

  const areaParam = findParam(ad.params, "m");
  const roomsParam = findParam(ad.params, "rooms");
  const floorParam = findParam(ad.params, "floor_select");

  const addressParts = [ad.location?.districtName, ad.location?.cityName].filter(Boolean);

  return {
    source: "olx",
    sourceId: String(ad.id),
    sourceUrl: ad.url,
    title: ad.title,
    priceText: ad.price?.regularPrice?.value ? String(ad.price.regularPrice.value) : undefined,
    areaText: areaParam?.value,
    addressText: addressParts.join(", "),
    roomsText: roomsParam?.normalizedValue
      ? String(ROOMS_MAP[roomsParam.normalizedValue] ?? "")
      : undefined,
    floorText: floorParam?.value,
    listingDateText: ad.createdTime,
    raw: ad as unknown as Record<string, unknown>,
  };
}

async function searchPass(criteria: SearchCriteria, pass: LocationPass, baseUrl: string): Promise<RawListing[]> {
  const maxPages = criteria.maxPages ?? 5;
  const districtId = pass.kind === "warsaw" && pass.district ? OLX_DISTRICT_ID[pass.district] : undefined;
  const results: RawListing[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = buildSearchUrl(criteria, page, baseUrl, districtId);
    const html = await fetchText(url);
    if (!html) {
      log.warn(`[${pass.label}] no HTML for page ${page}, stopping pagination`);
      break;
    }

    const state = extractPrerenderedState(html);
    const listing = getListing(state);
    if (!listing) {
      log.warn(`[${pass.label}] could not locate listing state for page ${page}, stopping (site may be bot-checking)`);
      break;
    }

    for (const ad of listing.ads) {
      const raw = adToRawListing(ad);
      if (!raw) continue;
      if (pass.kind === "town" && !isTownAddress(raw.addressText)) continue;
      results.push(raw);
    }

    log.info(`[${pass.label}] page ${page}/${Math.min(listing.totalPages, maxPages)}: ${listing.ads.length} ads`);

    if (page >= listing.totalPages) break;
    await politeDelay();
  }

  return results;
}

export const olxScraper: Scraper = {
  source: "olx",

  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    // One pass per requested location (OLX filters Warsaw districts via a
    // numeric district_id, towns via their city slug); Warsaw without
    // districts -> a single whole-city pass.
    const passes = locationPasses(criteria);
    const all: RawListing[] = [];
    const seen = new Set<string>();

    for (const pass of passes) {
      const baseUrl = passBaseUrl(pass);
      if (!baseUrl) {
        log.warn(`[${pass.label}] no OLX location for this town, skipping`);
        continue;
      }
      const listings = await searchPass(criteria, pass, baseUrl);
      for (const l of listings) {
        if (!seen.has(l.sourceId)) {
          seen.add(l.sourceId);
          all.push(l);
        }
      }
      if (passes.length > 1) await politeDelay(2000, 1000);
    }

    return all;
  },
};
