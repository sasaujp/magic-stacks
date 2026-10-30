import { A, createAsync } from "@solidjs/router";
import { Library, Users } from "lucide-solid";
import { BookCover } from "~/components/BookCover";
import { For, Show, Suspense } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { ROLE_LABEL } from "~/lib/labels";
import { myNotesQuery } from "~/lib/queries";
import { noteHref } from "~/lib/url";

export default function Home() {
  const notes = createAsync(() => myNotesQuery());
  return (
    <div class="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold">翻訳ノート</h1>
        <Button as={A} href="/library" variant="outline" size="sm" class="ml-auto">
          <Library class="size-4" aria-hidden="true" /> 書庫から本を選ぶ
        </Button>
      </div>

      <Suspense fallback={<Skeleton class="h-32 w-full" />}>
        <Show
          when={notes()?.length}
          fallback={
            <Card>
              <CardHeader>
                <CardTitle class="text-lg">まだノートがありません</CardTitle>
                <CardDescription class="leading-relaxed">
                  書庫で Project Gutenberg の本を取り込み、その本の翻訳ノートを作ります。ノートには訳文・注釈・翻訳メモリ・解釈コンテキストが入り、ほかのユーザーを招待して一緒に訳すこともできます。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button as={A} href="/library?q=Newman">
                  <Library class="size-4" aria-hidden="true" /> Newman の著作を探す
                </Button>
              </CardContent>
            </Card>
          }
        >
          <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <For each={notes()}>
              {n => {
                const pct = () => (n.sentenceCount ? Math.round((n.translatedCount / n.sentenceCount) * 100) : 0);
                return (
                  <li>
                    <A href={noteHref(n.id)} class="block h-full rounded-lg border p-4 transition-colors hover:bg-accent">
                      <div class="flex items-start gap-3">
                        <BookCover bookId={n.bookId} hasCover={n.hasCover} title={n.bookTitle} author={n.author} size="sm" class="shrink-0" />
                        <div class="min-w-0 flex-1 space-y-1">
                          <p class="font-medium leading-snug">{n.title}</p>
                          <p class="source truncate text-sm italic text-muted-foreground">
                            {n.bookTitle}
                            {n.author ? ` — ${n.author}` : ""}
                          </p>
                        </div>
                        <Show when={n.role !== "owner"}>
                          <Badge variant="secondary" class="shrink-0">
                            <Users class="mr-1 size-3" aria-hidden="true" />
                            {ROLE_LABEL[n.role]}
                          </Badge>
                        </Show>
                      </div>
                      <div class="mt-3 space-y-1">
                        <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div class="h-full bg-primary" style={{ width: `${pct()}%` }} />
                        </div>
                        <p class="text-xs text-muted-foreground">
                          {n.translatedCount.toLocaleString()} / {n.sentenceCount.toLocaleString()} 文 訳済み（{pct()}%）・ 更新 {new Date(n.updatedAt).toLocaleDateString("ja-JP")}
                        </p>
                      </div>
                    </A>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Suspense>
    </div>
  );
}
