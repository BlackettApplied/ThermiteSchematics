import { expect, it, vi } from "vitest";
vi.mock("./pdf-painted.mjs", () => ({
  paintedPdfItems: async (_p, items) => items,
}));
import {
  svgIdentifiers,
  mediaIdentifiers,
} from "./identifier-observations.mjs";
import { observation } from "./evaluate.mjs";
import { c, documents, split } from "./check4-fixture.mjs";
const svg = (x) => svgIdentifiers(x.s, x.packet, x.g, x.ir, x.tables, {});
it("CHECK4 measures mixed native document kinds independently", () => {
  const x = split(documents(), 1);
  x.tables[1] = {
    kind: "cables",
    documentId: "doc-1",
    columns: ["Cable"],
    rows: [{ key: "shared", cells: ["BB-002"] }],
  };
  Object.assign(x.g.texts[1], { documentKind: "cables", columnIndex: 0 });
  Object.assign(x.g.reportCells[1], { documentKind: "cables", columnIndex: 0 });
  expect(svg(x).extra).toEqual({});
  expect(svg(x).findings).toMatchObject([
    { kind: "identifier-line-break", identifier: "BB-002" },
  ]);
});
const pdf = (x) => ({
  getTextContent: async () => ({
    items: x.g.texts.flatMap((t) =>
      t.reportRuns.map((r) => ({
        str: r.text,
        transform: [
          1,
          0,
          0,
          7,
          (r.anchor.x * 72) / 25.4,
          (r.anchor.y * 72) / 25.4,
        ],
        width: (r.bbox.w * 72) / 25.4,
      })),
    ),
  }),
  getViewport: () => ({
    convertToViewportPoint: (a, b) => [(a * 25.4) / 72, (b * 25.4) / 72],
  }),
});
function firstDocument(g) {
  return {
    ...structuredClone(g),
    texts: g.texts.filter((t) => t.documentId === "doc-0"),
    reportCells: g.reportCells.filter((t) => t.documentId === "doc-0"),
  };
}
it("CHECK4 HTML-only additional documents are independently measured", async () => {
  const x = split(documents(), 1),
    standalone = firstDocument(x.g);
  const rows = await mediaIdentifiers(
    c,
    x.s,
    x.packet,
    standalone,
    x.g,
    x.ir,
    x.tables,
    pdf({ g: standalone }),
    {},
    observation,
  );
  expect(rows.map((r) => [r.medium, r.status])).toEqual([
    ["html", "fail"],
    ["pdf", "pass"],
  ]);
  expect(rows[0].evidence.findings).toMatchObject([{ identifier: "BB-002" }]);
});
it("CHECK4 missing HTML document geometry fails closed", async () => {
  const x = documents();
  const rows = await mediaIdentifiers(
    c,
    x.s,
    x.packet,
    x.g,
    firstDocument(x.g),
    x.ir,
    x.tables,
    pdf(x),
    {},
    observation,
  );
  expect(rows.map((r) => [r.medium, r.status])).toEqual([
    ["html", "infrastructure-error"],
    ["pdf", "pass"],
  ]);
});
it("CHECK4 HTML-kind bindings cannot borrow SVG's different document kind", async () => {
  const x = documents(),
    html = structuredClone(x.g);
  html.texts[1].documentKind = html.reportCells[1].documentKind = "cables";
  const rows = await mediaIdentifiers(
    c,
    x.s,
    x.packet,
    x.g,
    html,
    x.ir,
    x.tables,
    pdf(x),
    {},
    observation,
  );
  expect(rows.map((r) => [r.medium, r.status])).toEqual([
    ["html", "infrastructure-error"],
    ["pdf", "pass"],
  ]);
});
it("CHECK4 measures two source documents sharing row/column keys without infrastructure", () => {
  const r = svg(documents());
  expect(r.extra).toEqual({});
  expect(r.findings).toEqual([]);
});
it.each([0, 1])(
  "CHECK4 measures a split in document %s independently",
  (index) => {
    const x = split(documents(), index),
      r = svg(x);
    expect(r.extra).toEqual({});
    expect(r.findings).toMatchObject([
      { kind: "identifier-line-break", identifier: x.g.texts[index].text },
    ]);
  },
);
it("CHECK4 keeps another document's finding when one native table is missing", () => {
  const x = split(documents(), 0);
  x.tables.pop();
  const r = svg(x);
  expect(r.findings).toMatchObject([
    { kind: "identifier-line-break", identifier: "AA-001" },
  ]);
  expect(r.extra).toMatchObject({ status: "infrastructure-error" });
});
it("CHECK4 partial HTML/PDF infrastructure never erases a measured failure", async () => {
  const x = split(documents(), 0);
  x.tables.pop();
  const rows = await mediaIdentifiers(
    c,
    x.s,
    x.packet,
    x.g,
    x.g,
    x.ir,
    x.tables,
    pdf(x),
    {},
    observation,
  );
  for (const medium of ["html", "pdf"]) {
    const own = rows.filter((r) => r.medium === medium);
    expect(own.map((r) => r.status)).toEqual(["fail", "infrastructure-error"]);
    expect(own[0].evidence.findings).toMatchObject([{ identifier: "AA-001" }]);
    expect(own[1].evidence.findings).toEqual([]);
  }
});
it.each([0, 1])(
  "CHECK4 both HTML and PDF measure document %s",
  async (index) => {
    const x = split(documents(), index);
    const rows = await mediaIdentifiers(
      c,
      x.s,
      x.packet,
      x.g,
      x.g,
      x.ir,
      x.tables,
      pdf(x),
      {},
      observation,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.medium, r.status])).toEqual([
      ["html", "fail"],
      ["pdf", "fail"],
    ]);
    expect(
      rows.every(
        (r) =>
          r.evidence.findings.length === 1 &&
          r.evidence.findings[0].identifier === x.g.texts[index].text,
      ),
    ).toBe(true);
  },
);
