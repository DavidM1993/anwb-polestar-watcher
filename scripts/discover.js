/**
 * One-off discovery: open the ANWB occasion page and log every JSON
 * network response so we can find the offers API endpoint.
 *
 * Usage: npm run discover
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PAGE_URL =
  "https://www.anwb.nl/auto/private-lease/anwb-private-lease/aanbod?aanbod[0]=occasion";

const outDir = join(process.cwd(), "discovery-output");
mkdirSync(outDir, { recursive: true });

const hits = [];
let counter = 0;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  locale: "nl-NL",
});
const page = await context.newPage();

page.on("response", async (response) => {
  const url = response.url();
  const contentType = (response.headers()["content-type"] || "").toLowerCase();
  const status = response.status();

  // Capture JSON-ish responses and anything that looks like an API
  const looksApi =
    contentType.includes("json") ||
    url.includes("/api/") ||
    url.includes("graphql") ||
    url.includes("ayvens") ||
    url.includes("lease") ||
    url.includes("sombrero") ||
    url.includes("apigee") ||
    url.includes("cars");

  if (!looksApi && !contentType.includes("json")) return;
  if (status < 200 || status >= 400) return;

  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    return;
  }

  // Skip empty / tiny / non-JSON bodies
  const trimmed = bodyText.trim();
  if (!trimmed || trimmed.length < 20) return;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  const id = String(++counter).padStart(3, "0");
  const file = join(outDir, `${id}.json`);
  writeFileSync(file, JSON.stringify(parsed, null, 2));

  const lower = trimmed.toLowerCase();
  const hint =
    lower.includes("polestar") ||
    lower.includes("occasion") ||
    lower.includes("maand") ||
    lower.includes("lease") ||
    lower.includes("merk") ||
    lower.includes("brand") ||
    lower.includes("model");

  const entry = {
    id,
    status,
    url,
    contentType,
    bytes: Buffer.byteLength(trimmed),
    hint,
    file: `${id}.json`,
  };
  hits.push(entry);
  console.log(
    `[${id}] ${status} ${bytesFmt(entry.bytes)} hint=${hint} ${url.slice(0, 160)}`
  );
});

console.log("Opening", PAGE_URL);
await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 90_000 });

// Give client-side widgets time to load; scroll a bit to trigger lazy loads
await page.waitForTimeout(5_000);
await page.mouse.wheel(0, 2000);
await page.waitForTimeout(5_000);
await page.mouse.wheel(0, 2000);
await page.waitForTimeout(5_000);

const html = await page.content();
writeFileSync(join(outDir, "rendered.html"), html);
console.log("Saved rendered HTML");

const summary = {
  pageUrl: PAGE_URL,
  capturedAt: new Date().toISOString(),
  hitCount: hits.length,
  hits,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nDone. ${hits.length} JSON responses saved to ${outDir}`);
console.log("Hinted (likely offers) responses:");
for (const h of hits.filter((x) => x.hint)) {
  console.log(`  [${h.id}] ${h.url}`);
}

await browser.close();

function bytesFmt(n) {
  if (n < 1024) return `${n}B`;
  return `${(n / 1024).toFixed(1)}KB`;
}
