// Locate pass: gives a list's offers map coordinates (see lib/geocode.ts for
// where they come from). Started by the map view, not by scraping — Nominatim's
// 1 request/second makes a first run over a big list take minutes, which is only
// worth paying when someone actually opens the map. Every attempt is stamped
// (geocoded_at), so an offer is looked up once; a failed request is not stamped
// and gets retried by the next run.
//
// A run keeps going when its client disconnects (the dev server doesn't reliably
// report aborted requests), which is fine — it's rate-limited and its results are
// saved. What matters is that it can't block the next one: starting a run for a
// list makes any older run for that list stop before its next lookup.
import {
  getCachedGeocode,
  listingsNeedingLocation,
  putCachedGeocode,
  setListingLocation,
} from "../db/geo-repo";
import { nominatimSearch, olxCoordinates, pickCandidate, streetQuery, type GeoPoint } from "./geocode";
import { makeLogger } from "./logger";

const log = makeLogger("locate-runner");

const MAX_CONSECUTIVE_FAILURES = 3;

// searchId -> token of the newest run for that list.
const currentRun = new Map<number, symbol>();

export type LocateEvent =
  | { type: "start"; total: number }
  | { type: "located"; id: number; lat: number; lon: number }
  | { type: "progress"; done: number; total: number }
  | { type: "done"; located: number; failed: boolean };

export async function* locateListings(
  searchId: number,
  isCancelled: () => boolean = () => false
): AsyncGenerator<LocateEvent> {
  const token = Symbol(`locate-${searchId}`);
  currentRun.set(searchId, token);
  const shouldStop = () => currentRun.get(searchId) !== token || isCancelled();

  try {
    const pending = listingsNeedingLocation(searchId);
    const total = pending.length;
    yield { type: "start", total };

    let done = 0;
    let located = 0;
    let failures = 0;

    for (const row of pending) {
      if (shouldStop()) return;

      let point: GeoPoint | null = null;
      if (row.source === "olx") {
        point = olxCoordinates(row.raw_json);
      } else {
        const query = streetQuery(row);
        let candidates = query ? getCachedGeocode(query.key) : [];
        if (query && candidates === undefined) {
          const fetched = await nominatimSearch(query);
          if (shouldStop()) return;
          if (fetched === null) {
            done++;
            yield { type: "progress", done, total };
            if (++failures >= MAX_CONSECUTIVE_FAILURES) {
              log.warn(`search #${searchId}: geocoder failed ${failures} times in a row, stopping`);
              yield { type: "done", located, failed: true };
              return;
            }
            continue;
          }
          failures = 0;
          putCachedGeocode(query.key, fetched);
          candidates = fetched;
        }
        point = query && candidates ? pickCandidate(candidates, query.location) : null;
      }

      setListingLocation(row.id, point, row.source === "olx" ? "source" : "geocoded");
      if (point) {
        located++;
        yield { type: "located", id: row.id, lat: point.lat, lon: point.lon };
      }
      done++;
      yield { type: "progress", done, total };
    }

    if (total > 0) log.info(`search #${searchId}: located ${located}/${total}`);
    yield { type: "done", located, failed: false };
  } finally {
    if (currentRun.get(searchId) === token) currentRun.delete(searchId);
  }
}
