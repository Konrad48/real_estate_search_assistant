// OLX offer-page fetcher — reads the same window.__PRERENDERED_STATE__ blob
// as scrapers/olx.ts, but from an offer URL, where the ad sits at
// state.ad.ad with a full `params` array and the description:
//   params keys seen on flat-sale ads: price, m (area), rooms, floor_select,
//   builttype (building type), market (pierwotny/wtórny), furniture, rent
//   (czynsz) and "type_of_ownership"-ish wording inside description only.
// Last verified: 2026-08-25.
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
import { extractPrerenderedState, htmlToText } from "../../lib/page-json";
import { findParam, type OlxAdParam } from "../olx";
import { flagFromText } from "./flags";
import type { DetailFetcher, ListingDetail } from "./types";

const log = makeLogger("detail:olx");

interface OlxAdDetail {
  description?: string | null;
  params?: OlxAdParam[];
}

function getAd(state: unknown): OlxAdDetail | null {
  const payload = state as { ad?: { ad?: OlxAdDetail } };
  return payload?.ad?.ad ?? null;
}

function paramValue(params: OlxAdParam[], key: string): string | null {
  const param = findParam(params, key);
  return param?.value ?? param?.normalizedValue ?? null;
}

export const olxDetailFetcher: DetailFetcher = {
  source: "olx",

  async fetch(url: string): Promise<ListingDetail | null> {
    const html = await fetchText(url);
    if (!html) return null;

    const ad = getAd(extractPrerenderedState(html));
    if (!ad) {
      log.warn(`could not locate ad state for ${url} (site may be bot-checking)`);
      return null;
    }

    const params = ad.params ?? [];
    const description = htmlToText(ad.description);
    // OLX has no ownership/amenity params on flat sales — those live in the
    // free text, which the AI step reads. We only mine what is explicit here.
    const paramText = params
      .map((p) => `${p.key} ${p.value ?? ""} ${p.normalizedValue ?? ""}`)
      .join(" ")
      .toLowerCase();

    const floorText = paramValue(params, "floor_select");

    return {
      description,
      fields: {
        ownershipType: normalizeOwnership(paramValue(params, "type_of_ownership") ?? paramValue(params, "market")),
        floorNum: parseFloorNum(floorText),
        totalFloors: parsePositiveInt(paramValue(params, "building_floors")),
        czynsz: parsePricePLN(paramValue(params, "rent")),
        yearBuilt: parseYearBuilt(paramValue(params, "build_year")),
        conditionState: parseCondition(paramValue(params, "condition") ?? paramValue(params, "state")),
        hasBalcony: flagFromText(paramText, "balcony"),
        hasParking: flagFromText(paramText, "parking"),
        hasElevator: flagFromText(paramText, "elevator"),
      },
    };
  },
};
