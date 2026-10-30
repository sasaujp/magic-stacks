/** Groups a chapter's sentences (in reading order) into paragraphs / blocks by their `para` number. */
export function groupParagraphs<S extends { para: number; kind: string }>(sentences: readonly S[]): { para: number; kind: S["kind"]; sentences: S[] }[] {
  const out: { para: number; kind: S["kind"]; sentences: S[] }[] = [];
  for (const s of sentences) {
    const last = out.at(-1);
    if (last && last.para === s.para) last.sentences.push(s);
    else out.push({ para: s.para, kind: s.kind, sentences: [s] });
  }
  return out;
}
