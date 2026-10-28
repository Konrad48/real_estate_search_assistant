// Otodom.pl scraper — JSON-first strategy.
// Last verified working: 2026-09-14, by fetching live Warsaw and town search
// pages and inspecting the __NEXT_DATA__ JSON blob (Next.js SSR payload). The
// listing grid lives at props.pageProps.data.searchAds.{items,pagination}. This is
// far more robust than CSS-selector scraping since it's the same JSON the
// React app itself renders from — but Otodom can still change this shape on
// redeploy, in which case the `walkSearchAds` extraction below needs updating.
//
// Towns use the same results URL with their own location path
// (mazowieckie/<powiat>/<gmina>/<miejscowość>, see lib/towns.ts). A small
// town's results are padded with nearby offers (Warsaw, neighbouring villages),
// so town passes keep only offers located in a known town and stop paginating
// once a page is all padding.
import { fetchText, politeDelay } from "../lib/http";
import { makeLogger } from "../lib/logger";
import { extractNextData } from "../lib/page-json";
import { TOWNS, locationPasses, type LocationPass } from "../lib/towns";
import { OTODOM_DISTRICT_SLUG, isTownAddress } from "../lib/warsaw-districts";
import type { RawListing, Scraper, SearchCriteria } from "./types";

const log = makeLogger("otodom");

const REGION_URL = "https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/mazowieckie";
const WARSAW_URL = `${REGION_URL}/warszawa/warszawa/warszawa`;

const ROOMS_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  MORE: 7,
};

const FLOOR_MAP: Record<string, string> = {
  GROUND: "parter",
  FIRST: "1",
  SECOND: "2",
  THIRD: "3",
  FOURTH: "4",
  FIFTH: "5",
  SIXTH: "6",
  SEVENTH: "7",
  EIGHTH: "8",
  NINTH: "9",
  TENTH: "10",
  ABOVE_TENTH: "10+",
  CELLAR: "piwnica",
  GARRET: "poddasze",
};

// Otodom filters a district by appending its slug as a URL path segment, and a
// town by its own location path.
function passBaseUrl(pass: LocationPass): string {
  if (pass.kind === "town") return `${REGION_URL}/${TOWNS[pass.town].otodom}`;
  return pass.district ? `${WARSAW_URL}/${OTODOM_DISTRICT_SLUG[pass.district]}` : WARSAW_URL;
}

function buildSearchUrl(criteria: SearchCriteria, page: number, baseUrl: string): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (criteria.minPrice) params.set("priceMin", String(criteria.minPrice));
  if (criteria.maxPrice) params.set("priceMax", String(criteria.maxPrice));
  if (criteria.minArea) params.set("areaMin", String(criteria.minArea));
  if (criteria.maxArea) params.set("areaMax", String(criteria.maxArea));
  return `${baseUrl}?${params.toString()}`;
}

interface OtodomSearchAdItem {
  id: number | string;
  title?: string;
  slug: string;
  href?: string;
  totalPrice?: { value?: number } | null;
  areaInSquareMeters?: number | null;
  roomsNumber?: string | null;
  floorNumber?: string | null;
  dateCreated?: string | null;
  location?: {
    address?: {
      street?: { name?: string };
      city?: { name?: string };
    };
    reverseGeocoding?: {
      locations?: { locationLevel?: string; name?: string }[];
    };
  };
}

interface OtodomSearchAdsPayload {
  items: OtodomSearchAdItem[];
  pagination: { totalPages: number; currentPage: number };
}

function getSearchAds(nextData: unknown): OtodomSearchAdsPayload | null {
  const payload = nextData as {
    props?: { pageProps?: { data?: { searchAds?: OtodomSearchAdsPayload } } };
  };
  return payload?.props?.pageProps?.data?.searchAds ?? null;
}

function districtFromItem(item: OtodomSearchAdItem): string | undefined {
  const locations = item.location?.reverseGeocoding?.locations ?? [];
  const district = locations.find((l) => l.locationLevel === "district");
  return district?.name;
}

function itemToRawListing(item: OtodomSearchAdItem): RawListing | null {
  if (!item.slug) return null;

  const street = item.location?.address?.street?.name;
  const city = item.location?.address?.city?.name ?? "Warszawa";
  const district = districtFromItem(item);
  const addressParts = [street, district, city].filter(Boolean);

  return {
    source: "otodom",
    sourceId: String(item.id),
    sourceUrl: `https://www.otodom.pl/pl/oferta/${item.slug}`,
    title: item.title,
    priceText: item.totalPrice?.value ? String(item.totalPrice.value) : undefined,
    areaText: item.areaInSquareMeters ? `${item.areaInSquareMeters} m2` : undefined,
    addressText: addressParts.join(", "),
    roomsText: item.roomsNumber ? String(ROOMS_MAP[item.roomsNumber] ?? "") : undefined,
    floorText: item.floorNumber ? FLOOR_MAP[item.floorNumber] ?? item.floorNumber : undefined,
    listingDateText: item.dateCreated ?? undefined,
    raw: item as unknown as Record<string, unknown>,
  };
}

async function searchPass(criteria: SearchCriteria, pass: LocationPass): Promise<RawListing[]> {
  const maxPages = criteria.maxPages ?? 5;
  const baseUrl = passBaseUrl(pass);
  const results: RawListing[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = buildSearchUrl(criteria, page, baseUrl);
    const html = await fetchText(url);
    if (!html) {
      log.warn(`[${pass.label}] no HTML for page ${page}, stopping pagination`);
      break;
    }

    const nextData = extractNextData(html);
    const searchAds = getSearchAds(nextData);
    if (!searchAds) {
      log.warn(`[${pass.label}] could not locate searchAds in __NEXT_DATA__ for page ${page}, stopping`);
      break;
    }

    let kept = 0;
    for (const item of searchAds.items) {
      const listing = itemToRawListing(item);
      if (!listing) continue;
      if (pass.kind === "town" && !isTownAddress(listing.addressText)) continue;
      results.push(listing);
      kept++;
    }

    log.info(
      `[${pass.label}] page ${page}/${Math.min(searchAds.pagination.totalPages, maxPages)}: ${searchAds.items.length} items, ${kept} kept`
    );

    if (page >= searchAds.pagination.totalPages) break;
    if (pass.kind === "town" && kept === 0) break;
    await politeDelay();
  }

  return results;
}

export const otodomScraper: Scraper = {
  source: "otodom",

  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    // One pass per requested location (Otodom filters districts and towns at
    // source via the URL path); Warsaw without districts -> one whole-city pass.
    const passes = locationPasses(criteria);
    const all: RawListing[] = [];
    const seen = new Set<string>();

    for (const pass of passes) {
      const listings = await searchPass(criteria, pass);
      for (const l of listings) {
        if (!seen.has(l.sourceId)) {
          seen.add(l.sourceId);
          all.push(l);
        }
      }
      if (passes.length > 1) await politeDelay();
    }

    return all;
  },
};
