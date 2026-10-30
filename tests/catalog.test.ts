import { describe, expect, it } from "vitest";
import { buildCatalogEntries, fold, searchTerms, titleSortKey } from "~/server/catalog";

const CSV = `Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves
24526,Text,2008-01-01,"The Idea of a University Defined and Illustrated
In Nine Discourses Delivered to the Catholics of Dublin",en,"Newman, John Henry, 1801-1890","Universities and colleges; Education, Higher",LB,Category: Philosophy & Ethics; Category: Teaching & Education
18804,Text,2006-07-10,"Prose Masterpieces, Volume 3",en,"Froude, James Anthony, 1818-1894 [Contributor]; Newman, John Henry, 1801-1890 [Contributor]",English essays,PR,
99999,Text,2020-01-01,Modern Book,en,"Someone, Alive, 1950-",Things,PR,
88888,Sound,2020-01-01,Audio Book,en,"Newman, John Henry, 1801-1890",Things,PR,
`;

describe("catalog", () => {
  const entries = buildCatalogEntries(CSV);

  it("keeps public-domain texts and splits the subtitle off the title", () => {
    expect(entries.map(e => e.textId)).toEqual([24526, 18804]);
    expect(entries[0]).toMatchObject({ title: "The Idea of a University Defined and Illustrated", subtitle: "In Nine Discourses Delivered to the Catholics of Dublin", authors: "Newman, John Henry" });
    expect(entries[0].subjects).toBe("Universities and colleges; Education, Higher; Philosophy & Ethics; Teaching & Education");
  });

  it("makes every contributor searchable in both name orders", () => {
    expect(entries[1].searchKey).toContain("john henry newman");
    expect(entries[1].searchKey).toContain("newman, john henry");
  });

  it("folds accents and ignores leading articles when sorting", () => {
    expect(fold("Œuvres de Théophile")).toBe("oeuvres de theophile");
    expect(titleSortKey("The Idea of a University")).toBe("idea of a university");
    expect(searchTerms("  Newman, Apología 50%_ ")).toEqual(["newman", "apologia", "50"]);
  });
});
