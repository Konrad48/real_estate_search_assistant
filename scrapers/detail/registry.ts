// Single wiring point for offer-page fetchers, mirroring scrapers/registry.ts.
// Adding a source means adding its DetailFetcher here too — TS enforces it
// via Record<SourceId, DetailFetcher>.
import { makeHtmlDetailFetcher } from "./html";
import { olxDetailFetcher } from "./olx";
import { otodomDetailFetcher } from "./otodom";
import type { DetailFetcher, SourceId } from "./types";

export const DETAIL_FETCHERS: Record<SourceId, DetailFetcher> = {
  otodom: otodomDetailFetcher,
  olx: olxDetailFetcher,
  adresowo: makeHtmlDetailFetcher("adresowo"),
  sprzedajemy: makeHtmlDetailFetcher("sprzedajemy"),
  gratka: makeHtmlDetailFetcher("gratka"),
};
