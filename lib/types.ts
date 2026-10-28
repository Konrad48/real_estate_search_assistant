import type { SourceId } from "../db/schema";

export type { SourceId };

export interface RawListing {
  source: SourceId;
  sourceId: string;
  sourceUrl: string;
  title?: string;
  priceText?: string;
  areaText?: string;
  addressText?: string;
  roomsText?: string;
  floorText?: string;
  listingDateText?: string;
  raw: Record<string, unknown>;
}

export interface SearchCriteria {
  includeWarsaw: boolean; // false = skip Warsaw entirely (districts ignored)
  districts: string[]; // canonical Polish district names; [] = whole city
  towns: string[]; // towns outside Warsaw, canonical names from lib/towns.ts
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  maxPages?: number;
}

export interface ScrapeResult {
  source: SourceId;
  ok: boolean;
  count: number;
  error?: string;
}
