// Otodom offer-page fetcher — JSON-first, same trick as scrapers/otodom.ts.
// Last verified working: 2026-08-25, by fetching live Warsaw offer pages and
// inspecting __NEXT_DATA__ at props.pageProps.ad. The useful facts are NOT in
// ad.features (empty on every offer checked) but in two label/values lists,
// ad.topInformation and ad.additionalInformation, whose values are prefixed
// enum strings:
//   building_ownership = building_ownership::full_ownership
//   construction_status = construction_status::ready_to_use
//   floor               = floor_no::floor_7 | /8      (second value = building)
//   rent                = "273 zł"          build_year = "2016"
//   lift                = ::y / ::n         (an explicit "no" — worth keeping)
//   extras_types        = extras_types::balcony|::garage|::garden|::terrace|::lift
// ad.target / ad.characteristics carry a subset of the same data and are used
// as a fallback. This is the richest source in the app: most Otodom offers
// need no AI call at all.
import { fetchText } from "../../lib/http";
import { makeLogger } from "../../lib/logger";
import {
  parseCondition,
  parseFloorNum,
  parsePositiveInt,
  parsePricePLN,
  parseYearBuilt,
} from "../../lib/normalize";
import { normalizeOwnership } from "../../lib/ownership";
import { extractNextData, htmlToText } from "../../lib/page-json";
import type { DetailFetcher, ListingDetail } from "./types";

const log = makeLogger("detail:otodom");

interface OtodomInfoEntry {
  label?: string;
  values?: string[];
}

interface OtodomAd {
  description?: string | null;
  target?: Record<string, unknown>;
  characteristics?: { key?: string; value?: string; localizedValue?: string }[];
  topInformation?: OtodomInfoEntry[];
  additionalInformation?: OtodomInfoEntry[];
}

function getAd(nextData: unknown): OtodomAd | null {
  const payload = nextData as { props?: { pageProps?: { ad?: OtodomAd } } };
  return payload?.props?.pageProps?.ad ?? null;
}

/** label -> values, merging both info lists (later entries win). */
function infoMap(ad: OtodomAd): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of [...(ad.topInformation ?? []), ...(ad.additionalInformation ?? [])]) {
    if (!entry.label) continue;
    const values = entry.values ?? [];
    const existing = map.get(entry.label);
    map.set(entry.label, existing ? [...existing, ...values] : values);
  }
  return map;
}

/** "building_ownership::full_ownership" -> "full_ownership". */
function bare(value: string | undefined): string | null {
  if (!value) return null;
  const idx = value.lastIndexOf("::");
  const out = idx >= 0 ? value.slice(idx + 2) : value;
  return out.trim() || null;
}

function info(map: Map<string, string[]>, label: string): string | null {
  return bare(map.get(label)?.[0]);
}

/** target values are scalars or single-element arrays depending on the field. */
function targetText(target: Record<string, unknown> | undefined, key: string): string | null {
  const value = target?.[key];
  if (value == null) return null;
  if (Array.isArray(value)) return value.length ? String(value[0]) : null;
  if (typeof value === "object") return null;
  return String(value);
}

function characteristic(ad: OtodomAd, key: string): string | null {
  const hit = ad.characteristics?.find((c) => c.key === key);
  return hit?.value ?? hit?.localizedValue ?? null;
}

/** lift = "::y" / "::n"; anything else (absent) stays unknown. */
function liftFlag(map: Map<string, string[]>): number | null {
  const value = info(map, "lift");
  if (value === "y") return 1;
  if (value === "n") return 0;
  return null;
}

function extras(map: Map<string, string[]>): string[] {
  return (map.get("extras_types") ?? []).map((v) => bare(v) ?? "").filter(Boolean);
}

export const otodomDetailFetcher: DetailFetcher = {
  source: "otodom",

  async fetch(url: string): Promise<ListingDetail | null> {
    const html = await fetchText(url);
    if (!html) return null;

    const ad = getAd(extractNextData(html));
    if (!ad) {
      log.warn(`could not locate props.pageProps.ad for ${url}`);
      return null;
    }

    const map = infoMap(ad);
    const target = ad.target;
    const extrasList = extras(map);
    const floorValues = map.get("floor") ?? [];
    // extras_types lists only what an offer HAS, so a missing entry means
    // "not stated" (null), never "no" — the AI step may still find it in the text.
    const extra = (...keys: string[]) => (keys.some((k) => extrasList.includes(k)) ? 1 : null);

    return {
      description: htmlToText(ad.description),
      fields: {
        ownershipType: normalizeOwnership(
          info(map, "building_ownership") ??
            targetText(target, "Building_ownership") ??
            characteristic(ad, "building_ownership")
        ),
        floorNum: parseFloorNum(
          floorValues[0] ?? targetText(target, "Floor_no") ?? characteristic(ad, "floor_no")
        ),
        totalFloors:
          parsePositiveInt(floorValues[1]) ??
          parsePositiveInt(
            targetText(target, "Building_floors_num") ?? characteristic(ad, "building_floors_num")
          ),
        czynsz: parsePricePLN(
          map.get("rent")?.[0] ?? targetText(target, "Rent") ?? characteristic(ad, "rent")
        ),
        yearBuilt: parseYearBuilt(
          info(map, "build_year") ?? targetText(target, "Build_year") ?? characteristic(ad, "build_year")
        ),
        conditionState: parseCondition(
          info(map, "construction_status") ??
            targetText(target, "Construction_status") ??
            characteristic(ad, "construction_status")
        ),
        hasBalcony: extra("balcony", "terrace", "garden"),
        hasParking: extra("garage", "parking"),
        hasElevator: liftFlag(map) ?? extra("lift"),
      },
    };
  },
};
