// AI fallback for enrichment: reads an offer's description and fills in only
// the fields the offer page did not state outright (see lib/enrich-runner.ts).
// Deliberately cheap and optional:
//   * model defaults to gpt-5-nano (override with OPENAI_MODEL),
//   * no OPENAI_API_KEY -> isAiConfigured() is false and the whole step is
//     skipped, scraping still works,
//   * strict JSON schema built from the *missing* fields only, so the model
//     never re-states what we already know and the response stays tiny.
import OpenAI from "openai";
import type { EnrichedFields } from "../../db/schema";
import { makeLogger } from "../logger";
import { parseCondition, parsePositiveInt, parseYearBuilt, CONDITION_STATES } from "../normalize";
import { normalizeOwnership, OWNERSHIP_TYPES } from "../ownership";

const log = makeLogger("ai-enrich");

const MAX_DESCRIPTION_CHARS = 6000;

export function aiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5-nano";
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!isAiConfigured()) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

type FieldKey = keyof EnrichedFields;

// One JSON-schema property per enrichable field, with the Polish wording the
// model should follow. Nullable everywhere: "null" is the correct answer
// whenever the description doesn't say.
const FIELD_SCHEMA: Record<FieldKey, Record<string, unknown>> = {
  ownershipType: {
    type: ["string", "null"],
    enum: [...OWNERSHIP_TYPES, null],
    description: "Forma własności lokalu wprost wymieniona w opisie.",
  },
  floorNum: {
    type: ["integer", "null"],
    description: "Piętro: 0 = parter, -1 = suterena/piwnica.",
  },
  totalFloors: {
    type: ["integer", "null"],
    description: "Liczba pięter w budynku.",
  },
  czynsz: {
    type: ["number", "null"],
    description: "Miesięczny czynsz administracyjny w złotych (sama liczba).",
  },
  yearBuilt: {
    type: ["integer", "null"],
    description: "Rok budowy budynku.",
  },
  conditionState: {
    type: ["string", "null"],
    enum: [...CONDITION_STATES, null],
    description: "Stan wykończenia mieszkania.",
  },
  hasBalcony: {
    type: ["integer", "null"],
    enum: [0, 1, null],
    description: "1 = jest balkon, taras lub ogródek; 0 = wprost napisano, że nie ma.",
  },
  hasParking: {
    type: ["integer", "null"],
    enum: [0, 1, null],
    description: "1 = jest miejsce postojowe lub garaż; 0 = wprost napisano, że nie ma.",
  },
  hasElevator: {
    type: ["integer", "null"],
    enum: [0, 1, null],
    description: "1 = w budynku jest winda; 0 = wprost napisano, że nie ma.",
  },
};

const SYSTEM_PROMPT = [
  "Jesteś ekstraktorem faktów z ogłoszeń sprzedaży mieszkań w Warszawie i okolicach.",
  "Zwracasz WYŁĄCZNIE fakty napisane wprost w treści ogłoszenia.",
  "Nigdy nie zgaduj, nie wnioskuj i nie licz na typowe wartości — jeśli czegoś nie napisano wprost, zwróć null.",
  "Nie zmieniaj danych podanych jako już znane; one są pewne.",
].join(" ");

function buildSchema(missing: FieldKey[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const key of missing) properties[key] = FIELD_SCHEMA[key];
  return {
    type: "object",
    // strict mode requires every property to be required and no extras.
    properties,
    required: missing,
    additionalProperties: false,
  };
}

function buildUserPrompt(input: EnrichInput, missing: FieldKey[]): string {
  const known = Object.entries(input.known)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  return [
    `Tytuł ogłoszenia: ${input.title ?? "(brak)"}`,
    known ? `Dane już ustalone (nie podważaj ich):\n${known}` : "Dane już ustalone: brak.",
    `Uzupełnij wyłącznie te pola: ${missing.join(", ")}.`,
    "Treść ogłoszenia:",
    input.description.slice(0, MAX_DESCRIPTION_CHARS),
  ].join("\n\n");
}

/** Re-runs each AI value through the same parsers the scrapers use. */
function sanitize(raw: Record<string, unknown>, missing: FieldKey[]): Partial<EnrichedFields> {
  const out: Partial<EnrichedFields> = {};
  const int = (v: unknown, min: number, max: number): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
  };
  const flag = (v: unknown): number | null => (v === 0 || v === 1 ? v : null);

  for (const key of missing) {
    const value = raw[key];
    if (value == null) continue;
    switch (key) {
      case "ownershipType":
        out.ownershipType = normalizeOwnership(String(value));
        break;
      case "floorNum":
        out.floorNum = int(value, -1, 100);
        break;
      case "totalFloors":
        out.totalFloors = parsePositiveInt(value as string | number);
        break;
      case "czynsz":
        out.czynsz = int(value, 1, 20000);
        break;
      case "yearBuilt":
        out.yearBuilt = parseYearBuilt(value as string | number);
        break;
      case "conditionState":
        out.conditionState = parseCondition(String(value));
        break;
      case "hasBalcony":
        out.hasBalcony = flag(value);
        break;
      case "hasParking":
        out.hasParking = flag(value);
        break;
      case "hasElevator":
        out.hasElevator = flag(value);
        break;
    }
  }
  return out;
}

export interface EnrichInput {
  title: string | null;
  description: string;
  /** Fields the detail page already established — context, never overwritten. */
  known: Partial<EnrichedFields>;
}

/**
 * Asks the model for `missing` fields only. Returns {} on any failure (no
 * key, API error, unparsable answer) — enrichment is best-effort by design.
 */
export async function enrichFromDescription(
  input: EnrichInput,
  missing: FieldKey[]
): Promise<Partial<EnrichedFields>> {
  const openai = getClient();
  if (!openai || missing.length === 0 || !input.description.trim()) return {};

  const model = aiModel();
  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input, missing) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "listing_fields", strict: true, schema: buildSchema(missing) },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      log.warn("empty AI response");
      return {};
    }
    return sanitize(JSON.parse(content) as Record<string, unknown>, missing);
  } catch (err) {
    log.warn(`AI enrichment failed (${model}):`, err);
    return {};
  }
}
