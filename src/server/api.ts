"use server";
/**
 * Server functions (RPC endpoints). Everything here runs inside the Worker.
 * All of them require a signed-in user (resolved by src/middleware.ts) except fetchMe.
 * Errors meant for the user are returned as { ok: false, error } rather than thrown.
 */
import { env } from "cloudflare:workers";
import { getRequestEvent } from "solid-js/web";
import type { AnnotationKind, NoteRole } from "~/db/schema";
import { aiModel, analyzeSpan, translateSentence } from "./ai";
import { listPasskeys, removePasskey, type SessionUser } from "./auth";
import { ensureCover, getBook, getChapter, ingestGutenberg, listBooks, parseGutenbergId } from "./books";
import { browseAuthors, browseTitles, catalogSize, refreshCatalog, searchCatalog, worksByAuthor } from "./catalog";
import { getDb } from "./db";
import * as notes from "./notes";

function currentUser(): SessionUser | null {
  return getRequestEvent()?.locals.user ?? null;
}

function requireUser(): SessionUser {
  const user = currentUser();
  if (!user) throw new Error("ログインが必要です。");
  return user;
}

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

/** Runs a mutation and turns expected errors into { ok: false } (unexpected ones are logged). */
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (!(e instanceof notes.NoteError)) console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The signed-in user, or null (public: used by the login page and header). */
export async function fetchMe() {
  return currentUser();
}

export async function fetchAppInfo() {
  requireUser();
  return { hasApiKey: !!env.ANTHROPIC_API_KEY, model: aiModel(), catalogSize: await catalogSize(getDb()) };
}

// --- account -------------------------------------------------------------------------

export async function fetchAccount() {
  const user = requireUser();
  return { user, passkeys: await listPasskeys(getDb(), user.id) };
}

export async function deletePasskey(passkeyId: string) {
  const user = requireUser();
  try {
    await removePasskey(getDb(), user.id, passkeyId);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- library -------------------------------------------------------------------------

export async function fetchBooks() {
  requireUser();
  return listBooks(getDb());
}

export async function fetchBook(bookId: number) {
  const user = requireUser();
  const db = getDb();
  const book = await getBook(db, bookId);
  return book ? { ...book, myNotes: await notes.listMyNotes(db, user.id, bookId) } : null;
}

/** Marks works already ingested (so the list can offer "open" instead of "import"). */
async function withBookIds<T extends { textId: number }>(db: ReturnType<typeof getDb>, works: T[]) {
  const ingested = new Map((await listBooks(db)).map(b => [b.gutenbergId, b.id]));
  return works.map(w => ({ ...w, bookId: ingested.get(w.textId) ?? null }));
}

export async function fetchCatalogSearch(q: string, offset = 0) {
  requireUser();
  const db = getDb();
  const { works, hasMore } = await searchCatalog(db, q, Math.max(0, offset));
  return { directId: parseGutenbergId(q), works: await withBookIds(db, works), hasMore };
}

export type BrowseRequest = { mode: "title"; initial: string; offset?: number } | { mode: "author"; initial: string } | { mode: "works-by"; authors: string };

export async function fetchCatalogBrowse(req: BrowseRequest) {
  requireUser();
  const db = getDb();
  if (req.mode === "author") return { kind: "authors" as const, authors: await browseAuthors(db, req.initial) };
  if (req.mode === "works-by") return { kind: "works" as const, works: await withBookIds(db, await worksByAuthor(db, req.authors)), total: null };
  const { works, total } = await browseTitles(db, req.initial, Math.max(0, req.offset ?? 0));
  return { kind: "works" as const, works: await withBookIds(db, works), total };
}

export async function importGutenberg(gutenbergId: number) {
  const user = requireUser();
  return attempt(() => ingestGutenberg(getDb(), gutenbergId, user.id));
}

/** A chapter's original text, readable without a note; plus the user's notes on the book (to switch over). */
export async function fetchBookChapter(bookId: number, seq: number) {
  const user = requireUser();
  const db = getDb();
  const chapter = await getChapter(db, bookId, seq);
  if (!chapter) return null;
  const myNotes = (await notes.listMyNotes(db, user.id, bookId)).map(n => ({ id: n.id, title: n.title }));
  return { ...chapter, myNotes };
}

export async function fetchBookCover(bookId: number) {
  requireUser();
  return attempt(() => ensureCover(getDb(), bookId));
}

export async function updateCatalog() {
  const user = requireUser();
  if (!user.isAdmin) return { ok: false as const, error: "カタログの更新は管理者だけができます。" };
  return attempt(() => refreshCatalog(getDb()));
}

// --- notes ---------------------------------------------------------------------------

export async function fetchMyNotes() {
  return notes.listMyNotes(getDb(), requireUser().id);
}

export async function createNote(bookId: number, title: string) {
  const user = requireUser();
  return attempt(() => notes.createNote(getDb(), user.id, bookId, title));
}

export async function fetchNote(noteId: string) {
  const user = requireUser();
  const r = await attempt(() => notes.getNoteOverview(getDb(), noteId, user.id));
  return r.ok ? r.value : null;
}

export async function updateNote(noteId: string, patch: { title?: string; policy?: string }) {
  const user = requireUser();
  return attempt(() => notes.updateNote(getDb(), noteId, user.id, patch));
}

export async function deleteNote(noteId: string) {
  const user = requireUser();
  return attempt(() => notes.deleteNote(getDb(), noteId, user.id));
}

export async function addNoteMember(noteId: string, username: string, role: NoteRole) {
  const user = requireUser();
  return attempt(() => notes.addMember(getDb(), noteId, user.id, username, role));
}

export async function setNoteMemberRole(noteId: string, memberId: string, role: NoteRole | null) {
  const user = requireUser();
  return attempt(() => notes.setMemberRole(getDb(), noteId, user.id, memberId, role));
}

export async function fetchTerms(noteId: string) {
  const user = requireUser();
  const db = getDb();
  await notes.requireNote(db, noteId, user.id);
  return notes.listTerms(db, noteId);
}

export async function saveTerm(noteId: string, input: notes.TermInput) {
  const user = requireUser();
  return attempt(() => notes.saveTerm(getDb(), noteId, user.id, input));
}

export async function deleteTerm(noteId: string, id: number) {
  const user = requireUser();
  return attempt(() => notes.deleteTerm(getDb(), noteId, user.id, id));
}

export async function fetchConcepts(noteId: string) {
  const user = requireUser();
  const db = getDb();
  await notes.requireNote(db, noteId, user.id);
  return notes.listConcepts(db, noteId);
}

export async function saveConcept(noteId: string, input: { id?: number; title: string; body: string; chapterId: number | null }) {
  const user = requireUser();
  return attempt(() => notes.saveConcept(getDb(), noteId, user.id, input));
}

export async function deleteConcept(noteId: string, id: number) {
  const user = requireUser();
  return attempt(() => notes.deleteConcept(getDb(), noteId, user.id, id));
}

// --- reading & translating -------------------------------------------------------------

export async function fetchChapterView(noteId: string, seq: number) {
  const user = requireUser();
  const r = await attempt(() => notes.getChapterView(getDb(), noteId, user.id, seq));
  return r.ok ? r.value : null;
}

export async function fetchSentence(noteId: string, sentenceId: number) {
  const user = requireUser();
  return notes.getSentenceDetail(getDb(), noteId, user.id, sentenceId);
}

export async function saveTranslation(noteId: string, sentenceId: number, text: string, status: "ai" | "final") {
  const user = requireUser();
  return attempt(() => notes.saveTranslation(getDb(), noteId, user.id, sentenceId, text, status));
}

export async function aiTranslate(noteId: string, sentenceId: number) {
  const user = requireUser();
  try {
    return await translateSentence(getDb(), noteId, user.id, sentenceId);
  } catch (e) {
    return { status: "error" as const, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function aiAnalyze(noteId: string, input: { sentenceId: number; start: number | null; end: number | null; kind: Exclude<AnnotationKind, "memo">; question?: string }) {
  const user = requireUser();
  try {
    return await analyzeSpan(getDb(), noteId, user.id, input);
  } catch (e) {
    return { status: "error" as const, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function addMemo(noteId: string, input: { sentenceId: number; start: number | null; end: number | null; body: string }) {
  const user = requireUser();
  return attempt(() => {
    if (!input.body.trim()) throw new notes.NoteError("メモを入力してください。");
    return notes.addAnnotation(getDb(), noteId, user.id, { ...input, body: input.body.trim().slice(0, 8000), kind: "memo", source: "user" });
  });
}

export async function deleteAnnotation(noteId: string, id: number) {
  const user = requireUser();
  return attempt(() => notes.deleteAnnotation(getDb(), noteId, user.id, id));
}

export async function fetchConcordance(noteId: string, q: string) {
  const user = requireUser();
  return notes.concordance(getDb(), noteId, user.id, q);
}
