import { action, json, query } from "@solidjs/router";
import * as api from "~/server/api";

/** Signed-in user or null. */
export const meQuery = query(api.fetchMe, "me");
export const appInfoQuery = query(api.fetchAppInfo, "app-info");
export const accountQuery = query(api.fetchAccount, "account");
export const deletePasskeyAction = action(api.deletePasskey, "delete-passkey");

export const booksQuery = query(api.fetchBooks, "books");
export const bookQuery = query(api.fetchBook, "book");
export const bookChapterQuery = query(api.fetchBookChapter, "book-chapter");
export const catalogSearchQuery = query(api.fetchCatalogSearch, "catalog-search");
export const catalogBrowseQuery = query(api.fetchCatalogBrowse, "catalog-browse");

export const myNotesQuery = query(api.fetchMyNotes, "my-notes");
export const noteQuery = query(api.fetchNote, "note");
export const termsQuery = query(api.fetchTerms, "terms");
export const conceptsQuery = query(api.fetchConcepts, "concepts");
export const chapterViewQuery = query(api.fetchChapterView, "chapter-view");
export const sentenceQuery = query(api.fetchSentence, "sentence");
export const concordanceQuery = query(api.fetchConcordance, "concordance");

// Mutations: each revalidates only what it changes.
export const importGutenbergAction = action(async (id: number) => json(await api.importGutenberg(id), { revalidate: [booksQuery.key, catalogSearchQuery.key, catalogBrowseQuery.key] }), "import-gutenberg");
export const fetchCoverAction = action(async (bookId: number) => json(await api.fetchBookCover(bookId), { revalidate: [booksQuery.key, bookQuery.key, myNotesQuery.key] }), "fetch-cover");
export const updateCatalogAction = action(async () => json(await api.updateCatalog(), { revalidate: [appInfoQuery.key, catalogSearchQuery.key, catalogBrowseQuery.key] }), "update-catalog");
export const createNoteAction = action(async (bookId: number, title: string) => json(await api.createNote(bookId, title), { revalidate: [myNotesQuery.key, bookQuery.key, bookChapterQuery.key] }), "create-note");
export const updateNoteAction = action(async (noteId: string, patch: { title?: string; policy?: string }) => json(await api.updateNote(noteId, patch), { revalidate: [noteQuery.key, myNotesQuery.key] }), "update-note");
export const deleteNoteAction = action(async (noteId: string) => json(await api.deleteNote(noteId), { revalidate: [myNotesQuery.key, bookQuery.key] }), "delete-note");
export const addMemberAction = action(async (noteId: string, username: string, role: "owner" | "editor" | "viewer") => json(await api.addNoteMember(noteId, username, role), { revalidate: noteQuery.key }), "add-member");
export const setMemberRoleAction = action(async (noteId: string, memberId: string, role: "owner" | "editor" | "viewer" | null) => json(await api.setNoteMemberRole(noteId, memberId, role), { revalidate: noteQuery.key }), "set-member-role");

export const saveTermAction = action(async (noteId: string, input: Parameters<typeof api.saveTerm>[1]) => json(await api.saveTerm(noteId, input), { revalidate: [termsQuery.key, chapterViewQuery.key] }), "save-term");
export const deleteTermAction = action(async (noteId: string, id: number) => json(await api.deleteTerm(noteId, id), { revalidate: [termsQuery.key, chapterViewQuery.key] }), "delete-term");
export const saveConceptAction = action(async (noteId: string, input: Parameters<typeof api.saveConcept>[1]) => json(await api.saveConcept(noteId, input), { revalidate: conceptsQuery.key }), "save-concept");
export const deleteConceptAction = action(async (noteId: string, id: number) => json(await api.deleteConcept(noteId, id), { revalidate: conceptsQuery.key }), "delete-concept");

const sentenceKeys = [chapterViewQuery.key, sentenceQuery.key, noteQuery.key];
export const saveTranslationAction = action(async (noteId: string, sentenceId: number, text: string, status: "ai" | "final") => json(await api.saveTranslation(noteId, sentenceId, text, status), { revalidate: sentenceKeys }), "save-translation");
export const aiTranslateAction = action(async (noteId: string, sentenceId: number) => json(await api.aiTranslate(noteId, sentenceId), { revalidate: sentenceKeys }), "ai-translate");
export const aiAnalyzeAction = action(async (noteId: string, input: Parameters<typeof api.aiAnalyze>[1]) => json(await api.aiAnalyze(noteId, input), { revalidate: sentenceKeys }), "ai-analyze");
export const addMemoAction = action(async (noteId: string, input: Parameters<typeof api.addMemo>[1]) => json(await api.addMemo(noteId, input), { revalidate: sentenceKeys }), "add-memo");
export const deleteAnnotationAction = action(async (noteId: string, id: number) => json(await api.deleteAnnotation(noteId, id), { revalidate: sentenceKeys }), "delete-annotation");

export type ChapterView = NonNullable<Awaited<ReturnType<typeof api.fetchChapterView>>>;
export type SentenceDetail = Awaited<ReturnType<typeof api.fetchSentence>>;
export type NoteOverview = NonNullable<Awaited<ReturnType<typeof api.fetchNote>>>;
export type Term = Awaited<ReturnType<typeof api.fetchTerms>>[number];
export type Concept = Awaited<ReturnType<typeof api.fetchConcepts>>[number];
export type { AnalysisOutput, TranslateResponse } from "~/server/ai";
export type CatalogHit = Awaited<ReturnType<typeof api.fetchCatalogSearch>>["works"][number];
export type { BrowseRequest } from "~/server/api";
export type BookChapter = NonNullable<Awaited<ReturnType<typeof api.fetchBookChapter>>>;
