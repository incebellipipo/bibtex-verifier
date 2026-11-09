// Entry cards: rendering, status/summary badges, and filter/search visibility.
import {
  applyFieldEdits, COMPARED_FIELDS, defaultDiffEdit, defaultPlainEdit, doiLinkState, doiUrl,
  encodeEntryNames, entriesToBib,
  entryMatchesQuery, fieldToBibtex, groupDuplicateResultIndices, stripLatex, truncateAuthors,
} from "../lib/index.js";
import { $, $$, esc } from "./dom.js";
import { getSettings } from "./settings.js";
import { state } from "./state.js";

const entryList = $(".entry-list");
const entryEmpty = $("#entry-empty");

const STATUS_LABELS = {
  verified: "Verified",
  updated: "Auto-Updated",
  needs_review: "Needs Review",
  not_found: "Not Found",
};

export function statusLabel(s) {
  return STATUS_LABELS[s] || s;
}

const REMOVE_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const VERIFIED_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
// External-link icon using the familiar Lucide/Feather box-and-arrow shape.
const EXTERNAL_LINK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;
const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
const REVERT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>`;
const CHEVRON_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
const CODE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>`;

function statusTagContent(status, result) {
  const sources = result.verification_sources || [];
  const sourceText = sources.length ? ` via ${esc(sources.join(" + "))}`
    : result.online_manual_review ? " · Online source" : "";
  return `${status === "verified" ? VERIFIED_ICON : ""}${statusLabel(status)}${sourceText}`;
}

function statusTagClass(status) {
  return `status-tag tag-result-status tag-${status}`;
}

export const DIFF_TABLE_HEADER = `<tr><th>Field</th><th>Your Value</th><th>Suggested</th><th></th></tr>`;

export function removeFieldButton(idx, field, currentAction, title = "Remove field") {
  return `<button type="button" class="fa-btn-x ${currentAction === "remove" ? "active" : ""}"
            title="${title}" aria-label="${title}"
            data-entry="${idx}" data-field="${esc(field)}" data-action="remove">
      ${REMOVE_ICON}
    </button>`;
}

function doiLink(value) {
  const url = doiUrl(value);
  if (!url) return "";
  const hoverText = `Open DOI in a new tab: ${url}`;
  return `<a class="doi-external-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
            title="${esc(hoverText)}" aria-label="${esc(hoverText)}">${EXTERNAL_LINK_ICON}</a>`;
}

const DOI_TONE_LABELS = {
  unchanged: "unchanged",
  updated: "auto-updated from the database",
  review: "needs review",
};

/** Link to the DOI the entry will be exported with, colored by its state. */
function doiActionLink(idx) {
  const doiState = doiLinkState(state.parsedEntries[idx] || {}, state.results[idx], state.fieldEdits[idx]);
  if (!doiState) return "";
  const url = doiUrl(doiState.doi);
  const label = state.results[idx]?.status === "not_found"
    ? "not confirmed by DOI.org or DataCite" : DOI_TONE_LABELS[doiState.tone];
  return `<a class="doi-action-link doi-${doiState.tone}" href="${esc(url)}" target="_blank"
      rel="noopener noreferrer" title="${esc(`DOI ${label}: ${url}`)}"
      aria-label="${esc(`Open DOI (${label}) in a new tab`)}">DOI ${EXTERNAL_LINK_ICON}</a>`;
}

/** Refresh the action-row DOI link after the entry's DOI choice changes. */
export function syncDoiActionLink(card) {
  const actions = card?.querySelector(".entry-actions");
  if (!actions) return;
  actions.querySelector(".doi-action-link")?.remove();
  actions.insertAdjacentHTML("beforeend", doiActionLink(Number(card.dataset.index)));
}

function doiValueWrap(valueHTML, value) {
  return `<span class="doi-value-wrap">${valueHTML}${doiLink(value)}</span>`;
}

export function editableEntryBib(idx) {
  const entry = applyFieldEdits(state.parsedEntries[idx], state.fieldEdits[idx]);
  return entriesToBib([encodeEntryNames(entry)]).trim();
}

// ─── Visibility (filter + search) ────────────────────────────────────
function cardMatchesFilter(card) {
  if (state.activeFilter === "all") return true;
  if (state.activeFilter === "duplicate") return card.dataset.duplicate === "true";
  return card.dataset.status === state.activeFilter;
}

function cardMatchesSearch(card) {
  const r = state.results[card.dataset.index];
  return !r || entryMatchesQuery(r, state.activeSearch);
}

function applyCardVisibility(card) {
  card.classList.toggle("hidden", !(cardMatchesFilter(card) && cardMatchesSearch(card)));
}

function updateEntryEmptyState() {
  const cards = $$(".entry-card");
  if (!cards.length) { entryEmpty.classList.remove("visible"); return; }
  const anyVisible = [...cards].some(c => !c.classList.contains("hidden"));
  entryEmpty.classList.toggle("visible", !anyVisible);
}

function arrangeCards() {
  const order = state.activeFilter === "all"
    ? groupDuplicateResultIndices(state.results)
    : state.results.filter(Boolean).map(result => result.index);
  for (const index of order) {
    const card = entryList.querySelector(`.entry-card[data-index="${index}"]`);
    if (card) entryList.appendChild(card);
  }
}

export function applyAllCardVisibility() {
  arrangeCards();
  $$(".entry-card").forEach(applyCardVisibility);
  updateEntryEmptyState();
}

export function clearCards() {
  entryList.innerHTML = "";
  entryEmpty.classList.remove("visible");
}

// ─── Summary + effective status ──────────────────────────────────────
export function updateSummary() {
  const c = { verified: 0, updated: 0, needs_review: 0, not_found: 0 };
  let dupes = 0;
  $$(".entry-card").forEach(card => {
    c[card.dataset.status] = (c[card.dataset.status] || 0) + 1;
    if (card.dataset.duplicate === "true") dupes++;
  });
  $(".badge-all .summary-count").textContent = $$(".entry-card").length;
  $(".badge-verified .summary-count").textContent = c.verified;
  $(".badge-updated .summary-count").textContent = c.updated;
  $(".badge-review .summary-count").textContent = c.needs_review;
  $(".badge-notfound .summary-count").textContent = c.not_found;
  $(".badge-duplicates .summary-count").textContent = dupes;
}

/**
 * Re-derive each card's displayed status from its visible diff rows: author
 * truncation can add a suggestion to a verified entry, or hide the only
 * difference of an updated one.
 */
export function updateCardStatuses() {
  $$(".entry-card").forEach(card => {
    const r = state.results[card.dataset.index];
    if (!r) return;
    if (!card.dataset.origStatus) card.dataset.origStatus = r.status;
    const savedStatus = card.dataset.origStatus;

    const diffRows = card.querySelectorAll(".diff-row:not(.field-row-plain)");
    const hasVisibleDiffs = diffRows.length > 0 && ![...diffRows].every(row => row.classList.contains("author-match-hidden"));
    const hasInjectedRows = card.querySelector(".diff-row[data-injected]") !== null;

    let effectiveStatus = savedStatus;
    if (r.online_manual_review) effectiveStatus = "needs_review";
    else if (hasInjectedRows && hasVisibleDiffs && savedStatus === "verified") effectiveStatus = "updated";
    else if (!hasVisibleDiffs && (savedStatus === "updated" || savedStatus === "needs_review")) effectiveStatus = "verified";

    card.dataset.status = effectiveStatus;
    card.className = card.className.replace(/status-\S+/, `status-${effectiveStatus}`);
    const tag = card.querySelector(".tag-result-status");
    if (tag) {
      tag.className = statusTagClass(effectiveStatus);
      tag.innerHTML = statusTagContent(effectiveStatus, r);
    }

    const diffTable = card.querySelector(".diff-table:not(.fields-table)");
    if (diffTable) diffTable.style.display = !hasVisibleDiffs && !hasInjectedRows ? "none" : "";
    const actions = card.querySelector(".entry-actions");
    if (actions) {
      actions.querySelectorAll(".btn-accept-all, .btn-revert-all").forEach(btn => btn.hidden = !hasVisibleDiffs);
    }
  });

  updateSummary();
}

// ─── Rendering ───────────────────────────────────────────────────────
/**
 * A suggestion row comparing the entry's value with `d.found`. `injected`
 * marks the author-truncation row, which is not a lookup suggestion.
 */
export function renderDiffRow(r, idx, d, hasSuggestion, maxAuthors, { injected = false } = {}) {
  d = { ...d, original: fieldToBibtex(d.field, d.original), found: fieldToBibtex(d.field, d.found) };
  if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};
  const edits = state.fieldEdits[idx];
  const isEnrichment = !(d.original || "").trim();

  if (!edits[d.field]) edits[d.field] = defaultDiffEdit(d, r.status);
  const fe = edits[d.field];
  const currentAction = fe.action;

  const suggestionText = fieldToBibtex(d.field,
    currentAction === "custom" ? fe.value : currentAction === "remove" ? fe._savedValue : d.found);
  const displaySuggestion = (d.field === "author" && maxAuthors > 0 && currentAction !== "custom")
    ? truncateAuthors(suggestionText, maxAuthors) : suggestionText;
  const authorMatchHidden = d.field === "author" && maxAuthors > 0 && displaySuggestion.trim() === (d.original || "").trim();
  const originalHTML = `<button class="choice-pill pill-original ${isEnrichment ? "pill-none" : ""} ${currentAction === "original" ? "active" : ""} ${currentAction === "remove" ? "removed" : ""}"
                data-entry="${idx}" data-field="${esc(d.field)}" data-action="original" data-val="${esc(d.original || "")}"
                title="${isEnrichment ? "Do not add this field" : "Keep your value"}">${isEnrichment ? '<code class="none-label">None</code>' : esc(d.original)}</button>`;
  const suggestedHTML = `<span class="choice-pill pill-suggested ${currentAction === "found" || currentAction === "custom" ? "active" : ""} ${currentAction === "remove" ? "removed" : ""}"
                contenteditable="${currentAction === "remove" ? "false" : "true"}"
                spellcheck="false"
                data-entry="${idx}" data-field="${esc(d.field)}" data-action="found" data-val="${esc(d.found || "")}"
                title="Use suggested value (click to select, edit to customize)">${esc(displaySuggestion)}</span>`;

  return `<tr class="diff-row${authorMatchHidden ? " author-match-hidden" : ""}" data-entry="${idx}" data-field="${esc(d.field)}" data-action="${currentAction}"
      data-enrichment="${isEnrichment ? "1" : ""}"${injected ? ' data-injected="1"' : ""}
      data-found-val="${encodeURIComponent(d.found || "")}"
      data-original-val="${encodeURIComponent(d.original || "")}">
      <td class="field-name"><span class="field-name-pill">${esc(d.field)}</span></td>
      <td class="val-col val-col-original">
        ${d.field === "doi" && d.original ? doiValueWrap(originalHTML, d.original) : originalHTML}
      </td>
      <td class="val-col val-col-suggested">
        ${hasSuggestion ? (d.field === "doi"
          ? doiValueWrap(suggestedHTML, suggestionText)
          : `<span class="suggested-value-wrap">${suggestedHTML}</span>`) : ""}
      </td>
      <td class="field-actions-mini">
        ${removeFieldButton(idx, d.field, currentAction, isEnrichment ? "Remove suggested field" : "Remove field")}
      </td>
    </tr>`;
}

/** A row for a field the lookup made no suggestion for. */
export function renderPlainFieldRow(idx, f, entry) {
  if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};
  const edits = state.fieldEdits[idx];
  if (!edits[f]) edits[f] = defaultPlainEdit(entry[f]);
  const fe = edits[f];
  const removed = fe.action === "remove";
  const value = fieldToBibtex(f, removed ? fe._savedValue : fe.value);
  const valueHTML = `<span class="choice-pill pill-value ${removed ? "removed" : "active"}"
              contenteditable="${removed ? "false" : "true"}" spellcheck="false"
              data-entry="${idx}" data-field="${esc(f)}">${esc(value)}</span>`;

  return `<tr class="diff-row field-row-plain" data-entry="${idx}" data-field="${esc(f)}" data-action="${fe.action}">
      <td class="field-name"><span class="field-name-pill">${esc(f)}</span></td>
      <td class="val-col" colspan="2">
        ${f === "doi" ? doiValueWrap(valueHTML, value) : valueHTML}
      </td>
      <td class="field-actions-mini">
        ${removeFieldButton(idx, f, fe.action)}
      </td>
    </tr>`;
}

function fieldsSectionHTML(rows, count, hasDiffs) {
  return `<div class="fields-toggle-wrap collapsed">
    <button class="fields-toggle-btn" type="button">
      <svg class="fields-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      ${hasDiffs ? "Other fields" : "Fields"} (<span class="fields-count">${count}</span>)
    </button>
    <table class="diff-table fields-table">
      <tr><th>Field</th><th colspan="2">Value</th><th></th></tr>
      ${rows}
    </table>
  </div>`;
}

export function appendAddedFieldRow(card, idx, field) {
  let wrap = card.querySelector(".fields-toggle-wrap");
  if (!wrap) {
    const hasDiffs = card.querySelector(".diff-table:not(.fields-table)") !== null;
    card.querySelector(".entry-actions").insertAdjacentHTML(
      "beforebegin",
      fieldsSectionHTML(renderPlainFieldRow(idx, field, state.parsedEntries[idx]), 1, hasDiffs),
    );
    wrap = card.querySelector(".fields-toggle-wrap");
  } else {
    wrap.querySelector(".fields-table").insertAdjacentHTML(
      "beforeend",
      renderPlainFieldRow(idx, field, state.parsedEntries[idx]),
    );
    const count = wrap.querySelectorAll(".field-row-plain").length;
    wrap.querySelector(".fields-count").textContent = count;
  }
  wrap.classList.remove("collapsed");
}

function renderHints(r) {
  let html = "";
  if (r.duplicate_of)
    html += `<div class="duplicate-row">Duplicate of <strong>${esc(r.duplicate_of)}</strong></div>`;

  if (r.online_manual_review) {
    let sourceLink = "";
    try {
      const url = new URL(r.online_url);
      if (["http:", "https:"].includes(url.protocol)) {
        sourceLink = `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Open source page</a>`;
      }
    } catch { /* The editable URL field may currently be incomplete. */ }
    html += `<div class="online-source-hint">
      <strong>Online source:</strong> academic-paper indexes are not authoritative for this entry.
      Review its title, author, publication date, and organization on the source page.
      ${sourceLink}
    </div>`;
  }

  if (r.status === "needs_review" && r.found_title) {
    html += `<div class="review-hint">The closest database record may not be the paper you meant
      (<strong>${esc(String(r.title_score))}%</strong> title similarity to
      <strong class="review-hint-match">${esc(r.found_title)}</strong>).
      Review the suggestions below and use the checkmark on each row to adopt a value, or keep your original text.</div>`;
  }

  if (r.status === "not_found") {
    html += `<div class="not-found-hint">${(r.title || "").trim()
      ? "No matching publication was found for this title, and any supplied DOI could not be confirmed through DOI.org or DataCite. Try fixing typos or check the reference manually."
      : "This entry has neither a title nor a confirmed DOI. Add one to your .bib file or verify the entry by hand."}</div>`;
  }
  return html;
}

function renderSearchLinks(title) {
  if (!(title || "").trim()) return "";
  const q = encodeURIComponent(stripLatex(title));
  return `<div class="search-links">
    <a class="search-link" href="https://scholar.google.com/scholar?q=${q}" target="_blank" rel="noopener" title="Google Scholar">
      <img src="https://scholar.google.com/favicon.ico" width="14" height="14" alt="Scholar">
    </a>
    <a class="search-link" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener" title="Google">
      <img src="https://www.google.com/favicon.ico" width="14" height="14" alt="Google">
    </a>
    <a class="search-link" href="https://www.semanticscholar.org/search?q=${q}" target="_blank" rel="noopener" title="Semantic Scholar">
      <img src="https://www.semanticscholar.org/favicon.ico" width="14" height="14" alt="S2">
    </a>
    <a class="search-link search-link-crossref" href="https://search.crossref.org/?q=${q}&from_ui=yes" target="_blank" rel="noopener" title="CrossRef">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="search-link-svg">
        <rect width="24" height="24" rx="4" fill="#f89838"/>
        <path fill="#fff" fill-rule="evenodd" d="M7 8h10v2H7V8zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
      </svg>
    </a>
    <a class="search-link" href="https://dblp.org/search?q=${q}" target="_blank" rel="noopener" title="DBLP">
      <img src="https://dblp.org/img/dblp.icon.192x192.png" width="14" height="14" alt="DBLP">
    </a>
  </div>`;
}

function headerHTML(r, idx, manuallyChecked) {
  const tagTitle = (r.verification_sources || []).length
    ? `Metadata source: ${r.verification_sources.join(", ")}`
    : r.online_manual_review ? "Online source requiring manual review" : statusLabel(r.status);
  // The Checked marker is not offered until the result is final.
  const checkedControl = r.checking ? "" : `<label class="entry-review-control entry-checked-control"
      title="Manual review marker; does not change verification status">
    <span class="entry-checked-label">Checked</span>
    <span class="entry-checked-box">
      <input class="entry-checked-checkbox" type="checkbox" data-entry="${idx}"
        ${manuallyChecked ? "checked" : ""} aria-label="Mark this entry as manually checked">
    </span>
  </label>`;

  return `<div class="entry-header">
    <div class="entry-header-text">
      <div class="entry-title">${esc(r.title || "(no title)")}</div>
      <div class="entry-meta">${esc(r.entry_id)} &middot; ${esc(r.entry_type)}</div>
    </div>
    <div class="entry-header-aside">
      <div class="entry-tags">
        ${r.duplicate_of ? '<span class="status-tag tag-duplicate">Duplicate</span>' : ""}
        <span class="${statusTagClass(r.status)}" title="${esc(tagTitle)}">
          ${statusTagContent(r.status, r)}
        </span>
        ${r.checking ? `<span class="status-tag tag-checking" role="status"
          title="Provisional: other sources are still being checked">Checking…</span>` : ""}
      </div>
      <div class="entry-review-controls" role="group" aria-label="Entry review controls">
        ${checkedControl}
        <button class="btn-jump-preview" type="button" data-entry-id="${esc(r.entry_id)}" title="Scroll to this entry in the live preview">
          ${CHEVRON_ICON}${CHEVRON_ICON}
        </button>
        <button class="btn-text-edit-entry" type="button" data-entry="${idx}"
            aria-expanded="false" aria-controls="entry-text-editor-${idx}" title="Edit this entry as BibTeX text">
          ${CODE_ICON}
          <span>Text edit</span>
        </button>
      </div>
    </div>
  </div>`;
}

function textEditorHTML(r, idx) {
  return `<form class="entry-text-editor" id="entry-text-editor-${idx}" data-entry="${idx}" hidden>
    <div class="entry-text-editor-heading">
      <div>
        <strong>Edit BibTeX entry</strong>
        <span>Applying replaces this entry and resets its field choices. Re-run verification after changing its title or DOI.</span>
      </div>
      <kbd>Ctrl/⌘ + Enter</kbd>
    </div>
    <textarea class="entry-text-editor-input" spellcheck="false" aria-label="BibTeX text for ${esc(r.entry_id || `entry ${idx + 1}`)}">${esc(editableEntryBib(idx))}</textarea>
    <div class="entry-text-editor-footer">
      <div class="entry-text-editor-error" role="alert" aria-live="polite"></div>
      <button type="button" class="entry-text-editor-cancel">Cancel</button>
      <button type="submit" class="entry-text-editor-apply">Apply text</button>
    </div>
  </form>`;
}

/** The suggestion table plus the collapsible table of the entry's other fields. */
function fieldTablesHTML(r, idx, entry, hasSuggestion) {
  const diffs = r.field_diffs || [];
  let html = "";
  if (diffs.length) {
    const maxAuthors = getSettings().maxAuthors;
    html = `<table class="diff-table">
      ${DIFF_TABLE_HEADER}
      ${diffs.map(d => renderDiffRow(r, idx, d, hasSuggestion, maxAuthors)).join("")}
    </table>`;
  }

  const diffFields = new Set(diffs.map(d => d.field));
  const addedFields = Object.entries(state.fieldEdits[idx])
    .filter(([field, edit]) => edit?._added && !diffFields.has(field))
    .map(([field]) => field);
  const extraFields = [...new Set([
    ...["title", ...COMPARED_FIELDS].filter(f => !diffFields.has(f) && (entry[f] || "").trim()),
    ...addedFields,
  ])];
  if (extraFields.length) {
    const rows = extraFields.map(f => renderPlainFieldRow(idx, f, entry)).join("");
    html += fieldsSectionHTML(rows, extraFields.length, diffs.length > 0);
  }
  return html;
}

/** Reads the field choices that fieldTablesHTML records, so render it after. */
function actionsHTML(r, idx, hasSuggestion) {
  let bulk = "";
  if (hasSuggestion && r.field_diffs?.length) {
    const edits = state.fieldEdits[idx];
    const allFound = r.field_diffs.every(d => edits[d.field]?.action === "found");
    const allOriginal = r.field_diffs.every(d => edits[d.field]?.action === "original");
    bulk = `<button class="seg-btn btn-accept-all ${allFound ? "active-accept" : ""}" data-entry="${idx}">
        ${CHECK_ICON}
        Accept all
      </button>
      <button class="seg-btn btn-revert-all ${allOriginal ? "active-revert" : ""}" data-entry="${idx}">
        ${REVERT_ICON}
        Keep original
      </button>`;
  }
  return `<div class="entry-actions">
      ${bulk}
      <button type="button" class="seg-btn btn-add-field" data-entry="${idx}">+ Add field</button>
      <button type="button" class="seg-btn btn-delete-entry" data-entry="${idx}">Delete</button>
      ${doiActionLink(idx)}
    </div>`;
}

function addFieldFormHTML(idx) {
  return `<form class="add-field-form" data-entry="${idx}" hidden>
    <label>
      <span>Field name</span>
      <input class="add-field-name" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="e.g. keywords">
    </label>
    <label class="add-field-value-label">
      <span>Value</span>
      <input class="add-field-value" type="text" autocomplete="off" spellcheck="false" placeholder="Field value">
    </label>
    <button type="submit" class="add-field-submit">Add</button>
    <button type="button" class="add-field-cancel">Cancel</button>
    <div class="add-field-error" role="alert" aria-live="polite"></div>
  </form>`;
}

/**
 * A provisional result is replaced as more sources answer, and its field
 * choices are discarded then, so suggestions and edits stay locked until the
 * final result. Delete and preview jump stay usable.
 */
function lockProvisionalCard(card) {
  card.classList.add("checking");
  card.setAttribute("aria-busy", "true");
  card.querySelectorAll(
    ".diff-table, .fields-toggle-wrap, .btn-accept-all, .btn-revert-all, .btn-add-field, .btn-text-edit-entry",
  ).forEach(el => { el.inert = true; });
}

export function renderEntryCard(r) {
  const idx = r.index;
  if (state.deletedEntries.has(idx)) return;
  const entry = state.parsedEntries[idx];
  if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};

  const card = document.createElement("div");
  const manuallyChecked = state.checkedEntries.has(idx);
  card.className = `entry-card status-${r.status}${manuallyChecked ? " user-checked" : ""}`;
  card.dataset.status = r.status;
  card.dataset.index = idx;
  if (r.duplicate_of) card.dataset.duplicate = "true";

  // Verified entries can still carry enrichment-only diffs worth adopting.
  const hasSuggestion = r.status === "updated" || r.status === "needs_review"
    || (r.status === "verified" && r.field_diffs?.length > 0);
  const fields = fieldTablesHTML(r, idx, entry, hasSuggestion);
  card.innerHTML = headerHTML(r, idx, manuallyChecked) + textEditorHTML(r, idx) + renderHints(r)
    + fields + actionsHTML(r, idx, hasSuggestion) + addFieldFormHTML(idx) + renderSearchLinks(r.title);
  if (r.checking) lockProvisionalCard(card);

  applyCardVisibility(card);
  // Re-rendered cards (provisional updates, retries) replace the old one in place.
  const existing = entryList.querySelector(`.entry-card[data-index="${idx}"]`);
  if (existing) entryList.replaceChild(card, existing);
  else entryList.appendChild(card);
  arrangeCards();
  updateEntryEmptyState();
}
