"use client";

import { useState } from "react";
import { ALL_SOURCES, SOURCE_LABELS, type SourceId } from "./types";

// Post-scrape step: reads each new offer's own page (+ AI) for forma
// własności, piętro, czynsz…
type EnrichStatus =
  | { state: "running"; done: number; total: number }
  | { state: "done"; enriched: number; aiCalls: number; failed: number };

type SourceStatus =
  | { state: "running" }
  | { state: "done"; count: number }
  | { state: "error"; error: string };

export function ScrapeProgress({
  searchId,
  sources,
  onComplete,
}: {
  searchId: number;
  sources: SourceId[];
  onComplete: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<Partial<Record<SourceId, SourceStatus>>>({});
  const [fatal, setFatal] = useState<string | null>(null);
  const [enrich, setEnrich] = useState<EnrichStatus | null>(null);

  async function scrape() {
    setRunning(true);
    setStatuses({});
    setFatal(null);
    setEnrich(null);

    try {
      const res = await fetch(`/api/searches/${searchId}/scrape`, { method: "POST" });
      if (!res.ok || !res.body) {
        setFatal("Nie udało się uruchomić scrapowania.");
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === "source-start") {
            setStatuses((s) => ({ ...s, [evt.source]: { state: "running" } }));
          } else if (evt.type === "source-done") {
            setStatuses((s) => ({ ...s, [evt.source]: { state: "done", count: evt.count } }));
            onComplete();
          } else if (evt.type === "source-error") {
            setStatuses((s) => ({ ...s, [evt.source]: { state: "error", error: evt.error } }));
          } else if (evt.type === "enrich-start") {
            setEnrich({ state: "running", done: 0, total: evt.total });
          } else if (evt.type === "enrich-progress") {
            setEnrich({ state: "running", done: evt.done, total: evt.total });
          } else if (evt.type === "enrich-done") {
            setEnrich({ state: "done", enriched: evt.enriched, aiCalls: evt.aiCalls, failed: evt.failed });
          } else if (evt.type === "fatal") {
            setFatal(evt.error);
          }
        }
      }
      onComplete();
    } catch (err) {
      setFatal(err instanceof Error ? err.message : "Błąd scrapowania.");
    } finally {
      setRunning(false);
    }
  }

  function chip(source: SourceId) {
    const st = statuses[source];
    let text = "oczekuje";
    let cls = "text-zinc-400";
    if (!sources.includes(source)) {
      // Shown greyed out rather than hidden, so it's obvious when a list
      // predates a source (or has it switched off) instead of failing silently.
      text = "wyłączone";
      cls = "text-zinc-300 dark:text-zinc-600";
    } else if (st?.state === "running") {
      text = "w toku…";
      cls = "text-blue-600";
    } else if (st?.state === "done") {
      text = `gotowe: ${st.count}`;
      cls = "text-green-600";
    } else if (st?.state === "error") {
      text = `błąd: ${st.error}`;
      cls = "text-red-600";
    }
    return (
      <span key={source} className="flex items-center gap-1 text-xs">
        <span className="font-medium">{SOURCE_LABELS[source]}:</span>
        <span className={cls}>{text}</span>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={scrape}
        disabled={running}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {running ? "Scrapowanie…" : "Scrapuj"}
      </button>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{ALL_SOURCES.map(chip)}</div>
      {enrich && (
        <span className="flex items-center gap-1 text-xs">
          <span className="font-medium">Uzupełnianie danych:</span>
          {enrich.state === "running" ? (
            <span className="text-blue-600">
              {enrich.done}/{enrich.total} ofert
            </span>
          ) : (
            <span className={enrich.failed > 0 ? "text-amber-600" : "text-green-600"}>
              gotowe: {enrich.enriched} (AI: {enrich.aiCalls}
              {enrich.failed > 0 ? `, nieudane: ${enrich.failed}` : ""})
            </span>
          )}
        </span>
      )}
      {fatal && <span className="text-xs text-red-600">{fatal}</span>}
    </div>
  );
}
