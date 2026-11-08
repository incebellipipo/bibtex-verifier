// "Max authors" setting: reflect truncation in author diff rows, and inject a
// truncation suggestion for entries whose lookup didn't suggest an author.
import { namesToBibtex, truncateAuthors } from "../lib/index.js";
import { DIFF_TABLE_HEADER, removeFieldButton, updateCardStatuses } from "./cards.js";
import { $$, esc } from "./dom.js";
import { getSettings } from "./settings.js";
import { state } from "./state.js";

function refreshAuthorDiffRows(max) {
  $$('.diff-row[data-field="author"]:not([data-injected])').forEach(row => {
    const sugPill = row.querySelector(".pill-suggested");
    if (!sugPill || row.dataset.action === "custom") return;
    const foundVal = namesToBibtex(decodeURIComponent(row.getAttribute("data-found-val") || ""));
    const origVal = namesToBibtex(decodeURIComponent(row.getAttribute("data-original-val") || ""));
    const truncated = max > 0 ? truncateAuthors(foundVal, max) : foundVal;
    sugPill.textContent = truncated;
    row.classList.toggle("author-match-hidden", truncated.trim() === origVal.trim());
  });
}

function removeInjectedRows() {
  $$(".diff-row[data-injected]").forEach(row => {
    const card = row.closest(".entry-card");
    row.remove();
    if (card) {
      const diffTable = card.querySelector(".diff-table:not(.fields-table)");
      if (diffTable && diffTable.querySelectorAll(".diff-row").length === 0) diffTable.remove();
      card.querySelector('.field-row-plain[data-field="author"]')?.classList.remove("author-match-hidden");
    }
  });
}

function injectedRowHTML(idx, author, truncated, edit) {
  author = namesToBibtex(author);
  truncated = namesToBibtex(truncated);
  const action = edit.action;
  const suggestion = action === "custom" ? edit.value
    : action === "remove" ? edit._savedValue || truncated : truncated;
  const removedClass = action === "remove" ? "removed" : "";
  return `<tr class="diff-row" data-entry="${idx}" data-field="author" data-action="${action}"
      data-enrichment="" data-injected="1"
      data-found-val="${encodeURIComponent(truncated)}"
      data-original-val="${encodeURIComponent(author)}">
      <td class="field-name"><span class="field-name-pill">author</span></td>
      <td class="val-col val-col-original">
        <button class="choice-pill pill-original ${action === "original" ? "active" : ""} ${removedClass}"
                data-entry="${idx}" data-field="author" data-action="original" data-val="${esc(author)}"
                title="Keep your value">${esc(author)}</button>
      </td>
      <td class="val-col val-col-suggested">
        <span class="choice-pill pill-suggested ${action === "found" || action === "custom" ? "active" : ""} ${removedClass}"
                contenteditable="${action === "remove" ? "false" : "true"}" spellcheck="false"
                data-entry="${idx}" data-field="author" data-action="found" data-val="${esc(truncated)}"
                title="Use suggested value (click to select, edit to customize)">${esc(namesToBibtex(suggestion))}</span>
      </td>
      <td class="field-actions-mini">
        ${removeFieldButton(idx, "author", action)}
      </td>
    </tr>`;
}

function injectTruncationRows(max) {
  $$(".entry-card").forEach(card => {
    const idx = parseInt(card.dataset.index);
    const entry = state.parsedEntries[idx];
    const res = state.results[idx];
    if (!entry || !entry.author) return;
    // No lookup match — don't present truncation as if it were an API suggestion.
    if (res && res.status === "not_found") return;
    if (card.querySelector('.diff-row[data-field="author"]:not(.field-row-plain)')) return;

    if (entry.author.split(/\s+and\s+/i).length <= max) return;
    const truncated = truncateAuthors(entry.author, max);
    if (truncated.trim() === entry.author.trim()) return;

    if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};
    const existing = state.fieldEdits[idx].author;
    // A manually edited or removed plain author field takes precedence over an
    // injected truncation suggestion.
    if (existing && !existing._injected && ["custom", "remove"].includes(existing.action)) return;

    let edit = existing?._injected ? existing : null;
    if (!edit) {
      edit = { action: "found", value: truncated, _injected: true };
    } else if (edit.action === "found") {
      edit = { ...edit, value: truncated };
    } else if (edit.action === "remove" && edit._savedAction === "found") {
      edit = { ...edit, _savedValue: truncated };
    }
    state.fieldEdits[idx].author = edit;

    let diffTable = card.querySelector(".diff-table:not(.fields-table)");
    if (!diffTable) {
      const insertAfter = card.querySelector(".review-hint") || card.querySelector(".not-found-hint") || card.querySelector(".entry-header");
      insertAfter.insertAdjacentHTML("afterend", `<table class="diff-table">${DIFF_TABLE_HEADER}</table>`);
      diffTable = card.querySelector(".diff-table:not(.fields-table)");
    }
    diffTable.querySelector("tr").insertAdjacentHTML("afterend", injectedRowHTML(idx, entry.author, truncated, edit));

    card.querySelector('.field-row-plain[data-field="author"]')?.classList.add("author-match-hidden");
  });
}

function syncPreservedPlainAuthorEdits() {
  $$('.field-row-plain[data-field="author"]').forEach(row => {
    const idx = Number(row.dataset.entry);
    const edit = state.fieldEdits[idx]?.author;
    if (!edit || !["custom", "remove"].includes(edit.action)) return;
    const pill = row.querySelector(".pill-value");
    const xBtn = row.querySelector(".fa-btn-x");
    const removed = edit.action === "remove";
    row.dataset.action = edit.action;
    pill.textContent = namesToBibtex(removed ? edit._savedValue : edit.value);
    pill.classList.toggle("removed", removed);
    pill.classList.toggle("active", !removed);
    pill.contentEditable = removed ? "false" : "true";
    xBtn?.classList.toggle("active", removed);
  });
}

export function updateAuthorPills() {
  const max = getSettings().maxAuthors;
  refreshAuthorDiffRows(max);
  removeInjectedRows();
  if (max > 0) {
    injectTruncationRows(max);
  } else {
    for (const edits of Object.values(state.fieldEdits)) {
      if (!edits?.author?._injected) continue;
      if (["custom", "remove"].includes(edits.author.action)) delete edits.author._injected;
      else delete edits.author;
    }
    syncPreservedPlainAuthorEdits();
    $$('.field-row-plain[data-field="author"].author-match-hidden').forEach(row =>
      row.classList.remove("author-match-hidden"));
  }
  updateCardStatuses();
}
