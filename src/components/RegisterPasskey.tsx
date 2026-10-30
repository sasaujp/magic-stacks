import { createSignal, Match, onMount, Show, Switch } from "solid-js";
import { KeyRound } from "lucide-solid";
import { AuthCard } from "~/components/AuthCard";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { TextField, TextFieldDescription, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { describeLink, guessDeviceName, passkeysSupported, registerPasskey } from "~/lib/passkey-client";

type LinkInfo = Awaited<ReturnType<typeof describeLink>>;

/** Shared page body for /invite/:token (new account) and /link/:token (add this device). */
export function RegisterPasskey(props: { token: string; expect: "invite" | "device" }) {
  const [info, setInfo] = createSignal<LinkInfo | null>(null);
  const [username, setUsername] = createSignal("");
  const [deviceName, setDeviceName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [supported, setSupported] = createSignal(true);

  onMount(async () => {
    setSupported(passkeysSupported());
    setDeviceName(guessDeviceName());
    try {
      setInfo(await describeLink(props.token));
    } catch {
      setInfo({ valid: false });
    }
  });

  const valid = () => {
    const i = info();
    return i && i.valid && i.kind === props.expect ? i : null;
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await registerPasskey(props.token, { username: props.expect === "invite" ? username() : undefined, deviceName: deviceName() });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Switch>
      <Match when={info() === null}>
        <AuthCard title="確認しています…">
          <Skeleton class="h-24 w-full" />
        </AuthCard>
      </Match>
      <Match when={!valid()}>
        <AuthCard title="リンクが無効です" description="このリンクは期限切れか、すでに使われています。発行した人に新しいリンクを作ってもらってください。">
          <Button as="a" href="/login" variant="outline">
            ログイン画面へ
          </Button>
        </AuthCard>
      </Match>
      <Match when={valid()}>
        {v => (
          <AuthCard
            title={props.expect === "invite" ? "Magic Stacks への招待" : "この端末を追加"}
            description={
              props.expect === "invite"
                ? "ユーザー名を決めて、この端末にパスキーを作成します。パスワードは使いません。"
                : `ユーザー「${v().username}」に、この端末のパスキーを追加します。`
            }
          >
            <form class="space-y-4" onSubmit={submit}>
              <Show when={props.expect === "invite"}>
                <TextField value={username()} onChange={setUsername}>
                  <TextFieldLabel>ユーザー名</TextFieldLabel>
                  <TextFieldInput autocomplete="username" autocapitalize="none" spellcheck={false} required minLength={2} maxLength={32} />
                  <TextFieldDescription>半角英小文字・数字・「_ - .」、2〜32 文字</TextFieldDescription>
                </TextField>
              </Show>
              <TextField value={deviceName()} onChange={setDeviceName}>
                <TextFieldLabel>端末の名前</TextFieldLabel>
                <TextFieldInput maxLength={60} />
                <TextFieldDescription>アカウント画面で、どの端末のパスキーか見分けるための名前です。</TextFieldDescription>
              </TextField>
              <Show when={error()}>
                <Alert variant="destructive">
                  <AlertDescription>{error()}</AlertDescription>
                </Alert>
              </Show>
              <Show when={!supported()}>
                <Alert>
                  <AlertDescription>このブラウザはパスキーに対応していません。</AlertDescription>
                </Alert>
              </Show>
              <Button type="submit" class="w-full" disabled={busy() || (props.expect === "invite" && !username().trim())}>
                <KeyRound class="size-4" aria-hidden="true" />
                {busy() ? "作成しています…" : "パスキーを作成"}
              </Button>
              <p class="text-xs text-muted-foreground">有効期限: {new Date(v().expiresAt).toLocaleString("ja-JP")}</p>
            </form>
          </AuthCard>
        )}
      </Match>
    </Switch>
  );
}
