import { expect, it } from "vitest";
import { indexFixture } from "./tranche4-fixtures.mjs";
import { finalIndexAudit } from "./final-index-oracle.mjs";
const audit = (x) => finalIndexAudit(x.packet, x.geometries, x.request);
const cell = (x, number) =>
  x.geometries[1].texts.find(
    (t) => t.row === String(number) && t.columnIndex === 1,
  );
it("SF1 positive: repeated final titles require each row's own issued-sheet qualifier", () => {
  const x = indexFixture({ indexPages: 2 });
  expect(audit(x).findings).toEqual([]);
  expect(cell(x, 2).text).toBe("Drawing index (sheet 02)");
  expect(cell(x, 3).text).toBe("Drawing index (sheet 03)");
});
it.each([
  ["missing qualifier", 2, "Drawing index"],
  ["wrong NN", 2, "Drawing index (sheet 03)"],
  ["unqualified zero padding", 2, "Drawing index (sheet 2)"],
  ["qualifier on a unique title", 1, "Duplicate (sheet 01)"],
])("SF1 mutation killed: %s", (_name, number, value) => {
  const x = indexFixture({ indexPages: 2 });
  expect(audit(x).findings).toEqual([]);
  cell(x, number).text = value;
  expect(audit(x).findings.map((f) => f.kind)).toEqual([
    "final-index-view-caption-disagrees",
  ]);
});
it("SF1 counts issued captions, never damaged printed captions, to decide repetition", () => {
  const x = indexFixture({ indexPages: 2 });
  cell(x, 2).text = "Unique";
  cell(x, 3).text = "Drawing index";
  expect(audit(x).findings).toHaveLength(2);
});
