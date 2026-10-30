import { createAsync, useAction, useSubmission } from "@solidjs/router";
import { LogOut, QrCode, Trash2, UserPlus } from "lucide-solid";
import { createSignal, For, Show, Suspense } from "solid-js";
import { QrLink } from "~/components/QrLink";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { createLink, signOut } from "~/lib/passkey-client";
import { accountQuery, deletePasskeyAction } from "~/lib/queries";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function AccountPage() {
  const account = createAsync(() => accountQuery());
  const removeKey = useAction(deletePasskeyAction);
  const removing = useSubmission(deletePasskeyAction);
  const [deviceLink, setDeviceLink] = createSignal<{ url: string; expiresAt: string } | null>(null);
  const [invite, setInvite] = createSignal<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const make = async (kind: "device-link" | "invite") => {
    setError(null);
    try {
      const link = await createLink(kind);
      (kind === "invite" ? setInvite : setDeviceLink)(link);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const logout = async () => {
    await signOut();
    window.location.href = "/login";
  };
  const remove = async (id: string, name: string | null) => {
    if (!confirm(`パスキー「${name ?? "名称なし"}」を削除しますか？`)) return;
    const r = await removeKey(id);
    if (!r.ok) setError(r.error);
  };

  return (
    <div class="mx-auto max-w-2xl space-y-5 p-4 lg:p-6">
      <Suspense fallback={<Skeleton class="h-40 w-full" />}>
        <Show when={account()}>
          {a => (
            <>
              <div class="flex flex-wrap items-center gap-3">
                <h1 class="text-2xl font-semibold">{a().user.username}</h1>
                <Show when={a().user.isAdmin}>
                  <Badge variant="secondary">管理者</Badge>
                </Show>
                <Button variant="outline" size="sm" class="ml-auto" onClick={logout}>
                  <LogOut class="size-4" aria-hidden="true" /> ログアウト
                </Button>
              </div>

              <Show when={error() || removing.result?.ok === false}>
                <Alert variant="destructive">
                  <AlertDescription>{error() ?? (removing.result as { error?: string } | undefined)?.error}</AlertDescription>
                </Alert>
              </Show>

              <Card>
                <CardHeader>
                  <CardTitle class="text-lg">パスキー（ログインできる端末）</CardTitle>
                  <CardDescription>別の端末でも使うには、その端末で下の QR コードを読み取ってパスキーを追加します。</CardDescription>
                </CardHeader>
                <CardContent class="space-y-4">
                  <ul class="divide-y rounded-md border">
                    <For each={a().passkeys}>
                      {pk => (
                        <li class="flex items-center gap-3 px-3 py-2 text-sm">
                          <div class="min-w-0 flex-1">
                            <p class="font-medium">{pk.deviceName ?? "名称なし"}</p>
                            <p class="text-xs text-muted-foreground">
                              登録 {fmt(pk.createdAt)} ・ 最終使用 {fmt(pk.lastUsedAt)}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="size-8"
                            disabled={a().passkeys.length <= 1}
                            title={a().passkeys.length <= 1 ? "最後のパスキーは削除できません" : "削除"}
                            aria-label={`${pk.deviceName ?? "名称なし"} を削除`}
                            onClick={() => remove(pk.id, pk.deviceName)}
                          >
                            <Trash2 class="size-4" />
                          </Button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show
                    when={deviceLink()}
                    fallback={
                      <Button variant="outline" onClick={() => make("device-link")}>
                        <QrCode class="size-4" aria-hidden="true" /> 端末を追加（QR コードを表示）
                      </Button>
                    }
                  >
                    {l => <QrLink url={l().url} expiresAt={l().expiresAt} note="追加したい端末のカメラで読み取るか、リンクをその端末で開いてください（10 分間有効）。" />}
                  </Show>
                </CardContent>
              </Card>

              <Show when={a().user.isAdmin}>
                <Card>
                  <CardHeader>
                    <CardTitle class="text-lg">ユーザーを招待</CardTitle>
                    <CardDescription>招待リンクを渡すと、相手はユーザー名とパスキーを登録してログインできます。翻訳ノートはユーザーごとに分かれ、ノートごとにメンバーを招待できます。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Show
                      when={invite()}
                      fallback={
                        <Button variant="outline" onClick={() => make("invite")}>
                          <UserPlus class="size-4" aria-hidden="true" /> 招待リンクを作成
                        </Button>
                      }
                    >
                      {l => (
                        <div class="space-y-3">
                          <QrLink url={l().url} expiresAt={l().expiresAt} note="このリンクを招待する人に送ってください（7 日間有効、1 人分）。" />
                          <Button variant="ghost" size="sm" onClick={() => make("invite")}>
                            別の招待リンクを作成
                          </Button>
                        </div>
                      )}
                    </Show>
                  </CardContent>
                </Card>
              </Show>
            </>
          )}
        </Show>
      </Suspense>
    </div>
  );
}
