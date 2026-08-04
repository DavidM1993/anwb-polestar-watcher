#!/usr/bin/env node
/**
 * Amsterdam-time gate for GitHub Actions.
 *
 * Day (08:00–18:00 Europe/Amsterdam): run if >= randomized 20 or 40 minutes
 * since lastCheckAt.
 * Night: run if >= 3 hours since lastCheckAt.
 *
 * Always runs when FORCE_CHECK=1 or --force / --test.
 *
 * Writes GitHub Actions outputs:
 *   should_run=true|false
 *   reason=...
 */
import { loadState, saveState } from "../src/state.js";
import { appendFileSync } from "node:fs";

const TZ = "Europe/Amsterdam";
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18; // exclusive: day is [8, 18)
const NIGHT_INTERVAL_MS = 3 * 60 * 60 * 1000;

const force =
  process.env.FORCE_CHECK === "1" ||
  process.argv.includes("--force") ||
  process.argv.includes("--test") ||
  process.env.INPUT_TEST === "true" ||
  process.env.INPUT_TEST === "1";

/**
 * @param {Date} date
 */
function amsterdamParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * @param {Date} date
 */
function isDaytime(date) {
  const { hour } = amsterdamParts(date);
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}

/**
 * Pick 20 or 40 minutes (persist so we don't re-roll every cron tick).
 * @param {import('../src/state.js').State} state
 */
function dayIntervalMs(state) {
  if (state.nextDayIntervalMinutes !== 20 && state.nextDayIntervalMinutes !== 40) {
    state.nextDayIntervalMinutes = Math.random() < 0.5 ? 20 : 40;
    saveState(state);
  }
  return state.nextDayIntervalMinutes * 60 * 1000;
}

function writeOutput(shouldRun, reason) {
  console.log(`should_run=${shouldRun} reason=${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `should_run=${shouldRun}\nreason=${reason}\n`
    );
  }
}

const now = new Date();
const state = loadState();

if (force) {
  writeOutput("true", "forced");
  process.exit(0);
}

const last = state.lastCheckAt ? new Date(state.lastCheckAt).getTime() : 0;
const elapsed = now.getTime() - last;
const day = isDaytime(now);
const parts = amsterdamParts(now);
const localLabel = `${parts.hour.toString().padStart(2, "0")}:${parts.minute
  .toString()
  .padStart(2, "0")} ${TZ}`;

if (!last) {
  writeOutput("true", `first-run (${localLabel})`);
  process.exit(0);
}

if (day) {
  const needed = dayIntervalMs(state);
  if (elapsed >= needed) {
    // Re-roll interval for next day window after we decide to run
    state.nextDayIntervalMinutes = Math.random() < 0.5 ? 20 : 40;
    saveState(state);
    writeOutput(
      "true",
      `day due (${localLabel}, waited ${Math.round(elapsed / 60000)}m, interval ${needed / 60000}m)`
    );
  } else {
    writeOutput(
      "false",
      `day skip (${localLabel}, ${Math.round(elapsed / 60000)}m < ${needed / 60000}m)`
    );
  }
} else {
  if (elapsed >= NIGHT_INTERVAL_MS) {
    writeOutput(
      "true",
      `night due (${localLabel}, waited ${Math.round(elapsed / 60000)}m)`
    );
  } else {
    writeOutput(
      "false",
      `night skip (${localLabel}, ${Math.round(elapsed / 60000)}m < 180m)`
    );
  }
}
