import { NextRequest, NextResponse } from "next/server";
import { createSearch, listSearches, type SearchInput } from "../../../db/searches-repo";
import { autoSearchName } from "../../../lib/search-name";
import { searchInputSchema } from "../../../lib/validate";

export async function GET() {
  return NextResponse.json({ searches: listSearches() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = searchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nieprawidłowe dane", issues: parsed.error.issues }, { status: 400 });
  }

  const input: SearchInput = {
    name: parsed.data.name?.trim() || "",
    includeWarsaw: parsed.data.includeWarsaw,
    districts: parsed.data.districts,
    towns: parsed.data.towns,
    sources: parsed.data.sources,
    minPrice: parsed.data.minPrice,
    maxPrice: parsed.data.maxPrice,
    minArea: parsed.data.minArea,
    maxArea: parsed.data.maxArea,
  };
  if (!input.name) input.name = autoSearchName(input);

  const search = createSearch(input);
  return NextResponse.json({ search }, { status: 201 });
}
