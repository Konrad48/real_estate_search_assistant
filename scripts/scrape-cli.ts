// Debug entrypoint: scrape one source with ad-hoc criteria into a throwaway
// search, printing counts + a sample. Does NOT touch your real saved lists
// unless you pass --search <id>.
//
//   npm run scrape -- --source otodom --districts Mokotów,Śródmieście --min-price 500000 --max-price 900000
//   npm run scrape -- --source olx --districts Mokotów
//   npm run scrape -- --source olx --districts Mokotów --no-enrich
//   npm run scrape -- --source gratka --towns "Pruszków,Piastów" --no-warsaw
import { createSearch, getSearch } from "../db/searches-repo";
import { upsertMany, markGoneExcept, queryListings } from "../db/listings-repo";
import { enrichPending } from "../lib/enrich-runner";
import { applyCriteria } from "../lib/filter";
import { normalizeListing } from "../lib/normalize";
import { validateRawListings } from "../lib/validate";
import type { SearchCriteria, SourceId } from "../lib/types";
import { IMPLEMENTED_SOURCES, SOURCES } from "../scrapers/registry";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function listArg(name: string): string[] {
  return (arg(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const sourceArg = (arg("source") ?? "all") as SourceId | "all";
  const includeWarsaw = !process.argv.includes("--no-warsaw");
  const districts = includeWarsaw ? listArg("districts") : [];
  const towns = listArg("towns");
  const criteria: SearchCriteria = {
    includeWarsaw,
    districts,
    towns,
    minPrice: arg("min-price") ? Number(arg("min-price")) : undefined,
    maxPrice: arg("max-price") ? Number(arg("max-price")) : undefined,
    minArea: arg("min-area") ? Number(arg("min-area")) : undefined,
    maxArea: arg("max-area") ? Number(arg("max-area")) : undefined,
    maxPages: arg("max-pages") ? Number(arg("max-pages")) : 2,
  };

  const searchId = arg("search")
    ? Number(arg("search"))
    : createSearch({
        name: `CLI ${new Date().toISOString()}`,
        includeWarsaw,
        districts,
        towns,
        sources: sourceArg === "all" ? IMPLEMENTED_SOURCES : [sourceArg],
        minPrice: criteria.minPrice ?? null,
        maxPrice: criteria.maxPrice ?? null,
        minArea: criteria.minArea ?? null,
        maxArea: criteria.maxArea ?? null,
      }).id;

  const search = getSearch(searchId);
  console.log(`search #${searchId}:`, search?.name, "warsaw:", includeWarsaw, "districts:", districts, "towns:", towns);

  const sources: SourceId[] = sourceArg === "all" ? IMPLEMENTED_SOURCES : [sourceArg];
  for (const source of sources) {
    console.log(`\n=== Scraping ${source} ===`);
    const raw = await SOURCES[source].search(criteria);
    console.log(`${source}: fetched ${raw.length} raw`);
    const valid = validateRawListings(raw, source);
    const normalized = applyCriteria(valid.map(normalizeListing), criteria);
    console.log(`${source}: ${normalized.length} after validate+filter`);
    upsertMany(searchId, normalized);
    markGoneExcept(searchId, source, normalized.map((n) => n.sourceId));
    if (normalized[0]) console.log("sample:", normalized[0]);
  }

  // Same post-step the app runs: offer pages (+ AI for the gaps) for forma
  // własności, piętro, czynsz… Skip it with --no-enrich when iterating on a
  // scraper, since it makes the run much slower.
  if (!process.argv.includes("--no-enrich")) {
    const summary = await enrichPending(searchId);
    console.log(
      `\nenrichment: ${summary.enriched}/${summary.processed} ok, AI used ${summary.aiCalls}, failed ${summary.failed}`
    );
  }

  const rows = queryListings(searchId, { sort: { column: "price_per_m2", direction: "asc" } });
  console.log(`\nlist now has ${rows.length} listings (search #${searchId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
