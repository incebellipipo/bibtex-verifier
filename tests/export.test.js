import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFieldEdits, buildExportEntries, buildPreviewEntries, buildResult, diffLines, entriesToBib,
  findDuplicateTitles, groupDuplicateResultIndices, isOnlineOnlyEntry, parseBib, truncateAuthors,
} from "../src/lib/index.js";

const DEFAULT_SETTINGS = {
  removeDuplicates: false, dedupBy: "title", removeNotFound: false,
  cleanNotes: false, maxAuthors: 0, preferPublished: false,
};

describe("findDuplicateTitles", () => {
  it("points later same-title entries at the first one", () => {
    const dups = findDuplicateTitles([
      { ID: "a", title: "Attention Is All You Need" },
      { ID: "b", title: "Other" },
      { ID: "c", title: "{Attention} is all you need" },
      { ID: "d" },
      { title: "Other" },
    ]);
    assert.deepEqual(dups, [null, null, "a", null, "b"]);
  });
});

describe("groupDuplicateResultIndices", () => {
  it("places duplicate results immediately after their original", () => {
    const results = [
      { index: 0, entry_id: "a", duplicate_of: null },
      { index: 1, entry_id: "b", duplicate_of: null },
      { index: 2, entry_id: "c", duplicate_of: "a" },
      { index: 3, entry_id: "d", duplicate_of: null },
      { index: 4, entry_id: "e", duplicate_of: "a" },
      { index: 5, entry_id: "f", duplicate_of: "b" },
    ];
    assert.deepEqual(groupDuplicateResultIndices(results), [0, 2, 4, 1, 5, 3]);
  });

  it("keeps partial and orphaned results visible", () => {
    const results = [
      { index: 0, entry_id: "a", duplicate_of: null },
      null,
      { index: 2, entry_id: "c", duplicate_of: "missing" },
    ];
    assert.deepEqual(groupDuplicateResultIndices(results), [0, 2]);
  });
});

describe("buildResult", () => {
  const entry = { ID: "k", ENTRYTYPE: "article", title: "Test Paper", year: "2020" };

  it("is not_found without a found record", () => {
    const r = buildResult(entry, 3, null);
    assert.equal(r.status, "not_found");
    assert.equal(r.index, 3);
    assert.equal(r.entry_id, "k");
    assert.deepEqual(r.field_diffs, []);
    assert.equal(r.duplicate_of, null);
  });

  it("carries comparison output and the duplicate marker", () => {
    const found = { title: "Test Paper", year: "2021" };
    const r = buildResult(entry, 0, found, "other");
    assert.equal(r.status, "updated");
    assert.equal(r.found_title, "Test Paper");
    assert.equal(r.duplicate_of, "other");
    assert.equal(r._found, found);
    assert.ok(r.field_diffs.some(d => d.field === "year"));
  });

  it("marks an entry verified when its DOI was accepted from DataCite", () => {
    const r = buildResult(
      { ...entry, doi: "https://doi.org/10.1234/Example" }, 0,
      { title: "Test Paper", year: "2020", doi: "10.1234/example", _source: "datacite+crossref" },
    );
    assert.deepEqual(r.verification_sources, ["DataCite", "CrossRef"]);
  });

  it("marks a matching DOI.org record as a verification source", () => {
    const r = buildResult(
      { ...entry, doi: "10.1234/example" }, 0,
      { title: "Test Paper", year: "2020", doi: "10.1234/example", _source: "doi_org+crossref" },
    );
    assert.deepEqual(r.verification_sources, ["DOI.org", "CrossRef"]);
  });

  it("does not retain DataCite verification for a different DOI", () => {
    const r = buildResult(
      { ...entry, doi: "10.1234/changed" }, 0,
      { title: "Test Paper", year: "2020", doi: "10.1234/original", _source: "datacite" },
    );
    assert.deepEqual(r.verification_sources, []);
  });

  it("does not mark a fallback-only match as DataCite verified", () => {
    const r = buildResult(
      { ...entry, doi: "10.1234/example" }, 0,
      { title: "Test Paper", year: "2020", doi: "10.1234/example", _source: "crossref" },
    );
    assert.deepEqual(r.verification_sources, ["CrossRef"]);
  });

  it("reports all recognized metadata sources without duplicates", () => {
    const r = buildResult(
      entry, 0,
      { title: "Test Paper", year: "2020", _source: "semantic_scholar+crossref+openalex+crossref" },
    );
    assert.deepEqual(r.verification_sources, ["Semantic Scholar", "CrossRef", "OpenAlex"]);
  });

  it("keeps an online URL entry for manual review instead of marking it not found", () => {
    const online = {
      ENTRYTYPE: "online", ID: "post", title: "A Web Article",
      url: "https://example.com/post", year: "2026",
    };
    const r = buildResult(online, 0, null);
    assert.equal(r.status, "needs_review");
    assert.equal(r.online_manual_review, true);
    assert.equal(r.online_url, "https://example.com/post");
    assert.equal(isOnlineOnlyEntry(online), true);
  });

  it("still sends DOI-bearing online entries through academic verification", () => {
    assert.equal(isOnlineOnlyEntry({
      ENTRYTYPE: "online", url: "https://example.com/post", doi: "10.1234/example",
    }), false);
  });

  it("builds full diffs for needs_review", () => {
    const r = buildResult(entry, 0, { title: "Something Else Entirely", year: "2021" });
    assert.equal(r.status, "needs_review");
    assert.equal(r.field_diffs[0].field, "title");
  });
});

describe("raw entry text editing", () => {
  it("serializes the current field choices into one editable BibTeX entry", () => {
    const current = applyFieldEdits(
      { ENTRYTYPE: "article", ID: "paper", title: "Original", year: "2020" },
      {
        title: { action: "custom", value: "Edited title" },
        year: { action: "remove", value: "" },
        doi: { action: "custom", value: "10.1234/example", _added: true },
      },
    );
    const reparsed = parseBib(entriesToBib([current]));
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0].title, "Edited title");
    assert.equal(reparsed[0].doi, "10.1234/example");
    assert.ok(!("year" in reparsed[0]));
  });
});

describe("truncateAuthors", () => {
  it("keeps short lists and truncates long ones with 'and others'", () => {
    assert.equal(truncateAuthors("A and B", 2), "A and B");
    assert.equal(truncateAuthors("A and B and C", 2), "A and B and others");
    assert.equal(truncateAuthors("A and B and C", 0), "A and B and C");
    assert.equal(truncateAuthors("", 2), "");
  });
});

describe("buildExportEntries", () => {
  const entries = [
    { ID: "a", ENTRYTYPE: "article", title: "A", journal: "Old", year: "2020", note: "ZSCC: 0000001" },
    { ID: "b", ENTRYTYPE: "article", title: "B", author: "X and Y and Z" },
    { ID: "c", ENTRYTYPE: "article", title: "A", doi: "10.1/x" },
  ];
  const results = [
    { status: "updated", suggested: { journal: "New" } },
    { status: "not_found", suggested: {} },
    { status: "verified", suggested: {} },
  ];

  it("applies found, custom and remove edits", () => {
    const out = buildExportEntries(entries, results, {
      0: { journal: { action: "found", value: "New" }, year: { action: "remove", value: "" } },
      2: { doi: { action: "custom", value: "10.1/y" }, title: { action: "original", value: "ignored" } },
    }, DEFAULT_SETTINGS);
    assert.equal(out[0].journal, "New");
    assert.ok(!("year" in out[0]));
    assert.equal(out[2].doi, "10.1/y");
    assert.equal(out[2].title, "A");
    assert.equal(entries[0].journal, "Old", "input entries are not mutated");
  });

  it("adds a new custom field", () => {
    const out = buildExportEntries(entries, results, {
      0: { keywords: { action: "custom", value: "verification, bibliography", _added: true } },
    }, DEFAULT_SETTINGS);
    assert.equal(out[0].keywords, "verification, bibliography");
    assert.ok(!("keywords" in entries[0]), "input entries are not mutated");
  });

  it("only exports entries that have a result so far", () => {
    assert.equal(buildExportEntries(entries, results.slice(0, 2), {}, DEFAULT_SETTINGS).length, 2);
  });

  it("removes not-found entries and duplicates when asked", () => {
    const out = buildExportEntries(entries, results, {},
      { ...DEFAULT_SETTINGS, removeNotFound: true, removeDuplicates: true });
    assert.deepEqual(out.map(e => e.ID), ["a"]);
  });

  it("dedups by DOI and ID", () => {
    const dupEntries = [{ ID: "x", doi: "10.1/A" }, { ID: "X", doi: "10.1/a" }, { ID: "z" }];
    const r = dupEntries.map(() => ({ status: "verified", suggested: {} }));
    const byDoi = buildExportEntries(dupEntries, r, {}, { ...DEFAULT_SETTINGS, removeDuplicates: true, dedupBy: "doi" });
    assert.deepEqual(byDoi.map(e => e.ID), ["x", "z"]);
    const byId = buildExportEntries(dupEntries, r, {}, { ...DEFAULT_SETTINGS, removeDuplicates: true, dedupBy: "id" });
    assert.deepEqual(byId.map(e => e.ID), ["x", "z"]);
  });

  it("truncates authors except on not-found entries", () => {
    const out = buildExportEntries(
      [{ ID: "a", author: "A and B and C" }, { ID: "b", author: "A and B and C" }],
      [{ status: "verified", suggested: {} }, { status: "not_found", suggested: {} }],
      {}, { ...DEFAULT_SETTINGS, maxAuthors: 1 });
    assert.equal(out[0].author, "A and others");
    assert.equal(out[1].author, "A and B and C");
  });

  it("cleans notes when asked", () => {
    const out = buildExportEntries(entries, results, {}, { ...DEFAULT_SETTINGS, cleanNotes: true });
    assert.ok(!("note" in out[0]));
  });

  it("replaces a preprint venue with the published one when preferPublished is set", () => {
    const e = [{ ID: "p", booktitle: "arXiv preprint" }];
    const r = [{ status: "updated", suggested: { journal: "ICML" } }];
    assert.equal(buildExportEntries(e, r, {}, { ...DEFAULT_SETTINGS, preferPublished: true })[0].booktitle, "ICML");
    assert.equal(buildExportEntries(e, r, {}, DEFAULT_SETTINGS)[0].booktitle, "arXiv preprint");
    const stillPreprint = [{ status: "updated", suggested: { journal: "CoRR" } }];
    assert.equal(buildExportEntries(e, stillPreprint, {}, { ...DEFAULT_SETTINGS, preferPublished: true })[0].booktitle,
      "arXiv preprint");
  });
});

describe("buildPreviewEntries", () => {
  it("includes unprocessed entries unchanged while applying completed results", () => {
    const entries = [
      { ENTRYTYPE: "article", ID: "done", title: "Processed", year: "2020" },
      { ENTRYTYPE: "online", ID: "waiting", title: "Still waiting", url: "https://example.com" },
    ];
    const results = [{ status: "updated", suggested: { year: "2021" } }];
    const preview = buildPreviewEntries(entries, results, {
      0: { year: { action: "found", value: "2021" } },
    }, DEFAULT_SETTINGS);

    assert.equal(preview.length, 2);
    assert.equal(preview[0].year, "2021");
    assert.deepEqual(preview[1], entries[1]);
  });

  it("still respects deleted entries across the complete preview", () => {
    const entries = [
      { ENTRYTYPE: "article", ID: "a", title: "A" },
      { ENTRYTYPE: "article", ID: "b", title: "B" },
    ];
    const preview = buildPreviewEntries(entries, [], {}, DEFAULT_SETTINGS, new Set([1]));
    assert.deepEqual(preview.map(entry => entry.ID), ["a"]);
  });
});

describe("diffLines", () => {
  it("marks unchanged, added and removed lines", () => {
    const ops = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    assert.deepEqual(ops.map(o => `${o.type}:${o.text}`), ["ctx:a", "del:b", "add:x", "ctx:c"]);
  });

  it("handles empty inputs", () => {
    assert.deepEqual(diffLines([], ["a"]), [{ type: "add", text: "a" }]);
    assert.deepEqual(diffLines(["a"], []), [{ type: "del", text: "a" }]);
  });
});

describe("entry deletion and absent original values", () => {
  it("excludes deleted entries without shifting field edits for later entries", () => {
    const entries = [{ ID: "a", year: "2020" }, { ID: "b", year: "2021" }];
    const results = entries.map(() => ({ status: "verified" }));
    const edits = { 1: { year: { action: "custom", value: "2025" } } };
    const out = buildExportEntries(entries, results, edits, DEFAULT_SETTINGS, new Set([0]));
    assert.deepEqual(out, [{ ID: "b", year: "2025" }]);
    assert.equal(buildExportEntries(entries, results, edits, DEFAULT_SETTINGS, new Set([0, 1])).length, 0);
    assert.equal(entries.length, 2);
  });

  it("keeps an absent field absent when None is selected", () => {
    const entry = { ID: "a", title: "Paper" };
    const results = [{ status: "updated", suggested: { doi: "10.1/example" } }];
    const out = buildExportEntries([entry], results, {
      0: { doi: { action: "original", value: "" } },
    }, DEFAULT_SETTINGS);
    assert.deepEqual(out, [entry]);
  });
});
