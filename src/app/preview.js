// Live BibTeX preview panel: diff rendering, copy, download, collapse and scroll sync.
import { buildPreviewEntries, diffLines, entriesToBib } from "../lib/index.js";
import { $, $$, esc } from "./dom.js";
import { getSettings } from "./settings.js";
import { state } from "./state.js";

const mainColumns = $("#main-columns");
const colPreview = $("#col-preview");
const previewPanelEl = $("#preview-panel");
const btnPreviewToggle = $("#btn-preview-toggle");
const previewShowHandle = $("#preview-show-handle");
const previewCode = $("#preview-code");
const previewBody = $("#preview-body");
const previewPlaceholder = $(".preview-placeholder");
const btnCopy = $("#btn-copy-preview");
const btnDownload = $("#btn-download");
const btnAutoScroll = $("#btn-autoscroll");

const COLLAPSED_KEY = "bv-preview-collapsed";

let currentPreviewBib = "";
let autoScrollEnabled = true;
let copyFeedbackTimer = null;

function buildPreviewBib() {
  const { parsedEntries, results, fieldEdits } = state;
  return entriesToBib(buildPreviewEntries(
    parsedEntries, results, fieldEdits, getSettings(), state.deletedEntries,
  ));
}

function buildOriginalBib() {
  return entriesToBib(state.parsedEntries);
}

function renderDiff(oldBib, newBib) {
  const ops = diffLines(oldBib.split("\n"), newBib.split("\n"));
  const hasChanges = ops.some(o => o.type !== "ctx");
  return ops.map(o => {
    const cls = !hasChanges || o.type === "ctx" ? "diff-ctx" : o.type === "add" ? "diff-add" : "diff-del";
    const entryMatch = o.text.match(/^@\w+\{(.+),\s*$/);
    const idAttr = entryMatch ? ` data-entry-id="${esc(entryMatch[1])}"` : "";
    return `<span class="diff-line ${cls}"${idAttr}>${esc(o.text)}</span>`;
  }).join("");
}

export function updatePreview() {
  if (!state.parsedEntries.length) return;
  currentPreviewBib = buildPreviewBib();
  previewPlaceholder.style.display = "none";
  previewCode.style.display = "block";
  previewCode.innerHTML = renderDiff(buildOriginalBib(), currentPreviewBib);
}

/** Show the (empty) preview column at the start of a run. */
export function resetPreview() {
  currentPreviewBib = "";
  mainColumns.classList.add("two-col");
  colPreview.classList.add("visible");
  previewPlaceholder.style.display = "flex";
  previewCode.style.display = "none";
  previewCode.textContent = "";
  syncPreviewPanelCollapsed();
}

function previewLineFor(entryId) {
  return previewCode.querySelector(`.diff-line[data-entry-id="${CSS.escape(entryId)}"]`);
}

function syncPreviewPanelCollapsed() {
  const collapsed = sessionStorage.getItem(COLLAPSED_KEY) === "1";
  previewPanelEl.classList.toggle("is-collapsed", collapsed);
  mainColumns.classList.toggle("preview-collapsed", collapsed);
  btnPreviewToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btnPreviewToggle.title = collapsed ? "Expand Live BibTeX preview" : "Collapse Live BibTeX preview";
  const lbl = btnPreviewToggle.querySelector(".btn-preview-toggle-text");
  if (lbl) lbl.textContent = collapsed ? "Show" : "Hide";
  const hasResults = colPreview.classList.contains("visible");
  previewShowHandle.classList.toggle("visible", collapsed && hasResults);
  previewShowHandle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

// The entry card nearest the vertical middle of the viewport.
function getVisibleEntryCard() {
  const viewMid = window.innerHeight / 2;
  let best = null;
  let bestDist = Infinity;
  for (const card of $$(".entry-card:not(.hidden)")) {
    const rect = card.getBoundingClientRect();
    const dist = Math.abs(rect.top + rect.height / 2 - viewMid);
    if (dist < bestDist) {
      bestDist = dist;
      best = card;
    }
  }
  return best;
}

function jumpToEntry(entryId) {
  const target = previewLineFor(entryId);
  if (!target) return;

  previewBody.scrollTo({
    top: target.offsetTop - previewBody.offsetTop - 40,
    behavior: "smooth",
  });

  // Flash the header line and the field lines that follow it, up to the next entry.
  const toHighlight = [];
  let node = target;
  while (node) {
    toHighlight.push(node);
    const next = node.nextElementSibling;
    if (!next || next.dataset.entryId) break;
    node = next;
  }
  previewCode.querySelectorAll(".highlight-flash").forEach(el => el.classList.remove("highlight-flash"));
  void previewCode.offsetWidth;
  toHighlight.forEach(el => el.classList.add("highlight-flash"));
}

function initAutoScroll() {
  btnAutoScroll.addEventListener("click", () => {
    autoScrollEnabled = !autoScrollEnabled;
    btnAutoScroll.classList.toggle("active", autoScrollEnabled);
  });

  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (!autoScrollEnabled || scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      if (!autoScrollEnabled) return;
      const entryId = getVisibleEntryCard()?.querySelector(".btn-jump-preview")?.dataset?.entryId;
      if (!entryId) return;
      const target = previewLineFor(entryId);
      if (!target) return;
      previewBody.scrollTo({
        top: target.offsetTop - previewBody.offsetTop - previewBody.clientHeight / 2 + 20,
        behavior: "smooth",
      });
    });
  });
}

function legacyCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    top: "0",
    left: "-9999px",
    width: "1px",
    height: "1px",
    opacity: "0",
  });

  const activeElement = document.activeElement;
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
    activeElement?.focus?.({ preventScroll: true });
  }
  return copied;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard permissions and non-secure contexts commonly block this API;
      // fall through to the user-gesture based browser fallback.
    }
  }
  return legacyCopyText(text);
}

function showCopyFeedback(message, kind) {
  clearTimeout(copyFeedbackTimer);
  const label = btnCopy.querySelector(".btn-copy-label");
  label.textContent = message;
  btnCopy.classList.toggle("copied", kind === "success");
  btnCopy.classList.toggle("copy-failed", kind === "error");
  btnCopy.title = kind === "success"
    ? "The complete BibTeX preview was copied to the clipboard"
    : message;
  copyFeedbackTimer = setTimeout(() => {
    label.textContent = "Copy";
    btnCopy.classList.remove("copied", "copy-failed");
    btnCopy.title = "Copy the complete BibTeX preview to clipboard";
  }, 2200);
}

export function initPreview() {
  btnPreviewToggle.addEventListener("click", () => {
    const willCollapse = !previewPanelEl.classList.contains("is-collapsed");
    sessionStorage.setItem(COLLAPSED_KEY, willCollapse ? "1" : "0");
    syncPreviewPanelCollapsed();
  });
  previewShowHandle.addEventListener("click", () => {
    sessionStorage.setItem(COLLAPSED_KEY, "0");
    syncPreviewPanelCollapsed();
  });
  syncPreviewPanelCollapsed();

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-jump-preview");
    if (btn) jumpToEntry(btn.dataset.entryId);
  });

  initAutoScroll();

  btnCopy.addEventListener("click", async () => {
    // Rebuild on demand so Copy never depends on a stale or partially rendered
    // preview string.
    currentPreviewBib = buildPreviewBib();
    if (!currentPreviewBib) {
      showCopyFeedback("Nothing to copy", "error");
      return;
    }
    try {
      const copied = await copyText(currentPreviewBib);
      showCopyFeedback(copied ? "Copied!" : "Copy failed", copied ? "success" : "error");
    } catch {
      showCopyFeedback("Copy failed", "error");
    }
  });

  btnDownload.addEventListener("click", () => {
    const bibContent = currentPreviewBib || buildPreviewBib();
    const blob = new Blob([bibContent], { type: "application/x-bibtex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "verified_refs.bib";
    a.click();
    URL.revokeObjectURL(url);
  });
}
