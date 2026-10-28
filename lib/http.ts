import { makeLogger } from "./logger";
import { isAllowed } from "./robots";

const log = makeLogger("http");

const USER_AGENT = "WarsawFlatFinder/1.0 (personal use; low-volume manual research tool)";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function politeDelay(baseMs = 500, jitterMs = 1000): Promise<void> {
  const delay = baseMs + Math.random() * jitterMs;
  return sleep(delay);
}

interface FetchTextOptions {
  timeoutMs?: number;
  retries?: number;
  skipRobotsCheck?: boolean;
}

export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string | null> {
  const { timeoutMs = 15000, retries = 2, skipRobotsCheck = false } = options;

  if (!skipRobotsCheck) {
    const allowed = await isAllowed(url);
    if (!allowed) {
      log.warn(`robots.txt disallows ${url}, skipping`);
      return null;
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        log.warn(`non-OK response ${res.status} for ${url}`);
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`HTTP ${res.status}`);
          await sleep(1000 * (attempt + 1));
          continue;
        }
        return null;
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      log.warn(`fetch attempt ${attempt + 1} failed for ${url}:`, err);
      await sleep(1000 * (attempt + 1));
    }
  }

  log.error(`all fetch attempts failed for ${url}`, lastError);
  return null;
}
