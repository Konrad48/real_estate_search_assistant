"use client";

// The map half of the listings view: Leaflet with OpenStreetMap tiles, one dot
// per offer that has coordinates. Leaflet touches `window` when imported, so
// the library is loaded inside an effect; only its stylesheet is static.
// Opening the map also starts the locate pass (/api/searches/[id]/locate) for
// offers never located before, drawing their dots as they arrive.
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_LABELS, type ListingWithPrev } from "./types";

const WARSAW_CENTER: Leaflet.LatLngTuple = [52.2297, 21.0122];

type LocateStatus =
  | { state: "idle" }
  | { state: "running"; done: number; total: number }
  | { state: "done" }
  | { state: "failed" };

interface Point {
  row: ListingWithPrev;
  lat: number;
  lon: number;
}

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("pl-PL", { maximumFractionDigits: 0 });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function tooltipHtml(row: ListingWithPrev): string {
  const title = row.title ?? SOURCE_LABELS[row.source];
  const short = title.length > 60 ? `${title.slice(0, 57)}…` : title;
  const rooms = row.rooms ? ` · ${row.rooms} pok.` : "";
  return `<strong>${fmt(row.price_pln)} zł</strong> · ${fmt(row.area_m2)} m²${rooms}<br>${escapeHtml(short)}`;
}

function markerStyle(row: ListingWithPrev, highlighted: boolean): Leaflet.CircleMarkerOptions {
  if (highlighted) {
    return { radius: 10, color: "#7f1d1d", weight: 3, fillColor: "#ef4444", fillOpacity: 1 };
  }
  const fill = !row.is_active || row.is_disliked ? "#a1a1aa" : row.is_starred ? "#eab308" : "#2563eb";
  return { radius: 6, color: "#ffffff", weight: 1.5, fillColor: fill, fillOpacity: 0.9 };
}

function fitTo(map: Leaflet.Map, L: typeof Leaflet, points: Point[]) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lon], 15);
    return;
  }
  const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as Leaflet.LatLngTuple));
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}

export function ListingsMap({
  searchId,
  rows,
  allRows,
  highlightId,
  onHover,
  onSelect,
  onLocated,
}: {
  searchId: number;
  /** Offers the table currently shows (filtered + sorted) — the ones drawn. */
  rows: ListingWithPrev[];
  /** Every fetched offer, used to tell whether any still needs locating. */
  allRows: ListingWithPrev[];
  highlightId: number | null;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
  /** Called when a locate run finishes, so the rows can be refetched with coordinates. */
  onLocated: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const markersRef = useRef(new Map<number, { marker: Leaflet.CircleMarker; row: ListingWithPrev }>());
  const highlightedRef = useRef<number | null>(null);
  const fittedRef = useRef(false);
  const handlersRef = useRef({ onHover, onSelect, onLocated });
  const [mapVersion, setMapVersion] = useState(0);
  const [located, setLocated] = useState<Map<number, { lat: number; lon: number }>>(() => new Map());
  const [status, setStatus] = useState<LocateStatus>({ state: "idle" });

  // Marker event handlers are bound once per marker; read the latest callbacks.
  useEffect(() => {
    handlersRef.current = { onHover, onSelect, onLocated };
  });

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    const markers = markersRef.current;

    import("leaflet").then((mod) => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
      if (cancelled || !containerRef.current) return;
      map = L.map(containerRef.current, { preferCanvas: true }).setView(WARSAW_CENTER, 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      leafletRef.current = L;
      mapRef.current = map;
      fittedRef.current = false;
      setMapVersion((v) => v + 1);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markers.clear();
      highlightedRef.current = null;
    };
  }, []);

  const points = useMemo<Point[]>(
    () =>
      rows.flatMap((row) => {
        const coords = row.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : located.get(row.id);
        return coords ? [{ row, ...coords }] : [];
      }),
    [rows, located]
  );

  // Add/update/remove markers to match the drawn offers.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const markers = markersRef.current;
    const seen = new Set<number>();

    for (const p of points) {
      const id = p.row.id;
      seen.add(id);
      const highlighted = id === highlightedRef.current;
      const existing = markers.get(id);
      if (existing) {
        existing.marker.setLatLng([p.lat, p.lon]);
        existing.marker.setStyle(markerStyle(p.row, highlighted));
        existing.marker.setTooltipContent(tooltipHtml(p.row));
        existing.row = p.row;
      } else {
        const marker = L.circleMarker([p.lat, p.lon], markerStyle(p.row, highlighted))
          .bindTooltip(tooltipHtml(p.row), { direction: "top", offset: [0, -6] })
          .on("mouseover", () => handlersRef.current.onHover(id))
          .on("mouseout", () => handlersRef.current.onHover(null))
          .on("click", () => handlersRef.current.onSelect(id))
          .addTo(map);
        markers.set(id, { marker, row: p.row });
      }
    }
    for (const [id, entry] of markers) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
  }, [points, mapVersion]);

  // Light up the hovered offer's dot (hovered on the map or in the table).
  useEffect(() => {
    const markers = markersRef.current;
    const previous = highlightedRef.current;
    if (previous === highlightId) return;
    const prevEntry = previous != null ? markers.get(previous) : undefined;
    if (prevEntry) {
      prevEntry.marker.setStyle(markerStyle(prevEntry.row, false));
      prevEntry.marker.closeTooltip();
    }
    highlightedRef.current = highlightId;
    const entry = highlightId != null ? markers.get(highlightId) : undefined;
    if (entry) {
      entry.marker.setStyle(markerStyle(entry.row, true));
      entry.marker.bringToFront();
      entry.marker.openTooltip();
    }
  }, [highlightId, mapVersion]);

  const pendingKey = useMemo(() => {
    const pending = allRows.filter((r) => r.is_active === 1 && r.lat == null && r.geocoded_at == null);
    return pending.length === 0 ? "" : `${pending.length}:${pending[0].id}:${pending[pending.length - 1].id}`;
  }, [allRows]);

  // Locate offers that have never been located; dots appear as results stream in.
  useEffect(() => {
    if (!pendingKey) return;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/searches/${searchId}/locate`, { method: "POST", signal: controller.signal });
        if (!res.ok || !res.body) {
          setStatus({ state: "failed" });
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
          const found: [number, { lat: number; lon: number }][] = [];
          for (const line of lines) {
            if (!line.trim()) continue;
            const evt = JSON.parse(line);
            if (evt.type === "start") {
              setStatus(evt.total > 0 ? { state: "running", done: 0, total: evt.total } : { state: "done" });
            } else if (evt.type === "progress") {
              setStatus({ state: "running", done: evt.done, total: evt.total });
            } else if (evt.type === "located") {
              found.push([evt.id, { lat: evt.lat, lon: evt.lon }]);
            } else if (evt.type === "done") {
              setStatus({ state: evt.failed ? "failed" : "done" });
            } else if (evt.type === "fatal") {
              setStatus({ state: "failed" });
            }
          }
          if (found.length > 0) {
            setLocated((prev) => {
              const next = new Map(prev);
              for (const [id, coords] of found) next.set(id, coords);
              return next;
            });
          }
        }
        // A stream can end without "done" (a newer run took over); don't stay "running".
        setStatus((s) => (s.state === "running" || s.state === "idle" ? { state: "done" } : s));
        handlersRef.current.onLocated();
      } catch {
        if (!controller.signal.aborted) setStatus({ state: "failed" });
      }
    })();

    return () => controller.abort();
  }, [searchId, pendingKey]);

  // Frame all dots once — after the first locate run, not on its first result.
  const locating = status.state === "running" || (pendingKey !== "" && status.state === "idle");
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || fittedRef.current || locating || points.length === 0) return;
    fitTo(map, L, points);
    fittedRef.current = true;
  }, [points, locating, mapVersion]);

  const missing = rows.length - points.length;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div ref={containerRef} className="h-full w-full" />
      <button
        onClick={() => {
          const L = leafletRef.current;
          const map = mapRef.current;
          if (L && map) fitTo(map, L, points);
        }}
        className="absolute right-2 top-2 z-[1000] rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs shadow dark:border-zinc-700 dark:bg-zinc-900"
      >
        Pokaż wszystkie
      </button>
      <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded bg-white/90 px-2 py-1 text-xs text-zinc-700 shadow dark:bg-zinc-900/90 dark:text-zinc-300">
        Na mapie: {points.length} z {rows.length} ofert
        {locating && (
          <>
            {" "}
            · ustalanie lokalizacji
            {status.state === "running" ? ` ${status.done}/${status.total}` : ""}…
          </>
        )}
        {status.state === "failed" && <> · nie udało się ustalić części lokalizacji</>}
        {!locating && missing > 0 && <span className="block text-zinc-500">{missing} bez dokładnego adresu</span>}
      </div>
    </div>
  );
}
