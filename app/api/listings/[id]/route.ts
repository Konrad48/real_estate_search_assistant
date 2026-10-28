import { NextRequest, NextResponse } from "next/server";
import { updateListingFields } from "../../../../db/listings-repo";
import { listingFieldsSchema } from "../../../../lib/validate";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return NextResponse.json({ error: "Zła oferta" }, { status: 400 });
  }
  const parsed = listingFieldsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }
  const ok = updateListingFields(listingId, parsed.data);
  if (!ok) return NextResponse.json({ error: "Zła oferta" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
