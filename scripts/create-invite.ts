/**
 * Issues an invite link from the command line (needed for the very first, administrator account).
 *
 *   pnpm admin:invite --local  --url http://localhost:5173 --admin
 *   pnpm admin:invite --remote --url https://magic-stacks.<account>.workers.dev --admin
 *
 * Later invites can be created by an administrator on the /account page.
 */
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "--remote" : "--local";
const admin = args.includes("--admin");
const urlArg = args[args.indexOf("--url") + 1];
const days = Number(args.includes("--days") ? args[args.indexOf("--days") + 1] : 7);
if (!args.includes("--url") || !urlArg?.startsWith("http")) {
  console.error("Usage: pnpm admin:invite (--local|--remote) --url <app origin> [--admin] [--days 7]");
  process.exit(1);
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const token = b64url(webcrypto.getRandomValues(new Uint8Array(32)));
const hash = b64url(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
const now = new Date();
const expires = new Date(now.getTime() + days * 86400_000);

const sql = `INSERT INTO auth_tokens (token_hash, kind, user_id, grants_admin, created_by, created_at, expires_at)
VALUES ('${hash}', 'invite', NULL, ${admin ? 1 : 0}, 'cli', '${now.toISOString()}', '${expires.toISOString()}');`;
execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "magic-stacks", target, "--command", sql], { stdio: ["ignore", "ignore", "inherit"] });

console.log(`${admin ? "Administrator invite" : "Invite"} (${target.slice(2)}, valid ${days} days, single use):`);
console.log(`${urlArg.replace(/\/$/, "")}/invite/${token}`);
