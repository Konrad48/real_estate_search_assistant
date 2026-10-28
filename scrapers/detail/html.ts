// Shared Cheerio detail fetcher for the three HTML-rendered sources
// (Gratka, Adresowo, Sprzedajemy). None of them exposes a JSON island, and
// each words its parameter table differently, so instead of three brittle
// selector sets we do one tolerant pass:
//   * description  - the first matching description selector, else the longest
//                    text block on the page (offer descriptions are long).
//   * parameters   - every "label: value" pair we can see (dt/dd, table rows,
//                    <li>), flattened into lines and matched by label keyword.
// Whatever this misses stays null and is left to the AI step, which reads the
// description — that is the whole point of the two-stage design.
import * as cheerio from "cheerio";
import { fetchText } from "../../lib/http";
import { makeLogger } from "../../lib/logger";
import {
  parseCondition,
  parseFloorNum,
  parsePositiveInt,
  parsePricePLN,
  parseTotalFloors,
  parseYearBuilt,
} from "../../lib/normalize";
import { normalizeOwnership } from "../../lib/ownership";
import { flagFromText } from "./flags";
import type { DetailFetcher, ListingDetail, SourceId } from "./types";

const log = makeLogger("detail:html");

const DESCRIPTION_SELECTORS: Record<string, string[]> = {
  gratka: ['[data-cy="descriptionSection"]', "#descriptionSection", ".description"],
  adresowo: ["[data-offer-description]", "#offer-description", ".offer-description"],
  sprzedajemy: [".offerDescription", "#offer-description", ".description"],
};

/** Longest text node container on the page — a decent description fallback. */
function longestBlock($: cheerio.CheerioAPI): string | null {
  let best = "";
  $("p, div[class*='desc'], section[class*='desc'], article").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > best.length && text.length < 20000) best = text;
  });
  return best.length >= 120 ? best : null;
}

function extractDescription($: cheerio.CheerioAPI, source: SourceId): string | null {
  for (const selector of DESCRIPTION_SELECTORS[source] ?? []) {
    const text = $(selector).first().text().replace(/[ \t]+/g, " ").trim();
    if (text.length >= 40) return text;
  }
  const meta = $('meta[name="description"]').attr("content")?.trim();
  return longestBlock($) ?? (meta && meta.length >= 40 ? meta : null);
}

/** Every visible "label: value" / "label value" pair we can find, as lines. */
function parameterLines($: cheerio.CheerioAPI): string[] {
  const lines: string[] = [];

  $("dl").each((_, dl) => {
    const terms = $(dl).find("dt");
    const defs = $(dl).find("dd");
    terms.each((i, dt) => {
      const label = $(dt).text().replace(/\s+/g, " ").trim();
      const value = $(defs[i]).text().replace(/\s+/g, " ").trim();
      if (label && value) lines.push(`${label}: ${value}`);
    });
  });

  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("th, td")
      .map((_i, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get();
    if (cells.length >= 2 && cells[0] && cells[1]) lines.push(`${cells[0]}: ${cells[1]}`);
  });

  $("li, .parameter, .attribute, [class*='param']").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text && text.length <= 120) lines.push(text);
  });

  return lines;
}

/** First parameter line whose label mentions one of `keywords`. */
function lineFor(lines: string[], keywords: string[]): string | null {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (keywords.some((k) => lower.includes(k))) return line;
  }
  return null;
}

/** The part after the label — what a "Czynsz: 480 zł" line actually says. */
function valuePart(line: string | null): string | null {
  if (!line) return null;
  const idx = line.indexOf(":");
  const value = idx >= 0 ? line.slice(idx + 1) : line;
  return value.trim() || null;
}

export function makeHtmlDetailFetcher(source: SourceId): DetailFetcher {
  return {
    source,

    async fetch(url: string): Promise<ListingDetail | null> {
      const html = await fetchText(url);
      if (!html) return null;

      const $ = cheerio.load(html);
      const description = extractDescription($, source);
      const lines = parameterLines($);
      if (lines.length === 0 && !description) {
        log.warn(`no description and no parameters found on ${url} (selectors may be stale)`);
      }

      const paramText = lines.join(" | ").toLowerCase();
      const floorLine = valuePart(lineFor(lines, ["piętro", "pietro"]));
      const ownershipLine = valuePart(lineFor(lines, ["forma własności", "własność", "wlasnosc", "spółdziel"]));

      return {
        description,
        fields: {
          ownershipType: normalizeOwnership(ownershipLine),
          floorNum: parseFloorNum(floorLine),
          totalFloors:
            parseTotalFloors(floorLine) ??
            parsePositiveInt(valuePart(lineFor(lines, ["liczba pięter", "liczba pieter", "pięter w budynku"]))),
          czynsz: parsePricePLN(valuePart(lineFor(lines, ["czynsz"]))),
          yearBuilt: parseYearBuilt(valuePart(lineFor(lines, ["rok budowy", "rok bud."]))),
          conditionState: parseCondition(valuePart(lineFor(lines, ["stan wykończenia", "stan:", "stan "]))),
          hasBalcony: flagFromText(paramText, "balcony"),
          hasParking: flagFromText(paramText, "parking"),
          hasElevator: flagFromText(paramText, "elevator"),
        },
      };
    },
  };
}
