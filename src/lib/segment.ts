/**
 * Rule-based sentence splitting for (19th-century) English prose.
 * Deterministic, so the same book always yields the same sentences; bump SEGMENTER_VERSION when
 * the rules change (books record which version produced their sentences).
 */
export const SEGMENTER_VERSION = "1";

/** Words that end with a period but never end a sentence (compared lowercase, without the period). */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "messrs", "dr", "st", "ss", "rev", "revd", "fr", "jr", "esq", "prof", "gen", "col", "capt", "lt", "hon", "abp", "bp",
  "viz", "i.e", "e.g", "cf", "vs", "ib", "ibid", "op", "cit", "loc", "sc",
  "exod", "lev", "deut", "matt", "rom", "cor", "gal", "eph", "phil", "thess", "heb", "apoc",
  "eccl", "epist", "hier", "chrys", "athan", "greg", "jan", "feb", "apr", "aug", "sept", "oct", "nov", "dec",
]);

/**
 * Reference words that are abbreviations only when a number follows ("vol. 2", "No. IV", "p. 23");
 * otherwise they may be ordinary words ending a sentence ("… the art. The …").
 */
const REFERENCE_WORDS = new Set(["no", "nos", "p", "pp", "vol", "vols", "ch", "chap", "sect", "sec", "art", "ed", "fol", "l", "ll", "v", "vv", "ver", "ps", "cap", "lib", "serm", "disc", "ep", "mk", "lk", "jn", "tim", "pet", "mar"]);

/** Words after which a roman numeral is a number, not the end of a sentence ("Chapter IV. The …"). */
const NUMBERED = /(?:chapter|chap|part|book|vol|volume|discourse|lecture|sermon|section|sect|note|letter|essay|tract|no|art|cap|lib)\.?$/i;

const ROMAN = /^[ivxlcdm]+$/i;

function isNonTerminal(before: string, after: string, paragraphStart: boolean): boolean {
  // The word ending at the period, e.g. "Mr", "i.e", "J", "IV", "1".
  const word = before.match(/([A-Za-z][A-Za-z.]*|\d+|&c)$/)?.[1] ?? "";
  if (!word) return false;
  const lower = word.toLowerCase();
  if (word === "&c") return false;
  if (ABBREVIATIONS.has(lower)) return true;
  const numberFollows = /^\s*(?:\d|[IVXLC]+\b)/.test(after);
  if (REFERENCE_WORDS.has(lower) && numberFollows) return true;
  // A digit after a number and a period is usually a reference ("1845. 2", "p. 23. 24").
  if (/^\d+$/.test(word) && /^\s*\d/.test(after)) return true;
  // Initials: "J. H. Newman", "S. Athanasius" (single capital letter).
  if (/^[A-Z]$/.test(word)) return true;
  // Dotted abbreviations: "i.e", "A.D", "B.C".
  if (/^[A-Za-z](?:\.[A-Za-z])+$/.test(word)) return true;
  const rest = before.slice(0, before.length - word.length).trimEnd();
  if (ROMAN.test(word) && NUMBERED.test(rest)) return true;
  // Section numbers at the start of a paragraph: "1. Propositions …", "§ 2. Real Assents".
  if (/^\d+$/.test(word) && (paragraphStart ? /^(?:§\s*)?$/.test(rest) : NUMBERED.test(rest))) return true;
  return false;
}

/**
 * Splits a paragraph into sentences. Returns [start, end) offsets into `text` (trimmed spans), so
 * callers can keep the exact original characters.
 */
export function sentenceSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  // Terminal punctuation, optional closing quotes/brackets, whitespace, then something that can start a sentence.
  const re = /[.?!]+[)\]"'”’»]*(?=\s+[\s"'“‘«(\[]*[A-Z0-9])/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const punct = m[0];
    if (punct.startsWith(".") && !punct.startsWith("..")) {
      const before = text.slice(start, m.index);
      if (isNonTerminal(before, text.slice(end, end + 12), before.trim().split(/\s+/).length <= 2)) continue;
    }
    pushSpan(text, spans, start, end);
    start = end;
  }
  pushSpan(text, spans, start, text.length);
  return mergeFragments(text, spans);
}

function pushSpan(text: string, spans: [number, number][], from: number, to: number) {
  let a = from;
  let b = to;
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (b > a) spans.push([a, b]);
}

/** Very short pieces ("1.", "§ 2.", "(a)") are joined to the following sentence. */
function mergeFragments(text: string, spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < spans.length; i++) {
    const [a, b] = spans[i];
    const piece = text.slice(a, b);
    if (i + 1 < spans.length && piece.replace(/[^A-Za-z]/g, "").length < 3) {
      spans[i + 1] = [a, spans[i + 1][1]];
      continue;
    }
    out.push([a, b]);
  }
  return out;
}

export function splitSentences(text: string): string[] {
  return sentenceSpans(text).map(([a, b]) => text.slice(a, b));
}
