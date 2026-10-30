/**
 * Project Gutenberg catalog (adapted from box-maison's gutenbergCatalog).
 *
 * The official CSV dump (pg_catalog.csv.gz, refreshed daily) is downloaded, filtered and loaded
 * into gutenberg_works, which is then searched locally (no third-party search API).
 *
 * Rights filter: Gutenberg's criterion is US public domain. To stay on the safe side in Japan,
 * every contributor listed (author, [Translator], [Editor] …) must have a known death year of 1945
 * or earlier (70 years after death plus wartime extensions). Unknown dates and corporate names are excluded.
 */
import { and, asc, count, desc, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { gunzipSync } from "fflate";
import { gutenbergWorks } from "~/db/schema";
import type { Db } from "./db";

const CATALOG_URL = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz";
export const DEATH_YEAR_CUTOFF = 1945;
/** Languages offered for now (the sentence splitter is written for English). */
export const CATALOG_LANGUAGES = new Set(["en"]);
export const FETCH_HEADERS = { "User-Agent": "MagicStacksBot/0.1 (personal translation notebook)" };

/** RFC 4180-style CSV parsing, one row at a time (the catalog has ~75k rows). */
export function parseCsvEach(text: string, onRow: (row: string[]) => void): void {
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") pushField();
    else if (ch === "\n") {
      pushField();
      onRow(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    pushField();
    onRow(row);
  }
}

/** "Newman, John Henry, 1801-1890 [Editor]" → 1890; null when unknown. */
export function contributorDeathYear(raw: string): number | null {
  const name = raw.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
  const seg = name.split(",").pop()?.trim() ?? "";
  const m = seg.match(/-\s*(?:approximately\s+)?(\d{1,4})\??(\s*BCE?)?\.?$/);
  if (!m) return null;
  return m[2] ? -Number(m[1]) : Number(m[1]);
}

/** Lowercase, accents removed, ligatures expanded: "Œuvres" → "oeuvres". Used for search and sorting. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleSortKey(title: string): string {
  return fold(title)
    .replace(/^["'“”¡¿([]+/, "")
    .replace(/^(?:the|a|an)\s+/, "")
    .trim();
}

/** "Newman, John Henry, 1801-1890 [Editor]" → "Newman, John Henry". */
const stripDates = (p: string) =>
  p
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/,\s*[^,]*\d{1,4}[^,]*$/, "")
    .trim();

export interface CatalogEntry {
  textId: number;
  title: string;
  subtitle: string | null;
  sortKey: string;
  authors: string;
  searchKey: string;
  subjectKey: string;
  subjects: string | null;
  language: string;
}

export function buildCatalogEntry(row: string[], col: Record<string, number>): CatalogEntry | null {
  if (row.length <= col.authors || row[col.type] !== "Text") return null;
  const language = row[col.language];
  if (!CATALOG_LANGUAGES.has(language)) return null;
  const textId = Number(row[col.id]);
  if (!Number.isInteger(textId) || textId <= 0) return null;

  const contributors = row[col.authors]
    .split("; ")
    .map(s => s.trim())
    .filter(Boolean);
  if (!contributors.length) return null;
  for (const person of contributors) {
    const death = contributorDeathYear(person);
    if (death === null || death > DEATH_YEAR_CUTOFF) return null;
  }
  // Display authors: creators without a role tag (editors, translators … are noise in a list).
  const creators = contributors.filter(p => !/\[[^\]]*\]\s*$/.test(p)).map(stripDates).filter(Boolean);
  const authors = creators.length ? creators.join("; ") : stripDates(contributors[0]);
  // The catalog puts subtitles on further lines of the title.
  const [first, ...rest] = row[col.title].split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!authors || !first) return null;
  const subtitle = rest.join(" ") || null;
  const subjects = [row[col.subjects], row[col.bookshelves]]
    .flatMap(s => (s ?? "").split(";"))
    .map(s => s.trim().replace(/^Category:\s*/, ""))
    .filter(Boolean);

  return {
    textId,
    title: first,
    subtitle,
    sortKey: titleSortKey(first),
    authors,
    // Every contributor (incl. [Contributor] in anthologies, translators) is searchable; names
    // are also added in "Forenames Surname" order so "john henry newman" matches.
    searchKey: fold([first, subtitle ?? "", ...contributors.map(stripDates).flatMap(n => [n, n.split(", ").reverse().join(" ")])].join(" | ")),
    subjectKey: fold(subjects.join(" | ")),
    subjects: subjects.length ? [...new Set(subjects)].join("; ").slice(0, 300) : null,
    language,
  };
}

export function buildCatalogEntries(text: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const seen = new Set<number>();
  let col: Record<string, number> | null = null;
  parseCsvEach(text, row => {
    if (!col) {
      const idx = (name: string) => row.indexOf(name);
      col = { id: idx("Text#"), type: idx("Type"), title: idx("Title"), language: idx("Language"), authors: idx("Authors"), subjects: idx("Subjects"), bookshelves: idx("Bookshelves") };
      if (Object.values(col).some(i => i < 0)) throw new Error("Gutenberg カタログの列が想定と違います。");
      return;
    }
    const e = buildCatalogEntry(row, col);
    if (e && !seen.has(e.textId)) {
      seen.add(e.textId);
      entries.push(e);
    }
  });
  return entries;
}

export async function refreshCatalog(db: Db): Promise<{ works: number }> {
  const res = await fetch(CATALOG_URL, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`カタログを取得できませんでした (${res.status})`);
  const text = new TextDecoder("utf-8").decode(gunzipSync(new Uint8Array(await res.arrayBuffer())));
  const entries = buildCatalogEntries(text);
  if (!entries.length) throw new Error("カタログが空でした。");

  const updatedAt = new Date().toISOString();
  // Rebuild. D1 allows 100 bound parameters per statement (10 columns → 10 rows).
  const ROWS = 10;
  const PER_BATCH = 50;
  const inserts = [];
  for (let i = 0; i < entries.length; i += ROWS) {
    inserts.push(db.insert(gutenbergWorks).values(entries.slice(i, i + ROWS).map(e => ({ ...e, updatedAt }))));
  }
  await db.delete(gutenbergWorks);
  for (let i = 0; i < inserts.length; i += PER_BATCH) {
    const chunk = inserts.slice(i, i + PER_BATCH);
    await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
  }
  return { works: entries.length };
}

export async function catalogSize(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(gutenbergWorks);
  return row?.n ?? 0;
}

const workColumns = {
  textId: gutenbergWorks.textId,
  title: gutenbergWorks.title,
  subtitle: gutenbergWorks.subtitle,
  authors: gutenbergWorks.authors,
  subjects: gutenbergWorks.subjects,
};
export type CatalogWork = { textId: number; title: string; subtitle: string | null; authors: string; subjects: string | null };

export const SEARCH_PAGE = 50;
export const BROWSE_PAGE = 100;

/** Search terms: folded words (≥1 char, at most 8), LIKE wildcards removed. */
export function searchTerms(q: string): string[] {
  return fold(q)
    .replace(/[%_]/g, " ")
    .split(/[\s,;:]+/)
    .filter(Boolean)
    .slice(0, 8);
}

const contains = (column: SQL | typeof gutenbergWorks.searchKey | typeof gutenbergWorks.subjectKey, term: string) => sql`instr(${column}, ${term}) > 0`;

/**
 * Every term must occur in the title/contributors or in the subjects. Works whose title or
 * contributors contain all terms come first; then by number of terms found there; then A–Z.
 */
export async function searchCatalog(db: Db, q: string, offset = 0) {
  const terms = searchTerms(q);
  if (!terms.length) return { works: [] as CatalogWork[], hasMore: false };
  const inMain = sql.join(
    terms.map(t => sql`(${contains(gutenbergWorks.searchKey, t)})`),
    sql` + `,
  );
  const rows = await db
    .select(workColumns)
    .from(gutenbergWorks)
    .where(and(...terms.map(t => sql`(${contains(gutenbergWorks.searchKey, t)} OR ${contains(gutenbergWorks.subjectKey, t)})`)))
    .orderBy(desc(inMain), asc(gutenbergWorks.sortKey), asc(gutenbergWorks.textId))
    .limit(SEARCH_PAGE + 1)
    .offset(offset);
  return { works: rows.slice(0, SEARCH_PAGE), hasMore: rows.length > SEARCH_PAGE };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** A–Z initial condition on a column ("#" = anything else: digits, symbols). */
function initialIs(column: typeof gutenbergWorks.sortKey | typeof gutenbergWorks.authors, initial: string) {
  const first = sql<string>`upper(substr(${column}, 1, 1))`;
  return LETTERS.includes(initial) ? eq(first, initial) : notInArray(first, LETTERS);
}

/** Titles starting with `initial` (leading articles ignored), A–Z, paged. */
export async function browseTitles(db: Db, initial: string, offset = 0) {
  const where = initialIs(gutenbergWorks.sortKey, initial);
  const [rows, [{ total }]] = await Promise.all([
    db.select(workColumns).from(gutenbergWorks).where(where).orderBy(asc(gutenbergWorks.sortKey), asc(gutenbergWorks.textId)).limit(BROWSE_PAGE).offset(offset),
    db.select({ total: count() }).from(gutenbergWorks).where(where),
  ]);
  return { works: rows, total };
}

/** Authors (as listed, "Surname, Forenames") whose surname starts with `initial`, with work counts. */
export async function browseAuthors(db: Db, initial: string) {
  return db
    .select({ authors: gutenbergWorks.authors, works: count() })
    .from(gutenbergWorks)
    .where(initialIs(gutenbergWorks.authors, initial))
    .groupBy(gutenbergWorks.authors)
    .orderBy(asc(sql`lower(${gutenbergWorks.authors})`));
}

/** All works whose author list is exactly `authors` or names that person among several authors. */
export async function worksByAuthor(db: Db, authors: string) {
  const person = authors.split("; ")[0];
  return db
    .select(workColumns)
    .from(gutenbergWorks)
    .where(sql`${gutenbergWorks.authors} = ${authors} OR ${gutenbergWorks.authors} = ${person} OR ('; ' || ${gutenbergWorks.authors} || '; ') LIKE ${`%; ${person}; %`}`)
    .orderBy(asc(gutenbergWorks.sortKey), asc(gutenbergWorks.textId));
}
