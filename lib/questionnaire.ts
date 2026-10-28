// Answers gathered on the phone with the seller („Kwestionariusz” mode of the
// offer modal). These columns are user-entered only — scrapers and enrichment
// never write them. Client-safe (imported by the modal and lib/validate.ts).

/** Instalacja elektryczna — stored as the displayable Polish label. */
export const WIRING_TYPES = ["miedziana", "aluminiowa", "mieszana"] as const;

export type WiringType = (typeof WIRING_TYPES)[number];
