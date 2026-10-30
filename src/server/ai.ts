/**
 * Claude Haiku: sentence translation and span analysis, informed by the note's context.
 *
 * Every request carries the note's working context so renderings stay consistent:
 * - translation policy (文体・方針),
 * - translation memory entries whose source occurs near the sentence (chapter exceptions win),
 * - interpretive context (book-wide and this chapter's),
 * - surrounding sentences with the note's existing translations.
 * The model may propose new terms; they enter the memory only when a person accepts them.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "cloudflare:workers";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { books, chapters, sentences, translations, type AnnotationKind } from "~/db/schema";
import { termOccurs } from "~/lib/text";
import type { Db } from "./db";
import { addAnnotation, effectiveTerms, getSentenceInNote, listConcepts, listTerms, normalizeSpan, requireNote, saveTranslation } from "./notes";

export const PROMPT_VERSION = "2026-10-30.1";
const DEFAULT_MODEL = "claude-haiku-5-5";
const CONTEXT_BEFORE = 4;
const CONTEXT_AFTER = 2;

export function aiModel(): string {
  return env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

const TermCandidate = z.object({
  source: z.string().describe("原文での表記（本文からそのまま）"),
  target: z.string().describe("提案する訳語"),
  kind: z.enum(["term", "name", "phrase"]).describe("term=概念・専門用語, name=固有名詞, phrase=定型句"),
  reason: z.string().describe("なぜ訳語を固定すべきか（1文）"),
});

export const TranslationSchema = z.object({
  translation: z.string().describe("対象の1文の日本語訳（前後の文は訳さない）"),
  rationale: z.array(z.string()).describe("訳出上の判断（構文の取り方、語の選択、翻訳メモリとの関係など）。2〜4項目"),
  termCandidates: z.array(TermCandidate).describe("翻訳メモリに未登録で、一貫した訳語を決めておくべき語。無ければ空配列"),
});
export type TranslationOutput = z.infer<typeof TranslationSchema>;

export const AnalysisSchema = z.object({
  summary: z.string().describe("答えの要点（1〜2文）"),
  explanation: z.string().describe("本文の説明。段落は空行で区切る"),
  structure: z
    .array(z.object({ text: z.string().describe("原文の一部（本文からそのまま）"), role: z.string().describe("文法的・論理的な役割"), note: z.string().describe("補足（不要なら空文字列）") }))
    .describe("構文や論理の要素ごとの分解（構文解析・論理のとき）。不要なら空配列"),
  translationHint: z.string().describe("この箇所の訳し方の提案（不要なら空文字列）"),
  termCandidates: z.array(TermCandidate).describe("翻訳メモリに加えるべき語。無ければ空配列"),
});
export type AnalysisOutput = z.infer<typeof AnalysisSchema>;

const SYSTEM_PROMPT = `あなたは英語で書かれた19世紀の思想・神学・教育論（とくに John Henry Newman）の翻訳者であり、精読の指導者です。翻訳ノートの共同作業者として、1文ずつ日本語に訳し、指定された箇所を解析します。

方針:
- 翻訳メモリ（用語集）にある語は、その訳語を使ってください。章ごとの例外が示されている場合は、それが優先です。訳語を変えるべきだと考えるときも、訳文ではメモリに従い、rationale でその旨を述べてください。
- 解釈コンテキストは、著者の議論や概念の定義についてのノートの理解です。訳語の選択や構文の取り方は、これと整合させてください。
- 直前の文の既存の訳文と、文体（です・ます／である）や用語を揃えてください。
- 原文の論理構造（譲歩・対比・条件・列挙、長い挿入句）を崩さず、日本語として自然に読める訳を目指してください。長い文は読点や語順で整理してかまいませんが、内容を省略・追加してはいけません。
- 聖書や教父などの引用・ラテン語は、意味を訳したうえで必要なら rationale で出典や原語に触れてください。確かでない出典は推測と分かるように書いてください。
- 説明文は「です・ます」調の日本語で、学習者に分かるように書いてください。原文を引用するときは本文の綴りのまま引用してください。`;

const KIND_PROMPT: Record<Exclude<AnnotationKind, "memo">, string> = {
  syntax: "指定箇所の構文を解析してください。主語・述語・目的語、節の関係、修飾のかかり方、挿入句、省略を明らかにし、structure に要素ごとに分解してください。",
  meaning: "指定箇所の語句の意味と用法を、19世紀英語および著者の用語法の観点から説明してください。現代英語と意味がずれる語、多義語は特に注意してください。",
  argument: "指定箇所が、この文・段落・章の議論の中でどんな役割を果たしているか（前提、例示、譲歩、反論、結論など）を説明してください。解釈コンテキストとの関係にも触れてください。",
  question: "利用者の質問に、指定箇所と文脈に即して答えてください。",
};

interface Context {
  bookTitle: string;
  author: string | null;
  chapterTitle: string;
  policy: string;
  before: { text: string; translation: string | null }[];
  after: string[];
  terms: { source: string; target: string; kind: string; memo: string; scoped: boolean }[];
  concepts: { title: string; body: string; scoped: boolean }[];
}


/** `note` must come from requireNote (the caller has checked access). */
async function buildContext(db: Db, note: { id: string; policy: string }, sentenceId: number): Promise<{ ctx: Context; sentence: { id: number; text: string; chapterId: number } }> {
  const noteId = note.id;
  const s = await getSentenceInNote(db, noteId, sentenceId);
  const [[chapter], [book], window] = await Promise.all([
    db.select({ title: chapters.title }).from(chapters).where(eq(chapters.id, s.chapterId)),
    db.select({ title: books.title, author: books.author }).from(books).where(eq(books.id, s.bookId)),
    db
      .select({ id: sentences.id, seq: sentences.seq, kind: sentences.kind, text: sentences.text, translation: translations.text })
      .from(sentences)
      .leftJoin(translations, and(eq(translations.sentenceId, sentences.id), eq(translations.noteId, noteId)))
      .where(and(eq(sentences.chapterId, s.chapterId), gte(sentences.seq, s.seq - CONTEXT_BEFORE), lte(sentences.seq, s.seq + CONTEXT_AFTER)))
      .orderBy(asc(sentences.seq)),
  ]);
  const before = window.filter(w => w.seq < s.seq && w.kind !== "image").map(w => ({ text: w.text, translation: w.translation }));
  const after = window.filter(w => w.seq > s.seq && w.kind !== "image").map(w => w.text);
  const windowText = [...before.map(b => b.text), s.text, ...after].join(" ");

  const terms = effectiveTerms(await listTerms(db, noteId), s.chapterId)
    .filter(t => termOccurs(t.source, windowText))
    .map(t => ({ source: t.source, target: t.target, kind: t.kind, memo: t.memo, scoped: t.chapterId !== null }));
  const concepts = (await listConcepts(db, noteId))
    .filter(c => c.chapterId === null || c.chapterId === s.chapterId)
    .map(c => ({ title: c.title, body: c.body, scoped: c.chapterId !== null }));

  return {
    ctx: { bookTitle: book.title, author: book.author, chapterTitle: chapter.title, policy: note.policy, before, after, terms, concepts },
    sentence: { id: s.id, text: s.text, chapterId: s.chapterId },
  };
}

/** Note-level context: identical for every sentence of a chapter, so it goes in the cached system prefix. */
function noteContextBlock(ctx: Context): string {
  const lines = [`# 書籍: ${ctx.bookTitle}${ctx.author ? `（${ctx.author}）` : ""}`, `# 章: ${ctx.chapterTitle}`, "", "## 翻訳方針", ctx.policy.trim() || "（特になし。です・ます調ではなく、である調の学術的な訳文を基本とする）", "", "## 解釈コンテキスト"];
  if (ctx.concepts.length) for (const c of ctx.concepts) lines.push(`### ${c.title}${c.scoped ? "（この章）" : ""}`, c.body, "");
  else lines.push("（まだありません）");
  return lines.join("\n");
}

function sentenceBlock(ctx: Context, text: string): string {
  const lines = ["## 翻訳メモリ（この文の付近に出てくる語）"];
  if (ctx.terms.length) for (const t of ctx.terms) lines.push(`- ${t.source} → ${t.target}${t.scoped ? "（この章の例外）" : ""}${t.memo ? ` ※${t.memo}` : ""}`);
  else lines.push("（該当なし）");
  lines.push("", "## 直前の文（既存の訳）");
  if (ctx.before.length) for (const b of ctx.before) lines.push(`> ${b.text}`, `訳: ${b.translation ?? "（未訳）"}`);
  else lines.push("（章の冒頭）");
  lines.push("", "## 対象の文", text, "", "## 直後の文（参照用。訳さない）", ...(ctx.after.length ? ctx.after.map(a => `> ${a}`) : ["（章の末尾）"]));
  return lines.join("\n");
}

type AiResult<T> = { status: "ok"; data: T; model: string } | { status: "no_api_key" } | { status: "error"; message: string };

async function callModel<T extends z.ZodType>(schema: T, ctx: Context, user: string): Promise<AiResult<z.infer<T>>> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: "no_api_key" };
  const model = aiModel();
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(schema) },
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        // Same for every sentence of the chapter → cacheable prefix (ignored by the API if too short).
        { type: "text", text: noteContextBlock(ctx), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") return { status: "error", message: "モデルが応答を拒否しました。" };
    if (response.stop_reason === "max_tokens") return { status: "error", message: "応答が長すぎて途中で切れました。もう一度お試しください。" };
    const parsed = schema.safeParse(response.parsed_output);
    if (!parsed.success) return { status: "error", message: "応答の形式が不正でした。もう一度お試しください。" };
    return { status: "ok", data: parsed.data, model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { status: "error", message: "Anthropic API キーが無効です。" };
    if (e instanceof Anthropic.NotFoundError) return { status: "error", message: `モデル ${model} が見つかりません。ANTHROPIC_MODEL を確認してください。` };
    if (e instanceof Anthropic.RateLimitError) return { status: "error", message: "API のレート制限に達しました。しばらく待って再試行してください。" };
    if (e instanceof Anthropic.APIError) return { status: "error", message: `Anthropic API エラー (${e.status}): ${e.message}` };
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Drops candidates already in the memory (or not actually in the text). */
function freshCandidates(cands: TranslationOutput["termCandidates"], ctx: Context, text: string) {
  const known = new Set(ctx.terms.map(t => t.source.toLowerCase()));
  const seen = new Set<string>();
  return cands.filter(c => {
    const k = c.source.trim().toLowerCase();
    if (!k || known.has(k) || seen.has(k) || !text.toLowerCase().includes(k)) return false;
    seen.add(k);
    return true;
  });
}

export type TranslateResponse =
  | { status: "ok"; translation: string; rationale: string[]; termCandidates: TranslationOutput["termCandidates"]; termsUsed: { source: string; target: string }[]; saved: boolean; model: string }
  | { status: "no_api_key" }
  | { status: "error"; message: string };

/**
 * Drafts a translation. It is saved as an "ai" draft unless a person already confirmed one
 * ("final"); then it is only returned as a suggestion.
 */
export async function translateSentence(db: Db, noteId: string, userId: string, sentenceId: number): Promise<TranslateResponse> {
  const { note } = await requireNote(db, noteId, userId, "editor");
  const { ctx, sentence } = await buildContext(db, note, sentenceId);
  const r = await callModel(TranslationSchema, ctx, `${sentenceBlock(ctx, sentence.text)}\n\n## 依頼\n対象の文を日本語に訳し、指定の JSON 形式で返してください。`);
  if (r.status !== "ok") return r;
  const [existing] = await db.select({ status: translations.status }).from(translations).where(and(eq(translations.noteId, noteId), eq(translations.sentenceId, sentenceId)));
  const saved = existing?.status !== "final";
  if (saved) await saveTranslation(db, noteId, userId, sentenceId, r.data.translation, "ai", { rationale: r.data.rationale, model: r.model });
  return {
    status: "ok",
    translation: r.data.translation,
    rationale: r.data.rationale,
    termCandidates: freshCandidates(r.data.termCandidates, ctx, sentence.text),
    termsUsed: ctx.terms.map(t => ({ source: t.source, target: t.target })),
    saved,
    model: r.model,
  };
}

export type AnalyzeResponse = { status: "ok"; annotationId: number; analysis: AnalysisOutput } | { status: "no_api_key" } | { status: "error"; message: string };

export async function analyzeSpan(
  db: Db,
  noteId: string,
  userId: string,
  input: { sentenceId: number; start: number | null; end: number | null; kind: Exclude<AnnotationKind, "memo">; question?: string },
): Promise<AnalyzeResponse> {
  const { note } = await requireNote(db, noteId, userId, "editor");
  if (input.kind === "question" && !input.question?.trim()) return { status: "error", message: "質問を入力してください。" };
  const { ctx, sentence } = await buildContext(db, note, input.sentenceId);
  const span = normalizeSpan(sentence.text, input.start, input.end);
  const target = span ? sentence.text.slice(span[0], span[1]) : null;
  const [tr] = await db.select({ text: translations.text }).from(translations).where(and(eq(translations.noteId, noteId), eq(translations.sentenceId, sentence.id)));
  const user = [
    sentenceBlock(ctx, sentence.text),
    "",
    "## この文の現在の訳",
    tr?.text ?? "（未訳）",
    "",
    "## 指定箇所",
    target ? `「${target}」（対象の文の一部）` : "対象の文全体",
    "",
    "## 依頼",
    KIND_PROMPT[input.kind],
    input.question ? `\n質問: ${input.question.trim()}` : "",
  ].join("\n");
  const r = await callModel(AnalysisSchema, ctx, user);
  if (r.status !== "ok") return r;
  const analysis = { ...r.data, termCandidates: freshCandidates(r.data.termCandidates, ctx, sentence.text) };
  const annotationId = await addAnnotation(db, noteId, userId, {
    sentenceId: sentence.id,
    start: span?.[0] ?? null,
    end: span?.[1] ?? null,
    kind: input.kind,
    question: input.question ?? null,
    body: JSON.stringify(analysis),
    source: "ai",
    model: r.model,
  });
  return { status: "ok", annotationId, analysis };
}
