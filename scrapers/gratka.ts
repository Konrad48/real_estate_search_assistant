// Gratka.pl scraper — Cheerio HTML strategy.
// Last verified working: 2026-09-14, by fetching live Warsaw and town listing pages.
// Gratka is a Nuxt/Vue app but server-renders the listing grid as HTML cards.
// Each card is `a[data-listing-card-teaser]` and every field carries a stable
// `data-cy` test id (far more durable than the scoped `data-v-*` CSS classes):
//   propertyCardTitle / propertyCardPrice / cardPropertyInfoArea /
//   cardPropertyInfoRooms / cardPropertyInfoFloor / descriptionAddedAtDate
// The listing id + location live in the href:
//   /nieruchomosci/mieszkanie-warszawa-mokotow-pulawska/ob/47538165
//   /nieruchomosci/mieszkanie-pruszkowski-piastow-piasta/ob/48942351
//
// Filtering: district/town IS filterable at source via the URL path segment
// (/warszawa/<slug> for a district, /<town-slug> for a town, same slug format
// as slugify()); price/area are NOT (their query params are ignored and
// robots-disallowed) so they fall to the shared applyCriteria post-filter.
// Town names Gratka resolves to a same-named place elsewhere in Poland
// (Komorów, Michałowice) go through the county page instead (lib/towns.ts),
// fetched once and narrowed to known towns.
//
// robots.txt disallows `*page=*` (pagination) and the filter params, so this
// scraper fetches PAGE 1 PER LOCATION ONLY (no pagination) — consistent with
// the project's robots-respecting posture (and the Sprzedajemy single-page
// precedent). High-inventory locations are therefore truncated to ~32 offers.
import * as cheerio from "cheerio";
import { fetchText, politeDelay } from "../lib/http";
import { makeLogger } from "../lib/logger";
import { TOWNS, locationPasses, type LocationPass } from "../lib/towns";
import { isTownAddress, slugify } from "../lib/warsaw-districts";
import type { RawListing, Scraper, SearchCriteria } from "./types";

const log = makeLogger("gratka");

const ORIGIN = "https://gratka.pl";
const BASE_PATH = "/nieruchomosci/mieszkania";

function passUrl(pass: LocationPass): string {
  if (pass.kind === "town") return `${ORIGIN}${BASE_PATH}/${TOWNS[pass.town].gratka}`;
  return pass.district
    ? `${ORIGIN}${BASE_PATH}/warszawa/${slugify(pass.district)}`
    : `${ORIGIN}${BASE_PATH}/warszawa`;
}

function cardAddress($: cheerio.CheerioAPI, card: ReturnType<cheerio.CheerioAPI>, href: string): string {
  // The address is a bare <span> ending in "…, Warszawa, mazowieckie" or
  // "…, Piastów, pruszkowski, mazowieckie".
  let addr = "";
  card.find("span").each((_, s) => {
    const t = $(s).clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    if (/, mazowieckie$/.test(t)) {
      addr = t;
      return false;
    }
  });
  // Fallback: the location is always present in the URL slug
  // (mieszkanie-warszawa-<district>-… / mieszkanie-<powiat>-<town>-…) — feed
  // that to matchDistrict instead.
  if (!addr) {
    const m = href.match(/mieszkanie-([a-z0-9-]+)\/(?:ob|oi)\//);
    addr = m ? m[1].replace(/-/g, " ") : "";
  }
  return addr;
}

function cardToRawListing($: cheerio.CheerioAPI, card: ReturnType<cheerio.CheerioAPI>): RawListing | null {
  const href = card.attr("href");
  if (!href) return null;
  const id = (href.match(/\/(?:ob|oi)\/(\d+)/) || [])[1];
  if (!id) return null;

  const text = (cy: string) => {
    const t = card.find(`[data-cy="${cy}"]`).first().text().replace(/\s+/g, " ").trim();
    return t || undefined;
  };

  return {
    source: "gratka",
    sourceId: id,
    sourceUrl: new URL(href, ORIGIN).toString(),
    title: text("propertyCardTitle"),
    priceText: text("propertyCardPrice"),
    areaText: text("cardPropertyInfoArea"),
    addressText: cardAddress($, card, href) || undefined,
    roomsText: text("cardPropertyInfoRooms"),
    floorText: text("cardPropertyInfoFloor"),
    listingDateText: text("descriptionAddedAtDate"),
    raw: { id, href },
  };
}

async function searchPass(pass: LocationPass, url: string): Promise<RawListing[]> {
  const html = await fetchText(url);
  if (!html) {
    log.warn(`[${pass.label}] no HTML (robots-disallowed or fetch failed), skipping`);
    return [];
  }

  const $ = cheerio.load(html);
  const cards = $("[data-listing-card-teaser]");
  if (cards.length === 0) {
    log.warn(`[${pass.label}] no cards found (selectors may be stale)`);
    return [];
  }

  const results: RawListing[] = [];
  cards.each((_, el) => {
    const raw = cardToRawListing($, $(el));
    if (!raw) return;
    if (pass.kind === "town" && !isTownAddress(raw.addressText)) return;
    results.push(raw);
  });
  log.info(`[${pass.label}] ${cards.length} cards, ${results.length} kept`);
  return results;
}

export const gratkaScraper: Scraper = {
  source: "gratka",

  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    // One page-1 pass per requested location (filtered at source); Warsaw
    // without districts -> a single whole-city pass. Towns sharing a county
    // page fetch it once — its offers are already narrowed to every known town.
    const passes = locationPasses(criteria);
    const all: RawListing[] = [];
    const seen = new Set<string>();
    const fetched = new Set<string>();

    for (const pass of passes) {
      const url = passUrl(pass);
      if (fetched.has(url)) continue;
      fetched.add(url);
      const listings = await searchPass(pass, url);
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
