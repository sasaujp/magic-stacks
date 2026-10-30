/**
 * Browser side of the passkey ceremonies (talks to /api/auth/*).
 */
import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `エラー (${res.status})`);
  return data;
}

function explain(e: unknown): Error {
  if (e instanceof WebAuthnError || (e instanceof Error && e.name === "NotAllowedError")) {
    return new Error("パスキーの操作がキャンセルされたか、時間切れになりました。");
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

/** A friendly default label for this device's passkey. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "この端末";
}

export async function signInWithPasskey(username: string) {
  const { challengeId, options } = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
    "login/options",
    { username },
  );
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    throw explain(e);
  }
  return post<{ user: { username: string } }>("login/verify", { challengeId, response });
}

/** Creates a passkey from an invite link (new account) or a device link (existing account). */
export async function registerPasskey(token: string, opts: { username?: string; deviceName?: string }) {
  const { challengeId, options } = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
    "register/options",
    { token, username: opts.username },
  );
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    throw explain(e);
  }
  return post<{ user: { username: string } }>("register/verify", { challengeId, response, deviceName: opts.deviceName });
}

export async function signOut() {
  await post("logout", {});
}

export async function createLink(kind: "device-link" | "invite") {
  return post<{ url: string; expiresAt: string }>(kind, {});
}

export async function describeLink(token: string) {
  const res = await fetch(`/api/auth/token?t=${encodeURIComponent(token)}`);
  return (await res.json()) as { valid: false } | { valid: true; kind: "invite" | "device"; username?: string; expiresAt: string };
}
