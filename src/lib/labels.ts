import type { AnnotationKind, NoteRole } from "~/db/schema";

export const ROLE_LABEL: Record<NoteRole, string> = { owner: "所有者", editor: "編集者", viewer: "閲覧者" };

export const ANNOTATION_LABEL: Record<AnnotationKind, string> = {
  syntax: "構文",
  meaning: "語義",
  argument: "論理",
  question: "質問",
  memo: "メモ",
};

export const TERM_KIND_LABEL = { term: "用語", name: "固有名詞", phrase: "定型句" } as const;
