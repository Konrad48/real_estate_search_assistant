import type { SearchInput } from "../db/searches-repo";
import { describeLocations } from "./towns";

function fmtThousands(v: number): string {
  if (v >= 1000) return `${Math.round(v / 1000)} tys.`;
  return String(v);
}

/**
 * Builds a Polish default name summarizing a search's parameters, e.g.
 * "Mokotów, Śródmieście, Pruszków · 500 tys.–900 tys. · 40–70 m²".
 */
export function autoSearchName(input: SearchInput): string {
  const parts: string[] = [];
  parts.push(describeLocations(input));

  if (input.minPrice != null || input.maxPrice != null) {
    const lo = input.minPrice != null ? fmtThousands(input.minPrice) : "";
    const hi = input.maxPrice != null ? fmtThousands(input.maxPrice) : "";
    parts.push(`${lo}–${hi} zł`.replace(/^–/, "do ").replace(/–$/, " i więcej"));
  }
  if (input.minArea != null || input.maxArea != null) {
    const lo = input.minArea != null ? String(input.minArea) : "";
    const hi = input.maxArea != null ? String(input.maxArea) : "";
    parts.push(`${lo}–${hi} m²`.replace(/^–/, "do ").replace(/–\s?m²$/, " m² i więcej"));
  }
  return parts.join(" · ");
}
