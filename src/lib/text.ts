/** A piece of a sentence: plain text, or an occurrence of a translation-memory term. */
export type TextPart = { text: string; term?: { source: string; target: string } };

/**
 * Marks whole-word, case-insensitive occurrences of the given terms. Longer terms win where they
 * overlap ("real assent" before "assent").
 */
export function markTerms(text: string, terms: readonly { source: string; target: string }[]): TextPart[] {
  const hits: { start: number; end: number; term: { source: string; target: string } }[] = [];
  const sorted = [...terms].filter(t => t.source.trim()).sort((a, b) => b.source.length - a.source.length);
  for (const term of sorted) {
    const escaped = term.source.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, "giu");
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (hits.some(h => start < h.end && end > h.start)) continue;
      hits.push({ start, end, term });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const parts: TextPart[] = [];
  let i = 0;
  for (const h of hits) {
    if (h.start > i) parts.push({ text: text.slice(i, h.start) });
    parts.push({ text: text.slice(h.start, h.end), term: h.term });
    i = h.end;
  }
  if (i < text.length) parts.push({ text: text.slice(i) });
  return parts;
}

/**
 * Character offsets of the current selection inside `root` (whose text content is the sentence),
 * or null when nothing (or something outside `root`) is selected.
 */
export function selectionOffsets(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  // Trim surrounding whitespace from the selection.
  const text = root.textContent ?? "";
  let a = start;
  let b = end;
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  return b > a ? [a, b] : null;
}

/** Whole-word, case-insensitive occurrence of a term in a text. */
export function termOccurs(source: string, text: string): boolean {
  return markTerms(text, [{ source, target: "" }]).some(p => p.term);
}
