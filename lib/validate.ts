import { z } from "zod";
import { makeLogger } from "./logger";
import { CONDITION_STATES } from "./normalize";
import { OWNERSHIP_TYPES } from "./ownership";
import { WIRING_TYPES } from "./questionnaire";
import { TOWN_NAMES } from "./towns";
import { WARSAW_DISTRICTS } from "./warsaw-districts";

const log = makeLogger("validate");

const districtSet = new Set<string>(WARSAW_DISTRICTS);
const townSet = new Set<string>(TOWN_NAMES);

const nullableNumber = z
  .union([z.number(), z.null()])
  .optional()
  .transform((v) => (v == null ? null : v));

export const searchInputSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    includeWarsaw: z.boolean().default(true),
    districts: z.array(z.string()).default([]).transform((arr) => arr.filter((d) => districtSet.has(d))),
    towns: z.array(z.string()).default([]).transform((arr) => arr.filter((t) => townSet.has(t))),
    sources: z.array(z.enum(["olx", "otodom", "adresowo", "sprzedajemy", "gratka"])).min(1),
    minPrice: nullableNumber,
    maxPrice: nullableNumber,
    minArea: nullableNumber,
    maxArea: nullableNumber,
  })
  .refine((v) => v.includeWarsaw || v.towns.length > 0, {
    message: "Wybierz Warszawę lub co najmniej jedną miejscowość",
    path: ["towns"],
  });

export type SearchInputParsed = z.infer<typeof searchInputSchema>;

export const rawListingSchema = z.object({
  source: z.enum(["olx", "otodom", "adresowo", "sprzedajemy", "gratka"]),
  sourceId: z.string().min(1),
  sourceUrl: z.string().url(),
  title: z.string().optional(),
  priceText: z.string().optional(),
  areaText: z.string().optional(),
  addressText: z.string().optional(),
  roomsText: z.string().optional(),
  floorText: z.string().optional(),
  listingDateText: z.string().optional(),
  raw: z.record(z.string(), z.unknown()),
});

export type ValidatedRawListing = z.infer<typeof rawListingSchema>;

export const listingFieldsSchema = z.object({
  title: z.string().trim().max(300).nullable(),
  pricePln: z.number().nonnegative().nullable(),
  areaM2: z.number().positive().nullable(),
  district: z.string().trim().max(100).nullable(),
  addressRaw: z.string().trim().max(300).nullable(),
  rooms: z.number().int().nonnegative().nullable(),
  floor: z.string().trim().max(50).nullable(),
  listingDate: z.string().trim().max(50).nullable(),
  sourceUrl: z.string().trim().max(500).nullable(),
  comment: z.string().trim().max(2000).nullable(),
  contactName: z.string().trim().max(200).nullable(),
  contactPhone: z.string().trim().max(50).nullable(),
  czynsz: z.number().nonnegative().nullable(),
  ownershipType: z.enum(OWNERSHIP_TYPES).nullable(),
  floorNum: z.number().int().min(-1).max(100).nullable(),
  totalFloors: z.number().int().positive().max(100).nullable(),
  yearBuilt: z.number().int().min(1800).max(2100).nullable(),
  conditionState: z.enum(CONDITION_STATES).nullable(),
  hasBalcony: z.union([z.literal(0), z.literal(1)]).nullable(),
  hasParking: z.union([z.literal(0), z.literal(1)]).nullable(),
  hasElevator: z.union([z.literal(0), z.literal(1)]).nullable(),
  hasLandRegister: z.union([z.literal(0), z.literal(1)]).nullable(),
  landRegisterNumber: z.string().trim().max(50).nullable(),
  landRegulated: z.union([z.literal(0), z.literal(1)]).nullable(),
  hasEncumbrance: z.union([z.literal(0), z.literal(1)]).nullable(),
  layout: z.string().trim().max(1000).nullable(),
  priceNegotiable: z.union([z.literal(0), z.literal(1)]).nullable(),
  flooring: z.string().trim().max(200).nullable(),
  wiring: z.enum(WIRING_TYPES).nullable(),
  commissionTerms: z.string().trim().max(1000).nullable(),
  hasTenants: z.union([z.literal(0), z.literal(1)]).nullable(),
  saleReason: z.string().trim().max(1000).nullable(),
});

export type ListingFields = z.infer<typeof listingFieldsSchema>;

/**
 * Validates a list of raw listings, logging (not throwing) on individual
 * failures so one malformed card doesn't kill the whole scrape run.
 */
export function validateRawListings(items: unknown[], source: string): ValidatedRawListing[] {
  const valid: ValidatedRawListing[] = [];
  for (const item of items) {
    const result = rawListingSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      log.warn(`dropping invalid listing from ${source}:`, result.error.issues);
    }
  }
  return valid;
}
