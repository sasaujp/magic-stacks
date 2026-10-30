/**
 * Book images from R2 (covers and illustrations under books/<id>/). Signed-in users only
 * (src/middleware.ts guards /api/*). Keys never change content, so they are cached for long.
 */
import type { APIEvent } from "@solidjs/start/server";
import { serveObject } from "~/server/images";

export async function GET(event: APIEvent) {
  return serveObject(event.params.key ?? "", event.request);
}
