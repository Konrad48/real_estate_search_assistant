// Extractors for the JSON payloads Otodom and OLX embed in their HTML.
// Both the search-results scrapers (scrapers/otodom.ts, scrapers/olx.ts) and
// the detail-page fetchers (scrapers/detail/*) read the same blobs, so the
// parsing lives here once. If a site changes its hydration scheme, this is
// the single place to fix.
import * as cheerio from "cheerio";
import { makeLogger } from "./logger";

const log = makeLogger("page-json");

/** Otodom (Next.js): the SSR payload in <script id="__NEXT_DATA__">. */
export function extractNextData(html: string): unknown | null {
  const $ = cheerio.load(html);
  const script = $("script#__NEXT_DATA__").first().html();
  if (!script) return null;
  try {
    return JSON.parse(script);
  } catch (err) {
    log.warn("failed to parse __NEXT_DATA__ JSON", err);
    return null;
  }
}

/** OLX: window.__PRERENDERED_STATE__, a JSON-encoded string (parse twice). */
export function extractPrerenderedState(html: string): unknown | null {
  const match = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/);
  if (!match) return null;
  try {
    const jsonString = JSON.parse(match[1]);
    return JSON.parse(jsonString);
  } catch (err) {
    log.warn("failed to parse __PRERENDERED_STATE__ JSON", err);
    return null;
  }
}

/** Strips tags/entities off an HTML description into plain text for the AI. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = cheerio
    .load(`<div>${html}</div>`)("div")
    .text()
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
