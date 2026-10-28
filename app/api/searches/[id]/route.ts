import { NextRequest, NextResponse } from "next/server";
import { deleteSearch, getSearch, updateSearch, type SearchInput } from "../../../../db/searches-repo";
import { autoSearchName } from "../../../../lib/search-name";
import { searchInputSchema } from "../../../../lib/validate";

function parseId(idStr: string): number | null {
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = parseId(id);
  if (!searchId) return NextResponse.json({ error: "Zła lista" }, { status: 400 });
  const search = getSearch(searchId);
  if (!search) return NextResponse.json({ error: "Nie znaleziono listy" }, { status: 404 });
  return NextResponse.json({ search });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = parseId(id);
  if (!searchId) return NextResponse.json({ error: "Zła lista" }, { status: 400 });

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

  const search = updateSearch(searchId, input);
  if (!search) return NextResponse.json({ error: "Nie znaleziono listy" }, { status: 404 });
  return NextResponse.json({ search });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = parseId(id);
  if (!searchId) return NextResponse.json({ error: "Zła lista" }, { status: 400 });
  deleteSearch(searchId);
  return NextResponse.json({ ok: true });
}
