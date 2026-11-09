import { compareEntry, fieldDiffsForNeedsReview } from "./compare.js";
import { normalizeDoi, sameDoi } from "./doi.js";
import { normalizeTitle } from "./latex.js";

const SOURCE_LABELS = {
  doi_org: "DOI.org",
  datacite: "DataCite",
  semantic_scholar: "Semantic Scholar",
  crossref: "CrossRef",
  openalex: "OpenAlex",
};
// DOI providers only count as verifying an entry when they confirm its own DOI.
const DOI_SOURCES = new Set(["doi_org", "datacite"]);

/** Labels of the sources behind `found` that verify `entry`, without duplicates. */
function verificationSources(entry, found) {
  const sources = String(found?._source || "").split("+");
  return [...new Set(sources
    .filter(source => SOURCE_LABELS[source]
      && (!DOI_SOURCES.has(source) || sameDoi(entry.doi, found.doi)))
    .map(source => SOURCE_LABELS[source]))];
}

export function isOnlineSource(entry) {
  return String(entry?.ENTRYTYPE || "").toLowerCase() === "online"
    && !!String(entry?.url || "").trim();
}

export function isOnlineOnlyEntry(entry) {
  return isOnlineSource(entry) && !normalizeDoi(entry?.doi);
}

/**
 * For each entry, the ID of an earlier entry with the same normalized title,
 * or null.
 */
export function findDuplicateTitles(entries) {
  const seen = new Map();
  return entries.map((entry, i) => {
    const key = normalizeTitle(entry.title || "");
    if (!key) return null;
    if (seen.has(key)) return seen.get(key);
    seen.set(key, entry.ID || `entry_${i}`);
    return null;
  });
}

/**
 * Result indices in bibliography order, except that each original is followed
 * immediately by all processed entries whose duplicate_of points to it.
 */
export function groupDuplicateResultIndices(results) {
  const idToIndex = new Map();
  for (const result of results) {
    if (!result || !result.entry_id || idToIndex.has(result.entry_id)) continue;
    idToIndex.set(result.entry_id, result.index);
  }

  const duplicatesByOriginal = new Map();
  for (const result of results) {
    if (!result?.duplicate_of) continue;
    const originalIndex = idToIndex.get(result.duplicate_of);
    if (originalIndex === undefined || originalIndex === result.index) continue;
    if (!duplicatesByOriginal.has(originalIndex)) duplicatesByOriginal.set(originalIndex, []);
    duplicatesByOriginal.get(originalIndex).push(result.index);
  }

  const order = [];
  const added = new Set();
  const add = (index) => {
    if (added.has(index)) return;
    added.add(index);
    order.push(index);
  };

  for (const result of results) {
    if (!result || added.has(result.index)) continue;
    const originalIndex = result.duplicate_of ? idToIndex.get(result.duplicate_of) : result.index;
    if (originalIndex !== undefined && originalIndex !== result.index) continue;
    add(result.index);
    for (const duplicateIndex of duplicatesByOriginal.get(result.index) || []) add(duplicateIndex);
  }

  // Keep orphaned duplicate markers visible if their original result is absent.
  for (const result of results) if (result) add(result.index);
  return order;
}

/**
 * Turn a lookup outcome into the result object the UI renders: a missing
 * `found` record is "not_found", otherwise the entry is compared against it.
 */
export function buildResult(entry, index, found, duplicateOf = null) {
  let status = "not_found", titleScore = 0, fieldDiffs = [], suggested = {};
  const onlineSource = isOnlineSource(entry);
  if (found) {
    const cmp = compareEntry(entry, found);
    status = cmp.status;
    titleScore = cmp.title_score;
    suggested = cmp.suggested;
    fieldDiffs = status === "needs_review" ? fieldDiffsForNeedsReview(entry, found) : cmp.field_diffs;
  } else if (onlineSource) {
    // Academic indexes are not authoritative for ordinary web pages. Keep the
    // entry visible for manual review instead of calling it nonexistent.
    status = "needs_review";
  }
  return {
    index,
    entry_id: entry.ID || "",
    entry_type: entry.ENTRYTYPE || "",
    title: entry.title || "",
    status,
    title_score: titleScore,
    field_diffs: fieldDiffs,
    suggested,
    found_title: found ? (found.title || "") : "",
    online_url: onlineSource ? entry.url : "",
    online_manual_review: onlineSource && !found,
    verification_sources: verificationSources(entry, found),
    // Retained in memory so a raw-text edit can be compared again without
    // another network request. Internal keys are never written to BibTeX.
    _found: found || null,
    duplicate_of: duplicateOf,
  };
}
