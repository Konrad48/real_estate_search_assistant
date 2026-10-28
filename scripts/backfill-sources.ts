// Adds any newly implemented source to every existing saved list.
//   npm run backfill-sources
//
// A list's `sources` is a JSON snapshot frozen at creation time, so lists made
// before a source existed never scrape it. Deliberately a one-off script rather
// than a boot-time migration: re-adding on every boot would silently undo a
// deliberate opt-out made through the Edytuj form.
import { listSearches, updateSearch } from "../db/searches-repo";
import { IMPLEMENTED_SOURCES } from "../scrapers/registry";

function main() {
  const searches = listSearches();
  if (searches.length === 0) {
    console.log("Brak zapisanych list.");
    return;
  }
  for (const s of searches) {
    const missing = IMPLEMENTED_SOURCES.filter((src) => !s.sources.includes(src));
    if (missing.length === 0) {
      console.log(`#${s.id} "${s.name}": bez zmian`);
      continue;
    }
    // Keep registry order so the UI chips stay in a stable, familiar sequence.
    const sources = IMPLEMENTED_SOURCES.filter(
      (src) => s.sources.includes(src) || missing.includes(src)
    );
    updateSearch(s.id, {
      name: s.name,
      includeWarsaw: s.includeWarsaw,
      districts: s.districts,
      towns: s.towns,
      sources,
      minPrice: s.minPrice,
      maxPrice: s.maxPrice,
      minArea: s.minArea,
      maxArea: s.maxArea,
    });
    console.log(`#${s.id} "${s.name}": + ${missing.join(", ")}`);
  }
}

main();
