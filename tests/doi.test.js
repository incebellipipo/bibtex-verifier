import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doiUrl, encodeDoiPath, normalizeDoi, sameDoi } from "../src/lib/index.js";

describe("normalizeDoi", () => {
  it("strips resolver URLs and doi: prefixes but keeps case", () => {
    assert.equal(normalizeDoi(" https://doi.org/10.1/AbC "), "10.1/AbC");
    assert.equal(normalizeDoi("http://dx.doi.org/10.1/x"), "10.1/x");
    assert.equal(normalizeDoi("doi: 10.1/x"), "10.1/x");
    assert.equal(normalizeDoi("DOI:10.1/x"), "10.1/x");
  });

  it("returns an empty string for missing values", () => {
    assert.equal(normalizeDoi(undefined), "");
    assert.equal(normalizeDoi(null), "");
    assert.equal(normalizeDoi("   "), "");
  });
});

describe("sameDoi", () => {
  it("compares case-insensitively across prefixes", () => {
    assert.equal(sameDoi("https://doi.org/10.1234/Example", "10.1234/example"), true);
    assert.equal(sameDoi("10.1/a", "10.1/b"), false);
  });

  it("never treats two empty DOIs as the same", () => {
    assert.equal(sameDoi("", ""), false);
    assert.equal(sameDoi(undefined, null), false);
  });
});

describe("doiUrl / encodeDoiPath", () => {
  it("keeps slashes and escapes characters that would end the path", () => {
    assert.equal(encodeDoiPath("10.1/a#b?c d"), "10.1/a%23b%3Fc%20d");
    assert.equal(doiUrl("doi:10.1002/(SICI)1097"), "https://doi.org/10.1002/(SICI)1097");
  });

  it("returns an empty string without a DOI", () => {
    assert.equal(doiUrl(""), "");
    assert.equal(doiUrl("https://doi.org/"), "");
  });
});
