"use client";

import type { Search } from "./types";

export function SearchSidebar({
  searches,
  activeId,
  onSelect,
  onNew,
}: {
  searches: Search[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Moje listy</h2>
      </div>
      <button
        onClick={onNew}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        ＋ Nowa lista
      </button>

      <nav className="flex flex-col gap-1">
        {searches.length === 0 && (
          <p className="px-1 py-2 text-xs text-zinc-500">Brak zapisanych list. Utwórz nową, aby zacząć.</p>
        )}
        {searches.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`rounded-md px-3 py-2 text-left text-sm ${
              s.id === activeId
                ? "bg-zinc-200 font-medium dark:bg-zinc-800"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
            }`}
          >
            <span className="block truncate">{s.name}</span>
            <span className="block truncate text-xs text-zinc-500">
              {s.lastScrapedAt
                ? `Odświeżono: ${new Date(s.lastScrapedAt).toLocaleString("pl-PL")}`
                : "Jeszcze nie scrapowano"}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
