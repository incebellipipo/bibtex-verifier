import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { namesToBibtex } from "../src/lib/latex.js";
import { buildExportEntries } from "../src/lib/export.js";
import { entriesToBib, parseBib } from "../src/lib/bibtex.js";

describe("BibTeX name encoding", () => {
  it("preserves accents and special Latin letters using ASCII TeX", () => {
    assert.equal(namesToBibtex('Méndez and Müller and Søren and Łukasz'), String.raw`M{\'e}ndez and M{\"u}ller and S{\o}ren and {\L}ukasz`);
    assert.equal(namesToBibtex('Me\u0301ndez'), String.raw`M{\'e}ndez`);
    assert.equal(namesToBibtex('François'), String.raw`Fran{\c{c}}ois`);
  });

  it("leaves existing TeX and unsupported scripts intact", () => {
    const name = String.raw`M{\'e}ndez and 王`;
    assert.equal(namesToBibtex(name), name);
    assert.equal(namesToBibtex(namesToBibtex('Méndez')), namesToBibtex('Méndez'));
  });

  it("encodes original and custom author/editor values in export and round trips", () => {
    const entry = { ID: 'x', ENTRYTYPE: 'article', author: 'Méndez', editor: 'Müller', title: 'Café' };
    const out = buildExportEntries([entry], [{ status: 'verified' }], {
      0: { author: { action: 'custom', value: 'Søren' } },
    }, {});
    assert.equal(out[0].author, String.raw`S{\o}ren`);
    assert.equal(out[0].editor, String.raw`M{\"u}ller`);
    assert.equal(out[0].title, 'Café');
    assert.deepEqual(parseBib(entriesToBib(out)), out);
    assert.equal(entry.author, 'Méndez');
  });

  it("clears a field when the user deletes its editable text", () => {
    const out = buildExportEntries([{ ID: 'x', year: '2020' }], [{ status: 'verified' }], {
      0: { year: { action: 'custom', value: '' } },
    }, {});
    assert.ok(!('year' in out[0]));
  });
});
