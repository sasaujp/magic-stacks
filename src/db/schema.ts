import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

// ---------------------------------------------------------------------------
// Books (shared by everyone): Project Gutenberg catalog → ingested book → chapters → sentences.

/** Project Gutenberg catalog (pg_catalog.csv), filtered to public-domain texts. Rebuilt on refresh. */
export const gutenbergWorks = sqliteTable(
  "gutenberg_works",
  {
    textId: integer("text_id").primaryKey(),
    title: text("title").notNull(), // first line of the catalog title
    subtitle: text("subtitle"), // further lines ("In Nine Discourses Delivered to …")
    sortKey: text("sort_key").notNull(), // folded title without leading article (A–Z browsing)
    authors: text("authors").notNull(), // creators without dates, "Surname, Forenames" joined with "; "
    /** Folded title + subtitle + every contributor (incl. editors, translators, contributors). */
    searchKey: text("search_key").notNull().default(""),
    /** Folded subjects and bookshelves (matched, but ranked below title/author hits). */
    subjectKey: text("subject_key").notNull().default(""),
    subjects: text("subjects"), // for display
    language: text("language").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  t => [index("gutenberg_works_sort_idx").on(t.language, t.sortKey), index("gutenberg_works_authors_idx").on(t.authors)],
);

export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey(),
    gutenbergId: integer("gutenberg_id"),
    title: text("title").notNull(),
    author: text("author"),
    language: text("language"),
    sourceUrl: text("source_url").notNull(), // canonical URL, e.g. https://www.gutenberg.org/ebooks/24526
    epubKey: text("epub_key"), // original EPUB in R2 (kept so the text can be re-segmented)
    coverKey: text("cover_key"), // cover image in R2 (served by /api/images/…)
    /** Version of the segmenter that produced the sentences (see src/server/segment.ts). */
    segmenterVersion: text("segmenter_version").notNull(),
    chapterCount: integer("chapter_count").notNull().default(0),
    sentenceCount: integer("sentence_count").notNull().default(0),
    ingestedBy: text("ingested_by"),
    createdAt: createdAt(),
  },
  t => [uniqueIndex("books_gutenberg_idx").on(t.gutenbergId)],
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: integer("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(), // 1-based order in the book
    title: text("title").notNull(),
    sentenceCount: integer("sentence_count").notNull().default(0),
  },
  t => [uniqueIndex("chapters_book_seq_idx").on(t.bookId, t.seq)],
);

/**
 * Every sentence of the book, in reading order. Headings, quotes, notes and illustrations are
 * kept as blocks too (kind), so the text can be rebuilt paragraph by paragraph.
 */
export const sentences = sqliteTable(
  "sentences",
  {
    id: integer("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(), // order within the book (1-based)
    para: integer("para").notNull(), // paragraph (block) number within the chapter
    kind: text("kind", { enum: ["p", "heading", "quote", "note", "image"] }).notNull(),
    text: text("text").notNull(), // for images: the caption / alt text (may be empty)
    image: text("image"), // R2 key of an illustration (kind "image")
  },
  t => [index("sentences_chapter_idx").on(t.chapterId, t.seq), uniqueIndex("sentences_book_seq_idx").on(t.bookId, t.seq)],
);

// ---------------------------------------------------------------------------
// Translation notes (private to their members). One note = one book.

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(), // random id (used in URLs)
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Free-form translation policy (文体・読者・方針), sent to the model with every request. */
    policy: text("policy").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull(),
  },
  t => [index("notes_book_idx").on(t.bookId)],
);

export const NOTE_ROLES = ["owner", "editor", "viewer"] as const;
export type NoteRole = (typeof NOTE_ROLES)[number];

export const noteMembers = sqliteTable(
  "note_members",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: NOTE_ROLES }).notNull(),
    addedAt: text("added_at").notNull(),
  },
  t => [primaryKey({ columns: [t.noteId, t.userId] }), index("note_members_user_idx").on(t.userId)],
);

/**
 * Translation memory: source term → target rendering. A row with chapterId set is an exception
 * that applies only in that chapter (it overrides the book-wide row with the same source).
 */
export const terms = sqliteTable(
  "terms",
  {
    id: integer("id").primaryKey(),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // as written in the text, e.g. "real assent"
    target: text("target").notNull(), // e.g. 「実的承認」
    kind: text("kind", { enum: ["term", "name", "phrase"] }).notNull().default("term"),
    chapterId: integer("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    memo: text("memo").notNull().default(""),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at").notNull(),
  },
  t => [index("terms_note_idx").on(t.noteId, t.source)],
);

/** Interpretive context: how the author argues and defines concepts. Optionally chapter-scoped. */
export const concepts = sqliteTable(
  "concepts",
  {
    id: integer("id").primaryKey(),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    chapterId: integer("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at").notNull(),
  },
  t => [index("concepts_note_idx").on(t.noteId)],
);

/** The note's translation of one sentence. "ai" = model draft, "final" = confirmed by a person. */
export const translations = sqliteTable(
  "translations",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    sentenceId: integer("sentence_id")
      .notNull()
      .references(() => sentences.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: ["ai", "final"] }).notNull(),
    /** Model's notes on the rendering (JSON string[]), kept with AI drafts. */
    rationale: text("rationale"),
    model: text("model"),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at").notNull(),
  },
  t => [primaryKey({ columns: [t.noteId, t.sentenceId] }), index("translations_chapter_idx").on(t.noteId, t.chapterId)],
);

export const ANNOTATION_KINDS = ["syntax", "meaning", "argument", "question", "memo"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/**
 * Analysis attached anywhere in a sentence: [start, end) are character offsets into the sentence
 * text (whole sentence when both are null). Written by the model (source "ai") or by a person.
 */
export const annotations = sqliteTable(
  "annotations",
  {
    id: integer("id").primaryKey(),
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    sentenceId: integer("sentence_id")
      .notNull()
      .references(() => sentences.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id").notNull(),
    start: integer("start"),
    end: integer("end"),
    quote: text("quote"), // the selected text at the time (for display / sanity check)
    kind: text("kind", { enum: ANNOTATION_KINDS }).notNull(),
    question: text("question"),
    body: text("body").notNull(), // JSON (ai: AnalysisSchema) or plain text (memo)
    source: text("source", { enum: ["ai", "user"] }).notNull(),
    model: text("model"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  t => [index("annotations_sentence_idx").on(t.noteId, t.sentenceId), index("annotations_chapter_idx").on(t.noteId, t.chapterId)],
);

// ---------------------------------------------------------------------------
// Accounts: username + passkeys (WebAuthn), invitation-only sign-up.

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(), // random UUID; also the WebAuthn user handle
    username: text("username").notNull(), // lowercase, unique
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  t => [uniqueIndex("users_username_idx").on(t.username)],
);

/** WebAuthn credentials. One user can have several (one per device / passkey provider). */
export const passkeys = sqliteTable(
  "passkeys",
  {
    id: text("id").primaryKey(), // credential ID (base64url)
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(), // COSE public key (base64url)
    counter: integer("counter").notNull().default(0),
    transports: text("transports"), // JSON array
    deviceName: text("device_name"),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  t => [index("passkeys_user_idx").on(t.userId)],
);

/** Login sessions. Only a SHA-256 hash of the cookie token is stored. */
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  t => [index("sessions_user_idx").on(t.userId)],
);

/**
 * Single-use links: "invite" creates a new account, "device" adds a passkey to an existing one
 * (shown as a QR code on a signed-in device). Only a hash of the token is stored.
 */
export const authTokens = sqliteTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind", { enum: ["invite", "device"] }).notNull(),
  userId: text("user_id"), // device: the account to extend
  grantsAdmin: integer("grants_admin", { mode: "boolean" }).notNull().default(false), // invite only
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

/** Pending WebAuthn ceremonies (challenge + context), consumed on verification. */
export const authChallenges = sqliteTable("auth_challenges", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["register", "login"] }).notNull(),
  challenge: text("challenge").notNull(),
  userId: text("user_id"),
  data: text("data"), // JSON: username, token hash, …
  expiresAt: text("expires_at").notNull(),
});

