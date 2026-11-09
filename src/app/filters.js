// Summary-badge status filter and the entry search box.
import { applyAllCardVisibility } from "./cards.js";
import { $, $$ } from "./dom.js";
import { state } from "./state.js";

const entrySearchWrap = $(".entry-search");
const entrySearchInput = $("#entry-search-input");
const entrySearchClear = $("#entry-search-clear");

function syncBadges() {
  $$(".summary-badge").forEach(b => {
    const active = b.dataset.filter === state.activeFilter;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setSearch(value) {
  state.activeSearch = (value || "").trim().toLowerCase();
  entrySearchWrap.classList.toggle("has-query", !!state.activeSearch);
  applyAllCardVisibility();
}

export function resetFilters() {
  state.activeFilter = "all";
  state.activeSearch = "";
  entrySearchInput.value = "";
  entrySearchWrap.classList.remove("has-query");
  syncBadges();
}

export function initFilters() {
  document.addEventListener("click", (e) => {
    const badge = e.target.closest(".summary-badge");
    if (!badge) return;
    state.activeFilter = badge.dataset.filter;
    syncBadges();
    applyAllCardVisibility();
  });

  entrySearchInput.addEventListener("input", (e) => setSearch(e.target.value));
  entrySearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      entrySearchInput.value = "";
      setSearch("");
      entrySearchInput.blur();
    }
  });
  entrySearchClear.addEventListener("click", () => {
    entrySearchInput.value = "";
    setSearch("");
    entrySearchInput.focus();
  });

  // "/" focuses search unless the user is already typing somewhere.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (entrySearchInput.offsetParent === null) return;
    e.preventDefault();
    entrySearchInput.focus();
    entrySearchInput.select();
  });
}
