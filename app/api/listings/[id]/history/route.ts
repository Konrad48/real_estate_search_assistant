import { NextRequest, NextResponse } from "next/server";
import { getPriceHistory } from "../../../../../db/listings-repo";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return NextResponse.json({ error: "Zła oferta" }, { status: 400 });
  }
  return NextResponse.json({ history: getPriceHistory(listingId) });
}
