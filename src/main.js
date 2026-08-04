/**
 * Orchestration: scrape → filter Polestar → diff → Telegram → persist state.
 *
 * Usage:
 *   node src/main.js
 *   node src/main.js --test   # send a test Telegram message + run a check
 *   FORCE_CHECK=1 node src/main.js
 */
import { scrapeListings, filterByBrand } from "./scrape.js";
import { loadState, saveState } from "./state.js";
import { sendMessage, sendPhoto, escapeHtml } from "./telegram.js";

const BRAND_FILTER = (process.env.BRAND_FILTER || "polestar").toLowerCase();
const FAILURE_THRESHOLD = Number(process.env.FAILURE_THRESHOLD || 3);
const isTest = process.argv.includes("--test");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

/**
 * @param {import('./scrape.js').Listing} listing
 */
function formatListingMessage(listing) {
  const title = `${escapeHtml(listing.brand)} ${escapeHtml(listing.model)}`;
  const price =
    listing.monthlyPrice != null
      ? `€${listing.monthlyPrice}/maand`
      : "prijs onbekend";
  const bits = [
    listing.termMonths ? `${listing.termMonths} maanden` : null,
    listing.mileage ? `${listing.mileage} km/jaar` : null,
    listing.fuelType,
    listing.configuration,
  ].filter(Boolean);

  const lines = [
    `🚨 <b>Polestar beschikbaar bij ANWB Private Lease</b>`,
    ``,
    `<b>${title}</b>`,
    price,
    bits.length ? bits.map(escapeHtml).join(" · ") : null,
    listing.url ? `\n<a href="${escapeHtml(listing.url)}">Bekijk / aanvragen</a>` : null,
  ].filter((x) => x != null);

  return lines.join("\n");
}

/**
 * @param {import('./scrape.js').Listing[]} matches
 * @param {Set<string>} previouslySeen
 */
function findNewMatches(matches, previouslySeen) {
  return matches.filter((m) => !previouslySeen.has(m.leasecarId));
}

async function notifyNewListings(token, chatId, listings) {
  for (const listing of listings) {
    const text = formatListingMessage(listing);
    try {
      if (listing.image) {
        await sendPhoto({
          token,
          chatId,
          photo: listing.image,
          caption: text,
        });
      } else {
        await sendMessage({ token, chatId, text });
      }
    } catch (err) {
      // Photo URLs sometimes fail; fall back to text
      console.warn("sendPhoto failed, falling back to text:", err.message);
      await sendMessage({ token, chatId, text });
    }
  }
}

async function main() {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const state = loadState();
  const previouslySeen = new Set(state.seenIds);
  const seenBefore = [...state.seenIds].sort().join(",");

  if (isTest) {
    await sendMessage({
      token,
      chatId,
      text: "✅ ANWB Polestar Watcher testbericht — Telegram werkt.",
      disablePreview: true,
    });
    console.log("Sent test Telegram message");
  }

  state.lastAttemptAt = new Date().toISOString();

  let listings;
  try {
    listings = await scrapeListings();
  } catch (err) {
    console.error("Scrape failed:", err);
    state.consecutiveFailures += 1;
    if (
      state.consecutiveFailures >= FAILURE_THRESHOLD &&
      !state.failureAlertSent
    ) {
      await sendMessage({
        token,
        chatId,
        text:
          `⚠️ <b>ANWB Polestar Watcher is kapot</b>\n\n` +
          `${state.consecutiveFailures} opeenvolgende mislukte checks.\n` +
          `<code>${escapeHtml(String(err.message || err))}</code>\n\n` +
          `Kijk de GitHub Actions logs na.`,
        disablePreview: true,
      });
      state.failureAlertSent = true;
    }
    saveState(state);
    process.exitCode = 1;
    return;
  }

  if (listings.length === 0) {
    const err = new Error(
      "API returned zero occasion listings (site redesign or empty feed?)"
    );
    console.error(err.message);
    state.consecutiveFailures += 1;
    if (
      state.consecutiveFailures >= FAILURE_THRESHOLD &&
      !state.failureAlertSent
    ) {
      await sendMessage({
        token,
        chatId,
        text:
          `⚠️ <b>ANWB Polestar Watcher is kapot</b>\n\n` +
          `${state.consecutiveFailures} opeenvolgende checks gaven 0 listings.\n` +
          `Waarschijnlijk is de API of pagina veranderd.`,
        disablePreview: true,
      });
      state.failureAlertSent = true;
    }
    saveState(state);
    process.exitCode = 1;
    return;
  }

  // Success path
  const wasFailing = state.consecutiveFailures > 0;
  state.consecutiveFailures = 0;
  state.failureAlertSent = false;
  state.lastCheckAt = new Date().toISOString();

  const matches = filterByBrand(listings, BRAND_FILTER);
  console.log(
    `Fetched ${listings.length} occasions; ${matches.length} match brand "${BRAND_FILTER}"`
  );

  const newOnes = findNewMatches(matches, previouslySeen);
  console.log(`New ${BRAND_FILTER} listings: ${newOnes.length}`);

  if (newOnes.length > 0) {
    await notifyNewListings(token, chatId, newOnes);
  } else if (isTest) {
    await sendMessage({
      token,
      chatId,
      text:
        `Check OK: ${listings.length} occasions, ` +
        `${matches.length} ${escapeHtml(BRAND_FILTER)} (geen nieuwe).`,
      disablePreview: true,
    });
  }

  if (wasFailing) {
    await sendMessage({
      token,
      chatId,
      text: "✅ ANWB Polestar Watcher is weer online.",
      disablePreview: true,
    });
  }

  // Track all currently matching IDs as seen (so we don't re-notify)
  for (const m of matches) {
    previouslySeen.add(m.leasecarId);
    state.listings[m.leasecarId] = m;
  }
  // Drop IDs that disappeared so a reappearance notifies again
  const currentMatchIds = new Set(matches.map((m) => m.leasecarId));
  state.seenIds = [...previouslySeen].filter((id) => currentMatchIds.has(id));
  // Also keep seenIds for matches we notified even if filter brand changes?
  // Plan: "If a Polestar disappears and comes back it's treated as new."
  // So only keep currently present match IDs. Done above.

  // Prune listings snapshot to current matches
  const pruned = {};
  for (const id of state.seenIds) {
    if (state.listings[id]) pruned[id] = state.listings[id];
  }
  state.listings = pruned;

  saveState(state);

  const seenAfter = [...state.seenIds].sort().join(",");
  const listingsChanged = seenBefore !== seenAfter;
  // Expose for the workflow commit step
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `listings_changed=${listingsChanged}\n`
    );
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
