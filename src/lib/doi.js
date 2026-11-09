// DOI normalization and resolver links, shared by the lookups and the UI.

/** The bare DOI, without a doi.org resolver URL or "doi:" prefix. Case is kept. */
export function normalizeDoi(value) {
  return String(value || "").trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

/** DOIs are case-insensitive. Two empty values are not the same DOI. */
export function sameDoi(a, b) {
  const x = normalizeDoi(a).toLowerCase();
  return !!x && x === normalizeDoi(b).toLowerCase();
}

/** The DOI as a URL path: "/" stays, while "#" and "?" cannot end the path early. */
export function encodeDoiPath(value) {
  return encodeURI(normalizeDoi(value)).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/** The https://doi.org link for a DOI, or "" when there is none. */
export function doiUrl(value) {
  return normalizeDoi(value) ? `https://doi.org/${encodeDoiPath(value)}` : "";
}
