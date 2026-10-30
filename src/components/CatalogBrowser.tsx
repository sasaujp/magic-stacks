import { A, createAsync, useAction, useNavigate, useSearchParams } from "@solidjs/router";
import { ArrowLeft, BookOpen, ChevronDown, Download, ExternalLink, Search, X } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, Show, Suspense, type JSX } from "solid-js";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { catalogBrowseQuery, catalogSearchQuery, importGutenbergAction, type CatalogHit } from "~/lib/queries";
import { cn } from "~/lib/utils";

const INITIALS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
const SEARCH_PAGE = 50;

type Params = { q?: string; by?: string; i?: string; a?: string };

/** Same title by the same author (different editions / transcriptions) shown as one row. */
type Group = { key: string; hits: CatalogHit[] };
function groupHits(hits: CatalogHit[]): Group[] {
  const byKey = new Map<string, Group>();
  const out: Group[] = [];
  for (const h of hits) {
    const key = `${h.title.toLowerCase()}\u0000${h.authors.toLowerCase()}`;
    const g = byKey.get(key);
    if (g) g.hits.push(h);
    else {
      const created = { key, hits: [h] };
      byKey.set(key, created);
      out.push(created);
    }
  }
  return out;
}

/**
 * Project Gutenberg catalog: type to search (title, subtitle, every contributor, subjects), or
 * browse A–Z by title or by author's surname (adapted from box-maison's ArchiveLibrary).
 * State lives in the URL (?q=, ?by=title|author, ?i=A, ?a=<author>) so it survives navigation.
 */
export function CatalogBrowser(props: { catalogReady: boolean }) {
  const [params, setParams] = useSearchParams<Params>();
  const q = () => (typeof params.q === "string" ? params.q : "");
  const by = () => (params.by === "author" ? "author" : "title");
  const initial = () => (typeof params.i === "string" && INITIALS.includes(params.i) ? params.i : "A");
  const author = () => (typeof params.a === "string" && params.a ? params.a : null);

  const [input, setInput] = createSignal(q());
  // Search as you type (debounced); the URL is the source of truth.
  createEffect(
    on(input, value => {
      const t = setTimeout(() => {
        if (value.trim() !== q().trim()) setParams({ q: value.trim() || undefined }, { replace: true });
      }, 300);
      onCleanup(() => clearTimeout(t));
    }, { defer: true }),
  );
  createEffect(on(q, v => v !== input().trim() && setInput(v), { defer: true }));

  const importBook = useAction(importGutenbergAction);
  const navigate = useNavigate();
  const [busy, setBusy] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const doImport = async (id: number) => {
    setError(null);
    setBusy(id);
    const r = await importBook(id);
    setBusy(null);
    if (r.ok) navigate(`/books/${r.value.bookId}`);
    else setError(r.error);
  };
  const showAuthor = (a: string) => {
    setInput("");
    setParams({ q: undefined, by: "author", a }, { replace: false });
  };

  const Action = (p: { hit: CatalogHit }) => (
    <Show
      when={p.hit.bookId}
      fallback={
        <Button size="sm" variant="outline" disabled={busy() !== null} onClick={() => doImport(p.hit.textId)}>
          <Download class="size-4" aria-hidden="true" />
          {busy() === p.hit.textId ? "取り込んでいます…" : "取り込む"}
        </Button>
      }
    >
      {bookId => (
        <Button as={A} href={`/books/${bookId()}`} size="sm" variant="ghost">
          <BookOpen class="size-4" aria-hidden="true" /> 開く
        </Button>
      )}
    </Show>
  );

  const Meta = (p: { hit: CatalogHit; showSubjects: boolean }) => (
    <span class="block truncate text-xs text-muted-foreground">
      <button type="button" class="hover:text-foreground hover:underline" onClick={() => showAuthor(p.hit.authors)} title="この著者の作品一覧">
        {p.hit.authors}
      </button>
      <Show when={p.showSubjects && p.hit.subjects}> ・ {p.hit.subjects}</Show>
    </span>
  );

  const GutenbergLink = (p: { id: number }) => (
    <a href={`https://www.gutenberg.org/ebooks/${p.id}`} target="_blank" rel="noreferrer" class="inline-flex items-center gap-0.5 hover:text-foreground" title="Project Gutenberg で見る">
      #{p.id}
      <ExternalLink class="size-3" aria-hidden="true" />
    </a>
  );

  /** One row per title+author; editions fold out. */
  const WorkList = (p: { hits: CatalogHit[]; showSubjects?: boolean }) => {
    const [open, setOpen] = createSignal<Set<string>>(new Set());
    const toggle = (k: string) =>
      setOpen(prev => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
    return (
      <ul class="divide-y">
        <For each={groupHits(p.hits)}>
          {g => {
            const first = g.hits[0];
            return (
              <li class="py-1.5">
                <Show
                  when={g.hits.length > 1}
                  fallback={
                    <div class="flex items-center gap-3 px-2">
                      <div class="min-w-0 flex-1">
                        <p class="source truncate text-base leading-snug">
                          {first.title}
                          <Show when={first.subtitle}>
                            <span class="text-muted-foreground"> — {first.subtitle}</span>
                          </Show>
                        </p>
                        <span class="flex gap-2 text-xs text-muted-foreground">
                          <span class="min-w-0 flex-1">
                            <Meta hit={first} showSubjects={!!p.showSubjects} />
                          </span>
                          <GutenbergLink id={first.textId} />
                        </span>
                      </div>
                      <Action hit={first} />
                    </div>
                  }
                >
                  <button type="button" class="flex w-full items-center gap-3 rounded px-2 text-left hover:bg-accent" onClick={() => toggle(g.key)} aria-expanded={open().has(g.key)}>
                    <span class="min-w-0 flex-1">
                      <span class="source block truncate text-base leading-snug">{first.title}</span>
                      <span class="block truncate text-xs text-muted-foreground">{first.authors}</span>
                    </span>
                    <span class="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                      {g.hits.length} 版
                      <ChevronDown class={cn("size-3.5 transition-transform", open().has(g.key) && "rotate-180")} aria-hidden="true" />
                    </span>
                  </button>
                  <Show when={open().has(g.key)}>
                    <ul class="ml-4 mt-1 border-l pl-3">
                      <For each={g.hits}>
                        {h => (
                          <li class="flex items-center gap-3 py-1">
                            <span class="min-w-0 flex-1 text-sm">
                              <span class="source">{h.subtitle ?? h.title}</span>
                              <span class="ml-2 text-xs text-muted-foreground">
                                <GutenbergLink id={h.textId} />
                              </span>
                            </span>
                            <Action hit={h} />
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    );
  };

  /** Search results, 50 per page ("more" appends the next page). */
  const SearchResults = () => {
    const [pages, setPages] = createSignal(1);
    createEffect(on(q, () => setPages(1), { defer: true }));
    const first = createAsync(() => catalogSearchQuery(q(), 0));
    return (
      <div class="space-y-2">
        <Show when={first()?.directId}>
          {id => (
            <div class="flex items-center gap-3 rounded-md border border-dashed p-3 text-sm">
              <span class="flex-1">Gutenberg 作品番号 {id()} を取り込む</span>
              <Button size="sm" disabled={busy() !== null} onClick={() => doImport(id())}>
                <Download class="size-4" aria-hidden="true" />
                {busy() === id() ? "取り込んでいます…" : "取り込む"}
              </Button>
            </div>
          )}
        </Show>
        <Show when={first()}>
          {f => (
            <Show when={f().works.length} fallback={<Show when={!f().directId}><p class="px-2 text-sm text-muted-foreground">見つかりませんでした。綴りを変えるか、著者の姓だけで探してみてください。</p></Show>}>
              <WorkList hits={f().works} showSubjects />
              <For each={Array.from({ length: pages() - 1 }, (_, i) => (i + 1) * SEARCH_PAGE)}>{offset => <MorePage offset={offset} />}</For>
              <Show when={pages() === 1 ? f().hasMore : true}>
                <MoreButton pages={pages()} onMore={() => setPages(n => n + 1)} />
              </Show>
            </Show>
          )}
        </Show>
      </div>
    );
  };
  const MorePage = (p: { offset: number }) => {
    const page = createAsync(() => catalogSearchQuery(q(), p.offset));
    return (
      <Suspense fallback={<Skeleton class="h-20 w-full" />}>
        <Show when={page()?.works.length}>
          <WorkList hits={page()!.works} showSubjects />
        </Show>
      </Suspense>
    );
  };
  // Only offered while the last loaded page was full.
  const MoreButton = (p: { pages: number; onMore: () => void }) => {
    const last = createAsync(() => catalogSearchQuery(q(), (p.pages - 1) * SEARCH_PAGE));
    return (
      <Show when={last()?.hasMore}>
        <Button variant="ghost" size="sm" class="w-full" onClick={() => p.onMore()}>
          もっと見る
        </Button>
      </Show>
    );
  };

  const TitleBrowse = () => {
    const [shown, setShown] = createSignal(1);
    createEffect(on(initial, () => setShown(1), { defer: true }));
    const head = createAsync(() => catalogBrowseQuery({ mode: "title", initial: initial(), offset: 0 }));
    const total = () => (head()?.kind === "works" ? (head()!.total ?? 0) : 0);
    return (
      <div class="space-y-1">
        <p class="px-2 text-xs text-muted-foreground">「{initial()}」で始まる題名 {total().toLocaleString()} 件（冠詞 The / A / An は除いて並べています）</p>
        <For each={Array.from({ length: shown() }, (_, i) => i * 100)}>{offset => <TitlePage offset={offset} />}</For>
        <Show when={shown() * 100 < total()}>
          <Button variant="ghost" size="sm" class="w-full" onClick={() => setShown(n => n + 1)}>
            もっと見る（残り {(total() - shown() * 100).toLocaleString()} 件）
          </Button>
        </Show>
      </div>
    );
  };
  const TitlePage = (p: { offset: number }) => {
    const page = createAsync(() => catalogBrowseQuery({ mode: "title", initial: initial(), offset: p.offset }));
    return (
      <Suspense fallback={<Skeleton class="h-40 w-full" />}>
        <Show when={page()?.kind === "works" && page()}>{r => <WorkList hits={(r() as { works: CatalogHit[] }).works} />}</Show>
      </Suspense>
    );
  };

  const AuthorBrowse = () => {
    const list = createAsync(() => catalogBrowseQuery({ mode: "author", initial: initial() }));
    return (
      <Show when={list()?.kind === "authors" && list()}>
        {r => {
          const authors = () => (r() as { authors: { authors: string; works: number }[] }).authors;
          return (
            <Show when={authors().length} fallback={<p class="px-2 text-sm text-muted-foreground">この頭文字の著者はいません。</p>}>
              <ul class="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                <For each={authors()}>
                  {a => (
                    <li>
                      <button type="button" class="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent" onClick={() => showAuthor(a.authors)}>
                        <span class="min-w-0 flex-1 truncate">{a.authors}</span>
                        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{a.works}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          );
        }}
      </Show>
    );
  };

  const AuthorWorks = (p: { authors: string }) => {
    const list = createAsync(() => catalogBrowseQuery({ mode: "works-by", authors: p.authors }));
    const works = () => (list()?.kind === "works" ? (list() as { works: CatalogHit[] }).works : []);
    return (
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-2 px-2">
          <Button variant="ghost" size="sm" class="-ml-2" onClick={() => setParams({ a: undefined, by: "author", i: p.authors[0]?.toUpperCase() })}>
            <ArrowLeft class="size-4" aria-hidden="true" /> 著者一覧
          </Button>
          <h3 class="font-medium">{p.authors}</h3>
          <span class="text-xs text-muted-foreground">{works().length} 作品</span>
        </div>
        <WorkList hits={works()} />
      </div>
    );
  };

  const Tab = (p: { value: "title" | "author"; children: JSX.Element }) => (
    <Button size="sm" variant={by() === p.value && !author() ? "default" : "ghost"} onClick={() => setParams({ by: p.value === "title" ? undefined : "author", a: undefined })}>
      {p.children}
    </Button>
  );

  return (
    <div class="space-y-3">
      <TextField value={input()} onChange={setInput} class="relative">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <TextFieldInput class="pl-9 pr-9" placeholder="題名・著者・主題で検索（例: newman assent / 作品番号 34022 / URL）" aria-label="Project Gutenberg を検索" />
        <Show when={input()}>
          <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="検索語を消す" onClick={() => setInput("")}>
            <X class="size-4" />
          </button>
        </Show>
      </TextField>

      <Show when={error()}>
        <Alert variant="destructive">
          <AlertDescription>{error()}</AlertDescription>
        </Alert>
      </Show>

      <Show
        when={!q().trim()}
        fallback={
          <Suspense fallback={<Skeleton class="h-40 w-full" />}>
            <SearchResults />
          </Suspense>
        }
      >
        <Show when={props.catalogReady}>
          <Show
            when={author()}
            fallback={
              <>
                <div class="flex flex-wrap items-center gap-1">
                  <Tab value="title">題名</Tab>
                  <Tab value="author">著者</Tab>
                  <span class="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                  <div class="flex flex-wrap gap-0.5" role="group" aria-label="頭文字">
                    <For each={INITIALS}>
                      {k => (
                        <button
                          type="button"
                          class={cn("size-7 rounded text-xs font-medium hover:bg-accent", initial() === k && "bg-primary text-primary-foreground hover:bg-primary")}
                          aria-pressed={initial() === k}
                          title={k === "#" ? "数字・記号" : undefined}
                          onClick={() => setParams({ i: k === "A" ? undefined : k }, { replace: true })}
                        >
                          {k}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
                <Suspense fallback={<Skeleton class="h-40 w-full" />}>
                  <Show when={by() === "author"} fallback={<TitleBrowse />}>
                    <AuthorBrowse />
                  </Show>
                </Suspense>
              </>
            }
          >
            {a => (
              <Suspense fallback={<Skeleton class="h-40 w-full" />}>
                <AuthorWorks authors={a()} />
              </Suspense>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
