import { A, createAsync, useNavigate, useParams } from "@solidjs/router";
import { ArrowLeft, ChevronLeft, ChevronRight, NotebookPen } from "lucide-solid";
import { createMemo, For, Match, Show, Suspense, Switch } from "solid-js";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { groupParagraphs } from "~/lib/paragraphs";
import { bookChapterQuery } from "~/lib/queries";
import { chapterHref } from "~/lib/url";
import { cn } from "~/lib/utils";

/**
 * The original text of a chapter, readable without a translation note (translations, analyses
 * and the translation memory belong to notes; from here the user can switch to one).
 */
export default function BookChapterPage() {
  const params = useParams<{ id: string; chapter: string }>();
  const navigate = useNavigate();
  const view = createAsync(() => bookChapterQuery(Number(params.id), Number(params.chapter)));
  const paragraphs = createMemo(() => groupParagraphs(view()?.sentences ?? []));
  const go = (seq: number) => navigate(`/books/${params.id}/${seq}`);

  return (
    <Suspense fallback={<Skeleton class="m-6 h-96" />}>
      <Show when={view()} fallback={<Alert class="m-6">この章は見つかりません。</Alert>}>
        {v => (
          <article class="mx-auto max-w-3xl px-4 py-4 lg:py-6">
            <div class="mb-4 flex flex-wrap items-center gap-2">
              <A href={`/books/${params.id}`} class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft class="size-4" aria-hidden="true" /> <span class="source italic">{v().book.title}</span>
              </A>
              <div class="ml-auto flex flex-wrap items-center gap-1">
                <Switch>
                  <Match when={v().myNotes.length === 1}>
                    <Button as={A} href={chapterHref(v().myNotes[0].id, v().chapter.seq)} size="sm" variant="outline">
                      <NotebookPen class="size-4" aria-hidden="true" /> ノートでこの章を開く
                    </Button>
                  </Match>
                  <Match when={v().myNotes.length > 1}>
                    <For each={v().myNotes}>
                      {n => (
                        <Button as={A} href={chapterHref(n.id, v().chapter.seq)} size="sm" variant="outline" title="このノートでこの章を開く">
                          <NotebookPen class="size-4" aria-hidden="true" /> {n.title}
                        </Button>
                      )}
                    </For>
                  </Match>
                  <Match when={v().myNotes.length === 0}>
                    <Button as={A} href={`/books/${params.id}`} size="sm" variant="ghost" title="ノートを作ると、訳文・解析・翻訳メモリを付けられます">
                      <NotebookPen class="size-4" aria-hidden="true" /> ノートを作って訳す
                    </Button>
                  </Match>
                </Switch>
              </div>
            </div>

            <header class="mb-6 space-y-1">
              <p class="text-xs text-muted-foreground">
                第{v().chapter.seq}章 / 全{v().chapter.last}章 ・ {v().book.author}
              </p>
              <h1 class="source text-2xl leading-snug sm:text-3xl">{v().chapter.title}</h1>
            </header>

            <div class="space-y-5">
              <For each={paragraphs()}>
                {p => (
                  <Switch>
                    <Match when={p.kind === "heading"}>
                      <h2 class="source pt-2 text-xl font-semibold">{p.sentences.map(s => s.text).join(" ")}</h2>
                    </Match>
                    <Match when={p.kind === "image"}>
                      <figure class="space-y-2 py-2">
                        <Show when={p.sentences[0].image}>
                          {key => <img src={`/api/images/${key()}`} alt={p.sentences[0].text} loading="lazy" class="mx-auto max-h-[70vh] w-auto max-w-full rounded border bg-muted object-contain" />}
                        </Show>
                        <Show when={p.sentences[0].text}>
                          <figcaption class="source text-center text-sm italic">{p.sentences[0].text}</figcaption>
                        </Show>
                      </figure>
                    </Match>
                    <Match when={true}>
                      <p class={cn("source", p.kind === "quote" && "border-l-2 pl-4", p.kind === "note" && "text-sm text-muted-foreground")}>{p.sentences.map(s => s.text).join(" ")}</p>
                    </Match>
                  </Switch>
                )}
              </For>
            </div>

            <nav class="mt-10 flex items-center justify-between border-t pt-4" aria-label="章の移動">
              <Show when={v().chapter.seq > 1} fallback={<span />}>
                <Button variant="ghost" size="sm" onClick={() => go(v().chapter.seq - 1)}>
                  <ChevronLeft class="size-4" aria-hidden="true" /> 前の章
                </Button>
              </Show>
              <Show when={v().chapter.seq < v().chapter.last}>
                <Button variant="ghost" size="sm" onClick={() => go(v().chapter.seq + 1)}>
                  次の章 <ChevronRight class="size-4" aria-hidden="true" />
                </Button>
              </Show>
            </nav>
          </article>
        )}
      </Show>
    </Suspense>
  );
}
