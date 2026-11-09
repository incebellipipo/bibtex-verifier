// "Max authors" setting: reflect truncation in author diff rows, and inject a
// truncation suggestion for entries whose lookup didn't suggest an author.
import { injectedAuthorEdit, namesToBibtex, truncateAuthors, withoutInjection } from "../lib/index.js";
import { DIFF_TABLE_HEADER, renderDiffRow, renderPlainFieldRow, updateCardStatuses } from "./cards.js";
import { $$ } from "./dom.js";
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

function injectTruncationRows(max) {
  $$(".entry-card").forEach(card => {
    const idx = parseInt(card.dataset.index);
    const entry = state.parsedEntries[idx];
    const res = state.results[idx];
    if (!entry || !entry.author) return;
    // Provisional cards are locked; truncation rows are added to the final one.
    if (res?.checking) return;
    // No lookup match — don't present truncation as if it were an API suggestion.
    if (res && (res.status === "not_found" || res.online_manual_review)) return;
    if (card.querySelector('.diff-row[data-field="author"]:not(.field-row-plain)')) return;

    if (entry.author.split(/\s+and\s+/i).length <= max) return;
    const truncated = truncateAuthors(entry.author, max);
    if (truncated.trim() === entry.author.trim()) return;

    if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};
    const edit = injectedAuthorEdit(state.fieldEdits[idx].author, truncated);
    if (!edit) return;
    state.fieldEdits[idx].author = edit;

    let diffTable = card.querySelector(".diff-table:not(.fields-table)");
    if (!diffTable) {
      const insertAfter = card.querySelector(".review-hint") || card.querySelector(".not-found-hint") || card.querySelector(".entry-header");
      insertAfter.insertAdjacentHTML("afterend", `<table class="diff-table">${DIFF_TABLE_HEADER}</table>`);
      diffTable = card.querySelector(".diff-table:not(.fields-table)");
    }
    diffTable.querySelector("tr").insertAdjacentHTML("afterend", renderDiffRow(
      res ?? {}, idx, { field: "author", original: entry.author, found: truncated }, true, max,
      { injected: true },
    ));

    card.querySelector('.field-row-plain[data-field="author"]')?.classList.add("author-match-hidden");
  });
}

/** Re-render plain author rows so edits carried over from injected rows show. */
function rerenderPlainAuthorRows() {
  $$('.field-row-plain[data-field="author"]').forEach(row => {
    const idx = Number(row.dataset.entry);
    row.outerHTML = renderPlainFieldRow(idx, "author", state.parsedEntries[idx] || {});
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
      const author = withoutInjection(edits.author);
      if (author) edits.author = author;
      else delete edits.author;
    }
    // Fresh rows also drop the author-match-hidden class truncation added.
    rerenderPlainAuthorRows();
  }
  updateCardStatuses();
}
