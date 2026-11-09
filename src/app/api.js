// Network layer: rate-limited DOI metadata retrieval from DOI.org, with
// DataCite fallback, plus title lookups against Semantic Scholar, CrossRef and OpenAlex.
import {
  authorsNeedEnrichment, bestMatch, crossrefToStandard, dataCiteToStandard,
  doiBibtexToStandard, encodeDoiPath, isSamePaper, mergeMetadata, MIN_TITLE_SIM,
  normalizeDoi, openAlexToStandard, parseBib, ssToStandard, TITLE_MATCH_THRESHOLD, titleSimilarity,
} from "../lib/index.js";

const DOI_CITATION_API = "https://citation.doi.org/format";
const DATACITE_API = "https://api.datacite.org/dois";
const CROSSREF_API = "https://api.crossref.org/works";
const SS_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
const SS_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search";
const SS_FIELDS = "title,authors,year,venue,publicationVenue,externalIds";
const OPENALEX_API = "https://api.openalex.org/works";
const OPENALEX_FIELDS = "title,display_name,publication_year,doi,authorships,primary_location,biblio,id";

// Mutable so tests can shorten waits.
export const apiSettings = {
  maxRetries: 4,
  retryBaseMs: 1500,
  throttle: true,
};

/**
 * A source kept failing transiently (HTTP 429/5xx or network error) after all
 * retries — "the API was unreachable", as opposed to "the paper doesn't exist".
 */
export class TransientLookupError extends Error {
  constructor(message) { super(message); this.name = "TransientLookupError"; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Adaptive rate controller ────────────────────────────────────────
// One bucket per source: current delay, its clamps, last request time, and a
// run of consecutive successes used to speed back up.
const RATE_DEFAULTS = {
  doi: { delay: 100, min: 50, max: 2000 },
  dc: { delay: 100, min: 50, max: 2000 },
  ss: { delay: 500, min: 300, max: 3000 },
  cr: { delay: 100, min: 50,  max: 2000 },
  oa: { delay: 100, min: 50,  max: 2000 },
};
const rateBuckets = {};

export function resetRateLimits() {
  for (const [source, d] of Object.entries(RATE_DEFAULTS))
    rateBuckets[source] = { ...d, last: 0, ok: 0 };
}
resetRateLimits();

function rateBackoff(source) {
  const b = rateBuckets[source];
  b.delay = Math.min(b.delay * 1.3, b.max);
  b.ok = 0;
}

function rateSuccess(source) {
  const b = rateBuckets[source];
  b.ok++;
  if (b.ok >= 2) {
    b.delay = Math.max(b.delay * 0.85, b.min);
    b.ok = 0;
  }
}

/**
 * Wait for this source's next request slot. Every attempt, retries included,
 * reserves its own slot, so the spacing holds after a retry and between
 * overlapping callers of the same source.
 */
async function throttle(source) {
  if (!apiSettings.throttle) return;
  const b = rateBuckets[source];
  const now = Date.now();
  const slot = Math.max(now, b.last + b.delay);
  b.last = slot;
  if (slot > now) await sleep(slot - now);
}

/**
 * GET `url` with `params` through `source`'s rate bucket (a RATE_DEFAULTS key),
 * retrying transient failures.
 */
async function fetchJSON(source, url, params, {
  is404Ok = false, responseType = "json", maxRetries: retries = apiSettings.maxRetries,
} = {}) {
  if (!rateBuckets[source]) throw new Error(`Unknown rate-limit source: ${source}`);
  const { retryBaseMs } = apiSettings;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(source);
    try {
      const resp = await fetch(u.toString());
      if (resp.ok) {
        rateSuccess(source);
        return responseType === "text" ? resp.text() : resp.json();
      }
      if (resp.status === 404 && is404Ok) return null;
      // 429 and 5xx are transient: retry, then surface as an error so
      // congestion is never mistaken for a genuine miss.
      if (resp.status === 429 || resp.status >= 500) {
        rateBackoff(source);
        if (attempt < retries) {
          const wait = retryBaseMs * Math.pow(2, attempt);
          console.warn(`Transient ${resp.status} on attempt ${attempt + 1}, retrying in ${wait}ms...`);
          await sleep(wait);
          continue;
        }
        throw new TransientLookupError(`HTTP ${resp.status} after ${retries + 1} attempts`);
      }
      // Other 4xx responses are a definitive negative (e.g. empty query).
      return null;
    } catch (err) {
      if (err instanceof TransientLookupError) throw err;
      rateBackoff(source);
      if (attempt < retries) {
        const wait = retryBaseMs * Math.pow(2, attempt);
        console.warn(`Request failed (${err.message}), retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      throw new TransientLookupError(`Network error after ${retries + 1} attempts: ${err.message}`);
    }
  }
  return null;
}

// ─── Per-source searches ─────────────────────────────────────────────
async function searchSSMatch(title) {
  const data = await fetchJSON("ss", SS_MATCH, { query: title, fields: SS_FIELDS }, { is404Ok: true });
  if (!data?.data?.[0]) return null;
  return ssToStandard(data.data[0]);
}

async function searchSSSearch(title) {
  const data = await fetchJSON("ss", SS_SEARCH, { query: title, limit: "5", fields: SS_FIELDS });
  return (data?.data || []).map(ssToStandard);
}

async function searchCrossref(title) {
  const data = await fetchJSON("cr", CROSSREF_API, {
    "query.title": title, rows: "5",
    select: "title,author,published-print,published-online,container-title,volume,issue,page,DOI,publisher,URL,type",
  });
  return (data?.message?.items || []).map(crossrefToStandard);
}

async function searchOpenAlex(title) {
  // Keep this request limited to the title; no user or file identifiers.
  const data = await fetchJSON("oa", OPENALEX_API, {
    search: title, per_page: "5", select: OPENALEX_FIELDS,
  });
  return (data?.results || []).map(openAlexToStandard);
}

// DOI providers receive only the entry's DOI, never its title or other fields.
async function searchDataCiteDoi(value) {
  if (!normalizeDoi(value)) return null;
  const data = await fetchJSON("dc", `${DATACITE_API}/${encodeDoiPath(value)}`, {
    enriched: "true", affiliation: "true", publisher: "true",
  }, { is404Ok: true });
  return data ? dataCiteToStandard(data) : null;
}

async function searchDoiCitation(value) {
  const doi = normalizeDoi(value);
  if (!doi) return null;
  const bibtex = await fetchJSON("doi", DOI_CITATION_API, {
    doi, style: "bibtex", lang: "en-US",
  }, {
    is404Ok: true,
    responseType: "text",
    // DataCite is the fallback, so do not hold the run through the full retry
    // budget when the primary formatter is temporarily unavailable.
    maxRetries: 1,
  });
  const entry = parseBib(bibtex || "")[0];
  return entry ? doiBibtexToStandard(entry) : null;
}

/**
 * Find the best title match. `onPartial` receives the best match known so far
 * whenever Semantic Scholar or CrossRef answers, before the final decision.
 */
async function lookupByTitle(title, attempt, onPartial = () => {}) {
  if (!title.trim()) return null;

  let ssMatch = null, crMatch = null;
  // Same priority as the final decision below: a credible Semantic Scholar
  // match (merged with CrossRef when they agree), otherwise CrossRef.
  const bestSoFar = () => (ssMatch
    ? (crMatch && isSamePaper(ssMatch, crMatch) ? mergeMetadata(ssMatch, crMatch) : ssMatch)
    : crMatch);
  const report = () => { const m = bestSoFar(); if (m) onPartial(m); };

  // These providers are independent. Starting them together removes one full
  // network round trip per entry without changing source priority or match
  // selection. Each provider still uses its own adaptive rate bucket.
  await Promise.all([
    attempt(() => searchSSMatch(title)).then((m) => {
      ssMatch = m && titleSimilarity(title, m.title || "") >= MIN_TITLE_SIM ? m : null;
      report();
    }),
    attempt(() => searchCrossref(title)).then((results) => {
      crMatch = bestMatch(results || [], title);
      report();
    }),
  ]);

  if (ssMatch) {
    let merged = bestSoFar();

    // Avoid another request for already-complete lists. If a matched source
    // supplies initials only, OpenAlex can often provide the authors' full
    // display names.
    if (authorsNeedEnrichment(merged.author)) {
      const oaMatch = bestMatch((await attempt(() => searchOpenAlex(title))) || [], title);
      if (oaMatch && isSamePaper(merged, oaMatch)) merged = mergeMetadata(merged, oaMatch);
    }
    return merged;
  }

  if (crMatch) return crMatch;

  const oaMatch = bestMatch((await attempt(() => searchOpenAlex(title))) || [], title);
  if (oaMatch) return oaMatch;

  return bestMatch((await attempt(() => searchSSSearch(title))) || [], title);
}

function doiRecordMatchesEntry(entry, found) {
  if (!found?.title) return false;
  if (found._doiActive === false
      || (found._doiState && found._doiState !== "findable")) return false;
  if (entry.title?.trim()
      && titleSimilarity(entry.title, found.title) < TITLE_MATCH_THRESHOLD) return false;
  // isSamePaper also checks year and author overlap. The resolved DOI title
  // lets DOI-only entries pass while retaining those checks.
  return isSamePaper({ ...entry, title: found.title }, found);
}

/**
 * Check a supplied DOI through DOI.org (falling back to DataCite), then find
 * and merge matching title metadata. Returns null when no source has a credible record.
 * Throws TransientLookupError when nothing matched but a source failed
 * transiently, so the caller can retry instead of reporting "not found".
 *
 * `onProgress(found)` is called with the best provisional record each time a
 * source answers and changes it. It is never called after this resolves, and
 * the resolved value is always the final decision.
 */
export async function lookupPaper(title, doi = "", original = {}, onProgress = null) {
  title = String(title || "");
  let transient = false;
  const attempt = async (fn) => {
    try { return await fn(); }
    catch (err) {
      if (err instanceof TransientLookupError) { transient = true; return null; }
      throw err;
    }
  };

  // The DOI-specific record is primary. Matching title sources may fill
  // fields it does not carry, or provide a more complete author list.
  const combine = (doiMatch, titleMatch) => (doiMatch
    ? (titleMatch && isSamePaper(doiMatch, titleMatch) ? mergeMetadata(doiMatch, titleMatch) : doiMatch)
    : titleMatch);

  let doiSoFar = null, titleSoFar = null, lastReported = "";
  const report = () => {
    if (!onProgress) return;
    const best = combine(doiSoFar, titleSoFar);
    const key = best ? JSON.stringify(best) : "";
    if (!best || key === lastReported) return;
    lastReported = key;
    // A display error must not turn into a failed lookup.
    try { onProgress(best); } catch (err) { console.error("onProgress failed:", err); }
  };

  const entry = { ...original, title: title || original.title || "" };
  // DOI and title providers do not depend on each other, so overlap their
  // network waits. Both results are still evaluated before returning.
  const [doiRecord, titleMatch] = await Promise.all([
    doi ? (async () => {
      const record = (await attempt(() => searchDoiCitation(doi)))
        || await attempt(() => searchDataCiteDoi(doi));
      if (doiRecordMatchesEntry(entry, record)) { doiSoFar = record; report(); }
      return record;
    })() : Promise.resolve(null),
    lookupByTitle(title, attempt, (partial) => { titleSoFar = partial; report(); }),
  ]);
  const doiMatch = doiRecordMatchesEntry(entry, doiRecord) ? doiRecord : null;

  if (doiMatch || titleMatch) return combine(doiMatch, titleMatch);

  if (transient) throw new TransientLookupError("inconclusive lookup");
  return null;
}
