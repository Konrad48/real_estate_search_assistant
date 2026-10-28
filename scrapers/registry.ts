import { adresowoScraper } from "./adresowo";
import { gratkaScraper } from "./gratka";
import { olxScraper } from "./olx";
import { otodomScraper } from "./otodom";
import { sprzedajemyScraper } from "./sprzedajemy";
import type { Scraper, SourceId } from "./types";

export const SOURCES: Record<SourceId, Scraper> = {
  otodom: otodomScraper,
  olx: olxScraper,
  adresowo: adresowoScraper,
  sprzedajemy: sprzedajemyScraper,
  gratka: gratkaScraper,
};

export const IMPLEMENTED_SOURCES: SourceId[] = Object.keys(SOURCES) as SourceId[];
