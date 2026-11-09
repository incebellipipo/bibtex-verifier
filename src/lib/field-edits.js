// Per-field choices on entry cards, as pure transitions over edit records.
//
// `fieldEdits[i][field]` is an edit record:
//   action          "original" | "found" | "custom" | "remove"
//   value           the value exported for "found" and "custom"
//   _savedAction,   what restoring a "remove" brings back
//   _savedValue
//   _default        seeded by rendering a card; any user choice clears it
//   _injected       the author-truncation suggestion, not a lookup result
//   _added          a field the user added that the entry did not have
import { normalizeDoi } from "./doi.js";

const STICKY_FLAGS = ["_injected", "_added"];
const stickyFlags = (edit) =>
  Object.fromEntries(STICKY_FLAGS.filter(flag => edit?.[flag]).map(flag => [flag, true]));
const isUserEdit = (edit) => edit && ["custom", "remove"].includes(edit.action);

/** Default for a suggestion row: enrichments and "updated" entries adopt the suggestion. */
export function defaultDiffEdit(diff, status) {
  const isEnrichment = !String(diff.original || "").trim();
  const action = isEnrichment || status === "updated" ? "found" : "original";
  return { action, value: diff.found || "", _default: true };
}

/** Default for a field shown without a suggestion: keep the entry's value. */
export function defaultPlainEdit(value) {
  return { action: "original", value: value || "", _default: true };
}

/** The user picks `action` with `value` for a field whose current edit is `previous`. */
export function chooseEdit(previous, action, value) {
  return { action, value, ...stickyFlags(previous) };
}

/** A field the user added to the entry. */
export function addedFieldEdit(value) {
  return { action: "custom", value, _added: true };
}

export function removeEdit(previous = { action: "original", value: "" }) {
  return {
    action: "remove",
    value: "",
    _savedAction: previous.action,
    _savedValue: previous.value ?? "",
    ...stickyFlags(previous),
  };
}

export function restoreEdit(removed = {}) {
  return chooseEdit(removed, removed._savedAction || "original", removed._savedValue ?? "");
}

/**
 * The author edit while truncation to `truncated` is suggested. Returns null
 * when the user's own edit of the plain author field takes precedence.
 */
export function injectedAuthorEdit(existing, truncated) {
  if (isUserEdit(existing) && !existing._injected) return null;
  if (!existing?._injected) return { action: "found", value: truncated, _injected: true, _default: true };
  if (existing.action === "found") return { ...existing, value: truncated };
  if (existing.action === "remove" && existing._savedAction === "found") {
    return { ...existing, _savedValue: truncated };
  }
  return existing;
}

/**
 * The author edit once truncation is no longer suggested: the user's edits of
 * the injected row carry over to the plain field, anything else is dropped
 * (undefined) so the field falls back to its default.
 */
export function withoutInjection(edit) {
  if (!edit?._injected) return edit;
  if (!isUserEdit(edit)) return undefined;
  const { _injected, ...rest } = edit;
  return rest;
}

/**
 * The choices the user made, without rendering defaults. Re-rendering a card
 * for a new lookup result starts from this, so the new result's defaults apply.
 */
export function userFieldChoices(edits) {
  return Object.fromEntries(Object.entries(edits || {}).filter(([, edit]) => edit && !edit._default));
}

export function applyFieldEdits(entry, edits) {
  const out = { ...entry };
  for (const [field, fe] of Object.entries(edits || {})) {
    if (!fe) continue;
    if (fe.action === "found" || fe.action === "custom") {
      if (fe.value) out[field] = fe.value;
      else if (fe.action === "custom") delete out[field];
    } else if (fe.action === "remove") {
      delete out[field];
    }
  }
  return out;
}

/**
 * The DOI an entry will be exported with, given the current field choices, and
 * how it relates to the lookup: "review" when the DOI differs from a match that
 * needs review, "updated" when a database DOI is adopted, else "unchanged".
 * Returns null when the entry will be exported without a DOI.
 */
export function doiLinkState(entry, result, edits) {
  const doi = normalizeDoi(applyFieldEdits(entry, edits).doi);
  if (!doi) return null;
  const hasDiff = (result?.field_diffs || []).some(d => d.field === "doi");
  const action = edits?.doi?.action;
  let tone = "unchanged";
  if (hasDiff && result.status === "needs_review") tone = "review";
  else if (hasDiff && (action === "found" || action === "custom")) tone = "updated";
  return { doi, tone };
}
