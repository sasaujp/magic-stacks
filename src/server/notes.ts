/**
 * Translation notes: one book, translated by its members. Everything in a note (translation
 * memory, interpretive context, translations, annotations) is visible only to its members.
 *
 * Roles: owner (everything, incl. members), editor (edit content), viewer (read only).
 */
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { annotations, books, chapters, concepts, noteMembers, notes, sentences, terms, translations, users, type AnnotationKind, type NoteRole } from "~/db/schema";
import { randomToken } from "./auth";
import type { Db } from "./db";

export class NoteError extends Error {}

const now = () => new Date().toISOString();

// --- access ---------------------------------------------------------------------

export async function noteRole(db: Db, noteId: string, userId: string): Promise<NoteRole | null> {
  const [row] = await db.select({ role: noteMembers.role }).from(noteMembers).where(and(eq(noteMembers.noteId, noteId), eq(noteMembers.userId, userId)));
  return row?.role ?? null;
}

const RANK: Record<NoteRole, number> = { viewer: 0, editor: 1, owner: 2 };

/** Throws unless the user has at least `need` in the note. Returns the note row and the role. */
export async function requireNote(db: Db, noteId: string, userId: string, need: NoteRole = "viewer") {
  const role = await noteRole(db, noteId, userId);
  if (!role) throw new NoteError("このノートは見つからないか、アクセス権がありません。");
  if (RANK[role] < RANK[need]) throw new NoteError(need === "owner" ? "この操作はノートの所有者だけができます。" : "このノートは閲覧のみです。");
  const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
  return { note, role };
}

async function touch(db: Db, noteId: string) {
  await db.update(notes).set({ updatedAt: now() }).where(eq(notes.id, noteId));
}

// --- notes ----------------------------------------------------------------------

export async function createNote(db: Db, userId: string, bookId: number, title: string) {
  const [book] = await db.select({ id: books.id, title: books.title }).from(books).where(eq(books.id, bookId));
  if (!book) throw new NoteError("書籍が見つかりません。");
  const id = randomToken(9);
  const t = now();
  await db.batch([
    db.insert(notes).values({ id, bookId, title: title.trim().slice(0, 120) || book.title, createdBy: userId, updatedAt: t }),
    db.insert(noteMembers).values({ noteId: id, userId, role: "owner", addedAt: t }),
  ]);
  return { id };
}

export async function listMyNotes(db: Db, userId: string, bookId?: number) {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      bookId: notes.bookId,
      bookTitle: books.title,
      author: books.author,
      sentenceCount: books.sentenceCount,
      hasCover: sql<boolean>`${books.coverKey} is not null`.mapWith(Boolean),
      role: noteMembers.role,
      updatedAt: notes.updatedAt,
    })
    .from(noteMembers)
    .innerJoin(notes, eq(notes.id, noteMembers.noteId))
    .innerJoin(books, eq(books.id, notes.bookId))
    .where(bookId ? and(eq(noteMembers.userId, userId), eq(notes.bookId, bookId)) : eq(noteMembers.userId, userId))
    .orderBy(desc(notes.updatedAt));
  if (!rows.length) return [];
  const done = await db
    .select({ noteId: translations.noteId, n: count() })
    .from(translations)
    .where(inArray(translations.noteId, rows.map(r => r.id)))
    .groupBy(translations.noteId);
  const byNote = new Map(done.map(d => [d.noteId, d.n]));
  return rows.map(r => ({ ...r, translatedCount: byNote.get(r.id) ?? 0 }));
}

export async function getNoteOverview(db: Db, noteId: string, userId: string) {
  const { note, role } = await requireNote(db, noteId, userId);
  const [book] = await db.select().from(books).where(eq(books.id, note.bookId));
  const toc = await db
    .select({ id: chapters.id, seq: chapters.seq, title: chapters.title, sentenceCount: chapters.sentenceCount })
    .from(chapters)
    .where(eq(chapters.bookId, note.bookId))
    .orderBy(asc(chapters.seq));
  const progress = await db
    .select({ chapterId: translations.chapterId, total: count(), final: sql<number>`sum(case when ${translations.status} = 'final' then 1 else 0 end)` })
    .from(translations)
    .where(eq(translations.noteId, noteId))
    .groupBy(translations.chapterId);
  const byChapter = new Map(progress.map(p => [p.chapterId, p]));
  const members = await db
    .select({ userId: users.id, username: users.username, role: noteMembers.role, addedAt: noteMembers.addedAt })
    .from(noteMembers)
    .innerJoin(users, eq(users.id, noteMembers.userId))
    .where(eq(noteMembers.noteId, noteId))
    .orderBy(asc(noteMembers.addedAt));
  return {
    note,
    role,
    book: { id: book.id, title: book.title, author: book.author, sourceUrl: book.sourceUrl, sentenceCount: book.sentenceCount, hasCover: !!book.coverKey },
    chapters: toc.map(c => ({ ...c, translated: byChapter.get(c.id)?.total ?? 0, final: Number(byChapter.get(c.id)?.final ?? 0) })),
    members,
  };
}

export async function updateNote(db: Db, noteId: string, userId: string, patch: { title?: string; policy?: string }) {
  await requireNote(db, noteId, userId, "editor");
  const set: Partial<typeof notes.$inferInsert> = { updatedAt: now() };
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 120) || "無題のノート";
  if (patch.policy !== undefined) set.policy = patch.policy.slice(0, 4000);
  await db.update(notes).set(set).where(eq(notes.id, noteId));
}

export async function deleteNote(db: Db, noteId: string, userId: string) {
  await requireNote(db, noteId, userId, "owner");
  await db.delete(notes).where(eq(notes.id, noteId));
}

// --- members --------------------------------------------------------------------

export async function addMember(db: Db, noteId: string, userId: string, username: string, role: NoteRole) {
  await requireNote(db, noteId, userId, "owner");
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, username.trim().toLowerCase()));
  if (!u) throw new NoteError(`ユーザー「${username}」は見つかりません。`);
  await db
    .insert(noteMembers)
    .values({ noteId, userId: u.id, role, addedAt: now() })
    .onConflictDoUpdate({ target: [noteMembers.noteId, noteMembers.userId], set: { role } });
}

export async function setMemberRole(db: Db, noteId: string, userId: string, memberId: string, role: NoteRole | null) {
  await requireNote(db, noteId, userId, "owner");
  if (memberId === userId && role !== "owner") {
    const [{ n }] = await db.select({ n: count() }).from(noteMembers).where(and(eq(noteMembers.noteId, noteId), eq(noteMembers.role, "owner")));
    if (n <= 1) throw new NoteError("所有者が 1 人もいなくなるため変更できません。先に別のメンバーを所有者にしてください。");
  }
  const where = and(eq(noteMembers.noteId, noteId), eq(noteMembers.userId, memberId));
  if (role === null) await db.delete(noteMembers).where(where);
  else await db.update(noteMembers).set({ role }).where(where);
}

// --- translation memory & interpretive context ------------------------------------

export async function listTerms(db: Db, noteId: string) {
  return db
    .select({ id: terms.id, source: terms.source, target: terms.target, kind: terms.kind, chapterId: terms.chapterId, memo: terms.memo, updatedAt: terms.updatedAt })
    .from(terms)
    .where(eq(terms.noteId, noteId))
    .orderBy(sql`lower(${terms.source})`, asc(terms.chapterId));
}

export interface TermInput {
  id?: number;
  source: string;
  target: string;
  kind: "term" | "name" | "phrase";
  chapterId: number | null;
  memo: string;
}

export async function saveTerm(db: Db, noteId: string, userId: string, input: TermInput) {
  const { note } = await requireNote(db, noteId, userId, "editor");
  const source = input.source.trim().slice(0, 200);
  const target = input.target.trim().slice(0, 200);
  if (!source || !target) throw new NoteError("原語と訳語を入力してください。");
  if (input.chapterId !== null) {
    const [c] = await db.select({ id: chapters.id }).from(chapters).where(and(eq(chapters.id, input.chapterId), eq(chapters.bookId, note.bookId)));
    if (!c) throw new NoteError("章の指定が正しくありません。");
  }
  const values = { source, target, kind: input.kind, chapterId: input.chapterId, memo: input.memo.trim().slice(0, 1000), updatedBy: userId, updatedAt: now() };
  if (input.id) {
    await db.update(terms).set(values).where(and(eq(terms.id, input.id), eq(terms.noteId, noteId)));
  } else {
    // Same source and scope → update the existing entry instead of duplicating it.
    const scope = input.chapterId === null ? isNull(terms.chapterId) : eq(terms.chapterId, input.chapterId);
    const [dup] = await db.select({ id: terms.id }).from(terms).where(and(eq(terms.noteId, noteId), sql`lower(${terms.source}) = lower(${source})`, scope));
    if (dup) await db.update(terms).set(values).where(eq(terms.id, dup.id));
    else await db.insert(terms).values({ noteId, ...values });
  }
  await touch(db, noteId);
}

export async function deleteTerm(db: Db, noteId: string, userId: string, id: number) {
  await requireNote(db, noteId, userId, "editor");
  await db.delete(terms).where(and(eq(terms.id, id), eq(terms.noteId, noteId)));
}

export async function listConcepts(db: Db, noteId: string) {
  return db
    .select({ id: concepts.id, title: concepts.title, body: concepts.body, chapterId: concepts.chapterId, updatedAt: concepts.updatedAt })
    .from(concepts)
    .where(eq(concepts.noteId, noteId))
    .orderBy(asc(concepts.chapterId), asc(concepts.id));
}

export async function saveConcept(db: Db, noteId: string, userId: string, input: { id?: number; title: string; body: string; chapterId: number | null }) {
  await requireNote(db, noteId, userId, "editor");
  const title = input.title.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 6000);
  if (!title || !body) throw new NoteError("見出しと内容を入力してください。");
  const values = { title, body, chapterId: input.chapterId, updatedBy: userId, updatedAt: now() };
  if (input.id) await db.update(concepts).set(values).where(and(eq(concepts.id, input.id), eq(concepts.noteId, noteId)));
  else await db.insert(concepts).values({ noteId, ...values });
  await touch(db, noteId);
}

export async function deleteConcept(db: Db, noteId: string, userId: string, id: number) {
  await requireNote(db, noteId, userId, "editor");
  await db.delete(concepts).where(and(eq(concepts.id, id), eq(concepts.noteId, noteId)));
}

// --- reading a chapter ------------------------------------------------------------

export async function getChapterView(db: Db, noteId: string, userId: string, seq: number) {
  const { note, role } = await requireNote(db, noteId, userId);
  const [chapter] = await db.select().from(chapters).where(and(eq(chapters.bookId, note.bookId), eq(chapters.seq, seq)));
  if (!chapter) return null;
  const [rows, tr, ann, [{ last }], [book]] = await Promise.all([
    db
      .select({ id: sentences.id, seq: sentences.seq, para: sentences.para, kind: sentences.kind, text: sentences.text, image: sentences.image })
      .from(sentences)
      .where(eq(sentences.chapterId, chapter.id))
      .orderBy(asc(sentences.seq)),
    db
      .select({ sentenceId: translations.sentenceId, text: translations.text, status: translations.status })
      .from(translations)
      .where(and(eq(translations.noteId, noteId), eq(translations.chapterId, chapter.id))),
    db
      .select({ sentenceId: annotations.sentenceId, start: annotations.start, end: annotations.end, kind: annotations.kind })
      .from(annotations)
      .where(and(eq(annotations.noteId, noteId), eq(annotations.chapterId, chapter.id))),
    db.select({ last: sql<number>`max(${chapters.seq})` }).from(chapters).where(eq(chapters.bookId, note.bookId)),
    db.select({ title: books.title, author: books.author }).from(books).where(eq(books.id, note.bookId)),
  ]);
  const chapterTerms = (await listTerms(db, noteId)).filter(t => t.chapterId === null || t.chapterId === chapter.id);
  return {
    note: { id: note.id, title: note.title },
    book,
    role,
    chapter: { id: chapter.id, seq: chapter.seq, title: chapter.title, last },
    sentences: rows,
    translations: Object.fromEntries(tr.map(t => [t.sentenceId, { text: t.text, status: t.status }])),
    annotations: ann,
    terms: effectiveTerms(chapterTerms, chapter.id),
  };
}

/** Book-wide terms, with chapter-scoped entries replacing book-wide ones of the same source. */
export function effectiveTerms<T extends { source: string; chapterId: number | null }>(all: T[], chapterId: number): T[] {
  const scoped = new Set(all.filter(t => t.chapterId === chapterId).map(t => t.source.toLowerCase()));
  return all.filter(t => t.chapterId === chapterId || (t.chapterId === null && !scoped.has(t.source.toLowerCase())));
}

export async function getSentenceInNote(db: Db, noteId: string, sentenceId: number) {
  const [note] = await db.select({ bookId: notes.bookId }).from(notes).where(eq(notes.id, noteId));
  const [s] = await db.select().from(sentences).where(eq(sentences.id, sentenceId));
  if (!note || !s || s.bookId !== note.bookId) throw new NoteError("文が見つかりません。");
  return s;
}

export async function getSentenceDetail(db: Db, noteId: string, userId: string, sentenceId: number) {
  await requireNote(db, noteId, userId);
  const s = await getSentenceInNote(db, noteId, sentenceId);
  const [tr] = await db.select().from(translations).where(and(eq(translations.noteId, noteId), eq(translations.sentenceId, sentenceId)));
  const ann = await db
    .select({
      id: annotations.id,
      start: annotations.start,
      end: annotations.end,
      quote: annotations.quote,
      kind: annotations.kind,
      question: annotations.question,
      body: annotations.body,
      source: annotations.source,
      model: annotations.model,
      createdAt: annotations.createdAt,
      username: users.username,
    })
    .from(annotations)
    .leftJoin(users, eq(users.id, annotations.createdBy))
    .where(and(eq(annotations.noteId, noteId), eq(annotations.sentenceId, sentenceId)))
    .orderBy(asc(annotations.createdAt));
  return {
    sentence: { id: s.id, text: s.text, kind: s.kind },
    translation: tr ? { text: tr.text, status: tr.status, rationale: tr.rationale ? (JSON.parse(tr.rationale) as string[]) : [], model: tr.model, updatedAt: tr.updatedAt } : null,
    annotations: ann,
  };
}

export async function saveTranslation(db: Db, noteId: string, userId: string, sentenceId: number, text: string, status: "ai" | "final", extra: { rationale?: string[]; model?: string } = {}) {
  await requireNote(db, noteId, userId, "editor");
  const s = await getSentenceInNote(db, noteId, sentenceId);
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed) {
    await db.delete(translations).where(and(eq(translations.noteId, noteId), eq(translations.sentenceId, sentenceId)));
    return;
  }
  const values = {
    text: trimmed,
    status,
    rationale: extra.rationale ? JSON.stringify(extra.rationale) : null,
    model: extra.model ?? null,
    updatedBy: userId,
    updatedAt: now(),
  };
  await db
    .insert(translations)
    .values({ noteId, sentenceId, chapterId: s.chapterId, ...values })
    .onConflictDoUpdate({ target: [translations.noteId, translations.sentenceId], set: values });
  await touch(db, noteId);
}

export async function addAnnotation(
  db: Db,
  noteId: string,
  userId: string,
  input: { sentenceId: number; start: number | null; end: number | null; kind: AnnotationKind; question?: string | null; body: string; source: "ai" | "user"; model?: string | null },
) {
  await requireNote(db, noteId, userId, "editor");
  const s = await getSentenceInNote(db, noteId, input.sentenceId);
  const span = normalizeSpan(s.text, input.start, input.end);
  const [row] = await db
    .insert(annotations)
    .values({
      noteId,
      sentenceId: s.id,
      chapterId: s.chapterId,
      start: span?.[0] ?? null,
      end: span?.[1] ?? null,
      quote: span ? s.text.slice(span[0], span[1]) : null,
      kind: input.kind,
      question: input.question?.trim().slice(0, 1000) || null,
      body: input.body,
      source: input.source,
      model: input.model ?? null,
      createdBy: userId,
    })
    .returning({ id: annotations.id });
  await touch(db, noteId);
  return row.id;
}

/** Valid [start, end) within the sentence, or null for "the whole sentence". */
export function normalizeSpan(text: string, start: number | null, end: number | null): [number, number] | null {
  if (start === null || end === null) return null;
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.min(text.length, Math.max(start, end));
  if (b - a < 1 || (a === 0 && b === text.length)) return null;
  return [a, b];
}

export async function deleteAnnotation(db: Db, noteId: string, userId: string, id: number) {
  await requireNote(db, noteId, userId, "editor");
  await db.delete(annotations).where(and(eq(annotations.id, id), eq(annotations.noteId, noteId)));
}

// --- concordance (KWIC within the book) ----------------------------------------------

export async function concordance(db: Db, noteId: string, userId: string, q: string, limit = 200) {
  const { note } = await requireNote(db, noteId, userId);
  const needle = q.trim();
  if (needle.length < 2) return { query: needle, total: 0, hits: [] };
  const where = and(eq(sentences.bookId, note.bookId), sql`instr(lower(${sentences.text}), lower(${needle})) > 0`, or(eq(sentences.kind, "p"), eq(sentences.kind, "quote"), eq(sentences.kind, "note")));
  const [{ total }] = await db.select({ total: count() }).from(sentences).where(where);
  const rows = await db
    .select({ id: sentences.id, text: sentences.text, chapterSeq: chapters.seq, chapterTitle: chapters.title, translation: translations.text, status: translations.status })
    .from(sentences)
    .innerJoin(chapters, eq(chapters.id, sentences.chapterId))
    .leftJoin(translations, and(eq(translations.sentenceId, sentences.id), eq(translations.noteId, noteId)))
    .where(where)
    .orderBy(asc(sentences.seq))
    .limit(limit);
  return { query: needle, total, hits: rows };
}
