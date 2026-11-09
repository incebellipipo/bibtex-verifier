import { NAME_FIELDS } from "./constants.js";

const LATEX_ACCENT_MAP = {
  "\\'a":"á", "\\'e":"é", "\\'i":"í", "\\'o":"ó", "\\'u":"ú",
  "\\`a":"à", "\\`e":"è", "\\`i":"ì", "\\`o":"ò", "\\`u":"ù",
  '\\"a':"ä", '\\"e':"ë", '\\"i':"ï", '\\"o':"ö", '\\"u':"ü",
  "\\~n":"ñ", "\\~a":"ã", "\\~o":"õ",
  "\\^a":"â", "\\^e":"ê", "\\^i":"î", "\\^o":"ô", "\\^u":"û",
  "\\c{c}":"ç", "\\c c":"ç", "{\\ss}":"ß",
};

const LATEX_ACCENT_MARKS = {
  "`": "\u0300", "'": "\u0301", "^": "\u0302", "~": "\u0303",
  "=": "\u0304", "u": "\u0306", ".": "\u0307", '"': "\u0308",
  "r": "\u030a", "H": "\u030b", "v": "\u030c", "c": "\u0327", "k": "\u0328",
};

const LATEX_LETTER_MAP = {
  ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", o: "ø", O: "Ø",
  l: "ł", L: "Ł", dh: "ð", DH: "Ð", th: "þ", TH: "Þ", i: "ı",
};

export function stripLatex(text) {
  if (!text) return "";
  text = text.replace(/\\([`'"^~=\.])\s*\{?([A-Za-z])\}?/g,
    (_, accent, letter) => `${letter}${LATEX_ACCENT_MARKS[accent]}`.normalize("NFC"));
  text = text.replace(/\\(u|v|H|c|k|r)(?:\s+([A-Za-z])|\{([A-Za-z])\})/g,
    (_, accent, spacedLetter, bracedLetter) =>
      `${spacedLetter || bracedLetter}${LATEX_ACCENT_MARKS[accent]}`.normalize("NFC"));
  text = text.replace(/\\(ss|ae|AE|oe|OE|o|O|l|L|dh|DH|th|TH|i)\b/g,
    (_, command) => LATEX_LETTER_MAP[command]);
  for (const [latex, ch] of Object.entries(LATEX_ACCENT_MAP))
    text = text.replaceAll(latex, ch);
  text = text.replace(/\\[a-zA-Z]+\s*/g, "");
  text = text.replace(/[{}]/g, "");
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeTitle(title) {
  return stripLatex(title).toLowerCase().trim();
}

// Encode supported Latin accents without removing information from other scripts.
const BIBTEX_ACCENTS = {
  '\u0300': '`', '\u0301': "'", '\u0302': '^', '\u0303': '~',
  '\u0304': '=', '\u0306': 'u', '\u0307': '.', '\u0308': '"',
  '\u030a': 'r', '\u030b': 'H', '\u030c': 'v', '\u0327': 'c', '\u0328': 'k',
};
const BIBTEX_LETTERS = {
  'ß': '{\\ss}', 'æ': '{\\ae}', 'Æ': '{\\AE}', 'œ': '{\\oe}', 'Œ': '{\\OE}',
  'ø': '{\\o}', 'Ø': '{\\O}', 'ł': '{\\l}', 'Ł': '{\\L}',
  'ð': '{\\dh}', 'Ð': '{\\DH}', 'þ': '{\\th}', 'Þ': '{\\TH}',
  'ı': '{\\i}',
};

/**
 * A field value as written to BibTeX: name lists get BibTeX accent commands,
 * other fields are returned as-is. Missing values become "".
 */
export function fieldToBibtex(field, value) {
  return NAME_FIELDS.includes(field) ? namesToBibtex(value || "") : (value || "");
}

/** A copy of `entry` with its name fields written with BibTeX accents. */
export function encodeEntryNames(entry) {
  const out = { ...entry };
  for (const field of NAME_FIELDS) if (out[field]) out[field] = namesToBibtex(out[field]);
  return out;
}

export function namesToBibtex(text) {
  if (!text) return text;
  return text.replace(/[^\x00-\x7f]|[A-Za-z][\u0300-\u036f]+/gu, character => {
    if (BIBTEX_LETTERS[character]) return BIBTEX_LETTERS[character];
    const [base, ...marks] = character.normalize('NFD');
    if (!/^[A-Za-z]$/.test(base) || !marks.length || marks.some(mark => !BIBTEX_ACCENTS[mark])) return character;
    return marks.reduce((value, mark) => {
      const accent = BIBTEX_ACCENTS[mark];
      return /^[A-Za-z]$/.test(accent) ? `{\\${accent}{${value}}}` : `{\\${accent}${value}}`;
    }, base);
  });
}
