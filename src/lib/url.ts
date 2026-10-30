/** A same-site path to return to after sign-in, or null. */
export function safeReturnPath(from: string | undefined | null): string | null {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return null;
  return from;
}

export const noteHref = (noteId: string) => `/notes/${noteId}`;
export const chapterHref = (noteId: string, seq: number, sentenceId?: number | null) => `/notes/${noteId}/${seq}${sentenceId ? `?s=${sentenceId}` : ""}`;
