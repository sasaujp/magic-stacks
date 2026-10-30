/** Serves an R2 object of a book (cover / illustration) with long-lived private caching. */
import { env } from "cloudflare:workers";

export async function serveObject(key: string, request: Request) {
  if (!/^books\/\d+\/[\w./-]+$/.test(key) || key.includes("..")) return new Response("Not found", { status: 404 });
  const obj = await env.BUCKET.get(key, { onlyIf: request.headers });
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  // onlyIf matched the ETag → the body is absent; the browser's copy is current.
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  return new Response((obj as R2ObjectBody).body, { headers });
}
