import { normalizeDoi } from "./doi.js";
import { applyFieldEdits } from "./field-edits.js";
import { encodeEntryNames, normalizeTitle } from "./latex.js";
import { cleanEntryNotes } from "./notes.js";

export function truncateAuthors(authorStr, max) {
  if (!authorStr || max <= 0) return authorStr;
  const authors = authorStr.split(/\s+and\s+/i);
  if (authors.length <= max) return authorStr;
  return authors.slice(0, max).join(" and ") + " and others";
}

const isPreprintVenue = (venue) =>
  venue.includes("arxiv") || venue.includes("preprint") || venue.includes("corr");

function dedupKey(entry, dedupBy) {
  if (dedupBy === "doi") return normalizeDoi(entry.doi).toLowerCase();
  if (dedupBy === "id") return (entry.ID || "").toLowerCase().trim();
  return normalizeTitle(entry.title || "");
}

/**
 * Build the entries to export from the parsed entries processed so far
 * (`results[i]` belongs to `entries[i]`), the user's per-field choices, and
 * the download settings.
 *
 * `fieldEdits[i][field]` is an edit record (see field-edits.js).
 * `settings` is `{ removeDuplicates, dedupBy, removeNotFound, cleanNotes, maxAuthors, preferPublished }`.
 */
export function buildExportEntries(entries, results, fieldEdits, settings, deletedEntries = new Set()) {
  const s = settings;
  let final = entries.slice(0, results.length).map((entry, i) => {
    if (deletedEntries.has(i)) return null;
    const r = results[i];
    if (!r) return { ...entry };
    if (s.removeNotFound && r.status === "not_found") return null;

    const out = applyFieldEdits(entry, fieldEdits[i]);

    if (s.maxAuthors > 0 && out.author && r.status !== "not_found") {
      out.author = truncateAuthors(out.author, s.maxAuthors);
    }

    if (s.preferPublished && r.suggested) {
      const venue = (out.journal || out.booktitle || "").toLowerCase();
      const foundVenue = r.suggested.journal || r.suggested.booktitle || "";
      if (isPreprintVenue(venue) && foundVenue && !isPreprintVenue(foundVenue.toLowerCase())) {
        if (out.journal) out.journal = foundVenue;
        else if (out.booktitle) out.booktitle = foundVenue;
      }
    }
    const encoded = encodeEntryNames(out);
    return s.cleanNotes ? cleanEntryNotes(encoded) : encoded;
  }).filter(Boolean);

  if (s.removeDuplicates) {
    const seen = new Set();
    final = final.filter(entry => {
      const key = dedupKey(entry, s.dedupBy);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return final;
}

/**
 * Build a complete live preview while verification is still in progress.
 * Processed entries receive their current edits; entries without a result yet
 * remain unchanged instead of disappearing from the preview and clipboard.
 */
export function buildPreviewEntries(entries, results, fieldEdits, settings, deletedEntries = new Set()) {
  const completeResults = Array.from({ length: entries.length }, (_, i) => results[i]);
  return buildExportEntries(entries, completeResults, fieldEdits, settings, deletedEntries);
}
