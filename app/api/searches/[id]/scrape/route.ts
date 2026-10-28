import { NextRequest } from "next/server";
import { getSearch } from "../../../../../db/searches-repo";
import { runScrape } from "../../../../../lib/scrape-runner";

export const dynamic = "force-dynamic";

// Streams newline-delimited JSON progress events as each source finishes, so
// the client can show live per-source scraping status.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchId = Number(id);
  const search = getSearch(searchId);
  if (!search) {
    return new Response(JSON.stringify({ error: "Nie znaleziono listy" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runScrape(search)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "fatal", error: message }) + "\n"));
      } finally {
        controller.close();
      }
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
