import { A, createAsync } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { concordanceQuery } from "~/lib/queries";
import { chapterHref } from "~/lib/url";

/** Splits a sentence around every (case-insensitive) occurrence of `q`. */
export function kwicParts(text: string, q: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  while (needle && i < text.length) {
    const j = lower.indexOf(needle, i);
    if (j < 0) break;
    if (j > i) out.push({ text: text.slice(i, j), hit: false });
    out.push({ text: text.slice(j, j + needle.length), hit: true });
    i = j + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/** Every sentence of the book containing `query`, with this note's translation (concordance / KWIC). */
export function ConcordanceDialog(props: { noteId: string; query: string | null; onClose: () => void; termTarget?: string | null }) {
  const result = createAsync(async () => (props.query ? concordanceQuery(props.noteId, props.query) : null));
  return (
    <Dialog open={!!props.query} onOpenChange={open => !open && props.onClose()}>
      <DialogContent class="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            用例: <span class="source text-xl">{props.query}</span>
            <Show when={props.termTarget}>
              <span class="translation ml-2 text-base font-normal text-muted-foreground">→ {props.termTarget}</span>
            </Show>
          </DialogTitle>
          <DialogDescription>
            <Suspense fallback="検索しています…">
              <Show when={result()}>{r => <>この本の {r().total.toLocaleString()} 文に出てきます{r().total > r().hits.length ? `（先頭 ${r().hits.length} 件を表示）` : ""}。訳文はこのノートのものです。</>}</Show>
            </Suspense>
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<Skeleton class="h-40 w-full" />}>
          <ol class="space-y-3">
            <For each={result()?.hits}>
              {h => (
                <li class="rounded-md border p-3">
                  <A href={chapterHref(props.noteId, h.chapterSeq, h.id)} class="mb-1 block text-xs text-muted-foreground hover:text-foreground" onClick={() => props.onClose()}>
                    第{h.chapterSeq}章 {h.chapterTitle}
                  </A>
                  <p class="source text-base leading-relaxed">
                    <For each={kwicParts(h.text, props.query ?? "")}>{p => (p.hit ? <mark class="rounded bg-highlight px-0.5 text-highlight-foreground">{p.text}</mark> : p.text)}</For>
                  </p>
                  <Show when={h.translation} fallback={<p class="mt-1 text-xs text-muted-foreground">（未訳）</p>}>
                    <p class="translation mt-1 text-sm">{h.translation}</p>
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
