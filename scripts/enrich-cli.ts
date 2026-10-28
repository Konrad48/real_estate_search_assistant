// Backfill entrypoint for enrichment: fills forma własności / piętro / czynsz
// and friends on offers already in the DB (everything scraped before this
// feature existed, plus anything whose offer page failed the first time).
//
//   npm run enrich                       # every saved list, pending offers only
//   npm run enrich -- --search 3         # one list
//   npm run enrich -- --search 3 --force # redo offers already enriched
//   npm run enrich -- --limit 20         # cap per list (default ENRICH_MAX_PER_RUN)
//   npm run enrich -- --ai-only          # ask the AI about gaps in offers it has
//                                        # never seen, using
//                                        # descriptions already in the DB (no
//                                        # page fetches) - e.g. right after
//                                        # adding OPENAI_API_KEY. Offers the
//                                        # model already saw are skipped unless
//                                        # you add --force.
import { getDb } from "../db/client";
import type { PendingEnrichment } from "../db/listings-repo";
import { enrichGapsWithAi, enrichListing, enrichPending, maxPerRun } from "../lib/enrich-runner";
import { isAiConfigured, aiModel } from "../lib/ai/enrich";
import { listSearches } from "../db/searches-repo";
import { politeDelay } from "../lib/http";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** --force mode: re-reads offer pages regardless of enriched_at. */
function allListings(searchId: number, limit: number): PendingEnrichment[] {
  return getDb()
    .prepare(
      `SELECT id, source, source_url, title FROM listings
       WHERE search_id = @searchId AND is_active = 1 AND is_duplicate = 0
         AND source <> 'manual' AND source_url <> ''
       ORDER BY id ASC LIMIT @limit`
    )
    .all({ searchId, limit }) as PendingEnrichment[];
}

async function main() {
  const limit = arg("limit") ? Number(arg("limit")) : maxPerRun();
  const force = hasFlag("force");
  const searchIds = arg("search")
    ? [Number(arg("search"))]
    : listSearches().map((s) => s.id);

  console.log(
    isAiConfigured()
      ? `AI: ${aiModel()} (uzupełnia tylko braki)`
      : "AI: wyłączone (brak OPENAI_API_KEY) — tylko dane wprost ze stron ogłoszeń"
  );

  for (const searchId of searchIds) {
    if (hasFlag("ai-only")) {
      const summary = await enrichGapsWithAi(searchId, limit, { retryAiTried: force });
      console.log(
        `
=== lista #${searchId} (--ai-only): uzupełnione ${summary.enriched}/${summary.processed} ===`
      );
    } else if (force) {
      const rows = allListings(searchId, limit);
      console.log(`\n=== lista #${searchId}: ${rows.length} ofert (--force) ===`);
      let done = 0;
      for (const row of rows) {
        const result = await enrichListing(row);
        done++;
        console.log(`  [${done}/${rows.length}] #${row.id} ${row.source} ${result.ok ? "ok" : "BŁĄD"}`);
        if (done < rows.length) await politeDelay();
      }
    } else {
      console.log(`\n=== lista #${searchId} ===`);
      const summary = await enrichPending(searchId, limit);
      console.log(
        `  przetworzone: ${summary.processed}, uzupełnione: ${summary.enriched}, AI: ${summary.aiCalls}, nieudane: ${summary.failed}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
