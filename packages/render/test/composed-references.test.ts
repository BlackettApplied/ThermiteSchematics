import { expect, it } from "vitest";
import { scopedReferenceOracle } from "./helpers/local-reference-oracle.js";
import { namespaceSheetContent } from "../src/packet/svg.js";
import { stackSections } from "../src/packet/fold-stack.js";
import { sideCandidate } from "./helpers/side-candidate.js";

function composed(markup: string) {
  const c = sideCandidate(),
    source = c.drafts[0];
  if (!source?.drawingBounds) throw Error("Missing synthetic strip");
  source.links = [];
  source.content = `<svg data-layout-config-version="test"><defs><path id="target"/></defs>${markup}</svg>`;
  const [draft] = stackSections(
    [source],
    [20],
    [[0]],
    source.drawingBounds,
    "x",
  );
  if (!draft) throw Error("Missing composed fixture");
  return `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a href="#sheet-1"/>${draft.content}</svg>`;
}
it("allows rewritten clip paths and ignores global sheet navigation", () => {
  expect(
    scopedReferenceOracle(composed('<path clip-path="url(#target)"/>')),
  ).toEqual({ sections: 1, references: 1 });
});
it.each([
  '<path fill="url(#target)"/>',
  '<use href="#target"/>',
  '<use xlink:href="#target"/>',
  '<path marker-start="url(#target)"/>',
  '<path marker-mid="url(#target)"/>',
  '<path marker-end="url(#target)"/>',
  '<path mask="url(#target)"/>',
  '<path filter="url(#target)"/>',
  "<path style=\"filter: url('#target')\"/>",
  '<style>path { fill: url("#target"); }</style>',
])(
  "rejects a synthetic reference the production scoper does not rewrite: %s",
  (markup) => {
    expect(() => scopedReferenceOracle(composed(markup))).toThrow(
      /Unscoped local reference/u,
    );
  },
);
it.each(["href", "xlink:href", "marker-start", "mask", "filter"])(
  "accepts an already scoped %s target within the owning side",
  (attribute) => {
    const value = attribute.includes("href")
      ? "#side-0-target"
      : "url(#side-0-target)";
    expect(
      scopedReferenceOracle(composed(`<use ${attribute}="${value}"/>`))
        .references,
    ).toBe(1);
  },
);
it("rejects a reference to another component even when that target exists", () => {
  const svg = composed('<use href="#side-1-target"/>').replace(
    "</svg></g>",
    '</svg></g><g transform="translate(40 0)"><svg data-layout-config-version="test"><path id="side-1-target"/></svg></g>',
  );
  expect(() => scopedReferenceOracle(svg)).toThrow(/Unscoped local reference/u);
});

it("recognizes the physical-sheet prefix without mistaking it for side scoping", () => {
  const valid = namespaceSheetContent(
    composed('<path clip-path="url(#target)"/>'),
    9,
  );
  expect(scopedReferenceOracle(valid)).toEqual({ sections: 1, references: 1 });
  const invalid = namespaceSheetContent(composed('<use href="#target"/>'), 9);
  expect(() => scopedReferenceOracle(invalid)).toThrow(
    /Unscoped local reference/u,
  );
});
