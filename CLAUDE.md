# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal, localhost-only Next.js app for finding a flat to buy in Warsaw and a
few western suburbs. The user defines **saved lists** (searches), each with its own
locations (Warszawa — optionally narrowed to districts — and/or towns like Pruszków),
price range, area range, and sources; scraping a list pulls matching offers from
Otodom, OLX, Adresowo, Sprzedajemy, and Gratka into a local SQLite DB, keeps **price
history** across scrapes, and lets the user **star** offers. **The UI is in Polish** —
keep all user-facing strings Polish. No deployment, no auth, single machine, one user.

## Commands

```bash
npm run dev                          # start the app at localhost:3000
npm run build && npm run start       # production build/run
npm run lint                         # eslint (flat config, eslint-config-next)
npx tsc --noEmit                     # typecheck
# Debug a scraper straight into a throwaway (or existing) saved list:
npm run scrape -- --source otodom --districts "Mokotów,Śródmieście" --min-price 500000 --max-price 900000
npm run scrape -- --source all --districts Wola --search 3
npm run scrape -- --source gratka --towns "Pruszków,Piastów" --no-warsaw
npm run dedup                        # re-dedup all existing saved lists in the DB
npm run backfill-sources             # add newly implemented sources to existing saved lists
npm run enrich                       # backfill offer-page/AI enrichment (--search N, --force, --ai-only)
```

No test suite. `scripts/scrape-cli.ts` is the fast scraper-iteration loop.

## Architecture

Data flows: **saved search → scrapers (source-side filter) → normalize →
`applyCriteria` post-filter → upsert (with price history) → enrichment
(offer page → AI for the gaps) → Polish UI**.

- **Saved-lists data model.** `searches` holds parameters (`include_warsaw` 1/0,
  districts/towns/sources JSON, price/area bounds). Districts only apply when
  `include_warsaw=1` ([] = whole city); a list needs Warsaw or at least one town.
  `listings` are scoped by `search_id`
  (`UNIQUE(search_id, source, source_id)`) — the same flat can appear in multiple
  lists independently, and starring is per-list. `listings.district` holds the matched
  location: a Warsaw district **or** a town name. `price_history` gets a row on first
  insert and whenever `price_pln` changes. `is_active=0` marks "no longer listed"
  (nieaktualne) — gone offers are kept, not deleted. `is_disliked=1` is the user's 👎
  (odrzucone, per list, toggled via `listings/[id]/dislike`); star and dislike exclude
  each other, and `queryListings({activeOnly})` ("Ukryj nieaktywne") hides both gone and
  disliked rows. **Dedup:** cross-posted/repeated
  offers are collapsed by `recomputeDuplicates(searchId)` (`db/listings-repo.ts`, run
  after every scrape) — group by `dedupKey(title, area)` (`lib/dedup.ts`), keep one
  survivor (starred → active → cheapest → first, survivor inherits the star — and the
  dislike, unless the group is starred), mark the
  rest `is_duplicate=1`/`duplicate_of`. `queryListings` hides `is_duplicate=1` by
  default; `getDuplicateInfo` feeds the `też:` tag. Fully idempotent, so it self-heals
  on re-scrape. `npm run dedup` re-runs it across all existing lists.
- `scrapers/*.ts` - one module per site implementing `Scraper` (`source` +
  `search(criteria)`); the only code that knows site-specific markup/JSON.
  `scrapers/registry.ts` is the single wiring point. Otodom/OLX/Gratka run one
  **location pass** per Warsaw district (or one whole-city pass) and per town
  (`locationPasses` in `lib/towns.ts`). Otodom/OLX filter location + price/area
  **at the source URL** (path segment / `district_id` / town slug); Gratka filters
  location at source (URL path, page 1 only — `robots.txt` disallows pagination) but not
  price/area; Adresowo/Sprzedajemy scrape Warsaw city-wide plus a page per town where
  the site has one. Town passes keep only offers located in a known town
  (`isTownAddress`) — town result pages pad with nearby/nationwide offers. Adding a
  source = new `scrapers/<name>.ts` + add the `SourceId` to
  `db/schema.ts`, `scrapers/registry.ts`, `lib/validate.ts` (both enums), and
  `app/components/types.ts` (`ALL_SOURCES` + `SOURCE_LABELS`); TS flags any spot missed.
  Also add its field to `TownSources` in `lib/towns.ts`.
  **Then run `npm run backfill-sources`** — a saved list's `sources` is a JSON snapshot
  frozen at creation, so existing lists would otherwise silently never scrape the new
  source. `ScrapeProgress` renders a chip for every `ALL_SOURCES` entry, showing a muted
  `wyłączone` for ones the list has off, so that gap is visible rather than invisible.
- `lib/filter.ts` `applyCriteria` - shared post-filter run on **every** source's
  results so locations/price/area are enforced uniformly (essential for the sources
  that can't filter at source). A selected town always passes; Warsaw rows pass only
  with `includeWarsaw` (chosen districts, or any district/unmatched row for the whole
  city — but never an unselected town). Always applied in `lib/scrape-runner.ts`.
- **Enrichment.** Search-results cards carry no description, forma własności, czynsz
  or reliable floor, so after each scrape `lib/enrich-runner.ts` fetches the offer
  page of every listing with `enriched_at IS NULL` (`scrapers/detail/<source>.ts`,
  wired in `scrapers/detail/registry.ts`), takes what it states outright, and asks
  OpenAI (`lib/ai/enrich.ts`, `gpt-5-nano` by default) **only** for the fields still
  null — structured data always wins, no key = AI silently skipped. Results go through
  `updateEnrichment` (`db/listings-repo.ts`), which only fills columns that are still
  NULL, so scrapes and hand edits are never clobbered; `UPDATE_SQL` deliberately does
  not touch the enrichment columns. Canonical values live in `lib/ownership.ts`
  (`OWNERSHIP_TYPES`) and `lib/normalize.ts` (`CONDITION_STATES`, floor parsing).
  `has_*` columns are 1/0/**null**, where null means "the offer never said". **The
  model is asked about an offer at most once**: `enrich_model` is stamped on every
  attempt (hit or miss), `enriched_at` keeps later scrapes from re-fetching the page,
  and `listingsWithGaps` skips rows that already have `enrich_model` — only an
  explicit `--force` or the modal button asks again.
  `lib/page-json.ts` holds the `__NEXT_DATA__`/`__PRERENDERED_STATE__`/`htmlToText`
  helpers shared by both scraper layers. Adding an enrichable field = new column in
  `001_init.sql` **and** `ensureColumns` (db/client.ts), `EnrichedFields` +
  `ENRICHED_FIELD_KEYS` + `ListingRow` (db/schema.ts), the detail fetchers, the AI
  schema, `updateEnrichment`, `ListingFieldsInput`/`listingFieldsSchema`, the table
  columns/modal, and the export lists.
- **Kwestionariusz.** A switch in the offer modal (remembered in localStorage
  `listingDetails.questionnaire`) swaps the form for the phone-call questions
  (`QUESTIONS` in `ListingDetailsModal.tsx`). Answers are user-entered-only columns
  (`has_land_register`, `land_register_number`, `land_regulated`, `has_encumbrance`,
  `layout`, `price_negotiable`, `flooring`, `wiring` — `WIRING_TYPES` in
  `lib/questionnaire.ts`, `commission_terms`, `has_tenants`, `sale_reason`) and share
  `FormState` with the form, so known values (czynsz, contact, komentarz) show pre-filled.
  Scrapers and enrichment never write them; they travel through
  `ListingFieldsInput`/`listingFieldsSchema` and the export.
- **Map.** „Mapa” in the table toolbar splits the view 1/3 table (own scroll, sticky
  header) / 2/3 `ListingsMap` (Leaflet + OSM tiles; Leaflet is imported inside an effect
  because it touches `window`). Hovering a dot lights up its row and scrolls the table
  to it; hovering a row lights up its dot; clicking a dot opens the offer. Coordinates
  (`lat`/`lon`/`geo_source`/`geocoded_at`) come from `lib/locate-runner.ts`, streamed by
  `searches/[id]/locate` and started **by opening the map, not by scraping**: OLX's own
  pin from `raw_json.map` when `show_detailed` (otherwise it's a km-wide area — ignored),
  else the street parsed out of `address_raw` (`streetQuery` in `lib/geocode.ts`)
  geocoded with Nominatim — ≤1 req/s via a process-wide gate in `nominatimSearch`
  (`NOMINATIM_INTERVAL_MS`), answers cached forever in `geocode_cache` (SQL in
  `db/geo-repo.ts`). The dev server doesn't reliably report aborted requests, so a run
  outlives its client; instead a newer run for the same list makes the older one stop
  before its next lookup (no locks, no "busy"). A result
  only counts if `matchDistrict(display_name)` equals the offer's district/town.
  Offers with only a district/town, and Sprzedajemy (title as address), stay off the
  map on purpose. Every attempt stamps `geocoded_at`, so each offer is looked up once;
  a changed `address_raw`/`district` (re-scrape or edit) clears a geocoded position.
- `lib/scrape-runner.ts` - `runScrape(search)` async-generator: sequential per
  source (low-volume + error isolation), upserts, `markGoneExcept`, yields progress
  events consumed by both the SSE route and it could be reused elsewhere.
- `lib/warsaw-districts.ts` - 18 districts with proper Polish names as the single
  source of truth; `matchDistrict` (diacritic- and `ł`-aware) resolves an address to
  a district **or a town** (towns match as whole words and lose to a district when the
  address says "Warszawa" — Bielany has a "Piastów Śląskich" street), `isTownAddress`,
  `ALL_LOCATIONS`, `OTODOM_DISTRICT_SLUG`, `OLX_DISTRICT_ID`. `lib/normalize.ts` - all
  price/area text parsing + price/m².
- `lib/towns.ts` - towns outside Warsaw (`TOWN_NAMES`, order matters for matching:
  Komorów before Michałowice) and `TOWNS`, how each source reaches each town
  (Otodom location path, OLX slug — ambiguous names carry OLX's city id suffix, Gratka
  segment or county page, Adresowo/Sprzedajemy slug or `null` = skipped), plus
  `locationPasses` and `describeLocations`. Client-safe; imported by
  `warsaw-districts.ts`, so it must not import that file back. **Adding a town** = add
  it to `TOWN_NAMES` + `TOWNS` with slugs verified against the live sites (a wrong slug
  usually returns a same-named place elsewhere or a nationwide page, not an error).
- `db/searches-repo.ts`, `db/listings-repo.ts` - all SQL. Upsert records price
  history; `getPreviousPrices` powers the table's price-delta badges;
  `markGoneExcept` flags disappeared offers.
- **API** (`app/api/`): `searches` (GET/POST), `searches/[id]` (GET/PATCH/DELETE),
  `searches/[id]/scrape` (streams newline-delimited JSON progress — `Content-Type:
  application/x-ndjson`, read incrementally on the client), `searches/[id]/listings`,
  `searches/[id]/export`, `listings/[id]/star`, `listings/[id]/history`.
- **UI** (`app/components/`, all client components, Polish): `SearchSidebar`,
  `SearchForm` (Warszawa checkbox with its districts beneath, towns below),
  `ScrapeProgress` (reads the ndjson stream to drive per-source status),
  `ListingsTable` (star toggle, price-delta badge, nieaktualne row), `FilterPanel` +
  `listing-filters.ts` (client-side „Filtry” over every field, AND-ed, persisted in
  localStorage `listingsTable.filters`; add a field = one entry in `FILTER_DEFS` and,
  for a new kind, a branch in `emptyValue`/`isActive`/`matches`), `ExportButton`.
  `app/page.tsx` orchestrates sidebar + form/view modes. Client components can't
  import `scrapers/registry.ts` (pulls in server-only deps); they use `db/schema.ts`
  types, `lib/warsaw-districts.ts` and `lib/towns.ts` (safe, no server deps).

## Conventions / gotchas

- **Env vars:** `OPENAI_API_KEY`, `OPENAI_MODEL`, `ENRICH_MAX_PER_RUN` (see
  `.env.example`). Next loads `.env.local` itself; the `tsx` scripts only do because
  their npm scripts pass `--env-file-if-exists=.env.local` — keep that flag on any new
  script.
- **Schema changes:** migrations run every boot with `IF NOT EXISTS` (no once-only
  tracking). To change the schema, edit `db/migrations/001_init.sql` and delete the
  dev `data/listings.db` so it's recreated — data is disposable/re-scrapeable. Column
  additions can instead go in `ensureColumns` (db/client.ts, covers `searches` and
  `listings`) to keep existing data.
- `price_history` ordering ties (same-millisecond scrapes) are broken by `id` — keep
  the `, id` tiebreak in the ORDER BY clauses.
- District/town selection sends canonical Polish names (with diacritics); the API's
  zod filter drops anything not in `WARSAW_DISTRICTS` / `TOWN_NAMES`, so keep those in sync.
- OLX answers rapid consecutive requests with 403 (looks like a missing page) — the
  OLX scraper spaces location passes out more than the default polite delay.
- Each scraper file has a header comment with its last-verified date and where its
  selectors/JSON path came from — keep it current when you fix one. See the README's
  "Known limitations" for why Adresowo/Sprzedajemy yield little on narrow lists.
