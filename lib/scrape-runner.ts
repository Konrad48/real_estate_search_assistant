import {
  listingsNeedingEnrichment,
  markGoneExcept,
  recomputeDuplicates,
  upsertMany,
} from "../db/listings-repo";
import { touchLastScraped } from "../db/searches-repo";
import type { Search, SourceId } from "../db/schema";
import { enrichPendingStream, maxPerRun } from "./enrich-runner";
import { applyCriteria } from "./filter";
import { makeLogger } from "./logger";
import { normalizeListing } from "./normalize";
import type { SearchCriteria } from "./types";
import { validateRawListings } from "./validate";
import { SOURCES } from "../scrapers/registry";

const log = makeLogger("scrape-runner");

export type ScrapeEvent =
  | { type: "source-start"; source: SourceId }
  | { type: "source-done"; source: SourceId; count: number }
  | { type: "source-error"; source: SourceId; error: string }
  | { type: "enrich-start"; total: number }
  | { type: "enrich-progress"; done: number; total: number }
  | { type: "enrich-done"; enriched: number; aiCalls: number; failed: number }
  | { type: "complete"; total: number };

export function searchToCriteria(search: Search): SearchCriteria {
  return {
    includeWarsaw: search.includeWarsaw,
    districts: search.districts,
    towns: search.towns,
    minPrice: search.minPrice ?? undefined,
    maxPrice: search.maxPrice ?? undefined,
    minArea: search.minArea ?? undefined,
    maxArea: search.maxArea ?? undefined,
    maxPages: 5,
  };
}

/**
 * Runs all of a saved search's sources sequentially, upserting into that
 * search and yielding progress events. Deliberately sequential to stay
 * low-volume and isolate per-source errors.
 */
export async function* runScrape(search: Search): AsyncGenerator<ScrapeEvent> {
  const criteria = searchToCriteria(search);
  let total = 0;

  for (const source of search.sources) {
    yield { type: "source-start", source };
    try {
      const scraper = SOURCES[source];
      const raw = await scraper.search(criteria);
      const valid = validateRawListings(raw, source);
      const normalized = applyCriteria(valid.map(normalizeListing), criteria);
      upsertMany(search.id, normalized);
      markGoneExcept(
        search.id,
        source,
        normalized.map((n) => n.sourceId)
      );
      total += normalized.length;
      yield { type: "source-done", source, count: normalized.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`scrape failed for ${source}`, err);
      yield { type: "source-error", source, error: message };
    }
  }

  // Collapse cross-service / repeated offers once all sources are in.
  recomputeDuplicates(search.id);

  // Then fill in what the search-results cards can't tell us (forma
  // własności, piętro, czynsz…) by reading each new offer's own page, with
  // AI covering whatever the page doesn't state outright.
  try {
    const pendingCount = listingsNeedingEnrichment(search.id, maxPerRun()).length;
    if (pendingCount > 0) {
      yield { type: "enrich-start", total: pendingCount };
      const stream = enrichPendingStream(search.id);
      for (;;) {
        const step = await stream.next();
        if (step.done) {
          yield {
            type: "enrich-done",
            enriched: step.value.enriched,
            aiCalls: step.value.aiCalls,
            failed: step.value.failed,
          };
          break;
        }
        yield { type: "enrich-progress", done: step.value.done, total: step.value.total };
      }
    }
  } catch (err) {
    log.error("enrichment failed", err);
  }

  touchLastScraped(search.id);
  yield { type: "complete", total };
}
