"use client";

import { useState } from "react";
import { TOWN_NAMES } from "../../lib/towns";
import { WARSAW_DISTRICTS } from "../../lib/warsaw-districts";
import { ALL_SOURCES, SOURCE_LABELS, type SearchFormValues, type SourceId } from "./types";

export function SearchForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
  title,
}: {
  initial: SearchFormValues;
  onSubmit: (values: SearchFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  title: string;
}) {
  const [values, setValues] = useState<SearchFormValues>(initial);

  function toggleDistrict(d: string) {
    setValues((v) => ({
      ...v,
      districts: v.districts.includes(d) ? v.districts.filter((x) => x !== d) : [...v.districts, d],
    }));
  }
  function toggleTown(t: string) {
    setValues((v) => ({
      ...v,
      towns: v.towns.includes(t) ? v.towns.filter((x) => x !== t) : [...v.towns, t],
    }));
  }
  function toggleSource(s: SourceId) {
    setValues((v) => ({
      ...v,
      sources: v.sources.includes(s) ? v.sources.filter((x) => x !== s) : [...v.sources, s],
    }));
  }
  function num(key: keyof SearchFormValues) {
    return (
      <input
        type="number"
        value={values[key] as string}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        className="w-32 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      />
    );
  }

  const hasLocation = values.includeWarsaw || values.towns.length > 0;
  const canSubmit = values.sources.length > 0 && hasLocation && !submitting;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold">{title}</h2>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Nazwa listy (opcjonalnie)</span>
        <input
          type="text"
          value={values.name}
          placeholder="np. Mokotów do 800 tys."
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          className="w-full max-w-md rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
        />
      </label>

      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Lokalizacje</span>

        <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-700">
          <label className="flex items-center gap-1 font-medium">
            <input
              type="checkbox"
              checked={values.includeWarsaw}
              onChange={() => setValues((v) => ({ ...v, includeWarsaw: !v.includeWarsaw }))}
            />
            Warszawa
          </label>
          <div className={`flex flex-col gap-1 pl-5 ${values.includeWarsaw ? "" : "opacity-40"}`}>
            <span className="text-zinc-500">
              Dzielnice {values.districts.length === 0 && "(brak = cała Warszawa)"}
            </span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WARSAW_DISTRICTS.map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={values.districts.includes(d)}
                    disabled={!values.includeWarsaw}
                    onChange={() => toggleDistrict(d)}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded border border-zinc-200 p-3 dark:border-zinc-700">
          {TOWN_NAMES.map((t) => (
            <label key={t} className="flex items-center gap-1 font-medium">
              <input type="checkbox" checked={values.towns.includes(t)} onChange={() => toggleTown(t)} />
              {t}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Cena (zł):</span>
        {num("minPrice")} <span>–</span> {num("maxPrice")}
        <span className="ml-4 font-medium">Powierzchnia (m²):</span>
        {num("minArea")} <span>–</span> {num("maxArea")}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="font-medium">Źródła:</span>
        {ALL_SOURCES.map((s) => (
          <label key={s} className="flex items-center gap-1">
            <input type="checkbox" checked={values.sources.includes(s)} onChange={() => toggleSource(s)} />
            {SOURCE_LABELS[s]}
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onSubmit(values)}
          disabled={!canSubmit}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {submitting ? "Zapisywanie…" : "Zapisz listę"}
        </button>
        <button onClick={onCancel} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">
          Anuluj
        </button>
      </div>
      {!hasLocation && <p className="text-xs text-red-600">Zaznacz Warszawę lub co najmniej jedną miejscowość.</p>}
      {values.sources.length === 0 && <p className="text-xs text-red-600">Wybierz co najmniej jedno źródło.</p>}
    </div>
  );
}
