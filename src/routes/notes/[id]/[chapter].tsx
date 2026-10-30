import { A, createAsync, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, Suspense } from "solid-js";
import { ConcordanceDialog } from "~/components/ConcordanceDialog";
import { SentencePanel } from "~/components/SentencePanel";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { chapterViewQuery, type ChapterView } from "~/lib/queries";
import { groupParagraphs } from "~/lib/paragraphs";
import { markTerms } from "~/lib/text";
import { chapterHref, noteHref } from "~/lib/url";
import { cn } from "~/lib/utils";

type Mode = "source" | "parallel" | "translation";
type Sentence = ChapterView["sentences"][number];

const MODE_KEY = "ms.reader.mode";
function loadMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "source" || v === "translation" ? v : "parallel";
  } catch {
    return "parallel";
  }
}

export default function ChapterPage() {
  const params = useParams<{ id: string; chapter: string }>();
  const [search, setSearch] = useSearchParams<{ s?: string }>();
  const navigate = useNavigate();
  const view = createAsync(() => chapterViewQuery(params.id, Number(params.chapter)));
  const [mode, setModeSignal] = createSignal<Mode>(loadMode());
  const setMode = (m: Mode) => {
    setModeSignal(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // per-viewer convenience only
    }
  };
  const [kwic, setKwic] = createSignal<string | null>(null);
  /** The sentence under the pointer, highlighted on both the source and translation side. */
  const [hoveredId, setHoveredId] = createSignal<number | null>(null);
  const hoverProps = (id: number) => ({ onMouseEnter: () => setHoveredId(id), onMouseLeave: () => setHoveredId(h => (h === id ? null : h)) });

  const selectedId = () => (search.s ? Number(search.s) : null);
  /** Sentences that can be worked on (headings and uncaptioned images are shown but not selected). */
  const workable = createMemo(() => view()?.sentences.filter(s => s.kind !== "heading" && !(s.kind === "image" && !s.text)) ?? []);
  const selectedIndex = () => workable().findIndex(s => s.id === selectedId());
  const select = (id: number | null) => setSearch({ s: id ? String(id) : undefined }, { replace: true });
  const step = (d: number) => {
    const list = workable();
    const i = selectedIndex();
    const next = list[i < 0 ? 0 : i + d];
    if (next) select(next.id);
  };

  const paragraphs = createMemo(() => groupParagraphs(view()?.sentences ?? []));
  const annotated = createMemo(() => {
    const m = new Map<number, number>();
    for (const a of view()?.annotations ?? []) m.set(a.sentenceId, (m.get(a.sentenceId) ?? 0) + 1);
    return m;
  });

  // Keep the selected sentence in view (e.g. after j/k or arriving from a concordance link).
  createEffect(
    on([selectedId, view], ([id, v]) => {
      if (!id || !v) return;
      requestAnimationFrame(() => document.getElementById(`s-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }),
  );

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      // Esc in an open dialog closes the dialog only, not the sentence panel.
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "j") step(1);
      else if (e.key === "k") step(-1);
      else if (e.key === "Escape") select(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const SourceSentence = (p: { s: Sentence; v: ChapterView }) => (
    <span
      id={`s-${p.s.id}`}
      role="button"
      tabIndex={0}
      class={cn(
        "cursor-pointer rounded-sm transition-colors",
        selectedId() === p.s.id ? "bg-highlight text-highlight-foreground" : hoveredId() === p.s.id && "bg-accent",
        !p.v.translations[p.s.id] && mode() !== "source" && "text-foreground/80",
      )}
      {...hoverProps(p.s.id)}
      onClick={() => select(p.s.id)}
      onKeyDown={e => e.key === "Enter" && select(p.s.id)}
    >
      <For each={markTerms(p.s.text, p.v.terms)}>{part => (part.term ? <span class="underline decoration-primary/30 decoration-dotted underline-offset-4">{part.text}</span> : part.text)}</For>
      <Show when={annotated().get(p.s.id)}>
        {n => (
          <sup class="ml-0.5 font-sans text-[10px] text-primary" title={`注釈 ${n()} 件`}>
            {n()}
          </sup>
        )}
      </Show>
    </span>
  );

  const TranslationSentence = (p: { s: Sentence; v: ChapterView }) => {
    const tr = () => p.v.translations[p.s.id];
    return (
      <span
        role="button"
        tabIndex={-1}
        class={cn(
          "cursor-pointer rounded-sm transition-colors",
          selectedId() === p.s.id ? "bg-highlight text-highlight-foreground" : hoveredId() === p.s.id && "bg-accent",
          tr()?.status === "ai" && "text-foreground/75",
        )}
        {...hoverProps(p.s.id)}
        onClick={() => select(p.s.id)}
      >
        {tr()?.text ?? <span class="text-muted-foreground/50" title="未訳">…</span>}
      </span>
    );
  };

  /** An illustration (from R2) with its caption, which can be selected and translated like a sentence. */
  const Figure = (p: { s: Sentence; v: ChapterView }) => (
    <figure class="space-y-2 py-2">
      <Show when={p.s.image}>
        {key => <img src={`/api/images/${key()}`} alt={p.s.text} loading="lazy" class="mx-auto max-h-[70vh] w-auto max-w-full rounded border bg-muted object-contain" />}
      </Show>
      <Show when={p.s.text}>
        <figcaption class="space-y-1 text-center text-sm">
          <Show when={mode() !== "translation"}>
            <p class="source italic">
              <SourceSentence s={p.s} v={p.v} />
            </p>
          </Show>
          <Show when={mode() !== "source" && p.v.translations[p.s.id]}>
            <p class="translation">
              <TranslationSentence s={p.s} v={p.v} />
            </p>
          </Show>
        </figcaption>
      </Show>
    </figure>
  );

  return (
    <Suspense fallback={<Skeleton class="m-6 h-96" />}>
      <Show when={view()} fallback={<Alert class="m-6">この章は見つからないか、ノートへのアクセス権がありません。</Alert>}>
        {v => {
          const nav = (seq: number) => navigate(chapterHref(params.id, seq));
          return (
            <div class="mx-auto flex max-w-[1600px] gap-6 lg:px-4">
              <article class={cn("min-w-0 flex-1 px-4 py-4 lg:px-2", selectedId() && "pb-[70vh] lg:pb-16")}>
                <div class="mb-4 flex flex-wrap items-center gap-2">
                  <A href={noteHref(params.id)} class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft class="size-4" aria-hidden="true" /> {v().note.title}
                  </A>
                  <div class="ml-auto flex items-center gap-1">
                    <ToggleGroup value={mode()} onChange={m => m && setMode(m as Mode)} size="sm" aria-label="表示">
                      <ToggleGroupItem value="source">原文</ToggleGroupItem>
                      <ToggleGroupItem value="parallel">対訳</ToggleGroupItem>
                      <ToggleGroupItem value="translation">訳文</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>

                <header class="mb-6 space-y-1">
                  <p class="text-xs text-muted-foreground">
                    第{v().chapter.seq}章 ・ <span class="source italic">{v().book.title}</span>
                  </p>
                  <h1 class="source text-2xl leading-snug sm:text-3xl">{v().chapter.title}</h1>
                </header>

                <div class="max-w-3xl space-y-5">
                  <For each={paragraphs()}>
                    {p => (
                      <Show when={p.kind !== "image"} fallback={<Figure s={p.sentences[0]} v={v()} />}>
                      <Show
                        when={p.kind !== "heading"}
                        fallback={<h2 class="source pt-2 text-xl font-semibold">{p.sentences.map(s => s.text).join(" ")}</h2>}
                      >
                        <div class={cn("space-y-1.5", p.kind === "quote" && "border-l-2 pl-4", p.kind === "note" && "text-sm text-muted-foreground")}>
                          <Show when={mode() !== "translation"}>
                            <p class="source">
                              <For each={p.sentences}>
                                {s => (
                                  <>
                                    <SourceSentence s={s} v={v()} />{" "}
                                  </>
                                )}
                              </For>
                            </p>
                          </Show>
                          {/* In parallel mode a paragraph with no translation yet shows only the source. */}
                          <Show when={mode() === "translation" || (mode() === "parallel" && p.sentences.some(s => v().translations[s.id]))}>
                            <p class={cn("translation", mode() === "parallel" ? "text-[0.95rem] text-foreground/90" : "text-base")}>
                              <For each={p.sentences}>{s => <TranslationSentence s={s} v={v()} />}</For>
                            </p>
                          </Show>
                        </div>
                      </Show>
                      </Show>
                    )}
                  </For>
                </div>

                <nav class="mt-10 flex max-w-3xl items-center justify-between border-t pt-4" aria-label="章の移動">
                  <Show when={v().chapter.seq > 1} fallback={<span />}>
                    <Button variant="ghost" size="sm" onClick={() => nav(v().chapter.seq - 1)}>
                      <ChevronLeft class="size-4" aria-hidden="true" /> 前の章
                    </Button>
                  </Show>
                  <Show when={v().chapter.seq < v().chapter.last}>
                    <Button variant="ghost" size="sm" onClick={() => nav(v().chapter.seq + 1)}>
                      次の章 <ChevronRight class="size-4" aria-hidden="true" />
                    </Button>
                  </Show>
                </nav>
              </article>

              <Show when={selectedId()}>
                {id => (
                  <aside class="fixed inset-x-0 bottom-0 z-20 max-h-[65vh] overflow-y-auto border-t bg-background p-4 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] lg:sticky lg:top-14 lg:z-0 lg:h-[calc(100vh-3.5rem)] lg:max-h-none lg:w-[min(36rem,42vw)] lg:shrink-0 lg:border-l lg:border-t-0 lg:shadow-none">
                    <SentencePanel
                      noteId={params.id}
                      sentenceId={id()}
                      position={`第${v().chapter.seq}章 ・ ${selectedIndex() + 1} / ${workable().length} 文`}
                      canEdit={v().role !== "viewer"}
                      terms={v().terms}
                      chapter={{ id: v().chapter.id, seq: v().chapter.seq, title: v().chapter.title }}
                      onPrev={selectedIndex() > 0 ? () => step(-1) : undefined}
                      onNext={selectedIndex() < workable().length - 1 ? () => step(1) : undefined}
                      onConcordance={setKwic}
                      onClose={() => select(null)}
                    />
                  </aside>
                )}
              </Show>
              <ConcordanceDialog noteId={params.id} query={kwic()} onClose={() => setKwic(null)} />
            </div>
          );
        }}
      </Show>
    </Suspense>
  );
}
