import { describe, expect, it } from "vitest";
import { markTerms, termOccurs } from "~/lib/text";

describe("markTerms", () => {
  const terms = [
    { source: "assent", target: "承認" },
    { source: "real assent", target: "実的承認" },
  ];

  it("prefers the longer term and matches case-insensitively on word boundaries", () => {
    const parts = markTerms("Real assent differs from assent, not from assenting.", terms);
    expect(parts.filter(p => p.term).map(p => [p.text, p.term!.target])).toEqual([
      ["Real assent", "実的承認"],
      ["assent", "承認"],
    ]);
    expect(parts.map(p => p.text).join("")).toBe("Real assent differs from assent, not from assenting.");
  });

  it("returns the text unchanged without terms", () => {
    expect(markTerms("Nothing here.", [])).toEqual([{ text: "Nothing here." }]);
  });
});

describe("termOccurs", () => {
  it("matches whole words only", () => {
    expect(termOccurs("Illative Sense", "the illative  sense is")).toBe(true);
    expect(termOccurs("sense", "nonsense")).toBe(false);
  });
});
