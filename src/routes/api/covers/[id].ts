/** A book's cover by book id (the R2 key's extension varies). 404 → the client draws a typographic cover. */
import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";
import { books } from "~/db/schema";
import { getDb } from "~/server/db";
import { serveObject } from "~/server/images";

export async function GET(event: APIEvent) {
  const [book] = await getDb().select({ coverKey: books.coverKey }).from(books).where(eq(books.id, Number(event.params.id)));
  if (!book?.coverKey) return new Response("Not found", { status: 404 });
  const res = await serveObject(book.coverKey, event.request);
  // The cover can be added later (ensureCover), so revalidate instead of caching forever.
  res.headers.set("Cache-Control", "private, max-age=3600");
  return res;
}
