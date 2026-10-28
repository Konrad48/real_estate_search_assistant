// One-off (and re-runnable) dedup of every saved list already in the DB.
//   npm run dedup
import { listSearches } from "../db/searches-repo";
import { queryListings, recomputeDuplicates } from "../db/listings-repo";

function main() {
  const searches = listSearches();
  if (searches.length === 0) {
    console.log("No saved lists found.");
    return;
  }
  for (const s of searches) {
    const before = queryListings(s.id, { includeDuplicates: true }).length;
    const { groups, hidden } = recomputeDuplicates(s.id);
    const visible = queryListings(s.id).length;
    console.log(
      `#${s.id} "${s.name}": ${before} total → ${visible} visible (${hidden} duplicates hidden across ${groups} groups)`
    );
  }
}

main();
