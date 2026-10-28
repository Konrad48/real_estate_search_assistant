import { getDb } from "./client";
import type { Search, SearchRow, SourceId } from "./schema";

export interface SearchInput {
  name: string;
  includeWarsaw: boolean;
  districts: string[];
  towns: string[];
  sources: SourceId[];
  minPrice: number | null;
  maxPrice: number | null;
  minArea: number | null;
  maxArea: number | null;
}

function rowToSearch(row: SearchRow): Search {
  return {
    id: row.id,
    name: row.name,
    includeWarsaw: row.include_warsaw !== 0,
    districts: JSON.parse(row.districts) as string[],
    towns: JSON.parse(row.towns ?? "[]") as string[],
    sources: JSON.parse(row.sources) as SourceId[],
    minPrice: row.min_price,
    maxPrice: row.max_price,
    minArea: row.min_area,
    maxArea: row.max_area,
    createdAt: row.created_at,
    lastScrapedAt: row.last_scraped_at,
  };
}

function inputParams(input: SearchInput) {
  return {
    name: input.name,
    includeWarsaw: input.includeWarsaw ? 1 : 0,
    // Districts only mean something inside Warsaw; don't keep stale ones around.
    districts: JSON.stringify(input.includeWarsaw ? input.districts : []),
    towns: JSON.stringify(input.towns),
    sources: JSON.stringify(input.sources),
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    minArea: input.minArea,
    maxArea: input.maxArea,
  };
}

export function createSearch(input: SearchInput): Search {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO searches (name, include_warsaw, districts, towns, sources, min_price, max_price, min_area, max_area, created_at)
       VALUES (@name, @includeWarsaw, @districts, @towns, @sources, @minPrice, @maxPrice, @minArea, @maxArea, @now)`
    )
    .run({ ...inputParams(input), now });
  return getSearch(Number(result.lastInsertRowid))!;
}

export function listSearches(): Search[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM searches ORDER BY created_at DESC").all() as SearchRow[];
  return rows.map(rowToSearch);
}

export function getSearch(id: number): Search | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM searches WHERE id = ?").get(id) as SearchRow | undefined;
  return row ? rowToSearch(row) : null;
}

export function updateSearch(id: number, input: SearchInput): Search | null {
  const db = getDb();
  db.prepare(
    `UPDATE searches SET
       name = @name, include_warsaw = @includeWarsaw, districts = @districts, towns = @towns,
       sources = @sources,
       min_price = @minPrice, max_price = @maxPrice,
       min_area = @minArea, max_area = @maxArea
     WHERE id = @id`
  ).run({ id, ...inputParams(input) });
  return getSearch(id);
}

export function deleteSearch(id: number): void {
  const db = getDb();
  // Explicitly clear children in case foreign_keys pragma isn't on.
  const listingIds = db
    .prepare("SELECT id FROM listings WHERE search_id = ?")
    .all(id) as { id: number }[];
  const delHistory = db.prepare("DELETE FROM price_history WHERE listing_id = ?");
  const tx = db.transaction(() => {
    for (const { id: lid } of listingIds) delHistory.run(lid);
    db.prepare("DELETE FROM listings WHERE search_id = ?").run(id);
    db.prepare("DELETE FROM searches WHERE id = ?").run(id);
  });
  tx();
}

export function touchLastScraped(id: number): void {
  const db = getDb();
  db.prepare("UPDATE searches SET last_scraped_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}
