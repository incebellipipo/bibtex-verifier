// Verification run: parse the .bib, look up each entry, render results as they arrive.
import {
  buildResult, findDuplicateTitles, isOnlineOnlyEntry, parseBib, stripLatex, userFieldChoices,
} from "../lib/index.js";
import { lookupPaper, resetRateLimits, sleep, TransientLookupError } from "./api.js";
import { updateAuthorPills } from "./authors.js";
import { clearCards, renderEntryCard } from "./cards.js";
import { $, $$ } from "./dom.js";
import { resetFilters } from "./filters.js";
import { beginVerificationRun, openPostVerifyTour } from "./onboarding.js";
import { resetPreview, updatePreview } from "./preview.js";
import { resetRunState, state } from "./state.js";

const resultsSection = $(".results-section");
const floatingBar = $("#floating-bar");
const barProgress = $("#bar-progress");
const barProgressFill = $(".bar-progress-fill");
const barProgressText = $(".bar-progress-text");
const btnDownload = $("#btn-download");

// The tour's sample includes a fabricated title with this marker; skip its
// guaranteed-miss network lookup so the tour doesn't stall.
const TOUR_FAKE_MARKER = /QZX999/i;

function startProgress(statusMsg) {
  barProgress.classList.add("active");
  barProgress.classList.remove("fade-out");
  barProgressFill.style.width = "0%";
  barProgressFill.classList.remove("done");
  barProgressText.textContent = statusMsg;
  btnDownload.classList.add("hidden");
  btnDownload.classList.remove("fade-in");
  floatingBar.classList.add("visible");
}

function finishProgress(total, onDone) {
  barProgressFill.classList.add("done");
  barProgressText.textContent = `Done — ${total} entries verified`;
  setTimeout(() => {
    barProgress.classList.add("fade-out");
    setTimeout(() => {
      barProgress.classList.remove("active", "fade-out");
      btnDownload.classList.remove("hidden");
      btnDownload.classList.add("fade-in");
      onDone();
    }, 350);
  }, 800);
}

function showResult(r) {
  state.results[r.index] = r;
  renderEntryCard(r);
  updateAuthorPills();
  updatePreview();
}

/**
 * Show a lookup result for entry `i`, replacing any earlier one. The earlier
 * render's default field choices are dropped so this result's own defaults
 * apply; the user's choices are kept.
 */
function showLookupResult(entry, i, found, duplicateOf, extra = {}) {
  state.fieldEdits[i] = userFieldChoices(state.fieldEdits[i]);
  showResult({ ...buildResult(entry, i, found, duplicateOf), ...extra });
}

/**
 * Look up one entry. `inconclusive` means a source failed transiently.
 * `onProgress` receives provisional matches while other sources are pending.
 */
async function lookupEntry(entry, onProgress = null) {
  const title = stripLatex(entry.title || "");
  if (TOUR_FAKE_MARKER.test(title)) {
    await sleep(500);
    return { found: null, inconclusive: false };
  }
  try {
    return { found: await lookupPaper(title, entry.doi || "", entry, onProgress), inconclusive: false };
  } catch (err) {
    if (err instanceof TransientLookupError) return { found: null, inconclusive: true };
    console.warn("Lookup failed:", err);
    return { found: null, inconclusive: false };
  }
}

export function startVerificationFromContent(content, statusMsg) {
  const resumeTour = beginVerificationRun();

  resetRunState();
  resetFilters();
  clearCards();
  resetRateLimits();
  $$(".info-section").forEach(s => s.style.display = "none");
  resultsSection.style.display = "none";
  startProgress(statusMsg);
  resetPreview();

  state.parsedEntries = parseBib(content);
  if (!state.parsedEntries.length) {
    alert("No BibTeX entries found. Make sure the content contains valid @type{key, ...} entries.");
    floatingBar.classList.remove("visible");
    return;
  }

  document.body.classList.add("verification-active");
  resultsSection.style.display = "block";
  // Show and make the complete bibliography copyable immediately. Entries are
  // updated in place as their verification results arrive.
  updatePreview();
  barProgressText.textContent = `Verifying 0 / ${state.parsedEntries.length} entries...`;
  runVerification(resumeTour);
}

async function runVerification(resumeTour) {
  const entries = state.parsedEntries;
  const total = entries.length;
  const duplicateOf = findDuplicateTitles(entries);
  // Indices whose lookup was inconclusive; re-checked once rate-limit pressure eases.
  const pendingRetry = [];

  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    const title = entry.title || "";
    barProgressFill.style.width = Math.round(((i + 1) / total) * 100) + "%";
    barProgressText.textContent = `Verifying ${i + 1} / ${total}: ${title.slice(0, 50)}…`;

    if (isOnlineOnlyEntry(entry)) {
      showResult(buildResult(entry, i, null, duplicateOf[i]));
      continue;
    }

    if (!title.trim() && !(entry.doi || "").trim()) {
      showResult(buildResult(entry, i, null, duplicateOf[i]));
      continue;
    }

    // Show each provisional match as soon as a source confirms it; the card
    // stays locked while checking (see renderEntryCard).
    const { found, inconclusive } = await lookupEntry(entry, (partial) => {
      showLookupResult(entry, i, partial, duplicateOf[i], { checking: true });
    });
    if (inconclusive) pendingRetry.push(i);
    showLookupResult(entry, i, found, duplicateOf[i]);
  }

  if (pendingRetry.length) {
    barProgressText.textContent =
      `Re-checking ${pendingRetry.length} ${pendingRetry.length === 1 ? "entry" : "entries"}…`;
    await sleep(1200);
    for (let round = 0; round < 2 && pendingRetry.length; round++) {
      const stillPending = [];
      for (const i of pendingRetry) {
        const { found, inconclusive } = await lookupEntry(entries[i]);
        // Keep deferring only while still inconclusive and a round remains.
        if (inconclusive && round === 0) { stillPending.push(i); continue; }
        showLookupResult(entries[i], i, found, duplicateOf[i]);
      }
      pendingRetry.splice(0, pendingRetry.length, ...stillPending);
      if (pendingRetry.length) await sleep(1500);
    }
  }

  finishProgress(total, () => {
    if (resumeTour) setTimeout(openPostVerifyTour, 450);
  });
}
