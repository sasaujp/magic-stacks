/**
 * Receives errors from browsers (render errors and uncaught exceptions) and writes them to the
 * Worker log, so they show up in `wrangler tail` / Workers Logs. Signed-in users only (middleware).
 */
import type { APIEvent } from "@solidjs/start/server";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

export async function POST(event: APIEvent) {
  const { request, locals } = event;
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  console.error(
    "[client-error]",
    JSON.stringify({
      kind: clip(body.kind, 40),
      message: clip(body.message, 2000),
      stack: clip(body.stack, 6000),
      url: clip(body.url, 500),
      user: locals.user?.username ?? null,
      ua: request.headers.get("user-agent")?.slice(0, 300),
    }),
  );
  return new Response(null, { status: 204 });
}
