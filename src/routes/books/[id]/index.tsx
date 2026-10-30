import { A, createAsync, useAction, useNavigate, useParams } from "@solidjs/router";
import { BookOpenText, ExternalLink, ImageDown, NotebookPen, Plus } from "lucide-solid";
import { BookCover } from "~/components/BookCover";
import { createSignal, For, Show, Suspense } from "solid-js";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { ROLE_LABEL } from "~/lib/labels";
import { bookQuery, createNoteAction, fetchCoverAction } from "~/lib/queries";
import { noteHref } from "~/lib/url";

export default function BookPage() {
  const params = useParams<{ id: string }>();
  const book = createAsync(() => bookQuery(Number(params.id)));
  const create = useAction(createNoteAction);
  const navigate = useNavigate();
  const [title, setTitle] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const fetchCover = useAction(fetchCoverAction);
  const [coverBusy, setCoverBusy] = createSignal(false);
  const getCover = async () => {
    setCoverBusy(true);
    const r = await fetchCover(Number(params.id));
    setCoverBusy(false);
    if (!r.ok) setError(r.error);
    else if (!r.value.coverKey) setError("Project Gutenberg に表紙がありませんでした。");
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await create(Number(params.id), title());
    setBusy(false);
    if (r.ok) navigate(noteHref(r.value.id));
    else setError(r.error);
  };

  return (
    <div class="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <Suspense fallback={<Skeleton class="h-40 w-full" />}>
        <Show when={book()} fallback={<Alert>この本は見つかりません。</Alert>}>
          {b => (
            <>
              <div class="flex gap-5">
                <div class="w-28 shrink-0 space-y-2 sm:w-36">
                  <BookCover bookId={b().id} hasCover={b().hasCover} title={b().title} author={b().author} />
                  <Show when={!b().hasCover && b().gutenbergId}>
                    <Button size="sm" variant="ghost" class="h-7 w-full text-xs" disabled={coverBusy()} onClick={getCover}>
                      <ImageDown class="size-3.5" aria-hidden="true" /> {coverBusy() ? "取得しています…" : "表紙を取得"}
                    </Button>
                  </Show>
                </div>
                <div class="min-w-0 space-y-1">
                  <h1 class="source text-3xl leading-tight">{b().title}</h1>
                  <p class="text-muted-foreground">{b().author}</p>
                  <p class="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {b().chapterCount} 章 ・ {b().sentenceCount.toLocaleString()} 文
                    </span>
                    <a href={b().sourceUrl} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 hover:text-foreground">
                      Project Gutenberg <ExternalLink class="size-3" aria-hidden="true" />
                    </a>
                  </p>
                  <div class="pt-2">
                    <Button as={A} href={`/books/${b().id}/${b().chapters.find(c => c.title !== "前付け")?.seq ?? 1}`} size="sm">
                      <BookOpenText class="size-4" aria-hidden="true" /> 原文を読む
                    </Button>
                  </div>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle class="text-lg">この本の翻訳ノート</CardTitle>
                  <CardDescription>ノートは作った人と招待されたメンバーだけが見られます。</CardDescription>
                </CardHeader>
                <CardContent class="space-y-4">
                  <Show when={b().myNotes.length}>
                    <ul class="divide-y rounded-md border">
                      <For each={b().myNotes}>
                        {n => (
                          <li>
                            <A href={noteHref(n.id)} class="flex items-center gap-3 px-3 py-2 hover:bg-accent">
                              <NotebookPen class="size-4 text-muted-foreground" aria-hidden="true" />
                              <span class="flex-1">{n.title}</span>
                              <Badge variant="secondary">{ROLE_LABEL[n.role]}</Badge>
                              <span class="text-xs text-muted-foreground">{n.translatedCount.toLocaleString()} 文 訳済み</span>
                            </A>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <form class="flex flex-wrap items-end gap-2" onSubmit={submit}>
                    <TextField value={title()} onChange={setTitle} class="min-w-60 flex-1">
                      <TextFieldLabel>新しいノートの名前</TextFieldLabel>
                      <TextFieldInput placeholder={`${b().title} 訳読ノート`} maxLength={120} />
                    </TextField>
                    <Button type="submit" disabled={busy()}>
                      <Plus class="size-4" aria-hidden="true" /> ノートを作る
                    </Button>
                  </form>
                  <Show when={error()}>
                    <Alert variant="destructive">
                      <AlertDescription>{error()}</AlertDescription>
                    </Alert>
                  </Show>
                </CardContent>
              </Card>

              <section class="space-y-2">
                <h2 class="text-lg font-semibold">目次 <span class="text-sm font-normal text-muted-foreground">— 章を選ぶと原文を読めます</span></h2>
                <ol class="divide-y rounded-md border">
                  <For each={b().chapters}>
                    {c => (
                      <li>
                        <A href={`/books/${b().id}/${c.seq}`} class="flex items-baseline gap-3 px-3 py-2 text-sm hover:bg-accent">
                          <span class="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{c.seq}</span>
                          <span class="source flex-1 text-base">{c.title}</span>
                          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{c.sentenceCount} 文</span>
                        </A>
                      </li>
                    )}
                  </For>
                </ol>
              </section>
            </>
          )}
        </Show>
      </Suspense>
    </div>
  );
}
