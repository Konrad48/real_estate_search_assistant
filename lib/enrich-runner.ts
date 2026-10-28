// Enrichment pass: for offers we have never enriched, fetch the offer page,
// read what it states outright, and hand only the remaining gaps to the AI.
//
// Runs after a scrape (lib/scrape-runner.ts) and on demand
// (app/api/listings/[id]/enrich, scripts/enrich-cli.ts). Sequential and
// polite-delayed like the scrapers: this is a personal, low-volume tool.
//
// Design rules that matter:
//   * structured (detail page) data always beats AI output,
//   * AI is called only for fields still null AND only when a description
//     exists AND only when OPENAI_API_KEY is set,
//   * a listing is marked enriched even when it yields nothing, so a broken
//     offer page is not re-fetched on every scrape (enrich_status='failed'
//     tells you which ones to retry),
//   * the model is asked about an offer AT MOST ONCE (enrich_model records the
//     attempt, hit or miss). Later scrapes of the same list re-scrape prices
//     and nothing else - no offer-page fetch, no AI call. Only an explicit
//     --force / --ai-only --force / the modal button asks again.
import {
  getPendingEnrichment,
  listingsNeedingEnrichment,
  listingsWithGaps,
  updateEnrichment,
  type PendingEnrichment,
} from "../db/listings-repo";
import { ENRICHED_FIELD_KEYS, type EnrichStatus, type EnrichedFields, type SourceId } from "../db/schema";
import { DETAIL_FETCHERS } from "../scrapers/detail/registry";
import { aiModel, enrichFromDescription, isAiConfigured } from "./ai/enrich";
import { politeDelay } from "./http";
import { makeLogger } from "./logger";

const log = makeLogger("enrich-runner");

export const DEFAULT_MAX_PER_RUN = 200;

export function maxPerRun(): number {
  const raw = Number(process.env.ENRICH_MAX_PER_RUN);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_PER_RUN;
}

export interface EnrichSummary {
  processed: number;
  enriched: number;
  aiCalls: number;
  failed: number;
}

function missingKeys(fields: Partial<EnrichedFields>): (keyof EnrichedFields)[] {
  return ENRICHED_FIELD_KEYS.filter((key) => fields[key] == null);
}

function statusFor(structuredCount: number, aiCount: number): EnrichStatus {
  if (structuredCount > 0 && aiCount > 0) return "mixed";
  if (aiCount > 0) return "ai";
  return "structured";
}

/** Enriches a single listing. Returns whether the AI step was used. */
export async function enrichListing(listing: PendingEnrichment): Promise<{ ok: boolean; usedAi: boolean }> {
  const fetcher = DETAIL_FETCHERS[listing.source as SourceId];
  if (!fetcher) {
    updateEnrichment(listing.id, {}, { status: "failed", model: null, description: null });
    return { ok: false, usedAi: false };
  }

  let detail = null;
  try {
    detail = await fetcher.fetch(listing.source_url);
  } catch (err) {
    log.warn(`detail fetch threw for listing ${listing.id} (${listing.source_url})`, err);
  }

  if (!detail) {
    // Marked failed (not left pending) so it isn't retried on every scrape;
    // the "Uzupełnij dane (AI)" button / npm run enrich --force can redo it.
    updateEnrichment(listing.id, {}, { status: "failed", model: null, description: null });
    return { ok: false, usedAi: false };
  }

  const structured = detail.fields;
  const structuredCount = ENRICHED_FIELD_KEYS.filter((k) => structured[k] != null).length;

  let aiFields: Partial<EnrichedFields> = {};
  const gaps = missingKeys(structured);
  const useAi = gaps.length > 0 && Boolean(detail.description) && isAiConfigured();
  if (useAi) {
    aiFields = await enrichFromDescription(
      { title: listing.title, description: detail.description as string, known: structured },
      gaps
    );
  }

  const aiCount = ENRICHED_FIELD_KEYS.filter((k) => aiFields[k] != null).length;
  // Structured first: spread AI underneath so it can only fill actual gaps.
  const merged: Partial<EnrichedFields> = { ...aiFields, ...stripNulls(structured) };

  updateEnrichment(listing.id, merged, {
    status: statusFor(structuredCount, aiCount),
    // Records that the model was CONSULTED, not that it found something. An
    // attempt that yields nothing must still be remembered, otherwise the
    // AI-only backfill would keep paying to re-ask about the same offer.
    model: useAi ? aiModel() : null,
    description: detail.description,
  });

  return { ok: true, usedAi: aiCount > 0 };
}

/** Drops null entries so a spread can't overwrite a value with "unknown". */
function stripNulls(fields: Partial<EnrichedFields>): Partial<EnrichedFields> {
  const out: Partial<EnrichedFields> = {};
  for (const key of ENRICHED_FIELD_KEYS) {
    const value = fields[key];
    if (value != null) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Enriches every not-yet-enriched offer of one saved list, yielding progress
 * as it goes (an async generator so the scrape SSE stream can report live)
 * and returning the run summary.
 */
export async function* enrichPendingStream(
  searchId: number,
  limit = maxPerRun()
): AsyncGenerator<{ done: number; total: number }, EnrichSummary> {
  const pending = listingsNeedingEnrichment(searchId, limit);
  const summary: EnrichSummary = { processed: 0, enriched: 0, aiCalls: 0, failed: 0 };
  if (pending.length === 0) return summary;

  if (!isAiConfigured()) {
    log.warn("OPENAI_API_KEY not set — filling only what the offer pages state outright");
  }
  log.info(`enriching ${pending.length} listing(s) of search #${searchId}`);

  for (const listing of pending) {
    const result = await enrichListing(listing);
    summary.processed++;
    if (result.ok) summary.enriched++;
    else summary.failed++;
    if (result.usedAi) summary.aiCalls++;
    yield { done: summary.processed, total: pending.length };
    if (summary.processed < pending.length) await politeDelay();
  }

  log.info(
    `search #${searchId}: enriched ${summary.enriched}/${summary.processed} (AI used ${summary.aiCalls}, failed ${summary.failed})`
  );
  return summary;
}

/** Blocking wrapper around enrichPendingStream for the CLI and the API. */
export async function enrichPending(searchId: number, limit = maxPerRun()): Promise<EnrichSummary> {
  const stream = enrichPendingStream(searchId, limit);
  for (;;) {
    const step = await stream.next();
    if (step.done) return step.value;
  }
}

/**
 * Re-runs only the AI step over descriptions already stored in the DB, for
 * offers that still have empty columns. No page is re-fetched — this is the
 * cheap way to backfill after adding an OPENAI_API_KEY to an app that had
 * been running without one.
 */
export async function enrichGapsWithAi(
  searchId: number,
  limit = maxPerRun(),
  opts: { retryAiTried?: boolean } = {}
): Promise<EnrichSummary> {
  const summary: EnrichSummary = { processed: 0, enriched: 0, aiCalls: 0, failed: 0 };
  if (!isAiConfigured()) {
    log.warn("OPENAI_API_KEY not set — nothing to do in AI-only mode");
    return summary;
  }

  for (const row of listingsWithGaps(searchId, limit, opts)) {
    const known: Partial<EnrichedFields> = {
      ownershipType: row.ownership_type,
      floorNum: row.floor_num,
      totalFloors: row.total_floors,
      czynsz: row.czynsz,
      yearBuilt: row.year_built,
      conditionState: row.condition_state,
      hasBalcony: row.has_balcony,
      hasParking: row.has_parking,
      hasElevator: row.has_elevator,
    };
    const gaps = missingKeys(known);
    summary.processed++;
    const fields = await enrichFromDescription(
      { title: row.title, description: row.description ?? "", known },
      gaps
    );
    summary.aiCalls++;
    const filled = ENRICHED_FIELD_KEYS.filter((k) => fields[k] != null).length;
    if (filled > 0) summary.enriched++;
    // Written even when nothing was filled, so enrich_model records that this
    // offer has already been through the model and is not asked again.
    // updateEnrichment only writes into columns that are still NULL.
    updateEnrichment(row.id, fields, {
      status: filled > 0 ? "mixed" : "structured",
      model: aiModel(),
      description: null,
    });
  }

  log.info(`search #${searchId}: AI-only pass filled ${summary.enriched}/${summary.processed}`);
  return summary;
}

/** Re-runs enrichment for one listing, ignoring its current enriched_at. */
export async function enrichOne(listingId: number): Promise<boolean> {
  const listing = getPendingEnrichment(listingId);
  if (!listing || listing.source === "manual" || !listing.source_url) return false;
  const result = await enrichListing(listing);
  return result.ok;
}
