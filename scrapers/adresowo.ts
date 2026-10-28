// Adresowo.pl scraper — Cheerio HTML strategy.
// Last verified working: 2026-09-14, by fetching live Warsaw and town listing
// pages and inspecting the server-rendered HTML. No __NEXT_DATA__/JSON island was
// found, so this parses offer cards directly. Cards are `[data-offer-card]`
// elements with a stable `data-id` attribute (used as sourceId) - preferred
// over any CSS class since Tailwind utility classes on this site churn.
// Price/area/rooms are the first three `p.flex-auto` elements within a card
// (each holds a bold number + a unit label); this ordering is a brittle
// assumption if Adresowo reorders those fields, flagged here for future-you.
//
// No price/area/rooms filter query params were found in the static HTML
// (the filter UI appears to be client-rendered), so this scraper fetches the
// default unfiltered Warsaw "for sale" listing and lets the app's own
// filters narrow results after scraping.
//
// Also observed: the server-rendered HTML for the /warszawa listing path is
// NOT reliably city-filtered - many pages return a majority of cards from
// other cities entirely (looks like a nationwide "recommended" SSR fallback
// that a real browser would replace via client-side JS after hydration).
// isWarsawListing() below filters these out post-hoc rather than trying to
// find/replicate the real client-side XHR endpoint - acceptable coverage
// tradeoff for a low-volume personal tool per the project's scraping
// posture (accept reduced coverage over escalating scraping effort).
//
// Towns: only a few have a real /mieszkania/<slug>/ page (Pruszków, as of
// 2026-09-14); the rest get that same nationwide fallback, so lib/towns.ts
// marks them null and they're skipped. Town pages are narrowed to offers
// located in a known town, the same way Warsaw pages are narrowed to Warsaw.
import * as cheerio from "cheerio";
import { fetchText, politeDelay } from "../lib/http";
import { makeLogger } from "../lib/logger";
import { TOWNS, isTownName } from "../lib/towns";
import { isTownAddress } from "../lib/warsaw-districts";
import type { RawListing, Scraper, SearchCriteria } from "./types";

const log = makeLogger("adresowo");

const ORIGIN = "https://adresowo.pl";
const WARSAW_PATH = "/mieszkania/sprzedam/warszawa";

interface Target {
  label: string;
  url(page: number): string;
  keep(raw: RawListing): boolean;
}

function cardToRawListing($: cheerio.CheerioAPI, card: ReturnType<cheerio.CheerioAPI>): RawListing | null {
  const id = card.attr("data-id");
  const link = card.find("h2 a[href]").first();
  const href = link.attr("href");
  if (!id || !href) return null;

  let priceText: string | undefined;
  let areaText: string | undefined;
  let roomsText: string | undefined;

  card.find("p.flex-auto").each((_, p) => {
    const text = $(p).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    if (/z[lł]/i.test(text) && !priceText) priceText = text;
    else if (/m[²2]/.test(text) && !areaText) areaText = text;
    else if (/pok/i.test(text) && !roomsText) roomsText = text;
  });

  // Skip the leading aria-hidden decorative span - the real location spans
  // (district/city, then street) follow it.
  const locationSpans = link.find("span").slice(1, 3);
  const addressParts: string[] = [];
  locationSpans.each((_, s) => {
    const text = $(s).text().trim();
    if (text) addressParts.push(text);
  });

  // Cards have no dedicated ad-title text; the image alt attribute holds a
  // descriptive summary ("Mieszkanie 3-pokojowe Warszawa Ursynów, ul. Polki").
  const title = card.find("img[alt]").first().attr("alt")?.trim();

  return {
    source: "adresowo",
    sourceId: id,
    sourceUrl: new URL(href, ORIGIN).toString(),
    title: title || addressParts.join(", ") || undefined,
    priceText,
    areaText,
    addressText: addressParts.join(", "),
    roomsText,
    raw: { id, href, priceText, areaText, addressParts },
  };
}

// The Warsaw-filtered listing page occasionally mixes in "recommended"
// cards from other cities (observed on paginated requests), so drop anything
// that doesn't mention Warszawa.
function isWarsawListing(raw: RawListing): boolean {
  return /warszawa/i.test(raw.addressText ?? "") || /warszawa/i.test(raw.sourceUrl);
}

function targetsFor(criteria: SearchCriteria): Target[] {
  const targets: Target[] = [];
  if (criteria.includeWarsaw) {
    targets.push({
      label: "Warszawa",
      url: (page) => (page <= 1 ? `${ORIGIN}${WARSAW_PATH}` : `${ORIGIN}${WARSAW_PATH}/${page}`),
      keep: isWarsawListing,
    });
  }
  for (const town of criteria.towns) {
    if (!isTownName(town)) continue;
    const slug = TOWNS[town].adresowo;
    if (!slug) {
      log.info(`[${town}] no Adresowo town page, skipping`);
      continue;
    }
    targets.push({
      label: town,
      url: (page) => (page <= 1 ? `${ORIGIN}/mieszkania/${slug}/` : `${ORIGIN}/mieszkania/${slug}/${page}`),
      keep: (raw) => isTownAddress(raw.addressText),
    });
  }
  return targets;
}

async function searchTarget(target: Target, maxPages: number, seenIds: Set<string>): Promise<RawListing[]> {
  const results: RawListing[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(target.url(page));
    if (!html) {
      log.warn(`[${target.label}] no HTML for page ${page}, stopping pagination`);
      break;
    }

    const $ = cheerio.load(html);
    const cards = $("[data-offer-card]");
    if (cards.length === 0) {
      log.warn(`[${target.label}] no offer cards found on page ${page}, stopping (selectors may be stale)`);
      break;
    }

    let newOnThisPage = 0;
    cards.each((_, el) => {
      const raw = cardToRawListing($, $(el));
      if (raw && target.keep(raw) && !seenIds.has(raw.sourceId)) {
        seenIds.add(raw.sourceId);
        results.push(raw);
        newOnThisPage++;
      }
    });

    log.info(`[${target.label}] page ${page}: ${cards.length} cards, ${newOnThisPage} new`);

    // No total-page count is exposed statically; stop once a page yields
    // nothing new (either past the end or hit repeated/promoted content).
    if (newOnThisPage === 0) break;
    await politeDelay();
  }

  return results;
}

export const adresowoScraper: Scraper = {
  source: "adresowo",

  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    // Warsaw is scraped city-wide (districts can't be filtered at source);
    // each town with a real page gets its own pass.
    const maxPages = criteria.maxPages ?? 5;
    const targets = targetsFor(criteria);
    const results: RawListing[] = [];
    const seenIds = new Set<string>();

    for (const target of targets) {
      results.push(...(await searchTarget(target, maxPages, seenIds)));
      if (targets.length > 1) await politeDelay();
    }

    return results;
  },
};
