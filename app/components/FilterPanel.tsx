"use client";

// The "Filtry ▾" dropdown next to "Kolumny ▾". One control per filterable
// field (see listing-filters.ts for the definitions and the matching logic);
// changes apply immediately and are persisted by the table.
import { useEffect, useRef, useState } from "react";
import {
  FILTER_DEFS,
  NULL_OPTION,
  countActive,
  emptyValue,
  isActive,
  type DateFilter,
  type FilterDef,
  type FilterValue,
  type FlagFilter,
  type ListingFilters,
  type NumberFilter,
} from "./listing-filters";

const inputClass =
  "w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800";
const smallInputClass =
  "w-24 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800";

function FilterControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}) {
  switch (def.kind) {
    case "number": {
      const v = value as NumberFilter;
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="od"
            value={v.min}
            onChange={(e) => onChange({ ...v, min: e.target.value })}
            className={smallInputClass}
          />
          <span className="text-zinc-400">–</span>
          <input
            type="number"
            placeholder="do"
            value={v.max}
            onChange={(e) => onChange({ ...v, max: e.target.value })}
            className={smallInputClass}
          />
          {def.unit && <span className="text-xs text-zinc-500">{def.unit}</span>}
        </div>
      );
    }
    case "date": {
      const v = value as DateFilter;
      return (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={v.from}
            onChange={(e) => onChange({ ...v, from: e.target.value })}
            className={smallInputClass}
          />
          <span className="text-zinc-400">–</span>
          <input
            type="date"
            value={v.to}
            onChange={(e) => onChange({ ...v, to: e.target.value })}
            className={smallInputClass}
          />
        </div>
      );
    }
    case "enum": {
      const selected = value as string[];
      return (
        <div className="flex flex-wrap gap-1">
          {(def.options ?? []).map((opt) => {
            const on = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onChange(on ? selected.filter((s) => s !== opt.value) : [...selected, opt.value])
                }
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  on
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "flag":
      return (
        <select value={value as FlagFilter} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">wszystkie</option>
          <option value="1">tak</option>
          <option value="0">nie</option>
          <option value={NULL_OPTION}>brak danych</option>
        </select>
      );
    case "text":
      return (
        <input
          type="text"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      );
  }
}

export function FilterPanel({
  filters,
  onChange,
  matched,
  total,
}: {
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  matched: number;
  total: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCount = countActive(filters);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  function setValue(key: string, value: FilterValue) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={`rounded-md border px-3 py-1.5 text-sm ${
          activeCount > 0
            ? "border-zinc-900 font-medium dark:border-zinc-100"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        Filtry{activeCount > 0 ? ` (${activeCount})` : ""} ▾
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-[70vh] w-[26rem] overflow-y-auto rounded-md border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {matched} z {total} ofert
            </span>
            <button
              onClick={() => onChange({})}
              disabled={activeCount === 0}
              className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-700"
            >
              Wyczyść wszystkie
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {FILTER_DEFS.map((def) => {
              const value = filters[def.key] ?? emptyValue(def.kind);
              const on = isActive(def.kind, value);
              return (
                <div key={def.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${on ? "" : "text-zinc-500"}`}>{def.label}</span>
                    {on && (
                      <button
                        onClick={() => setValue(def.key, emptyValue(def.kind))}
                        className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                        title="Wyczyść ten filtr"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <FilterControl def={def} value={value} onChange={(v) => setValue(def.key, v)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
