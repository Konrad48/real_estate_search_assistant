"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { floorLabel } from "../../lib/normalize";
import { FilterPanel } from "./FilterPanel";
import { ListingsMap } from "./ListingsMap";
import { applyFilters, loadFilters, saveFilters, type ListingFilters } from "./listing-filters";
import { SOURCE_LABELS, type ListingWithPrev, type SortColumn, type SortState } from "./types";

const COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "source", label: "Źródło" },
  { key: "price_pln", label: "Cena (zł)" },
  { key: "area_m2", label: "Pow. (m²)" },
  { key: "price_per_m2", label: "Cena/m²" },
  { key: "rooms", label: "Pokoje" },
  { key: "district", label: "Lokalizacja" },
  { key: "last_scraped_at", label: "Pobrano" },
  { key: "floor", label: "Piętro" },
  { key: "ownership_type", label: "Prawo własności" },
  { key: "listing_date", label: "Data ogłoszenia" },
  { key: "address_raw", label: "Adres" },
  { key: "czynsz", label: "Czynsz (zł)" },
  { key: "contact_name", label: "Kontakt — imię" },
  { key: "contact_phone", label: "Kontakt — telefon" },
  { key: "comment", label: "Komentarz" },
  { key: "total_floors", label: "Pięter w budynku" },
  { key: "year_built", label: "Rok budowy" },
  { key: "condition_state", label: "Stan" },
  { key: "has_balcony", label: "Balkon" },
  { key: "has_parking", label: "Miejsce post." },
  { key: "has_elevator", label: "Winda" },
];

// Columns added after the original set default to hidden so the table stays
// compact until the user opts in via "Kolumny ▾".
const DEFAULT_HIDDEN_COLUMNS: SortColumn[] = [
  "floor",
  "total_floors",
  "year_built",
  "condition_state",
  "has_balcony",
  "has_parking",
  "has_elevator",
  "listing_date",
  "address_raw",
  "czynsz",
  "contact_name",
  "contact_phone",
  "comment",
];

const HIDDEN_COLUMNS_KEY = "listingsTable.hiddenColumns";
// Which columns this browser has already been offered. Without it, a column
// added in a new version would show up for existing users regardless of its
// DEFAULT_HIDDEN_COLUMNS entry, since their stored array simply lacks it.
const KNOWN_COLUMNS_KEY = "listingsTable.knownColumns";
// The column set that existed before KNOWN_COLUMNS_KEY was introduced — used
// to interpret preferences stored by an older build of the app.
const LEGACY_COLUMNS: SortColumn[] = [
  "source",
  "price_pln",
  "area_m2",
  "price_per_m2",
  "rooms",
  "district",
  "last_scraped_at",
  "floor",
  "listing_date",
  "address_raw",
  "czynsz",
  "contact_name",
  "contact_phone",
  "comment",
];
// Whether the map is open, so it stays open across reloads and list switches.
const MAP_OPEN_KEY = "listingsTable.mapOpen";

function loadHiddenColumns(): Set<SortColumn> {
  if (typeof window === "undefined") return new Set(DEFAULT_HIDDEN_COLUMNS);
  try {
    const raw = window.localStorage.getItem(HIDDEN_COLUMNS_KEY);
    if (!raw) return new Set(DEFAULT_HIDDEN_COLUMNS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_HIDDEN_COLUMNS);
    const hidden = new Set(parsed as SortColumn[]);

    const knownRaw = window.localStorage.getItem(KNOWN_COLUMNS_KEY);
    const known = new Set<SortColumn>(
      knownRaw ? (JSON.parse(knownRaw) as SortColumn[]) : LEGACY_COLUMNS
    );
    // Columns this browser has never seen fall back to their default state.
    for (const key of DEFAULT_HIDDEN_COLUMNS) {
      if (!known.has(key)) hidden.add(key);
    }
    return hidden;
  } catch {
    return new Set(DEFAULT_HIDDEN_COLUMNS);
  }
}

function loadMapOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MAP_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function ColumnPicker({
  hiddenColumns,
  onToggle,
}: {
  hiddenColumns: Set<SortColumn>;
  onToggle: (key: SortColumn) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
      >
        Kolumny ▾
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {COLUMNS.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                checked={!hiddenColumns.has(col.key)}
                onChange={() => onToggle(col.key)}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pl-PL", { maximumFractionDigits: 0 });
}

function PriceDelta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null || current === previous) return null;
  const diff = current - previous;
  const up = diff > 0;
  return (
    <span
      className={`ml-1 whitespace-nowrap text-xs ${up ? "text-red-600" : "text-green-600"}`}
      title={`Poprzednia cena: ${fmt(previous)} zł`}
    >
      {up ? "▲" : "▼"} {up ? "+" : "−"}
      {fmt(Math.abs(diff))}
    </span>
  );
}

function AlsoOnTag({ row }: { row: ListingWithPrev }) {
  if (!row.also_on || row.also_on.length === 0) return null;
  // Distinct other services this offer was also found on.
  const others = [...new Set(row.also_on.map((a) => SOURCE_LABELS[a.source]))];
  // Show a cheaper alternate price only if one exists elsewhere (rare).
  const prices = row.also_on.map((a) => a.price_pln).filter((p): p is number => p != null);
  const cheaperElsewhere = prices.length > 0 && row.price_pln != null && Math.min(...prices) < row.price_pln;
  return (
    <span
      className="ml-1 whitespace-nowrap rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      title={`Ta sama oferta również na: ${row.also_on
        .map((a) => `${SOURCE_LABELS[a.source]}${a.price_pln != null ? ` (${fmt(a.price_pln)} zł)` : ""}`)
        .join(", ")}`}
    >
      też: {others.join(", ")}
      {cheaperElsewhere ? " ⚠" : ""}
    </span>
  );
}

// Enrichment stores 1/0/null, where null means "the offer never said".
function yesNo(value: number | null): string {
  if (value == null) return "—";
  return value ? "tak" : "nie";
}

function isNewListing(row: ListingWithPrev): boolean {
  return row.source !== "manual" && row.first_scraped_at === row.last_scraped_at;
}

function priceChanged(row: ListingWithPrev): boolean {
  return row.previous_price_pln != null && row.price_pln !== row.previous_price_pln;
}

function renderCell(row: ListingWithPrev, column: SortColumn) {
  switch (column) {
    case "source":
      return (
        <>
          {SOURCE_LABELS[row.source]}
          <AlsoOnTag row={row} />
        </>
      );
    case "price_pln":
      return (
        <>
          {fmt(row.price_pln)}
          <PriceDelta current={row.price_pln} previous={row.previous_price_pln} />
        </>
      );
    case "area_m2":
      return fmt(row.area_m2);
    case "price_per_m2":
      return fmt(row.price_per_m2);
    case "rooms":
      return row.rooms ?? "—";
    case "district":
      return row.district ?? row.address_raw ?? "—";
    case "last_scraped_at":
      return new Date(row.last_scraped_at).toLocaleDateString("pl-PL");
    case "floor":
      // Enrichment's structured floor wins; the scraped text is the fallback.
      return floorLabel(row.floor_num, row.total_floors) ?? row.floor ?? "—";
    case "listing_date":
      return row.listing_date ?? "—";
    case "address_raw":
      return row.address_raw ?? "—";
    case "czynsz":
      return fmt(row.czynsz);
    case "contact_name":
      return row.contact_name ?? "—";
    case "contact_phone":
      return row.contact_phone ?? "—";
    case "comment":
      return row.comment ?? "—";
    case "ownership_type":
      return row.ownership_type ?? "—";
    case "total_floors":
      return row.total_floors ?? "—";
    case "year_built":
      return row.year_built ?? "—";
    case "condition_state":
      return row.condition_state ?? "—";
    case "has_balcony":
      return yesNo(row.has_balcony);
    case "has_parking":
      return yesNo(row.has_parking);
    case "has_elevator":
      return yesNo(row.has_elevator);
  }
}

const NOWRAP_COLUMNS = new Set<SortColumn>([
  "price_pln",
  "last_scraped_at",
  "listing_date",
  "contact_phone",
  "ownership_type",
]);
const TRUNCATE_COLUMNS = new Set<SortColumn>(["comment", "address_raw"]);

/** A hovered offer, and whether the hover started on the map (then the table scrolls to it). */
type Hover = { id: number; from: "map" | "table" } | null;

export function ListingsTable({
  searchId,
  rows,
  sort,
  onSortChange,
  onToggleStar,
  onToggleDislike,
  onRowClick,
  onLocated,
  highlightChanges,
}: {
  searchId: number;
  rows: ListingWithPrev[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
  onToggleStar: (id: number) => void;
  onToggleDislike: (id: number) => void;
  onRowClick: (id: number) => void;
  onLocated: () => void;
  highlightChanges: boolean;
}) {
  const [hiddenColumns, setHiddenColumns] = useState<Set<SortColumn>>(() => loadHiddenColumns());
  const [filters, setFilters] = useState<ListingFilters>(() => loadFilters());
  const [mapOpen, setMapOpen] = useState<boolean>(() => loadMapOpen());
  const [hover, setHover] = useState<Hover>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  // Persisted so a set of filters survives a reload / restart of the app.
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  useEffect(() => {
    window.localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...hiddenColumns]));
    window.localStorage.setItem(KNOWN_COLUMNS_KEY, JSON.stringify(COLUMNS.map((c) => c.key)));
  }, [hiddenColumns]);

  useEffect(() => {
    window.localStorage.setItem(MAP_OPEN_KEY, mapOpen ? "1" : "0");
  }, [mapOpen]);

  // A dot hovered on the map scrolls its row into the middle of the table pane
  // when it's out of view. "In view" means the part of the pane actually on
  // screen, below its sticky header — the pane can extend past the bottom of the
  // window (e.g. when the map reopens on load and the page isn't scrolled down).
  useEffect(() => {
    if (!hover || hover.from !== "map") return;
    const container = scrollRef.current;
    const row = rowRefs.current.get(hover.id);
    if (!container || !row) return;
    const box = container.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const headerHeight = container.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const visibleTop = Math.max(box.top, 0) + headerHeight;
    const visibleBottom = Math.min(box.bottom, window.innerHeight);
    if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return;
    const visibleMiddle = (visibleTop + visibleBottom) / 2;
    container.scrollTo({
      top: container.scrollTop + (rect.top + rect.height / 2 - visibleMiddle),
      behavior: "smooth",
    });
  }, [hover]);

  function toggleColumn(key: SortColumn) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleMap() {
    const opening = !mapOpen;
    setMapOpen(opening);
    setHover(null);
    // Bring the toolbar to the top of the screen so the map pane fits below it.
    if (opening) requestAnimationFrame(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const visibleColumns = useMemo(() => COLUMNS.filter((c) => !hiddenColumns.has(c.key)), [hiddenColumns]);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sort.column];
      const bv = b[sort.column];
      // nulls always last regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sort.direction === "asc" ? -1 : 1;
      if (av > bv) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sort]);

  function headerClick(column: SortColumn) {
    if (sort.column === column) {
      onSortChange({ column, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ column, direction: "asc" });
    }
  }

  return (
    <div ref={rootRef} className="scroll-mt-2">
      <div className="mb-2 flex items-center justify-end gap-2">
        {filtered.length !== rows.length && (
          // The page header counts all fetched offers, so say plainly how many
          // of them the filters are hiding.
          <span className="mr-auto text-xs text-zinc-500">
            Filtry: pokazano {filtered.length} z {rows.length} ofert
          </span>
        )}
        <FilterPanel filters={filters} onChange={setFilters} matched={filtered.length} total={rows.length} />
        <ColumnPicker hiddenColumns={hiddenColumns} onToggle={toggleColumn} />
        <button
          onClick={toggleMap}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            mapOpen
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {mapOpen ? "Ukryj mapę" : "Mapa"}
        </button>
      </div>
      <div className={mapOpen ? "grid grid-cols-3 gap-3" : undefined}>
        <div
          ref={scrollRef}
          className={`rounded-lg border border-zinc-200 dark:border-zinc-800 ${
            mapOpen ? "h-[85vh] min-w-0 overflow-auto" : "overflow-x-auto"
          }`}
        >
          <table className="w-full text-left text-sm">
            <thead className={`bg-zinc-100 dark:bg-zinc-800 ${mapOpen ? "sticky top-0 z-10" : ""}`}>
              <tr>
                <th className="px-3 py-2" aria-label="Ulubione" />
                {visibleColumns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => headerClick(col.key)}
                    className="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium"
                  >
                    {col.label}
                    {sort.column === col.key ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Tytuł / link</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const highlighted =
                  highlightChanges && row.is_active === 1 && !row.is_disliked && (isNewListing(row) || priceChanged(row));
                const rowBg =
                  hover?.id === row.id
                    ? "bg-amber-200 dark:bg-amber-700/50"
                    : !row.is_active || row.is_disliked
                      ? "bg-zinc-50 text-zinc-400 dark:bg-zinc-900/40"
                      : highlighted
                        ? "bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40";
                return (
                  <tr
                    key={row.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.id, el);
                      else rowRefs.current.delete(row.id);
                    }}
                    onClick={() => onRowClick(row.id)}
                    onMouseEnter={mapOpen ? () => setHover({ id: row.id, from: "table" }) : undefined}
                    onMouseLeave={mapOpen ? () => setHover(null) : undefined}
                    className={`cursor-pointer border-t border-zinc-100 dark:border-zinc-800 ${rowBg}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(row.id);
                        }}
                        title={row.is_starred ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
                        className={row.is_starred ? "text-yellow-500" : "text-zinc-300 hover:text-yellow-500"}
                      >
                        {row.is_starred ? "★" : "☆"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleDislike(row.id);
                        }}
                        title={row.is_disliked ? "Przywróć ofertę" : "Odrzuć ofertę (ukryje ją z listy)"}
                        className={`ml-2 ${row.is_disliked ? "" : "opacity-25 grayscale hover:opacity-100 hover:grayscale-0"}`}
                      >
                        👎
                      </button>
                    </td>
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        title={TRUNCATE_COLUMNS.has(col.key) ? (renderCell(row, col.key) as string) : undefined}
                        className={`px-3 py-2 ${NOWRAP_COLUMNS.has(col.key) ? "whitespace-nowrap" : ""} ${
                          TRUNCATE_COLUMNS.has(col.key) ? "max-w-[16rem] truncate" : ""
                        }`}
                      >
                        {renderCell(row, col.key)}
                      </td>
                    ))}
                    <td className="max-w-xs truncate px-3 py-2">
                      {!row.is_active && (
                        <span className="mr-2 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                          nieaktualne
                        </span>
                      )}
                      {row.is_disliked === 1 && (
                        <span className="mr-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          odrzucone
                        </span>
                      )}
                      <a
                        href={row.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 underline visited:text-purple-700 dark:text-blue-400 dark:visited:text-purple-400"
                      >
                        {row.title ?? row.source_url}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-4 text-center text-sm text-zinc-500">
              Brak ofert. Kliknij „Scrapuj”, aby pobrać wyniki dla tej listy.
            </p>
          )}
          {rows.length > 0 && filtered.length === 0 && (
            <p className="p-4 text-center text-sm text-zinc-500">
              Żadna z {rows.length} ofert nie pasuje do filtrów.{" "}
              <button onClick={() => setFilters({})} className="underline">
                Wyczyść filtry
              </button>
            </p>
          )}
        </div>
        {mapOpen && (
          <div className="col-span-2 h-[85vh] min-w-0">
            <ListingsMap
              key={searchId}
              searchId={searchId}
              rows={sorted}
              allRows={rows}
              highlightId={hover?.id ?? null}
              onHover={(id) => setHover(id == null ? null : { id, from: "map" })}
              onSelect={onRowClick}
              onLocated={onLocated}
            />
          </div>
        )}
      </div>
    </div>
  );
}
