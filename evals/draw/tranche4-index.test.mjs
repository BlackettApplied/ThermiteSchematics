import { expect, it } from "vitest";
import { indexFixture, geometry4, addRow } from "./tranche4-fixtures.mjs";
import { finalIndexAudit } from "./final-index-oracle.mjs";
const audit = (x) => finalIndexAudit(x.packet, x.geometries, x.request);
it.each([true, false])(
  "N15 positive: final self-index and intentional references:%s",
  (references) => {
    const x = indexFixture({ references });
    expect(audit(x).findings).toEqual([]);
  },
);
it("N15 positive: multiple index pages and duplicate captions keep distinct sheet identities", () => {
  const x = indexFixture({ indexPages: 2 });
  x.packet.sheets[2].view.title = "Drawing index";
  expect(audit(x).findings).toEqual([]);
});
it.each([
  [
    "self page omitted",
    (x) =>
      (x.geometries[1].texts = x.geometries[1].texts.filter(
        (t) => t.row !== "2",
      )),
  ],
  [
    "reference page omitted",
    (x) =>
      (x.geometries[1].texts = x.geometries[1].texts.filter(
        (t) => t.row !== "3",
      )),
  ],
  [
    "foreign printed number",
    (x) =>
      (x.geometries[1].texts.find(
        (t) => t.row === "1" && t.columnIndex === 0,
      ).text = "99"),
  ],
  [
    "wrong part caption",
    (x) =>
      (x.geometries[1].texts.find(
        (t) => t.row === "1" && t.columnIndex === 1,
      ).text = "Wrong part"),
  ],
  [
    "hidden printed row",
    (x) => (x.geometries[1].texts.find((t) => t.row === "1").painted = false),
  ],
  ["erased row geometry", (x) => (x.geometries[1].reportCells = [])],
  ["duplicate sheet identity", (x) => (x.packet.sheets[2].number = 1)],
  ["unexpected reference page", (x) => (x.request.references = false)],
  [
    "requested index absent",
    (x) => {
      x.packet.sheets = x.packet.sheets.slice(0, 1);
      x.geometries = x.geometries.slice(0, 1);
    },
  ],
  [
    "duplicate printed row",
    (x) => addRow(x.geometries[2], "1", ["1", "Duplicate"], "other-index"),
  ],
])("N15 mutation killed: %s", (_name, mutate) => {
  const x = indexFixture();
  if (_name === "duplicate printed row") x.packet.sheets[2].view.kind = "index";
  expect(audit(x).findings).toEqual([]);
  mutate(x);
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("N15 positive: no requested index is explicit n/a, not an invented missing reference sheet", () => {
  const x = indexFixture({ references: false });
  x.request.index = false;
  x.packet.sheets = x.packet.sheets.slice(0, 1);
  x.geometries = [geometry4()];
  expect(audit(x)).toMatchObject({ findings: [], eligible: 0 });
});
it("N15 mutation killed: final issued list exceeds the existing 100-sheet bound", () => {
  const x = indexFixture({ references: false });
  for (let n = 3; n <= 101; n++) {
    x.packet.sheets.push({
      number: n,
      view: { kind: "circuit", title: "Duplicate" },
    });
    x.geometries.push(geometry4());
    addRow(x.geometries[1], String(n), [String(n), "Duplicate"], "index");
  }
  expect(audit(x).findings.map((f) => f.kind)).toContain(
    "final-index-issued-sheet-list-invalid",
  );
});

it("N15 rooted-view mutation killed: an intact numeric row cannot hide the wrong native root caption", () => {
  const x = indexFixture();
  x.packet.sheets[0].view = {
    format: "schematic-view/0.1",
    root: { designation: "K1" },
    family: "control",
  };
  const cell = x.geometries[1].texts.find(
    (t) => t.row === "1" && t.columnIndex === 1,
  );
  cell.text = "K1 / control";
  expect(audit(x).findings).toEqual([]);
  cell.text = "K2 / control";
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
