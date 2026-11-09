import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addedFieldEdit, applyFieldEdits, chooseEdit, defaultDiffEdit, defaultPlainEdit, doiLinkState,
  injectedAuthorEdit, removeEdit, restoreEdit, userFieldChoices, withoutInjection,
} from "../src/lib/index.js";

describe("default edits", () => {
  it("adopts enrichments and updates, keeps the original otherwise", () => {
    const diff = { field: "year", original: "2016", found: "2017" };
    assert.deepEqual(defaultDiffEdit(diff, "updated"), { action: "found", value: "2017", _default: true });
    assert.deepEqual(defaultDiffEdit(diff, "needs_review"), { action: "original", value: "2017", _default: true });
    assert.equal(defaultDiffEdit({ field: "doi", original: " ", found: "10.1/x" }, "verified").action, "found");
  });

  it("keeps a plain field's value", () => {
    assert.deepEqual(defaultPlainEdit("2016"), { action: "original", value: "2016", _default: true });
    assert.deepEqual(defaultPlainEdit(undefined), { action: "original", value: "", _default: true });
  });
});

describe("user transitions", () => {
  it("a choice clears _default and keeps the injected/added flags", () => {
    assert.deepEqual(chooseEdit(defaultPlainEdit("a"), "custom", "b"), { action: "custom", value: "b" });
    assert.deepEqual(chooseEdit({ action: "found", value: "x", _injected: true, _default: true }, "original", "y"),
      { action: "original", value: "y", _injected: true });
    assert.deepEqual(chooseEdit(addedFieldEdit("v"), "custom", "w"), { action: "custom", value: "w", _added: true });
  });

  it("remove saves the previous choice and restore brings it back", () => {
    const removed = removeEdit({ action: "found", value: "2017", _added: true, _default: true });
    assert.deepEqual(removed,
      { action: "remove", value: "", _savedAction: "found", _savedValue: "2017", _added: true });
    assert.deepEqual(restoreEdit(removed), { action: "found", value: "2017", _added: true });
  });

  it("removing a field without an edit restores to keeping the original", () => {
    assert.deepEqual(restoreEdit(removeEdit(undefined)), { action: "original", value: "" });
  });
});

describe("injected author truncation", () => {
  const truncated = "A, B and others";

  it("suggests the truncation over a default author edit", () => {
    assert.deepEqual(injectedAuthorEdit(defaultPlainEdit("A, B and C, D"), truncated),
      { action: "found", value: truncated, _injected: true, _default: true });
  });

  it("yields to the user's own edit of the plain author field", () => {
    assert.equal(injectedAuthorEdit({ action: "custom", value: "Mine" }, truncated), null);
    assert.equal(injectedAuthorEdit(removeEdit(defaultPlainEdit("A")), truncated), null);
  });

  it("follows a new truncation length while keeping the user's choice", () => {
    const kept = { action: "original", value: "A", _injected: true };
    assert.equal(injectedAuthorEdit(kept, truncated), kept);
    assert.equal(injectedAuthorEdit({ action: "found", value: "old", _injected: true }, truncated).value, truncated);
    const removed = removeEdit({ action: "found", value: "old", _injected: true });
    assert.equal(injectedAuthorEdit(removed, truncated)._savedValue, truncated);
  });

  it("carries the user's edits over once truncation is off and drops the rest", () => {
    assert.deepEqual(withoutInjection({ action: "custom", value: "Mine", _injected: true }),
      { action: "custom", value: "Mine" });
    assert.equal(withoutInjection({ action: "found", value: truncated, _injected: true, _default: true }), undefined);
    assert.equal(withoutInjection({ action: "original", value: "A", _injected: true }), undefined);
    const plain = { action: "custom", value: "x" };
    assert.equal(withoutInjection(plain), plain);
  });
});

describe("userFieldChoices", () => {
  it("drops rendering defaults and keeps every user choice", () => {
    const edits = {
      title: defaultPlainEdit("Attention Is All You Need"),
      year: defaultDiffEdit({ original: "2016", found: "2017" }, "updated"),
      pages: chooseEdit(defaultPlainEdit("1-9"), "custom", "1-10"),
      volume: chooseEdit(defaultDiffEdit({ original: "1", found: "2" }, "updated"), "original", "1"),
      note: removeEdit(defaultPlainEdit("draft")),
      keywords: addedFieldEdit("nlp"),
    };
    assert.deepEqual(Object.keys(userFieldChoices(edits)), ["pages", "volume", "note", "keywords"]);
  });

  it("handles an entry without recorded choices", () => {
    assert.deepEqual(userFieldChoices(undefined), {});
  });
});

describe("applyFieldEdits", () => {
  it("applies adopted, custom and removed values and ignores kept originals", () => {
    const entry = { title: "T", year: "2016", pages: "1", note: "n", volume: "3" };
    const out = applyFieldEdits(entry, {
      year: { action: "found", value: "2017" },
      pages: { action: "custom", value: "1-2" },
      note: { action: "remove", value: "" },
      volume: { action: "original", value: "9" },
    });
    assert.deepEqual(out, { title: "T", year: "2017", pages: "1-2", volume: "3" });
    assert.equal(entry.year, "2016");
  });
});

describe("doiLinkState", () => {
  const entry = { title: "T", doi: "10.1/old" };
  const doiDiff = { field_diffs: [{ field: "doi", original: "10.1/old", found: "10.1/new" }] };

  it("is unchanged when the DOI has no suggestion", () => {
    assert.deepEqual(doiLinkState(entry, { status: "verified", field_diffs: [] }, {}),
      { doi: "10.1/old", tone: "unchanged" });
  });

  it("is updated and links the new DOI when the suggestion is adopted", () => {
    const edits = { doi: { action: "found", value: "10.1/new" } };
    assert.deepEqual(doiLinkState(entry, { status: "updated", ...doiDiff }, edits),
      { doi: "10.1/new", tone: "updated" });
  });

  it("is unchanged when the user keeps their own DOI on an updated entry", () => {
    const edits = { doi: { action: "original", value: "10.1/old" } };
    assert.equal(doiLinkState(entry, { status: "updated", ...doiDiff }, edits).tone, "unchanged");
  });

  it("needs review whenever a needs-review match has a different DOI", () => {
    for (const action of ["original", "found"]) {
      const edits = { doi: { action, value: action === "found" ? "10.1/new" : "10.1/old" } };
      assert.equal(doiLinkState(entry, { status: "needs_review", ...doiDiff }, edits).tone, "review");
    }
  });

  it("adds a DOI the entry lacked and strips resolver prefixes", () => {
    const edits = { doi: { action: "found", value: "https://doi.org/10.1/new" } };
    assert.deepEqual(doiLinkState({ title: "T" }, { status: "verified", ...doiDiff }, edits),
      { doi: "10.1/new", tone: "updated" });
  });

  it("is absent without a DOI or when the DOI is removed", () => {
    assert.equal(doiLinkState({ title: "T" }, { status: "not_found" }, {}), null);
    assert.equal(doiLinkState(entry, { status: "verified" }, { doi: { action: "remove", value: "" } }), null);
  });
});
