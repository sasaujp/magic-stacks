/**
 * Accounts with username + passkeys (WebAuthn). Sign-up is invitation-only; additional devices are
 * linked with a short-lived single-use link shown as a QR code on an already signed-in device.
 *
 * Only hashes of session cookies and link tokens are stored. WebAuthn challenges live in D1 and are
 * consumed on verification.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { authChallenges, authTokens, passkeys, sessions, users } from "~/db/schema";
import type { Db } from "./db";

export interface SessionUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

export const SESSION_COOKIE = "ms_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEVICE_LINK_TTL_MS = 10 * 60 * 1000;
const RP_NAME = "Magic Stacks";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// --- small helpers -----------------------------------------------------------

const now = () => new Date();
const iso = (d: Date) => d.toISOString();

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return base64url(new Uint8Array(buf));
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 2–32 characters: lowercase letters, digits, "_", "-", "." */
export function isValidUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9_.-]{1,31}$/.test(u);
}

/** Relying party derived from the request URL, so localhost and workers.dev both work. */
export function relyingParty(request: Request) {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin, secure: url.protocol === "https:" };
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function sessionTokenFrom(request: Request): string | null {
  return parseCookies(request.headers.get("cookie"))[SESSION_COOKIE] || null;
}

// --- sessions ----------------------------------------------------------------

export async function getSessionUser(db: Db, request: Request): Promise<SessionUser | null> {
  const token = sessionTokenFrom(request);
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, username: users.username, isAdmin: users.isAdmin })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, await sha256(token)), gt(sessions.expiresAt, iso(now()))));
  return row ?? null;
}

async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomToken();
  const t = now();
  await db.insert(sessions).values({
    tokenHash: await sha256(token),
    userId,
    createdAt: iso(t),
    expiresAt: iso(new Date(t.getTime() + SESSION_TTL_MS)),
  });
  return token;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
}

// --- invite / device-link tokens -----------------------------------------------

export async function createAuthToken(
  db: Db,
  opts: { kind: "invite" | "device"; userId?: string | null; grantsAdmin?: boolean; createdBy?: string | null; ttlMs: number },
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const t = now();
  const expiresAt = iso(new Date(t.getTime() + opts.ttlMs));
  await db.insert(authTokens).values({
    tokenHash: await sha256(token),
    kind: opts.kind,
    userId: opts.userId ?? null,
    grantsAdmin: opts.grantsAdmin ?? false,
    createdBy: opts.createdBy ?? null,
    createdAt: iso(t),
    expiresAt,
  });
  return { token, expiresAt };
}

async function findUsableToken(db: Db, tokenHash: string) {
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, tokenHash), isNull(authTokens.usedAt), gt(authTokens.expiresAt, iso(now()))));
  return row ?? null;
}

/** What a link is for, without consuming it (shown on the /invite and /link pages). */
export async function describeToken(db: Db, token: string) {
  const row = await findUsableToken(db, await sha256(token));
  if (!row) return { valid: false as const };
  if (row.kind === "device") {
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, row.userId ?? ""));
    if (!u) return { valid: false as const };
    return { valid: true as const, kind: "device" as const, username: u.username, expiresAt: row.expiresAt };
  }
  return { valid: true as const, kind: "invite" as const, expiresAt: row.expiresAt };
}

// --- registration (invite → new account, or device link → extra passkey) -------

export async function beginRegistration(
  db: Db,
  request: Request,
  input: { token: string; username?: string },
) {
  const { rpID } = relyingParty(request);
  await db.delete(authChallenges).where(lt(authChallenges.expiresAt, iso(now())));

  const tokenHash = await sha256(input.token);
  const link = await findUsableToken(db, tokenHash);
  if (!link) throw new AuthError("このリンクは無効か、期限が切れています。新しいリンクを発行してもらってください。", 410);

  let userId: string;
  let username: string;
  let exclude: { id: string; transports?: string[] }[] = [];
  if (link.kind === "invite") {
    username = normalizeUsername(input.username ?? "");
    if (!isValidUsername(username)) {
      throw new AuthError("ユーザー名は 2〜32 文字の半角英小文字・数字・「_ - .」で入力してください（先頭は英数字）。");
    }
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (taken) throw new AuthError("このユーザー名はすでに使われています。", 409);
    userId = crypto.randomUUID();
  } else {
    const [u] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, link.userId ?? ""));
    if (!u) throw new AuthError("このリンクは無効です。", 410);
    userId = u.id;
    username = u.username;
    exclude = (await db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, u.id))).map(p => ({
      id: p.id,
      transports: p.transports ? (JSON.parse(p.transports) as string[]) : undefined,
    }));
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: username,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: exclude,
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const challengeId = randomToken(16);
  await db.insert(authChallenges).values({
    id: challengeId,
    kind: "register",
    challenge: options.challenge,
    userId,
    data: JSON.stringify({ tokenHash, username, kind: link.kind }),
    expiresAt: iso(new Date(Date.now() + CHALLENGE_TTL_MS)),
  });
  return { challengeId, options };
}

async function takeChallenge(db: Db, id: string, kind: "register" | "login") {
  const [row] = await db.delete(authChallenges).where(and(eq(authChallenges.id, id), eq(authChallenges.kind, kind))).returning();
  if (!row || row.expiresAt < iso(now())) throw new AuthError("手続きの有効期限が切れました。もう一度お試しください。", 410);
  return row;
}

export async function finishRegistration(
  db: Db,
  request: Request,
  input: { challengeId: string; response: RegistrationResponseJSON; deviceName?: string },
): Promise<{ user: SessionUser; sessionToken: string }> {
  const { rpID, origin } = relyingParty(request);
  const challenge = await takeChallenge(db, input.challengeId, "register");
  const data = JSON.parse(challenge.data ?? "{}") as { tokenHash: string; username: string; kind: "invite" | "device" };
  const link = await findUsableToken(db, data.tokenHash);
  if (!link) throw new AuthError("このリンクは無効か、期限が切れています。", 410);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    throw new AuthError(`パスキーを確認できませんでした: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!verification.verified) throw new AuthError("パスキーを確認できませんでした。");
  const { credential } = verification.registrationInfo;

  const userId = challenge.userId!;
  const t = iso(now());
  const deviceName = (input.deviceName ?? "").trim().slice(0, 60) || null;

  // Claim the link first so it can only ever be used once, even under concurrent requests.
  const claimed = await db
    .update(authTokens)
    .set({ usedAt: t })
    .where(and(eq(authTokens.tokenHash, data.tokenHash), isNull(authTokens.usedAt)))
    .returning({ tokenHash: authTokens.tokenHash });
  if (!claimed.length) throw new AuthError("このリンクはすでに使われています。", 410);

  let isAdmin = false;
  if (data.kind === "invite") {
    isAdmin = link.grantsAdmin;
    try {
      await db.insert(users).values({ id: userId, username: data.username, isAdmin, createdAt: t });
    } catch {
      throw new AuthError("このユーザー名はすでに使われています。", 409);
    }
  } else {
    const [u] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
    isAdmin = !!u?.isAdmin;
  }

  await db.insert(passkeys).values({
    id: credential.id,
    userId,
    publicKey: base64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
    deviceName,
    createdAt: t,
    lastUsedAt: t,
  });

  const sessionToken = await createSession(db, userId);
  return { user: { id: userId, username: data.username, isAdmin }, sessionToken };
}

// --- login --------------------------------------------------------------------

export async function beginLogin(db: Db, request: Request, input: { username: string }) {
  const { rpID } = relyingParty(request);
  await db.delete(authChallenges).where(lt(authChallenges.expiresAt, iso(now())));
  const username = normalizeUsername(input.username);
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
  // Unknown usernames get the same kind of response (no allowCredentials); verification then fails.
  const creds = u
    ? await db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, u.id))
    : [];
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: creds.map(c => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
  });
  const challengeId = randomToken(16);
  await db.insert(authChallenges).values({
    id: challengeId,
    kind: "login",
    challenge: options.challenge,
    userId: u?.id ?? null,
    data: JSON.stringify({ username }),
    expiresAt: iso(new Date(Date.now() + CHALLENGE_TTL_MS)),
  });
  return { challengeId, options };
}

export async function finishLogin(
  db: Db,
  request: Request,
  input: { challengeId: string; response: AuthenticationResponseJSON },
): Promise<{ user: SessionUser; sessionToken: string }> {
  const { rpID, origin } = relyingParty(request);
  const challenge = await takeChallenge(db, input.challengeId, "login");
  const fail = () => new AuthError("ユーザー名かパスキーが正しくありません。", 401);

  const [pk] = await db.select().from(passkeys).where(eq(passkeys.id, input.response.id));
  if (!pk || !challenge.userId || pk.userId !== challenge.userId) throw fail();

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: pk.id,
        publicKey: base64urlDecode(pk.publicKey),
        counter: pk.counter,
        transports: pk.transports ? JSON.parse(pk.transports) : undefined,
      },
    });
  } catch {
    throw fail();
  }
  if (!verification.verified) throw fail();

  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: iso(now()) })
    .where(eq(passkeys.id, pk.id));
  const [u] = await db.select({ id: users.id, username: users.username, isAdmin: users.isAdmin }).from(users).where(eq(users.id, pk.userId));
  const sessionToken = await createSession(db, u.id);
  return { user: u, sessionToken };
}

function base64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- account management ---------------------------------------------------------

export async function listPasskeys(db: Db, userId: string) {
  return db
    .select({ id: passkeys.id, deviceName: passkeys.deviceName, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(passkeys.createdAt);
}

/** Removes a passkey; the last one cannot be removed (the account would be locked out). */
export async function removePasskey(db: Db, userId: string, passkeyId: string) {
  const [{ n }] = await db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, userId));
  if (n <= 1) throw new AuthError("最後のパスキーは削除できません。先に別の端末を追加してください。");
  await db.delete(passkeys).where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)));
}
