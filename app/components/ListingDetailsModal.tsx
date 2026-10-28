"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONDITION_STATES } from "../../lib/normalize";
import { OWNERSHIP_TYPES } from "../../lib/ownership";
import { WIRING_TYPES } from "../../lib/questionnaire";
import { TOWN_NAMES } from "../../lib/towns";
import { WARSAW_DISTRICTS } from "../../lib/warsaw-districts";
import { SOURCE_LABELS, type ListingWithPrev, type PriceHistoryRow } from "./types";

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pl-PL", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HistoryTimeline({ history, loading }: { history: PriceHistoryRow[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-zinc-500">Wczytywanie historii…</p>;
  if (history.length === 0) return <p className="text-sm text-zinc-500">Brak historii.</p>;

  return (
    <ol className="relative">
      {history.map((entry, i) => {
        const isFirst = i === 0;
        const prev = history[i - 1];
        const diff =
          !isFirst && entry.price_pln != null && prev.price_pln != null
            ? entry.price_pln - prev.price_pln
            : null;
        const up = diff != null && diff > 0;

        return (
          <li key={entry.id} className="relative pb-6 pl-6 last:pb-0">
            {i !== history.length - 1 && (
              <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-zinc-300 dark:bg-zinc-700" />
            )}
            <span
              aria-hidden
              className={`absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 ${
                diff == null
                  ? "border-zinc-400 bg-white dark:border-zinc-500 dark:bg-zinc-900"
                  : up
                    ? "border-red-500 bg-red-500"
                    : "border-green-500 bg-green-500"
              }`}
            />
            <p className="text-xs text-zinc-500">{fmtDate(entry.recorded_at)}</p>
            {isFirst ? (
              <p className="text-sm">
                <span className="font-medium">Utworzono</span> — {fmt(entry.price_pln)} zł
              </p>
            ) : diff == null ? (
              <p className="text-sm text-zinc-500">Odświeżono (bez zmiany ceny)</p>
            ) : (
              <p className="text-sm">
                {fmt(prev.price_pln)} zł → {fmt(entry.price_pln)} zł{" "}
                <span className={up ? "text-red-600" : "text-green-600"}>
                  ({up ? "▲ +" : "▼ −"}
                  {fmt(Math.abs(diff))})
                </span>
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface ListingFormFields {
  title: string | null;
  pricePln: number | null;
  areaM2: number | null;
  district: string | null;
  addressRaw: string | null;
  rooms: number | null;
  floor: string | null;
  listingDate: string | null;
  sourceUrl: string | null;
  comment: string | null;
  contactName: string | null;
  contactPhone: string | null;
  czynsz: number | null;
  ownershipType: string | null;
  floorNum: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  conditionState: string | null;
  hasBalcony: number | null;
  hasParking: number | null;
  hasElevator: number | null;
  hasLandRegister: number | null;
  landRegisterNumber: string | null;
  landRegulated: number | null;
  hasEncumbrance: number | null;
  layout: string | null;
  priceNegotiable: number | null;
  flooring: string | null;
  wiring: string | null;
  commissionTerms: string | null;
  hasTenants: number | null;
  saleReason: string | null;
}

interface FormState {
  title: string;
  pricePln: string;
  areaM2: string;
  district: string;
  addressRaw: string;
  rooms: string;
  floor: string;
  listingDate: string;
  sourceUrl: string;
  comment: string;
  contactName: string;
  contactPhone: string;
  czynsz: string;
  ownershipType: string;
  floorNum: string;
  totalFloors: string;
  yearBuilt: string;
  conditionState: string;
  hasBalcony: string;
  hasParking: string;
  hasElevator: string;
  hasLandRegister: string;
  landRegisterNumber: string;
  landRegulated: string;
  hasEncumbrance: string;
  layout: string;
  priceNegotiable: string;
  flooring: string;
  wiring: string;
  commissionTerms: string;
  hasTenants: string;
  saleReason: string;
}

// The 1/0/null amenity flags are edited as a three-state select, where the
// empty option means "unknown" (which is not the same as "no").
function flagToOption(value: number | null): string {
  return value == null ? "" : String(value);
}

function optionToFlag(value: string): 0 | 1 | null {
  if (value === "1") return 1;
  if (value === "0") return 0;
  return null;
}

function toFormState(row: ListingWithPrev | null): FormState {
  return {
    title: row?.title ?? "",
    pricePln: row?.price_pln != null ? String(row.price_pln) : "",
    areaM2: row?.area_m2 != null ? String(row.area_m2) : "",
    district: row?.district ?? "",
    addressRaw: row?.address_raw ?? "",
    rooms: row?.rooms != null ? String(row.rooms) : "",
    floor: row?.floor ?? "",
    listingDate: row?.listing_date ?? "",
    sourceUrl: row?.source_url ?? "",
    comment: row?.comment ?? "",
    contactName: row?.contact_name ?? "",
    contactPhone: row?.contact_phone ?? "",
    czynsz: row?.czynsz != null ? String(row.czynsz) : "",
    ownershipType: row?.ownership_type ?? "",
    floorNum: row?.floor_num != null ? String(row.floor_num) : "",
    totalFloors: row?.total_floors != null ? String(row.total_floors) : "",
    yearBuilt: row?.year_built != null ? String(row.year_built) : "",
    conditionState: row?.condition_state ?? "",
    hasBalcony: flagToOption(row?.has_balcony ?? null),
    hasParking: flagToOption(row?.has_parking ?? null),
    hasElevator: flagToOption(row?.has_elevator ?? null),
    hasLandRegister: flagToOption(row?.has_land_register ?? null),
    landRegisterNumber: row?.land_register_number ?? "",
    landRegulated: flagToOption(row?.land_regulated ?? null),
    hasEncumbrance: flagToOption(row?.has_encumbrance ?? null),
    layout: row?.layout ?? "",
    priceNegotiable: flagToOption(row?.price_negotiable ?? null),
    flooring: row?.flooring ?? "",
    wiring: row?.wiring ?? "",
    commissionTerms: row?.commission_terms ?? "",
    hasTenants: flagToOption(row?.has_tenants ?? null),
    saleReason: row?.sale_reason ?? "",
  };
}

function toFields(v: FormState): ListingFormFields {
  const str = (s: string) => (s.trim() === "" ? null : s.trim());
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    title: str(v.title),
    pricePln: num(v.pricePln),
    areaM2: num(v.areaM2),
    district: str(v.district),
    addressRaw: str(v.addressRaw),
    rooms: num(v.rooms),
    floor: str(v.floor),
    listingDate: str(v.listingDate),
    sourceUrl: str(v.sourceUrl),
    comment: str(v.comment),
    contactName: str(v.contactName),
    contactPhone: str(v.contactPhone),
    czynsz: num(v.czynsz),
    ownershipType: str(v.ownershipType),
    floorNum: num(v.floorNum),
    totalFloors: num(v.totalFloors),
    yearBuilt: num(v.yearBuilt),
    conditionState: str(v.conditionState),
    hasBalcony: optionToFlag(v.hasBalcony),
    hasParking: optionToFlag(v.hasParking),
    hasElevator: optionToFlag(v.hasElevator),
    hasLandRegister: optionToFlag(v.hasLandRegister),
    landRegisterNumber: str(v.landRegisterNumber),
    landRegulated: optionToFlag(v.landRegulated),
    hasEncumbrance: optionToFlag(v.hasEncumbrance),
    layout: str(v.layout),
    priceNegotiable: optionToFlag(v.priceNegotiable),
    flooring: str(v.flooring),
    wiring: str(v.wiring),
    commissionTerms: str(v.commissionTerms),
    hasTenants: optionToFlag(v.hasTenants),
    saleReason: str(v.saleReason),
  };
}

const FLAG_FIELDS: { key: "hasBalcony" | "hasParking" | "hasElevator"; label: string }[] = [
  { key: "hasBalcony", label: "Balkon / taras" },
  { key: "hasParking", label: "Miejsce postojowe" },
  { key: "hasElevator", label: "Winda" },
];

const ENRICH_STATUS_LABELS: Record<string, string> = {
  structured: "dane z ogłoszenia",
  ai: "uzupełnione przez AI",
  mixed: "ogłoszenie + AI",
  failed: "nie udało się pobrać",
};

const inputClass =
  "w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800";

// „Kwestionariusz” — the questions to ask the seller on the phone, in order.
// Answers share FormState with the regular form, so whatever is already known
// (e.g. czynsz from the offer page) shows up pre-filled and autosave covers both.
interface Question {
  key: keyof FormState;
  topic: string;
  question: string;
  kind: "flag" | "text" | "longtext" | "number" | "wiring";
  placeholder?: string;
  unit?: string;
  /** What the offer itself already says on the subject, shown under the question. */
  hint?: (row: ListingWithPrev) => string | null;
}

const QUESTIONS: Question[] = [
  {
    key: "hasLandRegister",
    topic: "Księga wieczysta",
    question: "Czy jest księga wieczysta?",
    kind: "flag",
    hint: (r) => (r.ownership_type ? `Prawo własności z ogłoszenia: ${r.ownership_type}` : null),
  },
  {
    key: "landRegisterNumber",
    topic: "Numer KW",
    question: "Numer księgi wieczystej",
    kind: "text",
    placeholder: "np. WA1M/00012345/6",
  },
  { key: "landRegulated", topic: "Grunt", question: "Czy grunty są uregulowane?", kind: "flag" },
  {
    key: "hasEncumbrance",
    topic: "Obciążenia",
    question: "Czy na mieszkaniu jest hipoteka lub inne obciążenia?",
    kind: "flag",
  },
  { key: "czynsz", topic: "Czynsz", question: "Ile wynosi czynsz?", kind: "number", unit: "zł / mies." },
  {
    key: "layout",
    topic: "Układ",
    question: "Jaki jest układ mieszkania?",
    kind: "longtext",
    placeholder: "np. pokoje nieprzechodnie, kuchnia otwarta na salon",
    hint: (r) => (r.rooms != null ? `Pokoi według ogłoszenia: ${r.rooms}` : null),
  },
  { key: "priceNegotiable", topic: "Negocjacje", question: "Czy cena jest do negocjacji?", kind: "flag" },
  {
    key: "flooring",
    topic: "Podłoga",
    question: "Co to za podłoga?",
    kind: "text",
    placeholder: "np. panele, deska, parkiet, płytki",
  },
  {
    key: "wiring",
    topic: "Instalacja elektryczna",
    question: "Jaka jest instalacja — aluminium czy miedź?",
    kind: "wiring",
  },
  { key: "commissionTerms", topic: "Prowizja", question: "Jakie są warunki prowizji?", kind: "longtext" },
  { key: "hasTenants", topic: "Lokatorzy", question: "Czy są lokatorzy?", kind: "flag" },
  {
    key: "saleReason",
    topic: "Powód sprzedaży",
    question: "Dlaczego mieszkanie jest sprzedawane?",
    kind: "longtext",
  },
];

const QUESTIONNAIRE_KEY = "listingDetails.questionnaire";

/** Quiet time after the last keystroke before the form is saved. */
const AUTOSAVE_DELAY_MS = 700;

type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: "Zmiany zapisują się automatycznie",
  saving: "Zapisywanie…",
  saved: "✓ Zapisano",
  error: "Nie udało się zapisać — sprawdź pola (np. rok budowy, piętro)",
};

function loadQuestionnaireMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(QUESTIONNAIRE_KEY) === "1";
  } catch {
    return false;
  }
}

/** tak / nie / nie wiadomo as one-click buttons — quicker than a select mid-call. */
function TriState({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const options = [
    { value: "1", text: "tak" },
    { value: "0", text: "nie" },
    { value: "", text: "nie wiadomo" },
  ];
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`border-l border-zinc-300 px-3 py-1 text-sm first:border-l-0 dark:border-zinc-700 ${
            value === o.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

function QuestionnaireFields({
  row,
  values,
  set,
}: {
  row: ListingWithPrev | null;
  values: FormState;
  set: (key: keyof FormState, value: string) => void;
}) {
  const answered = QUESTIONS.filter((q) => values[q.key].trim() !== "").length;

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Kontakt — imię</span>
          <input type="text" value={values.contactName} onChange={(e) => set("contactName", e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Kontakt — telefon</span>
          <input type="tel" value={values.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} className={inputClass} />
        </label>
      </div>

      <p className="text-xs text-zinc-500">
        Odpowiedzi: {answered} / {QUESTIONS.length}
      </p>

      <ol className="flex flex-col gap-3">
        {QUESTIONS.map((q, i) => {
          const value = values[q.key];
          const hint = row && q.hint ? q.hint(row) : null;
          const id = `q-${q.key}`;
          return (
            <li key={q.key} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                <span>
                  {i + 1}. {q.topic}
                </span>
                <span className={value.trim() !== "" ? "text-green-600" : ""}>
                  {value.trim() !== "" ? "✓ uzupełnione" : "brak odpowiedzi"}
                </span>
              </div>
              <label htmlFor={id} className="mt-1 block text-sm font-medium">
                {q.question}
              </label>
              {hint && <p className="text-xs text-zinc-500">{hint}</p>}
              <div className="mt-2">
                {q.kind === "flag" ? (
                  <TriState value={value} onChange={(v) => set(q.key, v)} label={q.question} />
                ) : q.kind === "wiring" ? (
                  <select id={id} value={value} onChange={(e) => set(q.key, e.target.value)} className={inputClass}>
                    <option value="">nie wiadomo</option>
                    {WIRING_TYPES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                ) : q.kind === "longtext" ? (
                  <textarea
                    id={id}
                    value={value}
                    onChange={(e) => set(q.key, e.target.value)}
                    rows={2}
                    placeholder={q.placeholder}
                    className={inputClass}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      id={id}
                      type={q.kind === "number" ? "number" : "text"}
                      value={value}
                      onChange={(e) => set(q.key, e.target.value)}
                      placeholder={q.placeholder}
                      className={q.kind === "number" ? `${inputClass} max-w-[10rem]` : inputClass}
                    />
                    {q.unit && <span className="shrink-0 text-sm text-zinc-500">{q.unit}</span>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Komentarz</span>
        <textarea value={values.comment} onChange={(e) => set("comment", e.target.value)} rows={4} className={inputClass} />
      </label>
    </>
  );
}

export function ListingDetailsModal({
  row: rowProp,
  onClose,
  onSubmit,
  onEnriched,
}: {
  row: ListingWithPrev | null;
  onClose: () => void;
  /** Saves the fields (creates the listing when id is null); resolves to its id, rejects when refused. */
  onSubmit: (id: number | null, fields: ListingFormFields) => Promise<number>;
  /** Reloads the listings after a re-run of the enrichment for this offer. */
  onEnriched?: () => Promise<void> | void;
}) {
  // A save can hide the row from the reloaded table (e.g. dedup), so keep
  // showing the last row we had instead of flipping to „Nowa oferta”.
  const [lastRow, setLastRow] = useState(rowProp);
  if (rowProp && rowProp !== lastRow) setLastRow(rowProp);
  const row = rowProp ?? lastRow;

  const [values, setValues] = useState<FormState>(() => toFormState(row));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [questionnaire, setQuestionnaire] = useState(loadQuestionnaireMode);

  function toggleQuestionnaire() {
    setQuestionnaire((on) => {
      try {
        window.localStorage.setItem(QUESTIONNAIRE_KEY, on ? "0" : "1");
      } catch {
        // localStorage unavailable — the mode just won't be remembered
      }
      return !on;
    });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (row?.id == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    fetch(`/api/listings/${row.id}/history`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setHistory(data.history ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row?.id]);

  // ── Autosave ────────────────────────────────────────────────────────────
  // Saves are serialized (a slow PATCH never lands after a newer one) and
  // skipped when nothing changed since the last successful save. A new offer
  // is created by its first non-empty save and PATCHed from then on.
  const listingIdRef = useRef<number | null>(row?.id ?? null);
  const valuesRef = useRef(values);
  const savedJsonRef = useRef(JSON.stringify(toFields(values)));
  const emptyJsonRef = useRef(JSON.stringify(toFields(toFormState(null))));
  const inFlightRef = useRef<Promise<void> | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const lastKeyRef = useRef<keyof FormState | null>(null);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const flush = useCallback(async () => {
    for (;;) {
      if (inFlightRef.current) {
        await inFlightRef.current;
        continue;
      }
      const fields = toFields(valuesRef.current);
      const json = JSON.stringify(fields);
      if (json === savedJsonRef.current) return;
      if (listingIdRef.current == null && json === emptyJsonRef.current) return;

      let failed = false;
      setSaveStatus("saving");
      inFlightRef.current = onSubmitRef
        .current(listingIdRef.current, fields)
        .then((id) => {
          listingIdRef.current = id;
          savedJsonRef.current = json;
          setSaveStatus("saved");
        })
        .catch(() => {
          failed = true;
          setSaveStatus("error");
        })
        .finally(() => {
          inFlightRef.current = null;
        });
      await inFlightRef.current;
      // Don't retry a refused save in a loop — the next edit tries again.
      if (failed) return;
    }
  }, []);

  useEffect(() => {
    valuesRef.current = values;
    // Every saved price change becomes a price_history row, so the price
    // waits for blur/close rather than saving half-typed numbers.
    if (lastKeyRef.current == null || lastKeyRef.current === "pricePln") return;
    const t = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [values, flush]);

  // Closing (Escape, backdrop, button, after enrichment) never loses edits.
  useEffect(() => () => void flush(), [flush]);

  function set<K extends keyof FormState>(key: K, value: string) {
    lastKeyRef.current = key;
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleEnrich() {
    if (!row) return;
    setEnriching(true);
    setEnrichError(null);
    try {
      // Enrichment only fills empty columns, so persist what the user typed first.
      await flush();
      const res = await fetch(`/api/listings/${row.id}/enrich`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setEnrichError(data.error ?? "Nie udało się pobrać danych z ogłoszenia.");
        return;
      }
      await onEnriched?.();
      onClose();
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : "Błąd uzupełniania danych.");
    } finally {
      setEnriching(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className={`flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 ${
          row ? "max-w-3xl" : "max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{row ? "Szczegóły oferty" : "Nowa oferta (ręcznie)"}</h2>
          {row && (
            <p className="text-xs text-zinc-500">
              {SOURCE_LABELS[row.source]} · {fmt(row.price_pln)} zł
              {row.source_url && (
                <>
                  {" · "}
                  <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline visited:text-purple-700 dark:text-blue-400 dark:visited:text-purple-400">
                    otwórz ogłoszenie ↗
                  </a>
                </>
              )}
            </p>
          )}
        </div>
          <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-sm">
            <span className="font-medium">Kwestionariusz</span>
            <button
              type="button"
              role="switch"
              aria-checked={questionnaire}
              onClick={toggleQuestionnaire}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                questionnaire ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-700"
              }`}
            >
              <span
                aria-hidden
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform dark:bg-zinc-900 ${
                  questionnaire ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        </div>

        <div className={row ? "flex flex-col gap-6 md:flex-row md:items-start" : "flex flex-col gap-4"}>
        <div className="flex flex-1 flex-col gap-4">
        {questionnaire ? (
          <QuestionnaireFields row={row} values={values} set={set} />
        ) : (
        <>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tytuł</span>
          <input type="text" value={values.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Link do ogłoszenia</span>
          <input
            type="text"
            value={values.sourceUrl}
            onChange={(e) => set("sourceUrl", e.target.value)}
            className={inputClass}
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex w-32 flex-col gap-1 text-sm">
            <span className="font-medium">Cena (zł)</span>
            <input
              type="number"
              value={values.pricePln}
              onChange={(e) => set("pricePln", e.target.value)}
              onBlur={() => void flush()}
              className={inputClass}
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="font-medium">Pow. (m²)</span>
            <input
              type="number"
              value={values.areaM2}
              onChange={(e) => set("areaM2", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex w-24 flex-col gap-1 text-sm">
            <span className="font-medium">Pokoje</span>
            <input type="number" value={values.rooms} onChange={(e) => set("rooms", e.target.value)} className={inputClass} />
          </label>
          <label className="flex w-24 flex-col gap-1 text-sm">
            <span className="font-medium">Piętro (opis)</span>
            <input type="text" value={values.floor} onChange={(e) => set("floor", e.target.value)} className={inputClass} />
          </label>
          <label className="flex w-24 flex-col gap-1 text-sm">
            <span className="font-medium">Piętro (nr)</span>
            <input
              type="number"
              value={values.floorNum}
              onChange={(e) => set("floorNum", e.target.value)}
              title="0 = parter, -1 = suterena"
              className={inputClass}
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="font-medium">Pięter w bud.</span>
            <input
              type="number"
              value={values.totalFloors}
              onChange={(e) => set("totalFloors", e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Prawo własności</span>
            <select
              value={values.ownershipType}
              onChange={(e) => set("ownershipType", e.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {OWNERSHIP_TYPES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Stan wykończenia</span>
            <select
              value={values.conditionState}
              onChange={(e) => set("conditionState", e.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {CONDITION_STATES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="font-medium">Rok budowy</span>
            <input
              type="number"
              value={values.yearBuilt}
              onChange={(e) => set("yearBuilt", e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          {FLAG_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex w-36 flex-col gap-1 text-sm">
              <span className="font-medium">{label}</span>
              <select value={values[key]} onChange={(e) => set(key, e.target.value)} className={inputClass}>
                <option value="">nie wiadomo</option>
                <option value="1">tak</option>
                <option value="0">nie</option>
              </select>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Lokalizacja</span>
            <select value={values.district} onChange={(e) => set("district", e.target.value)} className={inputClass}>
              <option value="">—</option>
              <optgroup label="Warszawa">
                {WARSAW_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Okolice Warszawy">
                {TOWN_NAMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Adres</span>
            <input
              type="text"
              value={values.addressRaw}
              onChange={(e) => set("addressRaw", e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Data ogłoszenia</span>
          <input
            type="text"
            value={values.listingDate}
            onChange={(e) => set("listingDate", e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Komentarz</span>
          <textarea value={values.comment} onChange={(e) => set("comment", e.target.value)} rows={4} className={inputClass} />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Kontakt — imię</span>
            <input
              type="text"
              value={values.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Kontakt — telefon</span>
            <input
              type="tel"
              value={values.contactPhone}
              onChange={(e) => set("contactPhone", e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Czynsz (zł)</span>
          <input type="number" value={values.czynsz} onChange={(e) => set("czynsz", e.target.value)} className="w-32 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800" />
        </label>

        </>
        )}
        </div>

        {row && (
          <div className="flex w-full flex-col gap-2 md:w-64 md:shrink-0 md:border-l md:border-zinc-200 md:pl-6 dark:md:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Uzupełnianie danych</h3>
            <p className="text-xs text-zinc-500">
              {row.enriched_at
                ? `${ENRICH_STATUS_LABELS[row.enrich_status ?? ""] ?? row.enrich_status ?? "—"}${row.enrich_model ? ` (${row.enrich_model})` : ""}`
                : "jeszcze nieuzupełnione"}
            </p>
            <button
              onClick={handleEnrich}
              disabled={enriching || row.source === "manual"}
              className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
              {enriching ? "Uzupełnianie…" : "Uzupełnij dane (AI)"}
            </button>
            {enrichError && <p className="text-xs text-red-600">{enrichError}</p>}
            {row.description && (
              <details className="text-xs text-zinc-600 dark:text-zinc-400">
                <summary className="cursor-pointer font-medium">Opis ogłoszenia</summary>
                <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-line">{row.description}</p>
              </details>
            )}

            <h3 className="mt-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Historia scrapowania</h3>
            <HistoryTimeline history={history} loading={historyLoading} />
          </div>
        )}

        </div>

        <div className="flex items-center justify-between gap-2">
          <p
            aria-live="polite"
            className={`text-xs ${
              saveStatus === "error" ? "text-red-600" : saveStatus === "saved" ? "text-green-600" : "text-zinc-500"
            }`}
          >
            {SAVE_STATUS_LABELS[saveStatus]}
          </p>
          <button onClick={onClose} className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700">
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
