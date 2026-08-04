/**
 * Capture the exact request (method, headers, post body) for the leasecars API.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PAGE_URL =
  "https://www.anwb.nl/auto/private-lease/anwb-private-lease/aanbod?aanbod[0]=occasion";
const outDir = join(process.cwd(), "discovery-output");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  locale: "nl-NL",
});
const page = await context.newPage();

const captured = [];

page.on("request", (request) => {
  const url = request.url();
  if (!url.includes("leasecars") && !url.includes("privatelease")) return;
  captured.push({
    type: "request",
    method: request.method(),
    url,
    headers: request.headers(),
    postData: request.postData(),
  });
  console.log("REQ", request.method(), url);
  if (request.postData()) console.log("  body:", request.postData().slice(0, 500));
});

page.on("response", async (response) => {
  const url = response.url();
  if (!url.includes("leasecars") && !url.includes("privatelease")) return;
  let body = "";
  try {
    body = await response.text();
  } catch {}
  captured.push({
    type: "response",
    status: response.status(),
    url,
    headers: response.headers(),
    bodyBytes: Buffer.byteLength(body),
    bodyPreview: body.slice(0, 400),
  });
  console.log("RES", response.status(), url, "bytes", Buffer.byteLength(body));
});

await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(8_000);

writeFileSync(join(outDir, "request-capture.json"), JSON.stringify(captured, null, 2));
console.log("Saved request-capture.json with", captured.length, "entries");
await browser.close();
