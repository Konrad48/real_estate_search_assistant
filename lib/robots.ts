// Best-effort robots.txt check. Never throws - a parsing failure should not
// block a personal tool, it should just fail open (allow) with a warning.
import { makeLogger } from "./logger";

const log = makeLogger("robots");

interface RobotsRules {
  disallow: string[];
}

const cache = new Map<string, RobotsRules>();

function parseRobotsTxt(text: string): RobotsRules {
  const disallow: string[] = [];
  let appliesToUs = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const lowerKey = key.trim().toLowerCase();
    if (lowerKey === "user-agent") {
      appliesToUs = value === "*";
    } else if (lowerKey === "disallow" && appliesToUs && value) {
      disallow.push(value);
    }
  }
  return { disallow };
}

async function getRules(origin: string): Promise<RobotsRules> {
  const cached = cache.get(origin);
  if (cached) return cached;

  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const empty = { disallow: [] };
      cache.set(origin, empty);
      return empty;
    }
    const text = await res.text();
    const rules = parseRobotsTxt(text);
    cache.set(origin, rules);
    return rules;
  } catch (err) {
    log.warn(`could not fetch robots.txt for ${origin}, allowing by default`, err);
    const empty = { disallow: [] };
    cache.set(origin, empty);
    return empty;
  }
}

export async function isAllowed(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const rules = await getRules(u.origin);
    return !rules.disallow.some((rule) => u.pathname.startsWith(rule));
  } catch (err) {
    log.warn(`robots check failed for ${url}, allowing by default`, err);
    return true;
  }
}
