import { A, createAsync, useAction, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { Pencil, Plus, Search, Trash2, UserPlus } from "lucide-solid";
import { createMemo, createSignal, For, Show, Suspense } from "solid-js";
import { BookCover } from "~/components/BookCover";
import { ConcordanceDialog } from "~/components/ConcordanceDialog";
import { NativeSelect } from "~/components/NativeSelect";
import { TermForm, type TermDraft } from "~/components/TermForm";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { TextField, TextFieldInput, TextFieldLabel, TextFieldTextArea } from "~/components/ui/text-field";
import { ROLE_LABEL, TERM_KIND_LABEL } from "~/lib/labels";
import {
  addMemberAction,
  conceptsQuery,
  deleteConceptAction,
  deleteNoteAction,
  deleteTermAction,
  noteQuery,
  saveConceptAction,
  setMemberRoleAction,
  termsQuery,
  updateNoteAction,
  type NoteOverview,
} from "~/lib/queries";
import { chapterHref } from "~/lib/url";

type Tab = "toc" | "terms" | "concepts" | "settings";

export default function NotePage() {
  const params = useParams<{ id: string }>();
  const [search, setSearch] = useSearchParams<{ tab?: string }>();
  const note = createAsync(() => noteQuery(params.id));
  const tab = () => (["toc", "terms", "concepts", "settings"].includes(search.tab as string) ? (search.tab as Tab) : "toc");

  return (
    <div class="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <Suspense fallback={<Skeleton class="h-40 w-full" />}>
        <Show when={note()} fallback={<Alert>このノートは見つからないか、アクセス権がありません。</Alert>}>
          {n => (
            <>
              <div class="flex items-center gap-4">
                <BookCover bookId={n().book.id} hasCover={n().book.hasCover} title={n().book.title} author={n().book.author} class="w-16 shrink-0" />
                <div class="min-w-0 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h1 class="text-2xl font-semibold">{n().note.title}</h1>
                    <Badge variant="secondary">{ROLE_LABEL[n().role]}</Badge>
                  </div>
                  <A href={`/books/${n().book.id}`} class="source text-lg italic text-muted-foreground hover:text-foreground">
                    {n().book.title}
                    {n().book.author ? ` — ${n().book.author}` : ""}
                  </A>
                </div>
              </div>
              <Tabs value={tab()} onChange={v => setSearch({ tab: v === "toc" ? undefined : v }, { replace: true })}>
                <TabsList class="flex h-auto w-full flex-wrap justify-start">
                  <TabsTrigger value="toc">目次</TabsTrigger>
                  <TabsTrigger value="terms">翻訳メモリ</TabsTrigger>
                  <TabsTrigger value="concepts">解釈コンテキスト</TabsTrigger>
                  <TabsTrigger value="settings">設定・メンバー</TabsTrigger>
                  <TabsIndicator />
                </TabsList>
                <TabsContent value="toc" class="pt-4">
                  <Toc note={n()} />
                </TabsContent>
                <TabsContent value="terms" class="pt-4">
                  <Terms note={n()} />
                </TabsContent>
                <TabsContent value="concepts" class="pt-4">
                  <Concepts note={n()} />
                </TabsContent>
                <TabsContent value="settings" class="pt-4">
                  <Settings note={n()} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </Show>
      </Suspense>
    </div>
  );
}

const canEdit = (n: NoteOverview) => n.role !== "viewer";
const chapterLabel = (n: NoteOverview, id: number | null) => {
  if (id === null) return null;
  const c = n.chapters.find(c => c.id === id);
  return c ? `第${c.seq}章` : "章";
};

function Toc(props: { note: NoteOverview }) {
  const total = () => props.note.chapters.reduce((s, c) => s + c.translated, 0);
  return (
    <div class="space-y-3">
      <p class="text-sm text-muted-foreground">
        {total().toLocaleString()} / {props.note.book.sentenceCount.toLocaleString()} 文 訳済み。章を開くと、本文を 1 文ずつ訳し、任意の箇所に解析を付けられます。
      </p>
      <ol class="divide-y rounded-md border">
        <For each={props.note.chapters}>
          {c => {
            const pct = () => (c.sentenceCount ? Math.round((c.translated / c.sentenceCount) * 100) : 0);
            return (
              <li>
                <A href={chapterHref(props.note.note.id, c.seq)} class="flex items-center gap-3 px-3 py-2.5 hover:bg-accent">
                  <span class="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{c.seq}</span>
                  <span class="source min-w-0 flex-1 text-base leading-snug">{c.title}</span>
                  <span class="hidden w-24 shrink-0 sm:block">
                    <span class="block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span class="block h-full bg-primary" style={{ width: `${pct()}%` }} />
                    </span>
                  </span>
                  <span class="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {c.translated}/{c.sentenceCount}
                  </span>
                </A>
              </li>
            );
          }}
        </For>
      </ol>
    </div>
  );
}

function Terms(props: { note: NoteOverview }) {
  const terms = createAsync(() => termsQuery(props.note.note.id));
  const remove = useAction(deleteTermAction);
  const [editing, setEditing] = createSignal<TermDraft | null>(null);
  const [filter, setFilter] = createSignal("");
  const [kwic, setKwic] = createSignal<{ q: string; target: string } | null>(null);
  const shown = createMemo(() => {
    const f = filter().trim().toLowerCase();
    return (terms() ?? []).filter(t => !f || t.source.toLowerCase().includes(f) || t.target.includes(f));
  });
  const blank: TermDraft = { source: "", target: "", kind: "term", chapterId: null, memo: "" };

  return (
    <div class="space-y-4">
      <p class="text-sm leading-relaxed text-muted-foreground">
        固有名詞・専門用語・定型句の訳語です。AI はその文の付近に出てくる語の訳語に従って訳します。章ごとの例外は、その章でだけ本全体の訳語より優先されます。
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <TextField value={filter()} onChange={setFilter} class="min-w-48 flex-1">
          <TextFieldInput placeholder="絞り込み" aria-label="翻訳メモリを絞り込む" />
        </TextField>
        <Show when={canEdit(props.note) && !editing()}>
          <Button size="sm" onClick={() => setEditing({ ...blank })}>
            <Plus class="size-4" aria-hidden="true" /> 追加
          </Button>
        </Show>
      </div>
      <Show when={editing()}>
        {d => (
          <Card>
            <CardContent class="pt-6">
              <TermForm noteId={props.note.note.id} initial={d()} chapters={props.note.chapters} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />
            </CardContent>
          </Card>
        )}
      </Show>
      <Suspense fallback={<Skeleton class="h-24 w-full" />}>
        <Show when={shown().length} fallback={<p class="text-sm text-muted-foreground">まだ登録がありません。本文で AI 訳を作ると、登録すべき語の候補が出ます。</p>}>
          <ul class="divide-y rounded-md border">
            <For each={shown()}>
              {t => (
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span class="source text-base">{t.source}</span>
                  <span class="text-muted-foreground">→</span>
                  <span class="translation">{t.target}</span>
                  <Badge variant="outline" class="text-[11px]">
                    {TERM_KIND_LABEL[t.kind]}
                  </Badge>
                  <Show when={chapterLabel(props.note, t.chapterId)}>{l => <Badge variant="secondary" class="text-[11px]">{l()}のみ</Badge>}</Show>
                  <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.memo}</span>
                  <Button variant="ghost" size="icon" class="size-8" title="この本での用例" aria-label={`${t.source} の用例`} onClick={() => setKwic({ q: t.source, target: t.target })}>
                    <Search class="size-4" />
                  </Button>
                  <Show when={canEdit(props.note)}>
                    <Button variant="ghost" size="icon" class="size-8" aria-label={`${t.source} を編集`} onClick={() => setEditing({ ...t })}>
                      <Pencil class="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      aria-label={`${t.source} を削除`}
                      onClick={() => confirm(`「${t.source} → ${t.target}」を削除しますか？`) && remove(props.note.note.id, t.id)}
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Suspense>
      <ConcordanceDialog noteId={props.note.note.id} query={kwic()?.q ?? null} termTarget={kwic()?.target} onClose={() => setKwic(null)} />
    </div>
  );
}

function Concepts(props: { note: NoteOverview }) {
  const concepts = createAsync(() => conceptsQuery(props.note.note.id));
  const save = useAction(saveConceptAction);
  const remove = useAction(deleteConceptAction);
  const [editing, setEditing] = createSignal<{ id?: number; title: string; body: string; chapterId: number | null } | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const scopeOptions = () => [{ value: "", label: "本全体" }, ...props.note.chapters.map(c => ({ value: String(c.id), label: `第${c.seq}章: ${c.title.slice(0, 40)}` }))];

  const submit = async (e: Event) => {
    e.preventDefault();
    const d = editing();
    if (!d) return;
    setError(null);
    const r = await save(props.note.note.id, d);
    if (r.ok) setEditing(null);
    else setError(r.error);
  };

  return (
    <div class="space-y-4">
      <p class="text-sm leading-relaxed text-muted-foreground">
        著者がどんな議論を展開しているか、概念をどう定義しているかについての、このノートの理解です（例:「notional assent と real assent の区別」「第4講の論旨」）。本全体のものと、その章のものが AI に渡されます。
      </p>
      <Show when={canEdit(props.note) && !editing()}>
        <Button size="sm" onClick={() => setEditing({ title: "", body: "", chapterId: null })}>
          <Plus class="size-4" aria-hidden="true" /> 追加
        </Button>
      </Show>
      <Show when={editing()}>
        {d => (
          <Card>
            <CardContent class="pt-6">
              <form class="space-y-3" onSubmit={submit}>
                <TextField value={d().title} onChange={v => setEditing({ ...d(), title: v })}>
                  <TextFieldLabel>見出し</TextFieldLabel>
                  <TextFieldInput required placeholder="notional assent と real assent" />
                </TextField>
                <TextField value={d().body} onChange={v => setEditing({ ...d(), body: v })}>
                  <TextFieldLabel>内容</TextFieldLabel>
                  <TextFieldTextArea required rows={6} placeholder="Newman は承認（assent）を、命題を概念として把握する notional assent と、具体的な事物の像として把握する real assent に分ける。…" />
                </TextField>
                <label class="block space-y-1 text-sm font-medium">
                  <span class="block">適用範囲</span>
                  <NativeSelect class="w-full" value={d().chapterId === null ? "" : String(d().chapterId)} onChange={v => setEditing({ ...d(), chapterId: v ? Number(v) : null })} options={scopeOptions()} />
                </label>
                <Show when={error()}>
                  <Alert variant="destructive">
                    <AlertDescription>{error()}</AlertDescription>
                  </Alert>
                </Show>
                <div class="flex gap-2">
                  <Button type="submit" size="sm">
                    {d().id ? "更新" : "追加"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    キャンセル
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </Show>
      <Suspense fallback={<Skeleton class="h-24 w-full" />}>
        <Show when={concepts()?.length} fallback={<p class="text-sm text-muted-foreground">まだありません。</p>}>
          <ul class="space-y-3">
            <For each={concepts()}>
              {c => (
                <li class="rounded-md border p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-medium">{c.title}</h3>
                    <Show when={chapterLabel(props.note, c.chapterId)}>{l => <Badge variant="secondary">{l()}</Badge>}</Show>
                    <Show when={canEdit(props.note)}>
                      <span class="ml-auto flex">
                        <Button variant="ghost" size="icon" class="size-8" aria-label={`${c.title} を編集`} onClick={() => setEditing({ ...c })}>
                          <Pencil class="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" class="size-8" aria-label={`${c.title} を削除`} onClick={() => confirm(`「${c.title}」を削除しますか？`) && remove(props.note.note.id, c.id)}>
                          <Trash2 class="size-4" />
                        </Button>
                      </span>
                    </Show>
                  </div>
                  <p class="mt-1 whitespace-pre-line text-sm leading-7">{c.body}</p>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Suspense>
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: "editor", label: "編集者" },
  { value: "viewer", label: "閲覧者" },
  { value: "owner", label: "所有者" },
] as const;

function Settings(props: { note: NoteOverview }) {
  const update = useAction(updateNoteAction);
  const addMember = useAction(addMemberAction);
  const setRole = useAction(setMemberRoleAction);
  const del = useAction(deleteNoteAction);
  const navigate = useNavigate();
  const [title, setTitle] = createSignal(props.note.note.title);
  const [policy, setPolicy] = createSignal(props.note.note.policy);
  const [username, setUsername] = createSignal("");
  const [role, setRoleInput] = createSignal<"owner" | "editor" | "viewer">("editor");
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const owner = () => props.note.role === "owner";
  const report = (r: { ok: boolean; error?: string }, okText: string) => setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "失敗しました。" });

  return (
    <div class="space-y-5">
      <Show when={msg()}>
        {m => (
          <Alert variant={m().ok ? "default" : "destructive"}>
            <AlertDescription>{m().text}</AlertDescription>
          </Alert>
        )}
      </Show>
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">ノートと翻訳方針</CardTitle>
          <CardDescription>翻訳方針は、AI へのすべての依頼に添えられます（想定読者、文体、訳語の傾向など）。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            class="space-y-3"
            onSubmit={async e => {
              e.preventDefault();
              report(await update(props.note.note.id, { title: title(), policy: policy() }), "保存しました。");
            }}
          >
            <TextField value={title()} onChange={setTitle} disabled={!canEdit(props.note)}>
              <TextFieldLabel>ノートの名前</TextFieldLabel>
              <TextFieldInput maxLength={120} />
            </TextField>
            <TextField value={policy()} onChange={setPolicy} disabled={!canEdit(props.note)}>
              <TextFieldLabel>翻訳方針</TextFieldLabel>
              <TextFieldTextArea rows={5} placeholder="大学の講読で使う、原文の構造が追える訳。である調。神学用語はカトリックの慣用に従う。" />
            </TextField>
            <Show when={canEdit(props.note)}>
              <Button type="submit" size="sm">
                保存
              </Button>
            </Show>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">メンバー</CardTitle>
          <CardDescription>編集者は訳文・注釈・メモリを編集でき、閲覧者は読むだけです。招待できるのは、すでにアカウントを持っているユーザーです。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <ul class="divide-y rounded-md border">
            <For each={props.note.members}>
              {m => (
                <li class="flex items-center gap-3 px-3 py-2 text-sm">
                  <span class="flex-1 font-medium">{m.username}</span>
                  <Show when={owner()} fallback={<Badge variant="secondary">{ROLE_LABEL[m.role]}</Badge>}>
                    <NativeSelect
                      class="h-8"
                      value={m.role}
                      options={ROLE_OPTIONS}
                      onChange={async v => report(await setRole(props.note.note.id, m.userId, v), "変更しました。")}
                      aria-label={`${m.username} の役割`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      aria-label={`${m.username} を外す`}
                      onClick={async () => confirm(`${m.username} をこのノートから外しますか？`) && report(await setRole(props.note.note.id, m.userId, null), "外しました。")}
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={owner()}>
            <form
              class="flex flex-wrap items-end gap-2"
              onSubmit={async e => {
                e.preventDefault();
                const r = await addMember(props.note.note.id, username(), role());
                report(r, `${username()} を招待しました。`);
                if (r.ok) setUsername("");
              }}
            >
              <TextField value={username()} onChange={setUsername} class="min-w-48 flex-1">
                <TextFieldLabel>ユーザー名</TextFieldLabel>
                <TextFieldInput autocapitalize="none" spellcheck={false} required />
              </TextField>
              <NativeSelect value={role()} onChange={setRoleInput} options={ROLE_OPTIONS} aria-label="役割" />
              <Button type="submit">
                <UserPlus class="size-4" aria-hidden="true" /> 招待
              </Button>
            </form>
          </Show>
        </CardContent>
      </Card>

      <Show when={owner()}>
        <Card class="border-destructive/40">
          <CardHeader>
            <CardTitle class="text-lg">ノートを削除</CardTitle>
            <CardDescription>訳文・注釈・翻訳メモリ・解釈コンテキストがすべて消えます。書籍そのものは残ります。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!confirm(`ノート「${props.note.note.title}」を削除しますか？元に戻せません。`)) return;
                const r = await del(props.note.note.id);
                if (r.ok) navigate("/");
                else report(r, "");
              }}
            >
              <Trash2 class="size-4" aria-hidden="true" /> 削除
            </Button>
          </CardContent>
        </Card>
      </Show>
    </div>
  );
}

