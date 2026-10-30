/**
 * Dev helper: creates a local admin account with a software passkey and prints its session cookie
 * (for driving the app from browser automation).  BASE=http://localhost:5288 tsx tests/e2e/make-session.ts <username>
 */
import { execFileSync } from "node:child_process";
import { SoftAuthenticator } from "./soft-authenticator";

const BASE = process.env.BASE ?? "http://localhost:5173";
const username = process.argv[2] ?? "dev";
const out = execFileSync("pnpm", ["--silent", "admin:invite", "--local", "--url", BASE, "--admin"], { encoding: "utf8" });
const token = out.trim().split("\n").pop()!.split("/invite/")[1];
const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
const opts = (await (await post("/api/auth/register/options", { token, username })).json()) as { challengeId: string; options: any };
const auth = new SoftAuthenticator();
const response = await auth.register(opts.options, BASE);
const res = await post("/api/auth/register/verify", { challengeId: opts.challengeId, response, deviceName: "dev" });
if (!res.ok) throw new Error(await res.text());
console.log(res.headers.get("set-cookie")!.match(/ms_session=([^;]*)/)![1]);
