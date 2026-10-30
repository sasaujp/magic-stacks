import { useAction } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { NativeSelect } from "~/components/NativeSelect";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { TERM_KIND_LABEL } from "~/lib/labels";
import { saveTermAction } from "~/lib/queries";

export interface TermDraft {
  id?: number;
  source: string;
  target: string;
  kind: "term" | "name" | "phrase";
  chapterId: number | null;
  memo: string;
}

const KIND_OPTIONS = (Object.keys(TERM_KIND_LABEL) as (keyof typeof TERM_KIND_LABEL)[]).map(k => ({ value: k, label: TERM_KIND_LABEL[k] }));

/** Add or edit one translation-memory entry. `chapters` offers chapter-scoped exceptions. */
export function TermForm(props: { noteId: string; initial: TermDraft; chapters: { id: number; seq: number; title: string }[]; onDone: () => void; onCancel?: () => void }) {
  const save = useAction(saveTermAction);
  const [d, setD] = createSignal<TermDraft>({ ...props.initial });
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const set = <K extends keyof TermDraft>(k: K, v: TermDraft[K]) => setD(prev => ({ ...prev, [k]: v }));
  const scopeOptions = () => [{ value: "", label: "本全体" }, ...props.chapters.map(c => ({ value: String(c.id), label: `第${c.seq}章のみ: ${c.title.slice(0, 40)}` }))];

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await save(props.noteId, d());
    setBusy(false);
    if (r.ok) props.onDone();
    else setError(r.error);
  };

  return (
    <form class="space-y-3" onSubmit={submit}>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField value={d().source} onChange={v => set("source", v)}>
          <TextFieldLabel>原語</TextFieldLabel>
          <TextFieldInput class="source" required placeholder="real assent" />
        </TextField>
        <TextField value={d().target} onChange={v => set("target", v)}>
          <TextFieldLabel>訳語</TextFieldLabel>
          <TextFieldInput class="translation" required placeholder="実的承認" />
        </TextField>
      </div>
      <div class="flex flex-wrap gap-3">
        <label class="space-y-1 text-sm font-medium">
          <span class="block">種類</span>
          <NativeSelect value={d().kind} onChange={v => set("kind", v)} options={KIND_OPTIONS} />
        </label>
        <label class="min-w-0 flex-1 space-y-1 text-sm font-medium">
          <span class="block">適用範囲</span>
          <NativeSelect class="w-full" value={d().chapterId === null ? "" : String(d().chapterId)} onChange={v => set("chapterId", v ? Number(v) : null)} options={scopeOptions()} />
        </label>
      </div>
      <TextField value={d().memo} onChange={v => set("memo", v)}>
        <TextFieldLabel>メモ（訳語の根拠・注意点。AI にも渡されます）</TextFieldLabel>
        <TextFieldInput placeholder="notional assent と対にして訳す" />
      </TextField>
      <Show when={error()}>
        <Alert variant="destructive">
          <AlertDescription>{error()}</AlertDescription>
        </Alert>
      </Show>
      <div class="flex gap-2">
        <Button type="submit" size="sm" disabled={busy()}>
          {d().id ? "更新" : "追加"}
        </Button>
        <Show when={props.onCancel}>
          <Button type="button" size="sm" variant="ghost" onClick={() => props.onCancel?.()}>
            キャンセル
          </Button>
        </Show>
      </div>
    </form>
  );
}
