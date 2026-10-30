import { Sparkles, Trash2, UserRound } from "lucide-solid";
import { For, Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ANNOTATION_LABEL } from "~/lib/labels";
import type { AnalysisOutput, SentenceDetail } from "~/lib/queries";

type Annotation = SentenceDetail["annotations"][number];

function parse(body: string): AnalysisOutput | null {
  try {
    return JSON.parse(body) as AnalysisOutput;
  } catch {
    return null;
  }
}

export function AnnotationCard(props: {
  annotation: Annotation;
  canEdit: boolean;
  onDelete: () => void;
  onHover?: (span: [number, number] | null) => void;
  onAddTerm?: (c: AnalysisOutput["termCandidates"][number]) => void;
}) {
  const a = () => props.annotation;
  const ai = () => (a().source === "ai" ? parse(a().body) : null);
  const span = (): [number, number] | null => (a().start !== null && a().end !== null ? [a().start!, a().end!] : null);
  return (
    <article class="space-y-2 rounded-md border p-3" onMouseEnter={() => props.onHover?.(span())} onMouseLeave={() => props.onHover?.(null)}>
      <header class="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={a().source === "ai" ? "secondary" : "outline"}>
          {a().source === "ai" ? <Sparkles class="mr-1 size-3" aria-hidden="true" /> : <UserRound class="mr-1 size-3" aria-hidden="true" />}
          {ANNOTATION_LABEL[a().kind]}
        </Badge>
        <span class="source min-w-0 flex-1 truncate text-sm italic">{a().quote ? `“${a().quote}”` : "文全体"}</span>
        <span class="text-muted-foreground">{a().username ?? ""}</span>
        <Show when={props.canEdit}>
          <Button variant="ghost" size="icon" class="size-7" aria-label="この注釈を削除" onClick={() => confirm("この注釈を削除しますか？") && props.onDelete()}>
            <Trash2 class="size-3.5" />
          </Button>
        </Show>
      </header>
      <Show when={a().question}>
        <p class="text-sm font-medium">Q. {a().question}</p>
      </Show>
      <Show when={ai()} fallback={<p class="whitespace-pre-line text-sm leading-7">{a().body}</p>}>
        {r => (
          <div class="space-y-2 text-sm leading-7">
            <p class="font-medium">{r().summary}</p>
            <p class="whitespace-pre-line">{r().explanation}</p>
            <Show when={r().structure.length}>
              <dl class="grid grid-cols-1 gap-x-3 gap-y-1 rounded bg-muted/50 p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <For each={r().structure}>
                  {s => (
                    <>
                      <dt class="source text-base">{s.text}</dt>
                      <dd>
                        <span class="font-medium">{s.role}</span>
                        {s.note ? <span class="text-muted-foreground"> — {s.note}</span> : null}
                      </dd>
                    </>
                  )}
                </For>
              </dl>
            </Show>
            <Show when={r().translationHint}>
              <p class="rounded border-l-2 border-primary/40 pl-2">
                <span class="text-xs text-muted-foreground">訳し方: </span>
                <span class="translation">{r().translationHint}</span>
              </p>
            </Show>
            <Show when={r().termCandidates.length && props.onAddTerm}>
              <div class="flex flex-wrap gap-1">
                <For each={r().termCandidates}>
                  {c => (
                    <Button size="sm" variant="outline" class="h-7 text-xs" title={c.reason} onClick={() => props.onAddTerm?.(c)}>
                      ＋ {c.source} → {c.target}
                    </Button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </article>
  );
}
