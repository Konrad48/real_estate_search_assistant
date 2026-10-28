"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { describeLocations } from "../lib/towns";
import { ExportButton } from "./components/ExportButton";
import { ListingDetailsModal, type ListingFormFields } from "./components/ListingDetailsModal";
import { ListingsTable } from "./components/ListingsTable";
import { ScrapeProgress } from "./components/ScrapeProgress";
import { SearchForm } from "./components/SearchForm";
import { SearchSidebar } from "./components/SearchSidebar";
import {
  EMPTY_FORM,
  formToPayload,
  searchToFormValues,
  type ListingWithPrev,
  type Search,
  type SearchFormValues,
  type SortState,
} from "./components/types";

type Mode = { kind: "view" } | { kind: "new" } | { kind: "edit" };
type ListingModal = { kind: "closed" } | { kind: "create" } | { kind: "edit"; id: number };

export default function Home() {
  const [searches, setSearches] = useState<Search[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [submitting, setSubmitting] = useState(false);

  const [rows, setRows] = useState<ListingWithPrev[]>([]);
  const [sort, setSort] = useState<SortState>({ column: "price_per_m2", direction: "asc" });
  const [starredOnly, setStarredOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [highlightChanges, setHighlightChanges] = useState(true);
  const [listingModal, setListingModal] = useState<ListingModal>({ kind: "closed" });

  const activeSearch = useMemo(() => searches.find((s) => s.id === activeId) ?? null, [searches, activeId]);

  const loadSearches = useCallback(async () => {
    const res = await fetch("/api/searches");
    const data = await res.json();
    setSearches(data.searches ?? []);
    return data.searches as Search[];
  }, []);

  const loadListings = useCallback(async () => {
    if (activeId == null) {
      setRows([]);
      return;
    }
    const params = new URLSearchParams({ sortColumn: sort.column, sortDirection: sort.direction });
    if (starredOnly) params.set("starred", "1");
    if (activeOnly) params.set("active", "1");
    const res = await fetch(`/api/searches/${activeId}/listings?${params.toString()}`);
    const data = await res.json();
    setRows(data.rows ?? []);
  }, [activeId, sort, starredOnly, activeOnly]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSearches();
  }, [loadSearches]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadListings();
  }, [loadListings]);

  async function handleSubmit(values: SearchFormValues) {
    setSubmitting(true);
    try {
      const isEdit = mode.kind === "edit" && activeId != null;
      const res = await fetch(isEdit ? `/api/searches/${activeId}` : "/api/searches", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(values)),
      });
      const data = await res.json();
      if (!res.ok) return;
      const list = await loadSearches();
      const newId = data.search?.id ?? (list[0]?.id ?? null);
      setActiveId(isEdit ? activeId : newId);
      setMode({ kind: "view" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (activeId == null) return;
    if (!confirm("Usunąć tę listę wraz z ofertami?")) return;
    await fetch(`/api/searches/${activeId}`, { method: "DELETE" });
    const list = await loadSearches();
    setActiveId(list[0]?.id ?? null);
    setMode({ kind: "view" });
  }

  async function toggleStar(id: number) {
    await fetch(`/api/listings/${id}/star`, { method: "PATCH" });
    await loadListings();
  }

  async function toggleDislike(id: number) {
    await fetch(`/api/listings/${id}/dislike`, { method: "PATCH" });
    await loadListings();
  }

  /** Saves the modal's fields; returns the listing id (new for a created one), throws when rejected. */
  async function submitListingDetails(id: number | null, fields: ListingFormFields): Promise<number> {
    let savedId = id;
    if (id == null) {
      if (activeId == null) throw new Error("Brak aktywnej listy");
      const res = await fetch(`/api/searches/${activeId}/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error("Nie udało się zapisać");
      savedId = (await res.json()).row.id;
    } else {
      const res = await fetch(`/api/listings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error("Nie udało się zapisać");
    }
    await loadListings();
    return savedId as number;
  }

  const activeCount = rows.filter((r) => r.is_active && !r.is_disliked).length;
  const editingRow = listingModal.kind === "edit" ? rows.find((r) => r.id === listingModal.id) ?? null : null;

  return (
    <div className="flex min-h-screen">
      <SearchSidebar
        searches={searches}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setMode({ kind: "view" });
        }}
        onNew={() => setMode({ kind: "new" })}
      />

      <main className="flex-1 overflow-x-hidden p-6">
        <h1 className="mb-4 text-2xl font-semibold">Wyszukiwarka mieszkań — Warszawa i okolice</h1>

        {mode.kind === "new" && (
          <SearchForm
            title="Nowa lista"
            initial={EMPTY_FORM}
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={() => setMode({ kind: "view" })}
          />
        )}

        {mode.kind === "edit" && activeSearch && (
          <SearchForm
            title="Edytuj listę"
            initial={searchToFormValues(activeSearch)}
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={() => setMode({ kind: "view" })}
          />
        )}

        {mode.kind === "view" && !activeSearch && (
          <p className="text-sm text-zinc-500">
            Wybierz listę z menu po lewej lub utwórz nową, aby rozpocząć.
          </p>
        )}

        {mode.kind === "view" && activeSearch && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{activeSearch.name}</h2>
                <p className="text-xs text-zinc-500">
                  {describeLocations(activeSearch)} ·{" "}
                  {activeSearch.sources.length} źródeł
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode({ kind: "edit" })}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                >
                  Edytuj
                </button>
                <button
                  onClick={handleDelete}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 dark:border-red-800"
                >
                  Usuń
                </button>
              </div>
            </div>

            <ScrapeProgress searchId={activeSearch.id} sources={activeSearch.sources} onComplete={loadListings} />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-zinc-500">
                <span>
                  {rows.length} ofert ({activeCount} aktywnych)
                </span>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} />
                  Tylko ★
                </label>
                <label className="flex items-center gap-1" title="Ukrywa oferty nieaktualne i odrzucone (👎)">
                  <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                  Ukryj nieaktywne
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={highlightChanges}
                    onChange={(e) => setHighlightChanges(e.target.checked)}
                  />
                  Podświetlaj nowe i ze zmienioną ceną
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setListingModal({ kind: "create" })}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                >
                  Dodaj ofertę ręcznie
                </button>
                <ExportButton searchId={activeSearch.id} />
              </div>
            </div>

            <ListingsTable
              searchId={activeSearch.id}
              rows={rows}
              sort={sort}
              onSortChange={setSort}
              onToggleStar={toggleStar}
              onToggleDislike={toggleDislike}
              onRowClick={(id) => setListingModal({ kind: "edit", id })}
              onLocated={loadListings}
              highlightChanges={highlightChanges}
            />
          </div>
        )}

        {listingModal.kind !== "closed" && (
          <ListingDetailsModal
            row={editingRow}
            onClose={() => setListingModal({ kind: "closed" })}
            onSubmit={submitListingDetails}
            onEnriched={loadListings}
          />
        )}
      </main>
    </div>
  );
}
