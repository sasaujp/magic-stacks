/**
 * End-to-end check of the passkey account flows against a running app (dev server or wrangler dev),
 * using a software authenticator (P-256 keys, "none" attestation) that produces real WebAuthn data.
 *
 *   E2E_BASE_URL=http://localhost:5199 pnpm test tests/e2e
 *
 * Only non-admin accounts are created (so pre-existing memos are never claimed), and they are
 * deleted again at the end.
 */
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { SoftAuthenticator } from "./soft-authenticator";

const BASE = process.env.E2E_BASE_URL?.replace(/\/$/, "");
// --- HTTP helpers ----------------------------------------------------------------
async function call(path: string, body?: unknown, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json", Origin: BASE! } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  const session = setCookie?.match(/ms_session=([^;]*)/)?.[1];
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, location: res.headers.get("location"), cookie: session ? `ms_session=${session}` : undefined };
}

function d1(sql: string) {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "magic-stacks", "--local", "--command", sql], { stdio: "ignore" });
}

function cliInvite(): string {
  const out = execFileSync("pnpm", ["--silent", "admin:invite", "--local", "--url", BASE!], { encoding: "utf8" });
  return out.trim().split("\n").pop()!.split("/invite/")[1];
}

async function register(token: string, auth: SoftAuthenticator, username?: string) {
  const opts = await call("/api/auth/register/options", { token, username });
  expect(opts.status, JSON.stringify(opts.data)).toBe(200);
  const response = await auth.register(opts.data.options, BASE!);
  return call("/api/auth/register/verify", { challengeId: opts.data.challengeId, response, deviceName: "e2e" });
}

async function login(username: string, auth: SoftAuthenticator) {
  const opts = await call("/api/auth/login/options", { username });
  expect(opts.status).toBe(200);
  const response = await auth.authenticate(opts.data.options, BASE!);
  return call("/api/auth/login/verify", { challengeId: opts.data.challengeId, response });
}

const created: string[] = [];

describe.skipIf(!BASE)("passkey accounts (e2e)", () => {
  const username = `e2e-${Date.now().toString(36)}`;
  const phone = new SoftAuthenticator();
  const laptop = new SoftAuthenticator();
  let session = "";

  afterAll(() => {
    if (created.length) d1(`DELETE FROM users WHERE username IN (${created.map(u => `'${u}'`).join(",")})`);
  });

  it("keeps the data behind sign-in (the SPA shell itself is public)", async () => {
    expect((await call("/notes/x/1")).status).toBe(200);
    expect((await call("/api/client-error", { message: "x" })).status).toBe(401);
  });

  it("registers a new account from an invite link and signs in", async () => {
    const token = cliInvite();
    expect((await call(`/api/auth/token?t=${token}`)).data).toMatchObject({ valid: true, kind: "invite" });

    const bad = await call("/api/auth/register/options", { token, username: "X!" });
    expect(bad.status).toBe(400);

    const res = await register(token, phone, username);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    created.push(username);
    expect(res.data.user).toMatchObject({ username, isAdmin: false });
    expect(res.cookie).toBeTruthy();
    session = res.cookie!;

    expect((await call("/api/client-error", { message: "e2e" }, session)).status).toBe(204);

    // The invite is single-use.
    expect((await call(`/api/auth/token?t=${token}`)).data).toEqual({ valid: false });
    expect((await call("/api/auth/register/options", { token, username: `${username}x` })).status).toBe(410);
  });

  it("signs out and back in with the passkey", async () => {
    const out = await call("/api/auth/logout", {}, session);
    expect(out.status).toBe(200);
    expect((await call("/api/client-error", { message: "x" }, session)).status).toBe(401);

    const res = await login(username, phone);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    session = res.cookie!;
    expect((await call("/api/client-error", { message: "e2e" }, session)).status).toBe(204);
  });

  it("adds a second device through a one-time device link", async () => {
    const link = await call("/api/auth/device-link", {}, session);
    expect(link.status).toBe(200);
    const token = link.data.url.split("/link/")[1];
    expect((await call(`/api/auth/token?t=${token}`)).data).toMatchObject({ valid: true, kind: "device", username });

    const res = await register(token, laptop);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.user.username).toBe(username);
    expect((await login(username, laptop)).status).toBe(200);
    expect((await login(username, phone)).status).toBe(200);
  });

  it("rejects an unknown passkey and cross-site requests", async () => {
    const stranger = new SoftAuthenticator();
    await stranger.register({ challenge: "x", rp: { id: new URL(BASE!).hostname }, user: { id: "x" } }, BASE!);
    expect((await login(username, stranger)).status).toBe(401);

    const res = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: session } });
    expect(res.status).toBe(403);
  });

  it("does not let a non-admin create invites", async () => {
    expect((await call("/api/auth/invite", {}, session)).status).toBe(403);
    expect((await call("/api/auth/invite", {})).status).toBe(401);
  });
});
