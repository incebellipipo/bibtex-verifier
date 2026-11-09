// Shared UI state for the current verification run.
export const state = {
  // Entries parsed from the user's .bib, in file order.
  parsedEntries: [],
  // results[i] is the lookup result for parsedEntries[i]. A result with
  // `checking: true` is provisional and is replaced as more sources answer.
  results: [],
  // fieldEdits[i][field] is an edit record; see src/lib/field-edits.js for its
  // shape and the only functions that should create or change one.
  fieldEdits: {},
  deletedEntries: new Set(),
  // Entries the user has explicitly reviewed during this run.
  checkedEntries: new Set(),
  activeFilter: "all",
  activeSearch: "",
};

export function resetRunState() {
  state.parsedEntries = [];
  state.results = [];
  state.fieldEdits = {};
  state.deletedEntries = new Set();
  state.checkedEntries = new Set();
}
