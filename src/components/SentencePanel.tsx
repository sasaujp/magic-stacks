import { createAsync, useAction } from "@solidjs/router";
import { Check, ChevronDown, ChevronLeft, ChevronRight, MessageSquareText, Search, Sparkles, X } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, Suspense } from "solid-js";
import { AnnotationCard } from "~/components/AnnotationCard";
import { TermForm, type TermDraft } from "~/components/TermForm";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { TextField, TextFieldInput, TextFieldTextArea } from "~/components/ui/text-field";
import {
  addMemoAction,
  aiAnalyzeAction,
  aiTranslateAction,
  deleteAnnotationAction,
  saveTranslationAction,
  sentenceQuery,
  type TranslateResponse,
} from "~/lib/queries";
import { markTerms, selectionOffsets } from "~/lib/text";

type Candidate = { source: string; target: string; kind: "term" | "name" | "phrase"; reason: string };
type AnalyzeKind = "syntax" | "meaning" | "argument";

const ANALYZE_BUTTONS: { kind: AnalyzeKind; label: string; title: string }[] = [
  { kind: "syntax", label: "構文", title: "主語・述語、節の関係、修飾のかかり方" },
  { kind: "meaning", label: "語義", title: "19世紀英語・著者の用語法としての意味" },
  { kind: "argument", label: "論理", title: "議論の中での役割（前提・譲歩・結論…）" },
];

/**
 * Work area for one sentence: its translation (draft / confirmed / AI), and analyses attached to
 * any part of it. Select words in the sentence to aim an analysis, a question or a memo at them.
 */
export function SentencePanel(props: {
  noteId: string;
  sentenceId: number;
  position: string;
  canEdit: boolean;
  terms: { source: string; target: string }[];
  chapter: { id: number; seq: number; title: string };
  onPrev?: () => void;
  onNext?: () => void;
  onConcordance: (q: string) => void;
  onClose: () => void;
}) {
  const detail = createAsync(() => sentenceQuery(props.noteId, props.sentenceId));
  const saveTr = useAction(saveTranslationAction);
  const translate = useAction(aiTranslateAction);
  const analyze = useAction(aiAnalyzeAction);
  const addMemo = useAction(addMemoAction);
  const removeAnn = useAction(deleteAnnotationAction);

  const [draft, setDraft] = createSignal("");
  const [dirty, setDirty] = createSignal(false);
  const [selection, setSelection] = createSignal<[number, number] | null>(null);
  const [hover, setHover] = createSignal<[number, number] | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [aiResult, setAiResult] = createSignal<Extract<TranslateResponse, { status: "ok" }> | null>(null);
  const [question, setQuestion] = createSignal("");
  const [memo, setMemo] = createSignal("");
  const [termDraft, setTermDraft] = createSignal<TermDraft | null>(null);
  const [showRationale, setShowRationale] = createSignal(false);
  let sentenceEl: HTMLParagraphElement | undefined;

  // Translation box: fit its height to the text. Measured after layout (on text change and on
  // width change), because the panel may still be hidden behind Suspense when the value arrives.
  let textarea: HTMLTextAreaElement | undefined;
  const fit = () => {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit()) : null;
  onCleanup(() => resizeObserver?.disconnect());
  const observeTextarea = (el: HTMLTextAreaElement) => {
    textarea = el;
    resizeObserver?.observe(el);
    requestAnimationFrame(fit);
  };
  createEffect(on(draft, () => requestAnimationFrame(fit)));

  // New sentence → reset everything that belonged to the previous one.
  createEffect(
    on(
      () => props.sentenceId,
      () => {
        setSelection(null);
        setAiResult(null);
        setError(null);
        setTermDraft(null);
        setQuestion("");
        setMemo("");
        setDirty(false);
      },
    ),
  );
  // Keep the editor in step with the stored translation unless the user is editing.
  createEffect(() => {
    const d = detail();
    if (d && !dirty()) setDraft(d.translation?.text ?? "");
  });

  onMount(() => {
    const onSel = () => {
      if (!sentenceEl) return;
      const s = selectionOffsets(sentenceEl);
      if (s) setSelection(s);
    };
    document.addEventListener("selectionchange", onSel);
    onCleanup(() => document.removeEventListener("selectionchange", onSel));
  });

  const text = () => detail()?.sentence.text ?? "";
  const selectedText = () => {
    const s = selection();
    return s ? text().slice(s[0], s[1]) : null;
  };

  const run = async <T,>(key: string, fn: () => Promise<T>) => {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } finally {
      setBusy(null);
    }
  };

  const save = async (status: "ai" | "final") => {
    const r = await run("save", () => saveTr(props.noteId, props.sentenceId, draft(), status));
    if (r && !r.ok) setError(r.error);
    else setDirty(false);
  };

  const aiTranslate = async () => {
    const r = await run("translate", () => translate(props.noteId, props.sentenceId));
    if (!r) return;
    if (r.status === "no_api_key") setError("ANTHROPIC_API_KEY が設定されていません（.dev.vars または wrangler secret）。");
    else if (r.status === "error") setError(r.message);
    else {
      setAiResult(r);
      if (r.saved) setDirty(false);
    }
  };

  const aiAnalyze = async (kind: AnalyzeKind | "question") => {
    const s = selection();
    const r = await run(kind, () =>
      analyze(props.noteId, { sentenceId: props.sentenceId, start: s?.[0] ?? null, end: s?.[1] ?? null, kind, question: kind === "question" ? question() : undefined }),
    );
    if (!r) return;
    if (r.status === "no_api_key") setError("ANTHROPIC_API_KEY が設定されていません。");
    else if (r.status === "error") setError(r.message);
    else if (kind === "question") setQuestion("");
  };

  const saveMemo = async () => {
    const s = selection();
    const r = await run("memo", () => addMemo(props.noteId, { sentenceId: props.sentenceId, start: s?.[0] ?? null, end: s?.[1] ?? null, body: memo() }));
    if (r && !r.ok) setError(r.error);
    else setMemo("");
  };

  const proposeTerm = (c: Candidate) => setTermDraft({ source: c.source, target: c.target, kind: c.kind, chapterId: null, memo: c.reason });

  /**
   * The sentence with the hovered annotation's span highlighted, otherwise with term marks.
   * (Not the selection: re-rendering while the user drags would destroy the browser selection.)
   */
  const SentenceText = () => {
    const range = hover;
    return (
      <Show
        when={range()}
        fallback={
          <For each={markTerms(text(), props.terms)}>
            {p =>
              p.term ? (
                <span class="underline decoration-primary/40 decoration-dotted underline-offset-4" title={`翻訳メモリ: ${p.term.target}`}>
                  {p.text}
                </span>
              ) : (
                p.text
              )
            }
          </For>
        }
      >
        {r => (
          <>
            {text().slice(0, r()[0])}
            <mark class="rounded bg-highlight text-highlight-foreground">{text().slice(r()[0], r()[1])}</mark>
            {text().slice(r()[1])}
          </>
        )}
      </Show>
    );
  };

  return (
    <div class="space-y-4">
      <div class="flex items-center gap-1">
        <span class="text-xs text-muted-foreground">{props.position}</span>
        <div class="ml-auto flex items-center">
          <Button variant="ghost" size="icon" class="size-8" disabled={!props.onPrev} onClick={() => props.onPrev?.()} aria-label="前の文" title="前の文（k）">
            <ChevronLeft class="size-4" />
          </Button>
          <Button variant="ghost" size="icon" class="size-8" disabled={!props.onNext} onClick={() => props.onNext?.()} aria-label="次の文" title="次の文（j）">
            <ChevronRight class="size-4" />
          </Button>
          <Button variant="ghost" size="icon" class="size-8" onClick={() => props.onClose()} aria-label="閉じる" title="閉じる（Esc）">
            <X class="size-4" />
          </Button>
        </div>
      </div>

      <Suspense fallback={<Skeleton class="h-48 w-full" />}>
        <Show when={detail()}>
          {d => (
            <>
              <section class="space-y-2">
                <p ref={sentenceEl} class="source select-text text-lg leading-relaxed lg:text-xl">
                  <SentenceText />
                </p>
                <div class="flex min-h-8 flex-wrap items-center gap-2 text-xs">
                  <Show when={selectedText()} fallback={<span class="text-muted-foreground">語句を選択すると、その箇所に解析・質問・メモを付けられます。</span>}>
                    {q => (
                      <>
                        <Badge variant="secondary" class="source max-w-full truncate text-sm font-normal">
                          “{q()}”
                        </Badge>
                        <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" onClick={() => props.onConcordance(q())}>
                          <Search class="size-3.5" aria-hidden="true" /> 用例
                        </Button>
                        <Show when={props.canEdit}>
                          <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" onClick={() => setTermDraft({ source: q(), target: "", kind: "term", chapterId: null, memo: "" })}>
                            ＋ 翻訳メモリ
                          </Button>
                        </Show>
                        <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" onClick={() => setSelection(null)}>
                          <X class="size-3.5" aria-hidden="true" /> 選択を解除
                        </Button>
                      </>
                    )}
                  </Show>
                </div>
              </section>

              <Show when={error()}>
                <Alert variant="destructive">
                  <AlertDescription>{error()}</AlertDescription>
                </Alert>
              </Show>

              <Show when={termDraft()}>
                {t => (
                  <div class="rounded-md border border-primary/30 bg-muted/30 p-3">
                    <p class="mb-2 text-sm font-medium">翻訳メモリに追加</p>
                    <TermForm noteId={props.noteId} initial={t()} chapters={[props.chapter]} onDone={() => setTermDraft(null)} onCancel={() => setTermDraft(null)} />
                  </div>
                )}
              </Show>

              <section class="space-y-2">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-semibold">訳文</h3>
                  <Show when={d().translation}>
                    {tr => <Badge variant={tr().status === "final" ? "default" : "secondary"}>{tr().status === "final" ? "確定" : "AI 下訳"}</Badge>}
                  </Show>
                  <Show when={dirty()}>
                    <span class="text-xs text-muted-foreground">未保存</span>
                  </Show>
                </div>
                <TextField
                  value={draft()}
                  onChange={v => {
                    setDraft(v);
                    setDirty(true);
                  }}
                  disabled={!props.canEdit}
                >
                  {/* Grows with its content (also when AI fills it), so the translation never scrolls inside the box. */}
                  <TextFieldTextArea
                    ref={el => observeTextarea(el)}
                    rows={3}
                    class="translation min-h-24 resize-none overflow-hidden text-base leading-7"
                    placeholder="訳文を入力するか、AI で下訳を作ります。"
                    aria-label="訳文"
                  />
                </TextField>
                <Show when={props.canEdit}>
                  <div class="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy() !== null || !draft().trim()} onClick={() => save("final")}>
                      <Check class="size-4" aria-hidden="true" /> 確定
                    </Button>
                    <Show when={dirty()}>
                      <Button size="sm" variant="outline" disabled={busy() !== null} onClick={() => save("ai")}>
                        下書きとして保存
                      </Button>
                    </Show>
                    <Button size="sm" variant="outline" disabled={busy() !== null} onClick={aiTranslate}>
                      <Sparkles class={`size-4 ${busy() === "translate" ? "animate-pulse" : ""}`} aria-hidden="true" />
                      {busy() === "translate" ? "訳しています…" : d().translation ? "AI で訳し直す" : "AI で訳す"}
                    </Button>
                  </div>
                </Show>

                <Show when={aiResult()}>
                  {r => (
                    <div class="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                      <Show when={!r().saved}>
                        <p class="text-xs text-muted-foreground">確定済みの訳があるため、AI の訳は提案として表示しています。</p>
                        <p class="translation text-base">{r().translation}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDraft(r().translation);
                            setDirty(true);
                          }}
                        >
                          この訳を編集欄に入れる
                        </Button>
                      </Show>
                      <Show when={r().termsUsed.length}>
                        <p class="text-xs text-muted-foreground">
                          使った翻訳メモリ: {r().termsUsed.map(t => `${t.source}→${t.target}`).join("、")}
                        </p>
                      </Show>
                      <Show when={r().termCandidates.length}>
                        <div class="space-y-1">
                          <p class="text-xs text-muted-foreground">訳語を固定しておくとよい語（クリックで追加）:</p>
                          <div class="flex flex-wrap gap-1">
                            <For each={r().termCandidates}>
                              {c => (
                                <Button size="sm" variant="outline" class="h-7 text-xs" title={c.reason} onClick={() => proposeTerm(c)}>
                                  ＋ {c.source} → {c.target}
                                </Button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>

                <Show when={d().translation?.rationale.length}>
                  <button type="button" class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowRationale(v => !v)}>
                    <ChevronDown class={`size-3.5 transition-transform ${showRationale() ? "" : "-rotate-90"}`} aria-hidden="true" />
                    訳出上の判断（AI）
                  </button>
                  <Show when={showRationale()}>
                    <ul class="list-disc space-y-1 pl-5 text-sm leading-6">
                      <For each={d().translation!.rationale}>{x => <li>{x}</li>}</For>
                    </ul>
                  </Show>
                </Show>
              </section>

              <Show when={props.canEdit}>
                <section class="space-y-2">
                  <h3 class="text-sm font-semibold">
                    解析 <span class="font-normal text-muted-foreground">— {selectedText() ? "選択した箇所" : "文全体"}</span>
                  </h3>
                  <div class="flex flex-wrap gap-2">
                    <For each={ANALYZE_BUTTONS}>
                      {b => (
                        <Button size="sm" variant="secondary" title={b.title} disabled={busy() !== null} onClick={() => aiAnalyze(b.kind)}>
                          <Sparkles class={`size-4 ${busy() === b.kind ? "animate-pulse" : ""}`} aria-hidden="true" />
                          {b.label}
                        </Button>
                      )}
                    </For>
                  </div>
                  <form
                    class="flex gap-2"
                    onSubmit={e => {
                      e.preventDefault();
                      if (question().trim()) aiAnalyze("question");
                    }}
                  >
                    <TextField value={question()} onChange={setQuestion} class="flex-1">
                      <TextFieldInput placeholder="質問（例: この which は何を受けている？）" aria-label="AI への質問" />
                    </TextField>
                    <Button type="submit" size="sm" variant="secondary" class="h-10" disabled={busy() !== null || !question().trim()}>
                      <MessageSquareText class={`size-4 ${busy() === "question" ? "animate-pulse" : ""}`} aria-hidden="true" /> 質問
                    </Button>
                  </form>
                  <form
                    class="flex gap-2"
                    onSubmit={e => {
                      e.preventDefault();
                      if (memo().trim()) saveMemo();
                    }}
                  >
                    <TextField value={memo()} onChange={setMemo} class="flex-1">
                      <TextFieldInput placeholder="自分のメモ" aria-label="メモ" />
                    </TextField>
                    <Button type="submit" size="sm" variant="outline" class="h-10" disabled={busy() !== null || !memo().trim()}>
                      メモを付ける
                    </Button>
                  </form>
                </section>
              </Show>

              <Show when={d().annotations.length}>
                <section class="space-y-2">
                  <h3 class="text-sm font-semibold">注釈（{d().annotations.length}）</h3>
                  <For each={[...d().annotations].reverse()}>
                    {a => (
                      <AnnotationCard
                        annotation={a}
                        canEdit={props.canEdit}
                        onHover={setHover}
                        onAddTerm={props.canEdit ? proposeTerm : undefined}
                        onDelete={async () => {
                          const r = await removeAnn(props.noteId, a.id);
                          if (!r.ok) setError(r.error);
                        }}
                      />
                    )}
                  </For>
                </section>
              </Show>
            </>
          )}
        </Show>
      </Suspense>
    </div>
  );
}
