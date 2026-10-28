import type { RawListing, SearchCriteria, SourceId } from "../lib/types";

export type { SourceId, RawListing, SearchCriteria };

export interface Scraper {
  source: SourceId;
  search(criteria: SearchCriteria): Promise<RawListing[]>;
}
