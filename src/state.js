import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = join(__dirname, "..", "state", "seen.json");

/**
 * @typedef {object} State
 * @property {string|null} lastCheckAt ISO timestamp of last successful check
 * @property {string|null} lastAttemptAt ISO timestamp of last attempt (success or fail)
 * @property {string[]} seenIds leasecarIds we have already notified about (or seen)
 * @property {Record<string, object>} listings snapshot of last-known matching listings
 * @property {number} consecutiveFailures
 * @property {boolean} failureAlertSent
 * @property {number|null} nextDayIntervalMinutes randomized 20 or 40 for day cadence
 */

/** @returns {State} */
export function defaultState() {
  return {
    lastCheckAt: null,
    lastAttemptAt: null,
    seenIds: [],
    listings: {},
    consecutiveFailures: 0,
    failureAlertSent: false,
    nextDayIntervalMinutes: null,
  };
}

/** @returns {State} */
export function loadState() {
  if (!existsSync(STATE_PATH)) return defaultState();
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return { ...defaultState(), ...raw };
  } catch {
    return defaultState();
  }
}

/** @param {State} state */
export function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}
