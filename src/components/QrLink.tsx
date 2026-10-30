import { Check, Copy } from "lucide-solid";
import { createSignal } from "solid-js";
import { renderSVG } from "uqr";
import { Button } from "~/components/ui/button";

/** A one-time link shown as a QR code (to scan with another device) plus a copyable URL. */
export function QrLink(props: { url: string; expiresAt: string; note: string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    await navigator.clipboard.writeText(props.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div class="flex flex-col items-center gap-3 rounded-md border p-4 sm:flex-row sm:items-start">
      <div
        class="size-44 shrink-0 rounded bg-white p-2 [&_svg]:size-full"
        role="img"
        aria-label="QR コード"
        innerHTML={renderSVG(props.url, { border: 1 })}
      />
      <div class="min-w-0 flex-1 space-y-2 text-sm">
        <p>{props.note}</p>
        <p class="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{props.url}</p>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied() ? <Check class="size-4" aria-hidden="true" /> : <Copy class="size-4" aria-hidden="true" />}
          {copied() ? "コピーしました" : "リンクをコピー"}
        </Button>
        <p class="text-xs text-muted-foreground">1 回だけ使えます。有効期限: {new Date(props.expiresAt).toLocaleString("ja-JP")}</p>
      </div>
    </div>
  );
}
