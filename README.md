# Wyszukiwarka mieszkań — Warszawa i okolice (Warsaw Flat Finder)

A personal, localhost-only tool for finding a flat to buy in Warszawa — 
optionally narrowed to districts — and/or Piastów, Pruszków, Brwinów,
Komorów, Michałowice, Milanówek, Grodzisk Mazowiecki, price range, area range, and sources;
scraping a list fetches matching offers from Otodom, OLX, Adresowo, Sprzedajemy, and
Gratka — filtered at the source website where possible — into a local SQLite database.
Re-scraping a list updates it in place and **keeps price history** so you can see how
offer prices change over time. The UI is in Polish.
<img width="1890" height="907" alt="image" src="https://github.com/user-attachments/assets/dab53709-9304-4f68-9fac-7dc76396a9d2" />

## Getting started
App uses AI for filling up missing information from the listing description. This is optional but recommended.
Configure it by copying `.env.example` to `.env`:

```
OPENAI_API_KEY=sk-…          # without it, the AI step is skipped (app still works)
OPENAI_MODEL=gpt-5-nano      # cheap extraction model
ENRICH_MAX_PER_RUN=400       # offers enriched per scrape run
```

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

