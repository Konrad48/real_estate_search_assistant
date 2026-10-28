// Sprzedajemy.pl scraper — Cheerio HTML strategy.
// Last verified working: 2026-09-14, by fetching the live Warsaw "mieszkania
// na sprzedaz" category page and the town pages, and inspecting server-rendered
// HTML. Listing cards are `article.element` blocks; title+url from `h2.title a`,
// price from `span.price`, and area/rooms/floor from `p.attributes.g1 span`
// entries labeled "Pow.:" / "Pokoje:" / "Piętro:" (label text match, not
// positional - more robust if the site reorders these fields).
//
// Two limitations observed and accepted for v1 (general classifieds site,
// smallest/least structured of the four sources - per project posture,
// reduced coverage here is fine rather than over-investing):
//  - No working pagination was found (tried /2, ?page=2, /strona-2, ?od=30 -
//    all returned identical first-page content), so this scraper fetches a
//    single page per location only (~30 listings) regardless of criteria.maxPages.
//  - The city filter in the Warsaw URL doesn't reliably exclude other
//    cities/other property types (land, rentals) - isWarsawFlatListing() below
//    filters post-hoc on the listing URL slug, same approach as scrapers/adresowo.ts.
//
// Towns use the location-prefixed path /<town>/nieruchomosci/mieszkania/sprzedaz,
// which IS city-filtered (lib/towns.ts; Komorów/Michałowice get a nationwide
// fallback there, so they're null and skipped). Cards have no address field,
// so a town card is kept only when its URL slug names the town, and the town
// name is appended to its address text for district matching.
import * as cheerio from "cheerio";
import { fetchText, politeDelay } from "../lib/http";
import { makeLogger } from "../lib/logger";
import { TOWNS, isTownName, type TownName } from "../lib/towns";
import type { RawListing, Scraper, SearchCriteria } from "./types";

const log = makeLogger("sprzedajemy");

const ORIGIN = "https://sprzedajemy.pl";
const WARSAW_URL = `${ORIGIN}/nieruchomosci/mieszkania-sprzedam/warszawa`;

function attributeValue($: cheerio.CheerioAPI, card: ReturnType<cheerio.CheerioAPI>, label: string): string | undefined {
  let value: string | undefined;
  card.find("p.attributes span.attribute").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.startsWith(label)) {
      value = text.slice(label.length).trim();
    }
  });
  return value;
}

function extractIdFromHref(href: string): string | null {
  const match = href.match(/-nr(\d+)$/);
  return match ? match[1] : null;
}

function cardToRawListing($: cheerio.CheerioAPI, card: ReturnType<cheerio.CheerioAPI>): RawListing | null {
  const titleLink = card.find("h2.title a").first();
  const href = titleLink.attr("href");
  if (!href) return null;

  const id = extractIdFromHref(href);
  if (!id) return null;

  const title = titleLink.text().replace(/\s+/g, " ").trim();
  const priceText = card.find("span.price").first().text().replace(/\s+/g, " ").trim();
  const areaText = attributeValue($, card, "Pow.:");
  const roomsText = attributeValue($, card, "Pokoje:");
  const floorText = attributeValue($, card, "Piętro:");

  return {
    source: "sprzedajemy",
    sourceId: id,
    sourceUrl: new URL(href, ORIGIN).toString(),
    title: title || undefined,
    priceText: priceText || undefined,
    areaText,
    // No separate address field on this site's cards - the title often
    // includes a neighborhood name, so it doubles as the best-effort
    // address text for lib/normalize.ts's district matching.
    addressText: title,
    roomsText,
    floorText,
    raw: { id, href, title, priceText, areaText, roomsText, floorText },
  };
}

const NON_FLAT_KEYWORDS = ["dzialka", "działka", "grunt", "garaz", "garaż", "dom ", "domek", "siedlisko"];

function isFlatForSale(raw: RawListing): boolean {
  const url = raw.sourceUrl.toLowerCase();
  if (url.includes("wynajme") || url.includes("wynajem")) return false;

  // The category page mixes in other property types (land, houses) despite
  // being filtered to "mieszkania-sprzedam" - drop obvious non-flat titles.
  const title = (raw.title ?? "").toLowerCase();
  return !NON_FLAT_KEYWORDS.some((kw) => title.includes(kw) || url.includes(kw.replace(" ", "-")));
}

function isWarsawFlatListing(raw: RawListing): boolean {
  const url = raw.sourceUrl.toLowerCase();
  if (!url.includes("-warszawa-") && !url.endsWith("-warszawa")) return false;
  return isFlatForSale(raw);
}

async function fetchCards(url: string, label: string): Promise<RawListing[]> {
  const html = await fetchText(url);
  if (!html) {
    log.warn(`[${label}] no HTML returned, skipping`);
    return [];
  }

  const $ = cheerio.load(html);
  const cards = $("article.element");
  if (cards.length === 0) {
    log.warn(`[${label}] no offer cards found (selectors may be stale)`);
    return [];
  }

  const results: RawListing[] = [];
  cards.each((_, el) => {
    const raw = cardToRawListing($, $(el));
    if (raw) results.push(raw);
  });
  return results;
}

async function searchTown(town: TownName, slug: string): Promise<RawListing[]> {
  const cards = await fetchCards(`${ORIGIN}/${slug}/nieruchomosci/mieszkania/sprzedaz`, town);
  // "-pruszkow" also matches the "-pruszkowie-" inflection some titles use.
  const kept = cards
    .filter((raw) => raw.sourceUrl.toLowerCase().includes(`-${slug}`) && isFlatForSale(raw))
    .map((raw) => ({ ...raw, addressText: raw.title ? `${raw.title}, ${town}` : town }));
  log.info(`[${town}] single page: ${cards.length} cards, ${kept.length} flats kept`);
  return kept;
}

export const sprzedajemyScraper: Scraper = {
  source: "sprzedajemy",

  // Only the location part of the criteria is used - see file header,
  // pagination/filters aren't supported for this source in v1.
  async search(criteria: SearchCriteria): Promise<RawListing[]> {
    const results: RawListing[] = [];
    const seen = new Set<string>();
    const add = (listings: RawListing[]) => {
      for (const l of listings) {
        if (!seen.has(l.sourceId)) {
          seen.add(l.sourceId);
          results.push(l);
        }
      }
    };

    if (criteria.includeWarsaw) {
      const cards = await fetchCards(WARSAW_URL, "Warszawa");
      const kept = cards.filter(isWarsawFlatListing);
      log.info(`[Warszawa] single page: ${cards.length} cards, ${kept.length} Warsaw flats kept`);
      add(kept);
    }

    for (const town of criteria.towns) {
      if (!isTownName(town)) continue;
      const slug = TOWNS[town].sprzedajemy;
      if (!slug) {
        log.info(`[${town}] no Sprzedajemy town page, skipping`);
        continue;
      }
      if (results.length > 0 || criteria.includeWarsaw) await politeDelay();
      add(await searchTown(town, slug));
    }

    return results;
  },
};
