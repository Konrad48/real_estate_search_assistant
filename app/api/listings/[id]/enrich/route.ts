import { NextRequest, NextResponse } from "next/server";
import { enrichOne } from "../../../../../lib/enrich-runner";

export const dynamic = "force-dynamic";
// A detail-page fetch plus one AI call can take a while on a slow offer page.
export const maxDuration = 120;

/**
 * Re-runs enrichment for a single offer, ignoring its current enriched_at.
 * Used by the "Uzupełnij dane (AI)" button — the way to retry offers whose
 * page couldn't be read (enrich_status = 'failed') or that predate this feature.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return NextResponse.json({ error: "Zła oferta" }, { status: 400 });
  }

  try {
    const ok = await enrichOne(listingId);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "Nie udało się odczytać strony ogłoszenia." },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
