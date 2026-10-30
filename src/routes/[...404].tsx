import { A } from "@solidjs/router";
import { Button } from "~/components/ui/button";

export default function NotFound() {
  return (
    <div class="mx-auto max-w-md space-y-4 p-10 text-center">
      <h1 class="text-2xl font-semibold">ページが見つかりません</h1>
      <p class="text-sm text-muted-foreground">URL を確認するか、トップに戻ってください。</p>
      <Button as={A} href="/">
        トップへ
      </Button>
    </div>
  );
}
