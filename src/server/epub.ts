/**
 * Project Gutenberg EPUB → chapters of text blocks (headings, paragraphs, quotes, notes).
 *
 * Adapted from box-maison's epubExtract (regex only: Workers have no DOMParser). Differences:
 * - text and illustrations only (tables and code are skipped: they are not translated sentence by sentence);
 * - chapters follow the book's headings, not the EPUB spine (Gutenberg splits files by size, and
 *   TEI-derived books such as Newman's put several discourses in one file);
 * - page markers like "[pg 002]" and footnote anchors are removed from the running text.
 */
import { strFromU8, unzipSync } from "fflate";

export type BlockKind = "p" | "heading" | "quote" | "note" | "image";
export interface Block {
  kind: BlockKind;
  /** Text; for images the caption or alt text (may be empty). */
  text: string;
  /** Heading level 1–6 (headings only). */
  level?: number;
  /** Images: path inside the EPUB (after extractEpub), or the raw src (from parseXhtmlBlocks). */
  src?: string;
}
export interface EpubImage {
  path: string;
  bytes: Uint8Array;
  contentType: string;
}
export interface ParsedChapter {
  title: string;
  blocks: Block[];
}
export interface ParsedBook {
  title: string | null;
  author: string | null;
  language: string | null;
  chapters: ParsedChapter[];
  /** Illustrations referenced by image blocks (by `src` path), in order of first use. */
  images: EpubImage[];
  /** The EPUB's cover image (OPF cover-image / meta cover), if any. */
  cover: EpubImage | null;
}

const MAX_TEXT_BYTES = 48 * 1024 * 1024;
export const MAX_IMAGES = 120;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024;
/** Smaller files are ornaments (rules, drop-cap letters, bullets), not illustrations. */
const MIN_IMAGE_BYTES = 3 * 1024;
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
export const imageExt = (path: string): string | null => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext in IMAGE_TYPES ? (ext === "jpeg" ? "jpg" : ext) : null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/g, (m, name: string) => ENTITIES[name] ?? m);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`)) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`));
  return m ? m[1] : null;
}

/** OPF-relative href → path inside the zip (resolves ../ and URL escapes). */
function resolveHref(baseDir: string, href: string): string {
  let decoded = href.split("#")[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep malformed escapes as they are
  }
  const out: string[] = [];
  for (const p of (baseDir + decoded).split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Inline HTML → plain text: drops page markers and note anchors, keeps <br> as a space. */
export function inlineText(html: string): string {
  return decodeEntities(
    html
      // TEI page breaks: <span class="tei tei-pb" id="page002">[pg 002]</span>
      .replace(/<span\b[^>]*class="[^"]*\b(?:tei-pb|pagenum|pageno)\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, " ")
      // footnote references: <a … class="noteref">1</a>, <sup><a href="#note…">…</a></sup>
      .replace(/<sup\b[^>]*>\s*<a\b[^>]*>[\s\S]*?<\/a>\s*<\/sup>/g, "")
      .replace(/<a\b[^>]*(?:class="[^"]*\b(?:noteref|fnanchor|tei-ref)\b[^"]*"|epub:type="noteref")[^>]*>[\s\S]*?<\/a>/g, "")
      .replace(/<br\b[^>]*\/?>/g, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\[(?:pg|Pg|p\.|Page)\s*[\divxlc]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One XHTML document of the spine → flat list of blocks. */
export function parseXhtmlBlocks(html: string): Block[] {
  let body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? html;
  body = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "");
  body = body.replace(/\s+/g, " ");

  // Project Gutenberg boilerplate: metadata before START, licence after END.
  const pgStart = body.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
  if (pgStart?.index !== undefined) body = body.slice(pgStart.index + pgStart[0].length);
  const pgEnd = body.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (pgEnd?.index !== undefined) body = body.slice(0, pgEnd.index);
  // Gutenberg's own header/footer sections (pg-header / pg-footer) when the markers are absent.
  body = body.replace(/<(section|div)\b[^>]*id="pg-(?:header|footer)"[^>]*>[\s\S]*?<\/\1>/g, "");

  // Footnotes (EPUB3 asides and TEI/HTML note blocks) leave the flow and go to the end of the document.
  const footnotes: Block[] = [];
  body = body.replace(
    /<(aside|div|p)\b[^>]*(?:epub:type="[^"]*(?:footnote|endnote|rearnote)[^"]*"|class="[^"]*\b(?:footnote|tei-note)\b[^"]*")[^>]*>([\s\S]*?)<\/\1>/g,
    (_w, _tag: string, inner: string) => {
      const text = inlineText(inner);
      if (text) footnotes.push({ kind: "note", text });
      return " ";
    },
  );

  // <figure> / div.figure: the caption becomes the image's alt text (and is not repeated as a paragraph).
  body = body.replace(/<(figure|div)\b([^>]*)>([\s\S]*?)<\/\1>/g, (whole, tag: string, attrs: string, inner: string) => {
    if (tag === "div" && !/class="[^"]*\b(?:figure|fig|illustration|tei-figure)\b/.test(attrs)) return whole;
    const img = inner.match(/<img\b[^>]*>/)?.[0];
    if (!img || /<(?:figure|div)\b/.test(inner)) return whole;
    const cap = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/)?.[1] ?? inner.match(/<p\b[^>]*class="[^"]*caption[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    const caption = cap ? inlineText(cap) : "";
    return caption ? img.replace(/\s*\/?>$/, ` data-caption="${caption.replace(/"/g, "&quot;")}"/>`) : img;
  });

  const blocks: Block[] = [];
  const imageBlock = (tag: string): Block | null => {
    const src = attr(tag, "src") ?? attr(tag, "xlink:href") ?? attr(tag, "href");
    if (!src || /^(?:https?:|data:)/i.test(src)) return null;
    const caption = attr(tag, "data-caption") ?? attr(tag, "alt") ?? "";
    // Gutenberg's placeholder alt text carries no information.
    const text = decodeEntities(caption).replace(/^(?:\[?(?:illustration|image|cover|decoration)\]?:?\s*)$/i, "").trim();
    return { kind: "image", text, src };
  };
  const blockRe =
    /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>|<(ol|ul)\b[^>]*>([\s\S]*?)<\/\5>|<div\b[^>]*class="[^"]*\b(?:chapter|tei-lg|poem|stanza)\b[^"]*"[^>]*>([\s\S]*?)<\/div>|<img\b[^>]*>|<image\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body)) !== null) {
    const [, hTag, hInner, pInner, quoteInner, listTag, listInner, divInner] = m;
    if (m[0].startsWith("<img") || m[0].startsWith("<image")) {
      const img = imageBlock(m[0]);
      if (img) blocks.push(img);
    } else if (hTag !== undefined) {
      const text = inlineText(hInner);
      if (text) blocks.push({ kind: "heading", text, level: Number(hTag[1]) });
    } else if (pInner !== undefined) {
      // Illustrations inside a paragraph come first (inlineText drops the tags).
      for (const tag of pInner.match(/<img\b[^>]*>/g) ?? []) {
        const img = imageBlock(tag);
        if (img) blocks.push(img);
      }
      const text = inlineText(pInner);
      if (text) blocks.push({ kind: "p", text });
    } else if (quoteInner !== undefined) {
      // Paragraphs inside a quotation stay separate quote blocks.
      const parts = [...quoteInner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(x => inlineText(x[1])).filter(Boolean);
      for (const text of parts.length ? parts : [inlineText(quoteInner)].filter(Boolean)) blocks.push({ kind: "quote", text });
    } else if (listTag !== undefined) {
      for (const li of listInner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)) {
        const text = inlineText(li[1]);
        if (text) blocks.push({ kind: "p", text });
      }
    } else if (divInner !== undefined) {
      // A wrapper div: keep scanning inside it. Otherwise (div.chapter "CHAPTER I", verse lines) take its text.
      if (/<(p|h[1-6]|div|blockquote|ol|ul)\b/.test(divInner)) {
        blockRe.lastIndex = m.index + m[0].indexOf(">") + 1;
        continue;
      }
      const text = inlineText(divInner);
      if (text) blocks.push(/class="[^"]*\bchapter\b/.test(m[0]) ? { kind: "heading", text, level: 2 } : { kind: "quote", text });
    }
  }
  return [...blocks, ...footnotes];
}

/** Chapters should be readable in one sitting: aim for at most this many paragraphs on average. */
const TARGET_BLOCKS_PER_CHAPTER = 80;

/**
 * The shallowest heading level (among levels used at least twice, so a lone h1 title is ignored)
 * at which chapters average ≤ TARGET_BLOCKS_PER_CHAPTER paragraphs. Parts (h2) with chapters (h3)
 * therefore split at the chapters, while discourses (h2) with numbered sections (h3) split at h2.
 */
export function chooseSplitLevel(blocks: Block[]): number {
  const counts = new Map<number, number>();
  for (const b of blocks) if (b.kind === "heading") counts.set(b.level ?? 2, (counts.get(b.level ?? 2) ?? 0) + 1);
  const levels = [...counts.entries()].filter(([l, n]) => n >= 2 && l <= 4).map(([l]) => l).sort((a, b) => a - b);
  const textBlocks = blocks.filter(b => b.kind !== "heading").length;
  let headings = 0;
  for (const l of levels) {
    headings = [...counts.entries()].filter(([k]) => k <= l).reduce((s, [, n]) => s + n, 0);
    if (textBlocks / headings <= TARGET_BLOCKS_PER_CHAPTER) return l;
  }
  return levels.at(-1) ?? 2;
}

/**
 * Flat blocks → chapters. A heading of level ≤ splitLevel starts a chapter; consecutive headings
 * with no text between them form one title ("University Teaching. / Discourse I. / Introductory.").
 * See chooseSplitLevel for which headings count as chapter breaks.
 */
export function buildChapters(blocks: Block[], bookTitle: string | null): ParsedChapter[] {
  const splitLevel = chooseSplitLevel(blocks);

  const chapters: ParsedChapter[] = [];
  let current: ParsedChapter | null = null;
  let pendingTitle: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

  for (const b of blocks) {
    if (b.kind === "heading" && (b.level ?? 2) <= splitLevel) {
      // Skip a repeated book title at the very start.
      if (!chapters.length && !current && bookTitle && norm(b.text) === norm(bookTitle)) continue;
      pendingTitle.push(b.text);
      continue;
    }
    if (pendingTitle.length) {
      current = { title: pendingTitle.join(" / "), blocks: [] };
      chapters.push(current);
      pendingTitle = [];
    }
    if (!current) {
      current = { title: "前付け", blocks: [] };
      chapters.push(current);
    }
    current.blocks.push(b);
  }
  return chapters.filter(c => c.blocks.some(b => b.kind !== "heading"));
}

export function extractEpub(bytes: Uint8Array): ParsedBook {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: f => {
        if (!/\.(x?html?|opf|xml)$/i.test(f.name)) return false;
        total += Math.max(f.originalSize, f.size);
        if (total > MAX_TEXT_BYTES) throw new Error("epub_too_large");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "epub_too_large") throw new Error("EPUB が大きすぎます。");
    throw new Error("EPUB を読み取れませんでした。");
  }

  const container = files["META-INF/container.xml"];
  const rootfile = container ? strFromU8(container).match(/<rootfile\b[^>]*>/)?.[0] : undefined;
  const opfPath = rootfile ? attr(rootfile, "full-path") : null;
  const opfBytes = opfPath ? files[opfPath] : undefined;
  if (!opfPath || !opfBytes) throw new Error("EPUB を読み取れませんでした（OPF がありません）。");
  const opf = strFromU8(opfBytes);
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const meta = (re: RegExp) => {
    const t = opf.match(re)?.[1];
    return t ? inlineText(t) || null : null;
  };
  const title = meta(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/);
  const creators = [...opf.matchAll(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/g)].map(x => inlineText(x[1])).filter(Boolean);
  const language = meta(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/)?.toLowerCase() ?? null;

  const manifest = new Map<string, { href: string; mediaType: string | null; properties: string | null }>();
  for (const m of opf.matchAll(/<item\b[^>]*\/?>/g)) {
    const id = attr(m[0], "id");
    const href = attr(m[0], "href");
    if (id && href) manifest.set(id, { href, mediaType: attr(m[0], "media-type"), properties: attr(m[0], "properties") });
  }

  const blocks: Block[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*\/?>/g)) {
    const idref = attr(m[0], "idref");
    if (!idref || attr(m[0], "linear") === "no") continue;
    if (/^(pg-header|pg-footer|coverpage)/.test(idref)) continue;
    const item = manifest.get(idref);
    if (!item || (item.mediaType && !/xhtml|html/.test(item.mediaType))) continue;
    if (item.properties?.split(/\s+/).includes("nav")) continue;
    const docPath = resolveHref(opfDir, item.href);
    const doc = files[docPath];
    if (!doc) continue;
    const docDir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/") + 1) : "";
    for (const b of parseXhtmlBlocks(strFromU8(doc))) {
      // Image src is relative to the chapter document → path inside the zip.
      if (b.kind === "image") b.src = resolveHref(docDir, b.src!);
      blocks.push(b);
    }
  }

  // Cover: EPUB 3 properties="cover-image", else EPUB 2 <meta name="cover" content="<item id>">.
  const coverId =
    [...manifest.entries()].find(([, v]) => v.properties?.split(/\s+/).includes("cover-image"))?.[0] ??
    (opf.match(/<meta\b[^>]*name="cover"[^>]*>/)?.[0] ? attr(opf.match(/<meta\b[^>]*name="cover"[^>]*>/)![0], "content") : null);
  const coverHref = coverId ? manifest.get(coverId)?.href : undefined;
  const coverPath = coverHref ? resolveHref(opfDir, coverHref) : null;

  const images = extractImages(bytes, blocks, coverPath);
  const cover = coverPath ? (images.find(i => i.path === coverPath) ?? null) : null;
  const illustrations = images.filter(i => i.path !== coverPath || blocks.some(b => b.src === coverPath));
  const kept = new Set(illustrations.map(i => i.path));
  const finalBlocks = blocks.filter(b => b.kind !== "image" || kept.has(b.src!));
  return { title, author: creators.length ? creators.join(", ") : null, language, chapters: buildChapters(finalBlocks, title), images: illustrations, cover };
}

/** Second pass: inflate only the images the text refers to, within the limits (ornaments dropped). */
function extractImages(bytes: Uint8Array, blocks: Block[], coverPath: string | null): EpubImage[] {
  const wanted: string[] = [];
  if (coverPath && imageExt(coverPath)) wanted.push(coverPath);
  for (const b of blocks) if (b.kind === "image" && imageExt(b.src!) && !wanted.includes(b.src!)) wanted.push(b.src!);
  if (!wanted.length) return [];
  const take = new Set(wanted.slice(0, MAX_IMAGES * 2));
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: f => {
        if (!take.has(f.name) || f.originalSize > MAX_IMAGE_BYTES) return false;
        if (f.originalSize < MIN_IMAGE_BYTES && f.name !== coverPath) return false;
        if (total + f.originalSize > MAX_TOTAL_IMAGE_BYTES) return false;
        total += f.originalSize;
        return true;
      },
    });
  } catch {
    return []; // broken images: keep the text
  }
  return wanted
    .filter(p => files[p])
    .slice(0, MAX_IMAGES + 1)
    .map(path => ({ path, bytes: files[path], contentType: IMAGE_TYPES[imageExt(path)!] }));
}
