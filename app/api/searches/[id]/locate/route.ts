import { NextRequest } from "next/server";
import { getSearch } from "../../../../../db/searches-repo";
import { locateListings } from "../../../../../lib/locate-runner";

export const dynamic = "force-dynamic";

// Streams newline-delimited JSON as the list's offers get map coordinates, so
// the map can draw dots as they arrive. Closing the map aborts the request,
// which stops the run before its next geocoder call.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = Number(id);
  const search = Number.isInteger(searchId) && searchId > 0 ? getSearch(searchId) : null;
  if (!search) {
    return new Response(JSON.stringify({ error: "Nie znaleziono listy" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let cancelled = false;
  req.signal.addEventListener("abort", () => {
    cancelled = true;
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of locateListings(searchId, () => cancelled)) {
          if (cancelled) break;
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "fatal", error: message }) + "\n"));
          } catch {
            // the client is already gone
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
