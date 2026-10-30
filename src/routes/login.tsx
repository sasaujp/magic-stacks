import { useSearchParams } from "@solidjs/router";
import { KeyRound } from "lucide-solid";
import { createSignal, onMount, Show } from "solid-js";
import { AuthCard } from "~/components/AuthCard";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { passkeysSupported, signInWithPasskey } from "~/lib/passkey-client";
import { safeReturnPath } from "~/lib/url";

export default function LoginPage() {
  const [search] = useSearchParams<{ next?: string }>();
  const [username, setUsername] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [supported, setSupported] = createSignal(true);
  onMount(() => setSupported(passkeysSupported()));

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithPasskey(username());
      // Full reload so every query is fetched with the new session.
      window.location.href = safeReturnPath(typeof search.next === "string" ? search.next : null) ?? "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard title="ログイン" description="ユーザー名を入力し、この端末のパスキー（Touch ID・Face ID など）で確認します。">
      <form class="space-y-4" onSubmit={submit}>
        <TextField value={username()} onChange={setUsername}>
          <TextFieldLabel>ユーザー名</TextFieldLabel>
          <TextFieldInput autocomplete="username webauthn" autocapitalize="none" spellcheck={false} required />
        </TextField>
        <Show when={error()}>
          <Alert variant="destructive">
            <AlertDescription>{error()}</AlertDescription>
          </Alert>
        </Show>
        <Show when={!supported()}>
          <Alert>
            <AlertDescription>このブラウザはパスキーに対応していません。最新の Safari・Chrome・Edge などをお使いください。</AlertDescription>
          </Alert>
        </Show>
        <Button type="submit" class="w-full" disabled={busy() || !username().trim()}>
          <KeyRound class="size-4" aria-hidden="true" />
          {busy() ? "確認しています…" : "パスキーでログイン"}
        </Button>
        <p class="text-xs leading-relaxed text-muted-foreground">
          Magic Stacks は招待制です。招待リンクを受け取った方は、そのリンクを開いて登録してください。別の端末をお使いの場合は、ログイン済みの端末の「アカウント」から QR コードで追加できます。
        </p>
      </form>
    </AuthCard>
  );
}
