import { onMount } from "solid-js";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { reportClientError } from "~/lib/report-error";

/** Shown instead of the page when rendering fails; the error is also sent to the server log. */
export function AppError(props: { error: unknown; reset: () => void }) {
  const message = () => (props.error instanceof Error ? `${props.error.name}: ${props.error.message}` : String(props.error));
  onMount(() => {
    console.error(props.error);
    reportClientError(props.error, "render");
  });
  return (
    <div class="mx-auto max-w-lg p-6">
      <Alert variant="destructive">
        <AlertTitle>表示中にエラーが発生しました</AlertTitle>
        <AlertDescription class="space-y-3">
          <p class="break-words font-mono text-xs">{message()}</p>
          <p class="text-sm">エラーの内容は自動で記録されました。再読み込みすると直ることがあります。</p>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => location.reload()}>
              再読み込み
            </Button>
            <Button size="sm" variant="outline" onClick={() => (location.href = "/")}>
              一覧に戻る
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
