import type { EnrichedFields, SourceId } from "../../db/schema";

export type { EnrichedFields, SourceId };

export interface ListingDetail {
  /** Plain-text offer description, the input for the AI fallback. */
  description: string | null;
  /** Whatever the detail page states outright — always beats AI output. */
  fields: Partial<EnrichedFields>;
}

export interface DetailFetcher {
  source: SourceId;
  /** Returns null when the page couldn't be fetched (robots, 404, bot-check). */
  fetch(url: string): Promise<ListingDetail | null>;
}
