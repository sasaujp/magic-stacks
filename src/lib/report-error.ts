/** Sends a browser-side error to /api/client-error (best effort, a few per page at most). */
let sent = 0;

export function reportClientError(error: unknown, kind: string) {
  if (typeof window === "undefined" || sent >= 10) return;
  sent++;
  const e = error instanceof Error ? error : new Error(String(error));
  const body = JSON.stringify({ kind, message: `${e.name}: ${e.message}`, stack: e.stack, url: location.href });
  try {
    if (!navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    }
  } catch {
    // ignore
  }
}

/** Reports uncaught errors and unhandled promise rejections for the lifetime of the page. */
export function installGlobalErrorReporting() {
  window.addEventListener("error", ev => reportClientError(ev.error ?? ev.message, "window.error"));
  window.addEventListener("unhandledrejection", ev => reportClientError(ev.reason, "unhandledrejection"));
}
