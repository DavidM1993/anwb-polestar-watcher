/**
 * Fetch ANWB private-lease occasion listings via the public Fusion search API.
 * No browser required.
 */

const API_URL =
  "https://api.anwb.nl/privatelease/v1/car-search-api/query/leasecars";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * @typedef {object} Listing
 * @property {string} id
 * @property {string} leasecarId
 * @property {string} brand
 * @property {string} model
 * @property {string} [configuration]
 * @property {number|null} monthlyPrice
 * @property {string|null} termMonths
 * @property {string|null} mileage
 * @property {string|null} fuelType
 * @property {string|null} condition
 * @property {string|null} url
 * @property {string|null} image
 */

/**
 * @returns {Promise<Listing[]>}
 */
export async function scrapeListings() {
  const body = new URLSearchParams();
  // Occasion filter (same tag syntax the website uses)
  body.append("fq", '{!tag=condition}condition:("occasion")');
  // Collapse variants of the same product group down to the cheapest price
  body.append(
    "fq",
    "{!tag=beforeCollapseTag}{!collapse field=productGroup min=price}"
  );
  body.set("groupProducts", "true");
  body.set("q", "*:*");
  body.set("rows", "500");
  body.set("start", "0");
  body.set("sort", "price asc");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://www.anwb.nl",
      Referer: "https://www.anwb.nl/",
      "User-Agent": USER_AGENT,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ANWB API HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`
    );
  }

  const data = await res.json();
  const docs = data?.response?.docs;
  if (!Array.isArray(docs)) {
    throw new Error("ANWB API response missing response.docs array");
  }

  /** @type {Listing[]} */
  const listings = docs.map(normalizeDoc);

  // Deduplicate by leasecarId (collapse can still return near-duplicates)
  const byId = new Map();
  for (const listing of listings) {
    if (!byId.has(listing.leasecarId)) byId.set(listing.leasecarId, listing);
  }
  return [...byId.values()];
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {Listing}
 */
function normalizeDoc(doc) {
  const leasecarId = String(doc.leasecarId || doc.id || "");
  const brand = String(doc.manufacturer || "");
  const model = String(doc.model || "");
  const priceRaw = doc.price;
  const monthlyPrice =
    typeof priceRaw === "number"
      ? priceRaw
      : priceRaw != null && priceRaw !== ""
        ? Number(priceRaw)
        : null;

  return {
    id: String(doc.id || leasecarId),
    leasecarId,
    brand,
    model,
    configuration: doc.vehicleConfiguration
      ? String(doc.vehicleConfiguration)
      : undefined,
    monthlyPrice: Number.isFinite(monthlyPrice) ? monthlyPrice : null,
    termMonths: doc.duration != null ? String(doc.duration) : null,
    mileage: doc.mileage != null ? String(doc.mileage) : null,
    fuelType: doc.fuelType != null ? String(doc.fuelType) : null,
    condition: doc.condition != null ? String(doc.condition) : null,
    url: doc.externalUrl != null ? String(doc.externalUrl) : null,
    image:
      (doc["imageUrl.w620_t"] && String(doc["imageUrl.w620_t"])) ||
      (doc["imageUrl.w380_t"] && String(doc["imageUrl.w380_t"])) ||
      (doc["imageUrl.w300_t"] && String(doc["imageUrl.w300_t"])) ||
      null,
  };
}

/**
 * @param {Listing[]} listings
 * @param {string} brandFilter e.g. "polestar"
 */
export function filterByBrand(listings, brandFilter) {
  const needle = brandFilter.trim().toLowerCase();
  if (!needle) return listings;
  return listings.filter((l) => l.brand.toLowerCase().includes(needle));
}

// Allow `node src/scrape.js` for a quick smoke test
const isDirectRun = process.argv[1] && /[\\/]scrape\.js$/i.test(process.argv[1]);
if (isDirectRun) {
  const listings = await scrapeListings();
  const polestars = filterByBrand(listings, "polestar");
  console.log(`Fetched ${listings.length} occasion listings`);
  console.log(`Polestar matches: ${polestars.length}`);
  console.log(
    "Brands:",
    [...new Set(listings.map((l) => l.brand))].sort().join(", ")
  );
  if (listings[0]) console.log("Sample:", listings[0]);
}
