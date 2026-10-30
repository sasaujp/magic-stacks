import { describe, expect, it } from "vitest";
import { splitSentences } from "~/lib/segment";

describe("splitSentences", () => {
  it("splits ordinary sentences, keeping closing quotes", () => {
    expect(splitSentences('He said, "It is so." Then he left. Did he? Yes!')).toEqual(['He said, "It is so."', "Then he left.", "Did he?", "Yes!"]);
  });

  it("keeps titles, initials and Latin abbreviations inside the sentence", () => {
    expect(splitSentences("Mr. Kingsley wrote to Dr. Pusey and J. H. Newman, viz. the Tractarians. They replied.")).toEqual([
      "Mr. Kingsley wrote to Dr. Pusey and J. H. Newman, viz. the Tractarians.",
      "They replied.",
    ]);
    expect(splitSentences("This is St. Athanasius, i.e. the Father. Next.")).toEqual(["This is St. Athanasius, i.e. the Father.", "Next."]);
  });

  it("treats reference words as abbreviations only before numbers", () => {
    expect(splitSentences("See vol. 2, p. 23. It is there.")).toEqual(["See vol. 2, p. 23.", "It is there."]);
    expect(splitSentences("He spoke of no. The rest is silence.")).toEqual(["He spoke of no.", "The rest is silence."]);
  });

  it("does not split numbered headings or chapter numbers", () => {
    expect(splitSentences("1. Propositions may take a categorical form. They differ.")).toEqual([
      "1. Propositions may take a categorical form.",
      "They differ.",
    ]);
    expect(splitSentences("As shown in Chapter IV. The argument continues.")).toEqual(["As shown in Chapter IV. The argument continues."]);
  });

  it("does not split before a lowercase word", () => {
    expect(splitSentences("What then? we must ask. Truly.")).toEqual(["What then? we must ask.", "Truly."]);
  });

  it("splits after &c.", () => {
    expect(splitSentences("Books, papers, &c. These were lost.")).toEqual(["Books, papers, &c.", "These were lost."]);
  });
});
