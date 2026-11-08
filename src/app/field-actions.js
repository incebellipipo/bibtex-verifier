// Per-field choices on entry cards: keep original, adopt suggestion, edit
// inline, remove a field or entry, and the "Accept all" / "Keep original" bulk actions.
import { updatePreview } from "./preview.js";
import {
  appendAddedFieldRow, applyAllCardVisibility, editableEntryBib, renderEntryCard, updateSummary,
} from "./cards.js";
import { updateAuthorPills } from "./authors.js";
import { buildResult, findDuplicateTitles, namesToBibtex, parseBib } from "../lib/index.js";
import { state } from "./state.js";

function editsFor(idx) {
  if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};
  return state.fieldEdits[idx];
}

function displayFieldValue(field, value) {
  return ["author", "editor"].includes(field) ? namesToBibtex(value || "") : (value || "");
}

function syncDoiLink(pill) {
  if (pill.dataset.field !== "doi") return;
  const link = pill.closest(".doi-value-wrap")?.querySelector(".doi-external-link");
  if (!link) return;

  const doi = pill.textContent.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  if (!doi) {
    link.hidden = true;
    link.removeAttribute("href");
    return;
  }

  const url = `https://doi.org/${encodeURI(doi).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
  const hoverText = `Open DOI in a new tab: ${url}`;
  link.hidden = false;
  link.href = url;
  link.title = hoverText;
  link.setAttribute("aria-label", hoverText);
}

function setFieldEdit(idx, field, edit) {
  const edits = editsFor(idx);
  edits[field] = {
    ...edit,
    ...(edits[field]?._injected ? { _injected: true } : {}),
    ...(edits[field]?._added ? { _added: true } : {}),
  };
  return edits[field];
}

function flashRow(row) {
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
}

function syncRowState(row, action) {
  row.dataset.action = action;
  flashRow(row);
}

function syncBulkBtns(card) {
  const diffRows = card.querySelectorAll(".diff-row:not(.field-row-plain)");
  if (!diffRows.length) return;
  const allFound = [...diffRows].every(r => r.dataset.action === "found");
  const allOriginal = [...diffRows].every(r => r.dataset.action === "original");
  card.querySelector(".btn-accept-all")?.classList.toggle("active-accept", allFound);
  card.querySelector(".btn-revert-all")?.classList.toggle("active-revert", allOriginal);
}

function afterRowChange(row, action) {
  syncRowState(row, action);
  syncBulkBtns(row.closest(".entry-card"));
  updatePreview();
}

function setSuggestedPill(pill, { active, editable, text }) {
  if (!pill) return;
  pill.classList.toggle("active", active);
  pill.classList.remove("removed");
  pill.contentEditable = editable ? "true" : "false";
  if (text !== undefined) {
    pill.textContent = text;
    delete pill.dataset.customValue;
  }
  syncDoiLink(pill);
}

function selectOriginal(origPill) {
  const idx = parseInt(origPill.dataset.entry);
  const row = origPill.closest(".diff-row");
  setFieldEdit(idx, origPill.dataset.field, { action: "original", value: origPill.dataset.val });

  row.querySelectorAll(".pill-original").forEach(p => p.classList.add("active"));
  row.querySelectorAll(".choice-pill").forEach(p => p.classList.remove("removed"));
  row.querySelectorAll(".pill-suggested").forEach(p => p.classList.remove("active"));
  row.querySelector(".fa-btn-x")?.classList.remove("active");
  const sugPill = row.querySelector(".pill-suggested");
  if (sugPill) {
    sugPill.contentEditable = "false";
    sugPill.classList.remove("removed");
  }
  afterRowChange(row, "original");
}

function selectSuggested(sugPill) {
  const idx = parseInt(sugPill.dataset.entry);
  const row = sugPill.closest(".diff-row");
  const edit = setFieldEdit(idx, sugPill.dataset.field, {
    action: sugPill.dataset.customValue !== undefined ? "custom" : "found",
    value: sugPill.dataset.customValue ?? sugPill.dataset.val,
  });

  row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
  row.querySelectorAll(".choice-pill").forEach(p => p.classList.remove("removed"));
  setSuggestedPill(sugPill, { active: true, editable: true });
  row.querySelector(".fa-btn-x")?.classList.remove("active");
  afterRowChange(row, edit.action);
}

function removeField(xBtn) {
  const idx = Number(xBtn.dataset.entry);
  const field = xBtn.dataset.field;
  const row = xBtn.closest(".diff-row");
  const edits = editsFor(idx);
  const previous = edits[field] || { action: "original", value: "" };

  edits[field] = {
    action: "remove",
    value: "",
    _savedAction: previous.action,
    _savedValue: previous.value ?? "",
    ...(previous._injected ? { _injected: true } : {}),
    ...(previous._added ? { _added: true } : {}),
  };
  row.querySelectorAll(".choice-pill").forEach(pill => {
    pill.classList.remove("active");
    pill.classList.add("removed");
    pill.contentEditable = "false";
  });
  xBtn.classList.add("active");
  afterRowChange(row, "remove");
}

function restoreRemovedField(xBtn) {
  const idx = Number(xBtn.dataset.entry);
  const field = xBtn.dataset.field;
  const row = xBtn.closest(".diff-row");
  const removed = editsFor(idx)[field] || {};
  const action = removed._savedAction || "original";
  const value = removed._savedValue ?? "";
  const origPill = row.querySelector(".pill-original");
  const sugPill = row.querySelector(".pill-suggested");
  const valPill = row.querySelector(".pill-value");

  editsFor(idx)[field] = {
    action,
    value,
    ...(removed._injected ? { _injected: true } : {}),
    ...(removed._added ? { _added: true } : {}),
  };
  row.querySelectorAll(".choice-pill").forEach(pill => pill.classList.remove("removed"));
  xBtn.classList.remove("active");

  if (valPill) {
    valPill.textContent = displayFieldValue(field, value);
    valPill.classList.add("active");
    valPill.contentEditable = "true";
  } else if (action === "found" || action === "custom") {
    origPill?.classList.remove("active");
    const displayValue = displayFieldValue(field, value);
    setSuggestedPill(sugPill, { active: true, editable: true, text: displayValue });
    if (action === "custom") sugPill.dataset.customValue = displayValue;
  } else {
    origPill?.classList.add("active");
    setSuggestedPill(sugPill, { active: false, editable: false });
  }
  afterRowChange(row, action);
}

function toggleRemoveField(xBtn) {
  const row = xBtn.closest(".diff-row");
  if (row.dataset.action === "remove") restoreRemovedField(xBtn);
  else removeField(xBtn);
}

function deleteEntry(btn) {
  state.deletedEntries.add(Number(btn.dataset.entry));
  btn.closest(".entry-card").remove();
  updateSummary();
  applyAllCardVisibility();
  updatePreview();
}

function resizeEntryTextEditor(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 170), 520)}px`;
}

function closeEntryTextEditor(form) {
  form.hidden = true;
  form.reset();
  form.querySelector(".entry-text-editor-error").textContent = "";
  const btn = form.closest(".entry-card").querySelector(".btn-text-edit-entry");
  btn.classList.remove("active");
  btn.setAttribute("aria-expanded", "false");
}

function toggleEntryTextEditor(btn) {
  const form = btn.closest(".entry-card").querySelector(".entry-text-editor");
  if (!form.hidden) {
    closeEntryTextEditor(form);
    return;
  }
  form.hidden = false;
  btn.classList.add("active");
  btn.setAttribute("aria-expanded", "true");
  const textarea = form.querySelector(".entry-text-editor-input");
  textarea.value = editableEntryBib(Number(btn.dataset.entry));
  textarea.defaultValue = textarea.value;
  resizeEntryTextEditor(textarea);
  textarea.focus();
}

function applyEntryText(form) {
  const idx = Number(form.dataset.entry);
  const parsed = parseBib(form.querySelector(".entry-text-editor-input").value);
  const error = form.querySelector(".entry-text-editor-error");
  if (parsed.length !== 1) {
    error.textContent = parsed.length
      ? "Keep exactly one BibTeX entry in this editor."
      : "Enter one valid BibTeX entry, including its @type{key, ...} header.";
    return;
  }
  if (!parsed[0].ID) {
    error.textContent = "The BibTeX entry needs a citation key after the opening brace.";
    return;
  }

  const previousResult = state.results[idx];
  state.parsedEntries[idx] = parsed[0];
  state.fieldEdits[idx] = {};

  const duplicateOf = findDuplicateTitles(state.parsedEntries);
  state.results[idx] = buildResult(
    parsed[0], idx, previousResult?._found || null, duplicateOf[idx],
  );

  // Duplicate labels on other processed entries may change when a title/key is
  // edited, so refresh those cards while retaining all of their field choices.
  for (let i = 0; i < state.results.length; i++) {
    const result = state.results[i];
    if (!result) continue;
    if (i !== idx) result.duplicate_of = duplicateOf[i];
    renderEntryCard(result);
  }
  updateAuthorPills();
  applyAllCardVisibility();
  updatePreview();
}

function closeAddFieldForm(form) {
  form.hidden = true;
  form.reset();
  form.querySelector(".add-field-error").textContent = "";
}

function showAddFieldError(form, message) {
  form.querySelector(".add-field-error").textContent = message;
}

function submitAddedField(form) {
  const idx = Number(form.dataset.entry);
  const card = form.closest(".entry-card");
  const field = form.querySelector(".add-field-name").value.trim().toLowerCase();
  const value = form.querySelector(".add-field-value").value.trim();

  if (!/^[a-z][a-z0-9_]*$/.test(field)) {
    showAddFieldError(form, "Use letters, numbers, and underscores; start with a letter.");
    return;
  }
  if (["id", "entrytype"].includes(field)) {
    showAddFieldError(form, `The ${field} property cannot be added as a BibTeX field.`);
    return;
  }
  if (!value) {
    showAddFieldError(form, "Enter a value for the field.");
    return;
  }

  const entry = state.parsedEntries[idx] || {};
  const result = state.results[idx];
  const existing = editsFor(idx)[field];
  const isExistingField = Object.prototype.hasOwnProperty.call(entry, field)
    || result?.field_diffs?.some(diff => diff.field === field)
    || (existing && !existing._added);
  if (isExistingField) {
    showAddFieldError(form, "That field already exists. Edit its value in the table above.");
    return;
  }

  setFieldEdit(idx, field, { action: "custom", value, _added: true });
  const existingRow = [...card.querySelectorAll(".field-row-plain")]
    .find(row => row.dataset.field === field);
  if (existingRow) {
    const pill = existingRow.querySelector(".pill-value");
    existingRow.dataset.action = "custom";
    pill.textContent = displayFieldValue(field, value);
    pill.classList.remove("removed");
    pill.classList.add("active");
    pill.contentEditable = "true";
    syncDoiLink(pill);
    existingRow.querySelector(".fa-btn-x")?.classList.remove("active");
  } else {
    appendAddedFieldRow(card, idx, field);
  }
  closeAddFieldForm(form);
  updatePreview();
}

function applyBulk(btn) {
  const idx = parseInt(btn.dataset.entry);
  const isAccept = btn.classList.contains("btn-accept-all");
  const card = btn.closest(".entry-card");

  card.querySelectorAll(".diff-row:not(.field-row-plain)").forEach(row => {
    const field = row.dataset.field;
    const foundVal = decodeURIComponent(row.getAttribute("data-found-val") || "");
    const origPill = row.querySelector(".pill-original");
    const sugPill = row.querySelector(".pill-suggested");
    if (!origPill && !sugPill) return;

    if (isAccept) {
      if (sugPill) {
        setFieldEdit(idx, field, { action: "found", value: sugPill.dataset.val });
        origPill?.classList.remove("active");
        setSuggestedPill(sugPill, { active: true, editable: true, text: foundVal });
      }
    } else if (origPill) {
      setFieldEdit(idx, field, { action: "original", value: origPill.dataset.val });
      origPill.classList.add("active");
      setSuggestedPill(sugPill, { active: false, editable: false });
    }

    row.querySelectorAll(".choice-pill").forEach(p => p.classList.remove("removed"));
    row.querySelector(".fa-btn-x")?.classList.remove("active");
    syncRowState(row, isAccept ? "found" : "original");
  });
  syncBulkBtns(card);
  updatePreview();
}

function onInlineEdit(pill) {
  const idx = parseInt(pill.dataset.entry);
  pill.dataset.customValue = pill.textContent.trim();
  setFieldEdit(idx, pill.dataset.field, { action: "custom", value: pill.textContent.trim() });

  const row = pill.closest(".diff-row");
  syncDoiLink(pill);
  row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
  if (pill.classList.contains("pill-suggested")) pill.classList.add("active");
  afterRowChange(row, "custom");
}

export function initFieldActions() {
  document.addEventListener("focusout", e => {
    const pill = e.target.closest('.pill-suggested[contenteditable="true"], .pill-value[contenteditable="true"]');
    if (!pill || !["author", "editor"].includes(pill.dataset.field)) return;
    const encoded = namesToBibtex(pill.textContent);
    if (encoded !== pill.textContent) {
      pill.textContent = encoded;
      onInlineEdit(pill);
    }
  });
  document.addEventListener("click", (e) => {
    const textEditBtn = e.target.closest(".btn-text-edit-entry");
    if (textEditBtn) {
      toggleEntryTextEditor(textEditBtn);
      return;
    }

    const cancelTextEditBtn = e.target.closest(".entry-text-editor-cancel");
    if (cancelTextEditBtn) {
      closeEntryTextEditor(cancelTextEditBtn.closest(".entry-text-editor"));
      return;
    }

    const addFieldBtn = e.target.closest(".btn-add-field");
    if (addFieldBtn) {
      const form = addFieldBtn.closest(".entry-card").querySelector(".add-field-form");
      form.hidden = false;
      form.querySelector(".add-field-name").focus();
      return;
    }

    const cancelAddFieldBtn = e.target.closest(".add-field-cancel");
    if (cancelAddFieldBtn) {
      closeAddFieldForm(cancelAddFieldBtn.closest(".add-field-form"));
      return;
    }

    const deleteBtn = e.target.closest(".btn-delete-entry");
    if (deleteBtn) return deleteEntry(deleteBtn);

    const toggleBtn = e.target.closest(".fields-toggle-btn");
    if (toggleBtn) {
      toggleBtn.closest(".fields-toggle-wrap").classList.toggle("collapsed");
      return;
    }

    const origPill = e.target.closest(".pill-original");
    if (origPill) return selectOriginal(origPill);

    // Clicking an already-active suggestion is editing it, not re-selecting.
    const sugPill = e.target.closest(".pill-suggested");
    if (sugPill && !sugPill.classList.contains("active")) return selectSuggested(sugPill);

    const xBtn = e.target.closest(".fa-btn-x");
    if (xBtn) return toggleRemoveField(xBtn);

    const bulkBtn = e.target.closest(".btn-accept-all, .btn-revert-all");
    if (bulkBtn) applyBulk(bulkBtn);
  });

  document.addEventListener("input", (e) => {
    if (e.target.matches(".entry-text-editor-input")) {
      e.target.closest(".entry-text-editor")
        .querySelector(".entry-text-editor-error").textContent = "";
      resizeEntryTextEditor(e.target);
      return;
    }
    const pill = e.target.closest('.pill-suggested[contenteditable="true"], .pill-value[contenteditable="true"]');
    if (pill) onInlineEdit(pill);
  });

  document.addEventListener("submit", (e) => {
    const textEditor = e.target.closest(".entry-text-editor");
    if (textEditor) {
      e.preventDefault();
      applyEntryText(textEditor);
      return;
    }
    const form = e.target.closest(".add-field-form");
    if (!form) return;
    e.preventDefault();
    submitAddedField(form);
  });

  document.addEventListener("keydown", (e) => {
    const textarea = e.target.closest(".entry-text-editor-input");
    if (!textarea) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeEntryTextEditor(textarea.closest(".entry-text-editor"));
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      textarea.closest(".entry-text-editor").requestSubmit();
    }
  });
}
