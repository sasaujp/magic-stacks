import { Check, Copy } from "lucide-solid";
import { createSignal } from "solid-js";
import { Button } from "~/components/ui/button";

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without the async clipboard API (or without permission).
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** Copies text produced on demand; shows a short confirmation. */
export function CopyButton(props: { text: () => string; label?: string }) {
  const [state, setState] = createSignal<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    setState((await writeClipboard(props.text())) ? "done" : "failed");
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <Button variant="outline" size="sm" class="h-8" onClick={copy} aria-live="polite">
      {state() === "done" ? <Check class="size-4" aria-hidden="true" /> : <Copy class="size-4" aria-hidden="true" />}
      {state() === "done" ? "コピーしました" : state() === "failed" ? "コピーできませんでした" : (props.label ?? "コピー")}
    </Button>
  );
}
