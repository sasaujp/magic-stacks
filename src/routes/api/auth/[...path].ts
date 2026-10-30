/**
 * JSON endpoints for the passkey ceremonies and account links.
 *
 *   GET  /api/auth/token?t=…            describe an invite / device link
 *   POST /api/auth/register/options     { token, username? }
 *   POST /api/auth/register/verify      { challengeId, response, deviceName? }   → sets session cookie
 *   POST /api/auth/login/options        { username }
 *   POST /api/auth/login/verify         { challengeId, response }                → sets session cookie
 *   POST /api/auth/logout
 *   POST /api/auth/device-link          (signed in)  → { url, expiresAt }
 *   POST /api/auth/invite               (admin)      → { url, expiresAt }
 */
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { APIEvent } from "@solidjs/start/server";
import { z } from "zod";
import {
  AuthError,
  beginLogin,
  beginRegistration,
  clearSessionCookie,
  createAuthToken,
  deleteSession,
  describeToken,
  DEVICE_LINK_TTL_MS,
  finishLogin,
  finishRegistration,
  getSessionUser,
  INVITE_TTL_MS,
  relyingParty,
  sessionCookie,
  sessionTokenFrom,
} from "~/server/auth";
import { getDb } from "~/server/db";

// The WebAuthn response objects are verified cryptographically by @simplewebauthn; here we only check the shape.
// (A function declaration, not a generic arrow: route files are parsed as TSX, where `<T>()` reads as JSX.)
function webauthnResponse<T>() {
  return z.custom<T>(v => typeof v === "object" && v !== null && typeof (v as { id?: unknown }).id === "string");
}
const Bodies = {
  registerOptions: z.object({ token: z.string().min(1), username: z.string().max(64).optional() }),
  registerVerify: z.object({ challengeId: z.string().min(1), response: webauthnResponse<RegistrationResponseJSON>(), deviceName: z.string().max(100).optional() }),
  loginOptions: z.object({ username: z.string().max(64) }),
  loginVerify: z.object({ challengeId: z.string().min(1), response: webauthnResponse<AuthenticationResponseJSON>() }),
};

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new AuthError("リクエストの形式が正しくありません。");
  return r.data;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(init.headers ?? {}) },
  });

function errorResponse(e: unknown) {
  if (e instanceof AuthError) return json({ error: e.message }, { status: e.status });
  console.error(e);
  return json({ error: "サーバーでエラーが発生しました。" }, { status: 500 });
}

/** Reject cross-site POSTs (cookies are SameSite=Lax, this adds an explicit origin check). */
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(event: APIEvent) {
  const url = new URL(event.request.url);
  if (event.params.path === "token") {
    try {
      return json(await describeToken(getDb(), url.searchParams.get("t") ?? ""));
    } catch (e) {
      return errorResponse(e);
    }
  }
  return json({ error: "Not found" }, { status: 404 });
}

export async function POST(event: APIEvent) {
  const { request } = event;
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, { status: 403 });
  const db = getDb();
  const { secure, origin } = relyingParty(request);
  const body = request.headers.get("content-type")?.includes("application/json") ? ((await request.json().catch(() => ({}))) as unknown) : {};

  try {
    switch (event.params.path) {
      case "register/options":
        return json(await beginRegistration(db, request, parse(Bodies.registerOptions, body)));
      case "register/verify": {
        const { user, sessionToken } = await finishRegistration(db, request, parse(Bodies.registerVerify, body));
        return json({ user }, { headers: { "Set-Cookie": sessionCookie(sessionToken, secure) } });
      }
      case "login/options":
        return json(await beginLogin(db, request, parse(Bodies.loginOptions, body)));
      case "login/verify": {
        const { user, sessionToken } = await finishLogin(db, request, parse(Bodies.loginVerify, body));
        return json({ user }, { headers: { "Set-Cookie": sessionCookie(sessionToken, secure) } });
      }
      case "logout": {
        const token = sessionTokenFrom(request);
        if (token) await deleteSession(db, token);
        return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(secure) } });
      }
      case "device-link": {
        const user = await getSessionUser(db, request);
        if (!user) throw new AuthError("ログインが必要です。", 401);
        const { token, expiresAt } = await createAuthToken(db, { kind: "device", userId: user.id, createdBy: user.id, ttlMs: DEVICE_LINK_TTL_MS });
        return json({ url: `${origin}/link/${token}`, expiresAt });
      }
      case "invite": {
        const user = await getSessionUser(db, request);
        if (!user) throw new AuthError("ログインが必要です。", 401);
        if (!user.isAdmin) throw new AuthError("招待できるのは管理者だけです。", 403);
        const { token, expiresAt } = await createAuthToken(db, { kind: "invite", createdBy: user.id, ttlMs: INVITE_TTL_MS });
        return json({ url: `${origin}/invite/${token}`, expiresAt });
      }
      default:
        return json({ error: "Not found" }, { status: 404 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
