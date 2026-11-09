// Converters from each API's JSON to the standard record shape:
// title, author/editor, year, journal, volume, number, pages, doi, publisher,
// url, _source.
import { doiUrl, normalizeDoi } from "./doi.js";

// "First Middle Last" -> "Last, First Middle"
function lastFirst(name) {
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
  return name;
}

export function crossrefToStandard(item) {
  const authors = (item.author || []).map(a => {
    const f = a.family || "", g = a.given || "";
    return f ? `${f}, ${g}`.replace(/, $/, "") : "";
  }).filter(Boolean);

  const dp = item["published-print"] || item["published-online"] || {};
  const year = dp["date-parts"]?.[0]?.[0]?.toString() || "";
  const container = item["container-title"] || [];

  return {
    title: (item.title || [""])[0],
    author: authors.join(" and "),
    year,
    journal: container[0] || "",
    volume: item.volume || "",
    number: item.issue || "",
    pages: item.page || "",
    doi: item.DOI || "",
    publisher: item.publisher || "",
    url: item.URL || "",
    _source: "crossref",
  };
}

export function ssToStandard(paper) {
  const authors = (paper.authors || []).map(a => lastFirst(a.name || "")).filter(Boolean);

  const ext = paper.externalIds || {};
  const pv = paper.publicationVenue;
  let venue = (pv && typeof pv === "object" ? pv.name : null) || paper.venue || "";
  // Surface arXiv-only records as preprints so their submission year isn't trusted.
  if (!venue && ext.ArXiv) venue = "arXiv";

  return {
    title: paper.title || "",
    author: authors.join(" and "),
    year: (paper.year || "").toString(),
    journal: venue,
    volume: "", number: "", pages: "",
    doi: ext.DOI || "",
    publisher: "",
    url: doiUrl(ext.DOI),
    _source: "semantic_scholar",
  };
}

export function openAlexToStandard(work) {
  const authors = (work.authorships || [])
    .map(a => lastFirst((a.author && a.author.display_name) || ""))
    .filter(Boolean);

  const source = (work.primary_location && work.primary_location.source) || {};
  const biblio = work.biblio || {};
  const first = biblio.first_page || "";
  const last = biblio.last_page || "";
  const pages = first && last ? `${first}-${last}` : (first || last || "");
  // OpenAlex reports DOIs as full URLs (https://doi.org/10.x); store the bare DOI.
  const doi = normalizeDoi(work.doi);

  return {
    title: work.title || work.display_name || "",
    author: authors.join(" and "),
    year: (work.publication_year || "").toString(),
    journal: source.display_name || "",
    volume: biblio.volume || "",
    number: biblio.issue || "",
    pages,
    doi,
    publisher: source.host_organization_name || "",
    url: doiUrl(doi) || work.id || "",
    _source: "openalex",
  };
}

function dataCitePerson(person) {
  const family = person.familyName || "";
  const given = person.givenName || "";
  if (family) return `${family}, ${given}`.replace(/, $/, "");
  return person.name || "";
}

/** Convert the attributes from a DataCite singleton DOI response. */
export function dataCiteToStandard(record) {
  const attrs = record?.data?.attributes || record?.attributes || record || {};
  const creators = (attrs.creators || []).map(dataCitePerson).filter(Boolean);
  const editors = (attrs.contributors || [])
    .filter(person => person.contributorType === "Editor")
    .map(dataCitePerson)
    .filter(Boolean);
  const primaryTitle = (attrs.titles || []).find(title => !title.titleType)
    || (attrs.titles || [])[0]
    || {};
  const container = attrs.container || {};
  const first = container.firstPage || "";
  const last = container.lastPage || "";
  const pages = first && last ? `${first}-${last}` : (first || last || "");
  const publisher = typeof attrs.publisher === "string"
    ? attrs.publisher : (attrs.publisher?.name || "");
  const doi = attrs.doi || record?.data?.id || "";

  return {
    title: primaryTitle.title || "",
    author: creators.join(" and "),
    editor: editors.join(" and "),
    year: (attrs.publicationYear || "").toString(),
    journal: container.title || "",
    volume: container.volume || "",
    number: container.issue || "",
    pages,
    doi,
    publisher,
    url: attrs.url || doiUrl(doi),
    _doiState: attrs.state || "",
    _doiActive: attrs.isActive,
    _source: "datacite",
  };
}

/** Convert a parsed BibTeX entry returned by citation.doi.org/format. */
export function doiBibtexToStandard(entry) {
  if (!entry) return null;
  const pages = String(entry.pages || "").replace(/[\u2010-\u2015]/g, "-");
  return {
    title: entry.title || "",
    author: entry.author || "",
    editor: entry.editor || "",
    year: entry.year || "",
    journal: entry.journal || entry.booktitle || "",
    volume: entry.volume || "",
    number: entry.number || entry.issue || "",
    pages,
    doi: entry.doi || "",
    publisher: entry.publisher || "",
    url: entry.url || doiUrl(entry.doi),
    _source: "doi_org",
  };
}
