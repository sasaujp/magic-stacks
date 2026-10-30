/**
 * Shared books: ingest from Project Gutenberg (EPUB → chapters → sentences) and read back.
 * Each Gutenberg work is fetched at most once. R2 keeps the original EPUB, the cover and the
 * illustrations (keys under books/<id>/, served by /api/images/…).
 */
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { books, chapters, gutenbergWorks, sentences } from "~/db/schema";
import { SEGMENTER_VERSION, splitSentences } from "~/lib/segment";
import { FETCH_HEADERS } from "./catalog";
import type { Db } from "./db";
import { extractEpub, imageExt } from "./epub";

const MAX_EPUB_BYTES = 30 * 1024 * 1024;

export const gutenbergUrl = (id: number) => `https://www.gutenberg.org/ebooks/${id}`;

/** Accepts "24526", "https://www.gutenberg.org/ebooks/24526", "…/cache/epub/24526/…". */
export function parseGutenbergId(input: string): number | null {
  const s = input.trim();
  const m = s.match(/^(\d{1,6})$/) ?? s.match(/gutenberg\.org\/(?:ebooks|cache\/epub|files)\/(\d{1,6})/);
  return m ? Number(m[1]) : null;
}

export interface SentenceRow {
  bookId: number;
  chapterId: number;
  seq: number;
  para: number;
  kind: "p" | "heading" | "quote" | "note" | "image";
  text: string;
  image: string | null;
}

export const imageUrl = (key: string) => `/api/images/${key}`;

/** Gutenberg's own cover (generated when a book has none) — used when the EPUB carries no cover. */
async function fetchGutenbergCover(gutenbergId: number): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const res = await fetch(`https://www.gutenberg.org/cache/epub/${gutenbergId}/pg${gutenbergId}.cover.medium.jpg`, { headers: FETCH_HEADERS });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength > 0 && bytes.byteLength < 5 * 1024 * 1024 ? { bytes, contentType: type } : null;
}

async function putCover(bookId: number, cover: { bytes: Uint8Array; contentType: string }) {
  const ext = cover.contentType.includes("png") ? "png" : cover.contentType.includes("webp") ? "webp" : cover.contentType.includes("gif") ? "gif" : "jpg";
  const key = `books/${bookId}/cover.${ext}`;
  await env.BUCKET.put(key, cover.bytes, { httpMetadata: { contentType: cover.contentType } });
  return key;
}

/** Adds a cover to a book ingested without one (does not touch its sentences). */
export async function ensureCover(db: Db, bookId: number): Promise<{ coverKey: string | null }> {
  const [book] = await db.select({ coverKey: books.coverKey, gutenbergId: books.gutenbergId }).from(books).where(eq(books.id, bookId));
  if (!book) throw new Error("書籍が見つかりません。");
  if (book.coverKey || !book.gutenbergId) return { coverKey: book.coverKey };
  const cover = await fetchGutenbergCover(book.gutenbergId);
  if (!cover) return { coverKey: null };
  const coverKey = await putCover(bookId, cover);
  await db.update(books).set({ coverKey }).where(eq(books.id, bookId));
  return { coverKey };
}

export async function ingestGutenberg(db: Db, gutenbergId: number, userId: string): Promise<{ bookId: number; existing: boolean }> {
  const [existing] = await db.select({ id: books.id }).from(books).where(eq(books.gutenbergId, gutenbergId));
  if (existing) return { bookId: existing.id, existing: true };

  // The EPUB with images (falls back to text-only content when a book has none).
  const res = await fetch(`${gutenbergUrl(gutenbergId)}.epub.images`, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`Project Gutenberg から取得できませんでした (${res.status})。番号を確認してください。`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_EPUB_BYTES) throw new Error("EPUB が大きすぎます。");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_EPUB_BYTES) throw new Error("EPUB が大きすぎます。");

  const parsed = extractEpub(bytes);
  if (!parsed.chapters.length) throw new Error("本文を取り出せませんでした。");
  const [catalog] = await db.select().from(gutenbergWorks).where(eq(gutenbergWorks.textId, gutenbergId));

  const epubKey = `epub/${gutenbergId}.epub`;
  await env.BUCKET.put(epubKey, bytes, { httpMetadata: { contentType: "application/epub+zip" } });

  const [book] = await db
    .insert(books)
    .values({
      gutenbergId,
      // The catalog title is cleaner (the EPUB's often carries "Illustrated by …"); fall back to the EPUB.
      title: catalog?.title ?? parsed.title?.split(" / ")[0] ?? `Gutenberg #${gutenbergId}`,
      author: parsed.author ?? catalog?.authors ?? null,
      language: parsed.language ?? catalog?.language ?? null,
      sourceUrl: gutenbergUrl(gutenbergId),
      epubKey,
      segmenterVersion: SEGMENTER_VERSION,
      ingestedBy: userId,
    })
    .returning({ id: books.id });

  try {
    // Cover and illustrations → R2 (books/<id>/…), a few uploads at a time.
    const cover = parsed.cover ?? (await fetchGutenbergCover(gutenbergId));
    const coverKey = cover ? await putCover(book.id, cover) : null;
    const imageKeys = new Map<string, string>();
    parsed.images.forEach((img, i) => imageKeys.set(img.path, `books/${book.id}/img/${String(i + 1).padStart(3, "0")}.${imageExt(img.path)}`));
    for (let i = 0; i < parsed.images.length; i += 6) {
      await Promise.all(
        parsed.images.slice(i, i + 6).map(img => env.BUCKET.put(imageKeys.get(img.path)!, img.bytes, { httpMetadata: { contentType: img.contentType } })),
      );
    }
    if (coverKey) await db.update(books).set({ coverKey }).where(eq(books.id, book.id));

    // D1: ≤100 bound parameters per statement (4 per chapter row → 20 rows per insert).
    const chapterValues = parsed.chapters.map((c, i) => ({ bookId: book.id, seq: i + 1, title: c.title.slice(0, 500) }));
    const chapterInserts = [];
    for (let i = 0; i < chapterValues.length; i += 20) {
      chapterInserts.push(db.insert(chapters).values(chapterValues.slice(i, i + 20)).returning({ id: chapters.id, seq: chapters.seq }));
    }
    const chapterRows = (await db.batch(chapterInserts as [(typeof chapterInserts)[0], ...typeof chapterInserts])).flat();
    const chapterIds = new Map(chapterRows.map(r => [r.seq, r.id]));

    const rows: SentenceRow[] = [];
    const perChapter = new Map<number, number>();
    parsed.chapters.forEach((c, i) => {
      const chapterId = chapterIds.get(i + 1)!;
      c.blocks.forEach((b, para) => {
        if (b.kind === "image") {
          rows.push({ bookId: book.id, chapterId, seq: rows.length + 1, para: para + 1, kind: "image", text: b.text.slice(0, 2000), image: imageKeys.get(b.src!) ?? null });
          return;
        }
        const pieces = b.kind === "heading" ? [b.text] : splitSentences(b.text);
        for (const text of pieces) rows.push({ bookId: book.id, chapterId, seq: rows.length + 1, para: para + 1, kind: b.kind, text, image: null });
      });
      perChapter.set(chapterId, rows.filter(r => r.chapterId === chapterId).length);
    });

    // D1: ≤100 bound parameters per statement (7 columns → 14 rows); several statements per batch.
    const inserts = [];
    for (let i = 0; i < rows.length; i += 14) inserts.push(db.insert(sentences).values(rows.slice(i, i + 14)));
    for (let i = 0; i < inserts.length; i += 50) {
      const chunk = inserts.slice(i, i + 50);
      await db.batch(chunk as [(typeof chunk)[0], ...typeof chunk]);
    }
    const counts = [...perChapter.entries()].map(([id, n]) => db.update(chapters).set({ sentenceCount: n }).where(eq(chapters.id, id)));
    await db.batch([
      db.update(books).set({ chapterCount: parsed.chapters.length, sentenceCount: rows.length }).where(eq(books.id, book.id)),
      ...counts,
    ]);
  } catch (e) {
    // Leave no half-imported book behind (chapters and sentences cascade; R2 objects are removed).
    await db.delete(books).where(eq(books.id, book.id));
    const listed = await env.BUCKET.list({ prefix: `books/${book.id}/` });
    if (listed.objects.length) await env.BUCKET.delete(listed.objects.map(o => o.key));
    throw e;
  }
  return { bookId: book.id, existing: false };
}

export async function listBooks(db: Db) {
  return db
    .select({
      id: books.id,
      title: books.title,
      author: books.author,
      gutenbergId: books.gutenbergId,
      chapterCount: books.chapterCount,
      sentenceCount: books.sentenceCount,
      hasCover: sql<boolean>`${books.coverKey} is not null`.mapWith(Boolean),
      createdAt: books.createdAt,
    })
    .from(books)
    .where(sql`${books.sentenceCount} > 0`)
    .orderBy(desc(books.createdAt));
}

export async function getBook(db: Db, bookId: number) {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) return null;
  const toc = await db
    .select({ id: chapters.id, seq: chapters.seq, title: chapters.title, sentenceCount: chapters.sentenceCount })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.seq));
  return { ...book, hasCover: !!book.coverKey, chapters: toc };
}

export async function getChapter(db: Db, bookId: number, seq: number) {
  const [chapter] = await db.select().from(chapters).where(and(eq(chapters.bookId, bookId), eq(chapters.seq, seq)));
  if (!chapter) return null;
  const rows = await db
    .select({ id: sentences.id, seq: sentences.seq, para: sentences.para, kind: sentences.kind, text: sentences.text, image: sentences.image })
    .from(sentences)
    .where(eq(sentences.chapterId, chapter.id))
    .orderBy(asc(sentences.seq));
  const [[book], [{ last }]] = await Promise.all([
    db.select({ id: books.id, title: books.title, author: books.author }).from(books).where(eq(books.id, bookId)),
    db.select({ last: sql<number>`max(${chapters.seq})` }).from(chapters).where(eq(chapters.bookId, bookId)),
  ]);
  return { book, chapter: { id: chapter.id, seq: chapter.seq, title: chapter.title, last }, sentences: rows };
}

export type ChapterSentence = NonNullable<Awaited<ReturnType<typeof getChapter>>>["sentences"][number];
