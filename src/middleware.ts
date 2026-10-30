/**
 * Resolves the session cookie on every request and keeps the server functions behind sign-in.
 * Pages are a client-rendered SPA: the shell is public and the client redirects to /login
 * (see RequireUser in app.tsx); data only ever comes through the guarded endpoints below.
 */
import { createMiddleware } from "@solidjs/start/middleware";
import { getSessionUser } from "~/server/auth";
import { getDb } from "~/server/db";

/** Server functions callable without a session (their ids end with "-<exportName>"). */
const PUBLIC_SERVER_FUNCTIONS = ["fetchMe"];

export default createMiddleware({
  onRequest: async event => {
    const url = new URL(event.request.url);
    const guarded = url.pathname.startsWith("/_server") || (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/"));
    if (!guarded) return;
    event.locals.user = await getSessionUser(getDb(), event.request);
    if (event.locals.user) return;
    if (url.pathname.startsWith("/_server")) {
      const id = event.request.headers.get("X-Server-Id")?.split("#")[0] ?? url.searchParams.get("id") ?? "";
      if (PUBLIC_SERVER_FUNCTIONS.some(name => id.endsWith(`-${name}`))) return;
    }
    return new Response("ログインが必要です。", { status: 401 });
  },
});
