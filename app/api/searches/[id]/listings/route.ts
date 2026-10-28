import { NextRequest, NextResponse } from "next/server";
import {
  createManualListing,
  getDuplicateInfo,
  getPreviousPrices,
  queryListings,
  type ListingSort,
} from "../../../../../db/listings-repo";
import { listingFieldsSchema } from "../../../../../lib/validate";

const SORT_COLUMNS = new Set([
  "price_pln",
  "area_m2",
  "price_per_m2",
  "district",
  "source",
  "rooms",
  "last_scraped_at",
]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = Number(id);
  if (!Number.isInteger(searchId) || searchId <= 0) {
    return NextResponse.json({ error: "Zła lista" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const starredOnly = sp.get("starred") === "1";
  const activeOnly = sp.get("active") === "1";
  const sortColumn = sp.get("sortColumn");
  const sort: ListingSort | undefined =
    sortColumn && SORT_COLUMNS.has(sortColumn)
      ? { column: sortColumn as ListingSort["column"], direction: sp.get("sortDirection") === "desc" ? "desc" : "asc" }
      : undefined;

  const rows = queryListings(searchId, { starredOnly, activeOnly, sort });
  const prev = getPreviousPrices(searchId);
  const dupInfo = getDuplicateInfo(searchId);
  const rowsWithPrev = rows.map((r) => ({
    ...r,
    previous_price_pln: prev.has(r.id) ? prev.get(r.id) ?? null : null,
    also_on: dupInfo.get(r.id) ?? [],
  }));

  return NextResponse.json({ rows: rowsWithPrev });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = Number(id);
  if (!Number.isInteger(searchId) || searchId <= 0) {
    return NextResponse.json({ error: "Zła lista" }, { status: 400 });
  }

  const parsed = listingFieldsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const row = createManualListing(searchId, parsed.data);
  return NextResponse.json({ row }, { status: 201 });
}
