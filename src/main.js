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

  const isSeed = previouslySeen.size === 0;
  const newListings = findNewMatches(listings, previouslySeen);
  const newPolestars = filterByBrand(newListings, BRAND_FILTER);
  const newBrands = [
    ...new Set(newListings.map((l) => l.brand).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "nl"));

  console.log(
    `New listings: ${newListings.length} (brands: ${newBrands.join(", ") || "—"}); new ${BRAND_FILTER}: ${newPolestars.length}; seed=${isSeed}`
  );

  // After the first inventory seed, notify when anything new appears (brand only).
  if (!isSeed && newBrands.length > 0) {
    await sendMessage({
      token,
      chatId,
      text: `Nieuwe occasions: ${newBrands.map(escapeHtml).join(", ")}`,
      disablePreview: true,
    });
  }

  if (newPolestars.length > 0) {
    await notifyNewListings(token, chatId, newPolestars);
  } else if (isTest) {
    await sendMessage({
      token,
      chatId,
      text:
        `Check OK: ${listings.length} occasions, ` +
        `${matches.length} ${escapeHtml(BRAND_FILTER)}` +
        (isSeed
          ? " (inventory seeded)."
          : newBrands.length
            ? "."
            : " (geen nieuwe)."),
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

  // Track full inventory so "new" means any newly appeared occasion.
  // Dropped cars are forgotten so a reappearance notifies again.
  const currentIds = new Set(listings.map((l) => l.leasecarId));
  state.seenIds = [...currentIds];
  const pruned = {};
  for (const listing of listings) {
    pruned[listing.leasecarId] = {
      brand: listing.brand,
      model: listing.model,
      monthlyPrice: listing.monthlyPrice,
      url: listing.url,
    };
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
