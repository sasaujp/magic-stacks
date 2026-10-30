import { A, createAsync, useAction } from "@solidjs/router";
import { ChevronRight, RefreshCw } from "lucide-solid";
import { createSignal, For, Show, Suspense } from "solid-js";
import { BookCover } from "~/components/BookCover";
import { CatalogBrowser } from "~/components/CatalogBrowser";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { appInfoQuery, booksQuery, meQuery, updateCatalogAction } from "~/lib/queries";

export default function LibraryPage() {
  const books = createAsync(() => booksQuery());
  const info = createAsync(() => appInfoQuery());
  const me = createAsync(() => meQuery());
  const refresh = useAction(updateCatalogAction);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<{ ok: boolean; text: string } | null>(null);

  const doRefresh = async () => {
    setBusy(true);
    setMessage(null);
    const r = await refresh();
    setBusy(false);
    setMessage(r.ok ? { ok: true, text: `カタログを更新しました（${r.value.works.toLocaleString()} 作品）。` } : { ok: false, text: r.error });
  };

  return (
    <div class="mx-auto max-w-5xl space-y-6 p-4 lg:p-6">
      <h1 class="text-2xl font-semibold">書庫</h1>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">Project Gutenberg</CardTitle>
          <CardDescription class="leading-relaxed">
            入力すると、題名・副題・著者（編者・訳者・寄稿者を含む）・主題から探します。空欄のときは題名か著者の頭文字で一覧できます。取り込んだ本は全員で共有され、文ごとに分けて保存されます。
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <Show when={message()}>
            {m => (
              <Alert variant={m().ok ? "default" : "destructive"}>
                <AlertDescription>{m().text}</AlertDescription>
              </Alert>
            )}
          </Show>
          <Suspense>
            <Show when={info()?.catalogSize === 0}>
              <Alert>
                <AlertDescription class="space-y-2">
                  <p>カタログがまだ読み込まれていません。作品番号・URL を入力すれば、このままでも取り込めます。</p>
                  <Show when={me()?.isAdmin}>
                    <Button size="sm" variant="outline" disabled={busy()} onClick={doRefresh}>
                      <RefreshCw class={`size-4 ${busy() ? "animate-spin" : ""}`} aria-hidden="true" />
                      {busy() ? "読み込んでいます…（1 分ほど）" : "カタログを読み込む"}
                    </Button>
                  </Show>
                </AlertDescription>
              </Alert>
            </Show>
            <CatalogBrowser catalogReady={(info()?.catalogSize ?? 0) > 0} />
            <Show when={me()?.isAdmin && (info()?.catalogSize ?? 0) > 0}>
              <div class="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                カタログ {info()!.catalogSize.toLocaleString()} 作品
                <Button size="sm" variant="ghost" class="h-7 text-xs" disabled={busy()} onClick={doRefresh}>
                  <RefreshCw class={`size-3.5 ${busy() ? "animate-spin" : ""}`} aria-hidden="true" /> 更新
                </Button>
              </div>
            </Show>
          </Suspense>
        </CardContent>
      </Card>

      {/* Collapsed by default: the catalog above is the main way in (ingested works show "開く" there too). */}
      <Suspense>
        <Show when={books()?.length}>
          <details class="group rounded-lg border">
            <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight class="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
              取り込み済みの本
              <span class="font-normal text-muted-foreground">（{books()!.length} 冊）</span>
            </summary>
            <ul class="divide-y border-t">
              <For each={books()}>
                {b => (
                  <li>
                    <A href={`/books/${b.id}`} class="flex items-center gap-3 px-4 py-2 hover:bg-accent">
                      <BookCover bookId={b.id} hasCover={b.hasCover} title={b.title} author={b.author} size="sm" class="w-8 shrink-0" />
                      <span class="min-w-0 flex-1">
                        <span class="source block truncate leading-snug">{b.title}</span>
                        <span class="block truncate text-xs text-muted-foreground">{b.author}</span>
                      </span>
                      <span class="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
                        {b.chapterCount} 章 ・ {b.sentenceCount.toLocaleString()} 文
                      </span>
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </details>
        </Show>
      </Suspense>
    </div>
  );
}
