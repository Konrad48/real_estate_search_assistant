# Wyszukiwarka mieszkań — Warszawa i okolice (Warsaw Flat Finder)

A personal, localhost-only tool for finding a flat to buy in Warszawa — 
optionally narrowed to districts — and/or Piastów, Pruszków, Brwinów,
Komorów, Michałowice, Milanówek, Grodzisk Mazowiecki, price range, area range, and sources;
scraping a list fetches matching offers from Otodom, OLX, Adresowo, Sprzedajemy, and
Gratka — filtered at the source website where possible — into a local SQLite database.
Re-scraping a list updates it in place and **keeps price history** so you can see how
offer prices change over time. The UI is in Polish.

## Getting started

```bash
npm install
npx playwright install chromium   # optional - only if a scraper ever needs a JS-rendering fallback
npm run dev
```

Open [http://localhost:3000](http://localhost:3000):
1. **＋ Nowa lista** — under **Lokalizacje** tick **Warszawa** (and, optionally, its
   Dzielnice — none ticked = the whole city) and/or any of the towns below it; pick
   price/area ranges and sources. Save. A list needs Warszawa or at least one town.
2. **Scrapuj** — fetches matching offers; per-source status streams live.
3. Browse the results table: sort by any column, narrow it with **Filtry** (every field:
   ranges for cena/powierzchnia/piętro/rok, chips for źródło/lokalizacja/prawo własności,
   tak/nie/brak danych for balkon/parking/winda, substring for tytuł/adres/komentarz),
   pick visible columns with **Kolumny**, **★** star offers, **👎** reject offers (they get an
   `odrzucone` tag and disappear while *Ukryj nieaktywne* is ticked; untick it to see and
   restore them — rejecting removes the star and vice versa), watch price-change badges
   (`▼ −40 000`) on re-scrape, and export the list with **Eksport do Excela**.

   Filters run in the browser over the offers already loaded and are saved in
   localStorage (`listingsTable.filters`), so they survive a reload and an app restart —
   the button shows how many are active and the toolbar says how many offers they hide.
   The Excel export ignores them and always writes the whole list.

Data lands in `data/listings.db` (gitignored). Deleting that file resets everything.

## Mapa

**Mapa** (next to **Kolumny**) shrinks the table to a third of the width and shows the
offers on an OpenStreetMap map (Leaflet) in the other two thirds. It draws exactly the
offers the table shows, so **Filtry**, *Tylko ★* and *Ukryj nieaktywne* apply to it too.
Hovering a dot lights up its row (the table scrolls to it), hovering a row lights up its
dot, and clicking a dot opens the offer. Dots: blue, ★ yellow, nieaktualne/odrzucone grey.

An offer gets a dot only when its location is actually known:

- **OLX** — the pin OLX itself shows, when the seller made it exact (otherwise OLX only
  marks an area a few km wide, which is ignored).
- **Otodom / Gratka / Adresowo / ręcznie dodane** — the street from the address, looked
  up with OpenStreetMap's [Nominatim](https://nominatim.org/). A result counts only if
  Nominatim places it in the offer's own district/town.
- Offers that state only a district or town, and **Sprzedajemy** (no address field), get
  no dot — the corner of the map says how many are left out.

Locating runs when you open the map, not during scraping: Nominatim's usage policy allows
one request per second, so the first open of a big list takes a few minutes (progress
shows on the map, dots appear as they're found). Every answer is cached in the
`geocode_cache` table and each offer is looked up once, so later opens are instant.
Editing an offer's address clears its position so it's located again.

## Uzupełnianie danych (offer pages + AI)

The search-results cards the scrapers read carry only price/area/rooms — not the
**forma własności** (prawo własności), the floor, the czynsz, or the description. So
after every scrape the app fetches each *new* offer's own page and fills in:

| kolumna | skąd |
|---|---|
| `ownership_type` (Prawo własności) | Otodom `building_ownership`, else the description via AI |
| `floor_num` / `total_floors` | offer page (`floor`), else AI |
| `czynsz` | offer page (`rent`), else AI |
| `year_built`, `condition_state` | offer page, else AI |
| `has_balcony`, `has_parking`, `has_elevator` | offer page `extras_types`/`lift`, else AI |

The AI step is a **fallback only**: it runs on the offer description, is asked *only*
for fields the page did not state outright, and is told to answer `null` rather than
guess. Its answers are re-parsed through the same normalizers the scrapers use, and
a value from the offer page always wins. Otodom offers are usually fully covered
without any AI call; OLX/Gratka/Adresowo/Sprzedajemy lean on it.

Configure it by copying `.env.example` to `.env.local`:

```
OPENAI_API_KEY=sk-…          # without it, the AI step is skipped (app still works)
OPENAI_MODEL=gpt-5-nano      # cheap extraction model
ENRICH_MAX_PER_RUN=200       # offers enriched per scrape run
```

**Each offer is enriched at most once.** Only offers with `enriched_at IS NULL` are
processed, so re-scraping a list re-checks prices and nothing else — no offer-page
fetch and no AI call, including for offers whose columns stayed empty because the
description simply never mentioned them (asking again would return the same "nie
podano" and only cost money). `enrich_model` records that the model was consulted,
hit or miss. An offer whose page could not be read is marked
`enrich_status = 'failed'` and skipped next time — retry it with the
**„Uzupełnij dane (AI)"** button in the offer modal, or from the CLI:

```bash
npm run enrich                        # pending offers in every list
npm run enrich -- --search 3          # one list
npm run enrich -- --search 3 --force  # re-read offer pages already enriched
npm run enrich -- --ai-only           # ask the AI about gaps in offers it has never
                                      # seen, using descriptions already in the DB
                                      # (no fetches) — run this after adding an API
                                      # key. Add --force to re-ask about offers the
                                      # model has already been given.
```

## Debugging a scraper without the UI

```bash
npm run scrape -- --source otodom --districts "Mokotów,Śródmieście" --min-price 500000 --max-price 900000
npm run scrape -- --source olx --districts Mokotów
npm run scrape -- --source all --districts Wola   # all sources into one throwaway list
npm run scrape -- --source gratka --towns "Pruszków,Piastów" --no-warsaw
npm run dedup                                     # re-dedup every existing saved list in the DB
npm run backfill-sources                          # add newly implemented sources to existing lists
```

A list's `sources` is a snapshot taken when it was created, so lists made before a new
source existed will never scrape it. `npm run backfill-sources` adds any missing
implemented source to every saved list (idempotent). The status row also renders a muted
`wyłączone` chip for sources a list has switched off, so a skipped source is always
visible rather than silently absent.

Flags: `--source <id|all>`, `--districts A,B` (canonical Polish names), `--towns A,B`
(canonical names from `lib/towns.ts`), `--no-warsaw` (towns only), `--min-price`,
`--max-price`, `--min-area`, `--max-area`, `--max-pages` (default 2), `--search <id>`
(scrape into an existing saved list instead of creating a throwaway one). Prints
per-source counts and a sample normalized listing — much faster to iterate on than
the browser.

## Location filtering at the source

Warsaw districts (verified 2026-07-18):

- **Otodom** — district as a URL path segment (`.../warszawa/mokotow`).
- **OLX** — `search[district_id]=<id>` (numeric map in `OLX_DISTRICT_ID`).
- **Gratka** — district as a URL path segment (`.../warszawa/mokotow`, same slug as
  `slugify()`); price/area not filterable at source → post-filtered.
- **Adresowo / Sprzedajemy** — no reliable source-side district filter; scraped
  city-wide and narrowed by `applyCriteria`. Multi-district lists loop districts.

Towns (verified 2026-09-14, table in `lib/towns.ts`):

| | Otodom | OLX | Gratka | Adresowo | Sprzedajemy |
|---|---|---|---|---|---|
| Piastów | ✓ | ✓ | ✓ | — | ✓ |
| Pruszków | ✓ | ✓ | ✓ | ✓ | ✓ |
| Brwinów | ✓ | ✓ | ✓ | — | ✓ |
| Komorów | ✓ | ✓ (`komorow_117329`) | county page | — | — |
| Michałowice | ✓ | ✓ (`michalowice_101993`) | county page | — | — |
| Milanówek | ✓ | ✓ | ✓ | — | — |
| Grodzisk Mazowiecki | ✓ | ✓ | ✓ | — | ✓ |

Otodom uses the location path (`mazowieckie/pruszkowski/piastow/piastow`), OLX the
city slug, Gratka `/nieruchomosci/mieszkania/<slug>`, Adresowo `/mieszkania/<slug>/`,
Sprzedajemy `/<slug>/nieruchomosci/mieszkania/sprzedaz`. "County page" = Gratka resolves
the name to a same-named place elsewhere in Poland, so it reads the `pruszkowski`
county page instead and keeps offers from known towns. "—" = the site serves a
nationwide fallback for that town, so the source skips it. Town result pages are padded
with nearby/nationwide offers, so every town pass keeps only offers whose address
resolves to a known town.

## Adding or fixing a scraper

1. Fetch a live search page (`curl -A "Mozilla/5.0 ..." <url>`) and check for an
   embedded JSON blob (`__NEXT_DATA__`, `__PRERENDERED_STATE__`) — JSON-first is far
   more robust than CSS selectors. Otodom/OLX have one; Adresowo/Sprzedajemy/Gratka don't
   (Gratka is Nuxt but SSRs clean HTML cards with stable `data-cy` test ids).
2. When parsing HTML, prefer `data-*` attributes over utility CSS classes.
3. Update the file's header comment with the last-verified date and where the
   selectors/JSON path came from.
4. Test with `npm run scrape -- --source <name> --districts …` (and `--towns …`) before wiring in.

## Known limitations

- **Adresowo / Sprzedajemy yield little for narrow lists.** They can't filter at
  source, so the shared post-filter drops most of a city-wide page — expect few
  (sometimes zero) results from them for a tight district/price/area list. This is
  by design per the scraping posture below.
- **Town coverage is uneven.** Komorów and Michałowice are small: Otodom/OLX have a
  handful of offers there at most, Gratka only sees them if they make its county page
  (~35 offers across the whole county), and Adresowo/Sprzedajemy skip them. Adresowo
  covers only Pruszków among the towns.
- **Sprzedajemy has no working pagination** (all page URLs return page 1), so it's
  capped at ~30 raw listings per location per scrape before filtering.
- **Gratka is page-1-per-location only.** Its `robots.txt` disallows paginated URLs
  (`*page=*`) and its price/area filter params, so — per the scraping posture below —
  the scraper fetches only the first page of each district/town (~32 offers) and
  post-filters price/area. High-inventory locations are truncated. Its card areas are
  integer-rounded, so cross-service dedup with Otodom/OLX can occasionally miss by 1 m²
  (negligible, since cross-service titles usually differ anyway).
- **OLX rate-limits bursts** with a 403, so a list with many districts/towns scrapes OLX
  slowly (passes are spaced ~2–3 s apart) and can still lose a pass to a 403.
- `rooms` and `floor` are read as-published per site and not cross-validated.
- **Enrichment is best-effort.** Fields the offer never states stay `NULL` (shown as
  `—`), and `has_*` columns distinguish "nie" from "nie wiadomo". Only Otodom exposes
  `building_ownership` as structured data; elsewhere the forma własności comes from
  the description via AI, so it is only as reliable as what the seller wrote.
- **Enrichment costs one page fetch per new offer**, so the first scrape of a big list
  is noticeably slower than before (sequential + polite delay, like the scrapers).

## Scraping posture

Single-user, on-demand, low-volume personal tool — not a crawler. `lib/http.ts`
sends an honest User-Agent, checks `robots.txt` best-effort (`lib/robots.ts`,
fail-open), and adds a small randomized delay between requests. Sources run
sequentially and page counts are capped (`maxPages`, default 5). No CAPTCHA/anti-bot
evasion — if a site persistently blocks the polite path, prefer dropping it.
