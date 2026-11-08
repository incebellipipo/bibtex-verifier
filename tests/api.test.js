import "./helpers/setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { apiSettings, lookupPaper, resetRateLimits, TransientLookupError } from "../src/app/api.js";

const realFetch = globalThis.fetch;
let calls;

const json = (status, body) => new Response(JSON.stringify(body), { status });

/** Route mocked requests by host; each handler gets the parsed URL. */
function mockFetch({ dc = () => json(404, {}), ss = () => json(404, {}),
  cr = () => json(200, { message: { items: [] } }),
  oa = () => json(200, { results: [] }) } = {}) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (u.host.includes("datacite")) return dc(u);
    if (u.host.includes("semanticscholar")) return ss(u);
    if (u.host.includes("crossref")) return cr(u);
    if (u.host.includes("openalex")) return oa(u);
    throw new Error(`unexpected fetch ${url}`);
  };
}

const ssPaper = {
  title: "Attention Is All You Need", year: 2017, venue: "NeurIPS",
  authors: [{ name: "Ashish Vaswani" }], externalIds: { DOI: "10.5555/1" },
};
const crItem = {
  title: ["Attention Is All You Need"], author: [{ family: "Vaswani", given: "Ashish" }],
  "published-print": { "date-parts": [[2017]] }, "container-title": ["NeurIPS"],
  volume: "30", page: "5998-6008", DOI: "10.5555/1",
};

const dcRecord = {
  data: {
    id: "10.5555/1",
    type: "dois",
    attributes: {
      doi: "10.5555/1",
      titles: [{ title: "Attention Is All You Need" }],
      creators: [{ familyName: "Vaswani", givenName: "Ashish", nameType: "Personal" }],
      contributors: [{ familyName: "Editor", givenName: "Ed", contributorType: "Editor" }],
      publicationYear: 2017,
      state: "findable",
      isActive: true,
      publisher: { name: "Example Press" },
      container: { title: "NeurIPS" },
      url: "https://example.test/attention",
    },
  },
};

describe("lookupPaper", () => {
  beforeEach(() => {
    calls = [];
    Object.assign(apiSettings, { maxRetries: 1, retryBaseMs: 0, throttle: false });
    resetRateLimits();
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("checks a supplied DOI in DataCite before using its metadata", async () => {
    mockFetch({ dc: () => json(200, dcRecord) });
    const found = await lookupPaper(
      "Attention Is All You Need", "https://doi.org/10.5555/1",
      { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017" },
    );

    assert.equal(found._source, "datacite");
    assert.equal(found.publisher, "Example Press");
    assert.equal(found.editor, "Editor, Ed");
    const request = calls.find(u => u.host.includes("datacite"));
    assert.equal(request.pathname, "/dois/10.5555/1");
    assert.equal(request.searchParams.get("enriched"), "true");
    assert.equal(request.searchParams.get("affiliation"), "true");
    assert.equal(request.searchParams.get("publisher"), "true");
  });

  it("uses title sources to fill fields missing from a matching DataCite record", async () => {
    mockFetch({
      dc: () => json(200, dcRecord),
      ss: (u) => (u.pathname.endsWith("/match") ? json(200, { data: [ssPaper] }) : json(200, { data: [] })),
      cr: () => json(200, { message: { items: [crItem] } }),
    });
    const found = await lookupPaper(
      "Attention Is All You Need", "10.5555/1", { title: "Attention Is All You Need" },
    );
    assert.equal(found._source, "datacite+semantic_scholar+crossref");
    assert.equal(found.volume, "30");
    assert.equal(found.pages, "5998-6008");
  });

  it("ignores DataCite metadata when the DOI belongs to a different work", async () => {
    const wrongRecord = structuredClone(dcRecord);
    wrongRecord.data.attributes.titles[0].title = "A Completely Different Publication";
    mockFetch({
      dc: () => json(200, wrongRecord),
      cr: () => json(200, { message: { items: [crItem] } }),
    });
    const found = await lookupPaper(
      "Attention Is All You Need", "10.5555/1", { title: "Attention Is All You Need" },
    );
    assert.equal(found._source, "crossref");
    assert.equal(found.title, "Attention Is All You Need");
  });

  it("can verify and populate an entry that only contains a DOI", async () => {
    mockFetch({ dc: () => json(200, dcRecord) });
    const found = await lookupPaper("", "10.5555/1", { doi: "10.5555/1" });
    assert.equal(found._source, "datacite");
    assert.equal(found.title, "Attention Is All You Need");
  });

  it("merges a Semantic Scholar match with the same CrossRef paper", async () => {
    mockFetch({
      ss: (u) => (u.pathname.endsWith("/match") ? json(200, { data: [ssPaper] }) : json(200, { data: [] })),
      cr: () => json(200, { message: { items: [crItem] } }),
    });
    const found = await lookupPaper("Attention Is All You Need");
    assert.equal(found._source, "semantic_scholar+crossref");
    assert.equal(found.volume, "30");
    assert.equal(found.pages, "5998-6008");
  });

  it("enriches an abbreviated matched author list from OpenAlex", async () => {
    const title = "Hybrid controller concept for dynamic positioning of marine vessels with experimental results";
    const abbreviated = {
      title, year: 2018, venue: "Automatica",
      authors: [
        { name: "Astrid H. Brodtkorb" }, { name: "Svenn Are Vaerno" },
        { name: "A. Teel" }, { name: "A. Sørensen" }, { name: "R. Skjetne" },
      ],
      externalIds: { DOI: "10.1016/j.automatica.2018.03.047" },
    };
    const openAlex = {
      title, publication_year: 2018, id: "W1",
      authorships: [
        { author: { display_name: "Astrid H. Brodtkorb" } },
        { author: { display_name: "Svenn Are Værnø" } },
        { author: { display_name: "Andrew R. Teel" } },
        { author: { display_name: "Asgeir J. Sørensen" } },
        { author: { display_name: "Roger Skjetne" } },
      ],
      primary_location: { source: { display_name: "Automatica" } },
      doi: "https://doi.org/10.1016/j.automatica.2018.03.047",
    };
    mockFetch({
      ss: (u) => (u.pathname.endsWith("/match") ? json(200, { data: [abbreviated] }) : json(200, { data: [] })),
      oa: () => json(200, { results: [openAlex] }),
    });
    const found = await lookupPaper(title);
    assert.equal(found.author,
      "Brodtkorb, Astrid H. and Værnø, Svenn Are and Teel, Andrew R. and Sørensen, Asgeir J. and Skjetne, Roger");
    assert.equal(found._source, "semantic_scholar+openalex");
  });

  it("only sends the title to the APIs", async () => {
    mockFetch();
    await lookupPaper("Some Title");
    assert.ok(calls.length > 0);
    for (const u of calls) {
      const values = [...u.searchParams.entries()].filter(([k]) => ["query", "query.title", "search"].includes(k));
      assert.deepEqual(values.map(([, v]) => v), ["Some Title"], u.toString());
      assert.ok(!u.searchParams.has("mailto"));
    }
  });

  it("falls back to OpenAlex when SS and CrossRef have nothing", async () => {
    mockFetch({
      oa: () => json(200, { results: [{ title: "Some OpenAlex Paper", publication_year: 2019, id: "W1" }] }),
    });
    const found = await lookupPaper("Some OpenAlex Paper");
    assert.equal(found._source, "openalex");
    assert.equal(found.year, "2019");
  });

  it("returns null for a genuine miss", async () => {
    mockFetch({ ss: (u) => (u.pathname.endsWith("/match") ? json(404, {}) : json(200, { data: [] })) });
    assert.equal(await lookupPaper("Totally Made Up"), null);
  });

  it("retries a transient failure before succeeding", async () => {
    let crCalls = 0;
    mockFetch({
      cr: () => (++crCalls === 1 ? json(503, {}) : json(200, { message: { items: [crItem] } })),
    });
    const found = await lookupPaper("Attention Is All You Need");
    assert.equal(found._source, "crossref");
    assert.equal(crCalls, 2);
  });

  it("reports an inconclusive lookup instead of a miss when a source stays down", async () => {
    mockFetch({ cr: () => json(429, {}) });
    await assert.rejects(lookupPaper("Attention Is All You Need"), TransientLookupError);
  });

  it("treats network errors as transient", async () => {
    mockFetch({ oa: () => { throw new TypeError("fetch failed"); } });
    await assert.rejects(lookupPaper("Anything"), TransientLookupError);
  });
});
