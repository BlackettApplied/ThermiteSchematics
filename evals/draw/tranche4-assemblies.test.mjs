import { expect, it } from "vitest";
import { assemblyFixture, text, addRow } from "./tranche4-fixtures.mjs";
import { assemblyNoteAudit } from "./assembly-note-oracle.mjs";
import { nativeRows } from "./m3-native.mjs";
const audit = (x) => assemblyNoteAudit(x.packet, x.geometries, x.ir, x.request);
it("N17 positive: source-backed cap reason, sufficient row and actual target zone", () => {
  const x = assemblyFixture();
  expect(audit(x).findings).toEqual([]);
});
it.each([
  [
    "generic schedule destination",
    (x) =>
      (x.geometries[0].texts.at(-1).text =
        "1 authored assembly. See assembly schedule."),
  ],
  [
    "missing row",
    (x) =>
      (x.geometries[1].texts = x.geometries[1].texts.filter((t) => !t.row)),
  ],
  [
    "wrong port",
    (x) =>
      (x.geometries[1].texts.find((t) => t.columnIndex === 2).text =
        "K1.WRONG"),
  ],
  [
    "wrong source reason",
    (x) =>
      (x.geometries[1].texts.find((t) => t.columnIndex === 4).text =
        "documented Pin mapping: not-applicable Safe"),
  ],
  [
    "wrong destination geometry",
    (x) =>
      (x.geometries[0].texts.at(-1).text =
        "1 authored assembly. See assembly schedule 02.D6."),
  ],
  [
    "forged assembly",
    (x) => (x.geometries[0].tranche4.assemblies[0].uid = "FOREIGN"),
  ],
  [
    "erased native link",
    (x) => (x.geometries[0].tranche4.assemblies[0].ink = []),
  ],
  [
    "missing note",
    (x) =>
      (x.geometries[0].texts = x.geometries[0].texts.filter(
        (t) => !t.text.includes("authored assembly"),
      )),
  ],
  ["missing actual cells", (x) => (x.geometries[1].reportCells = [])],
  ["missing native data", (x) => delete x.ir.relations],
  [
    "missing native reason",
    (x) => delete x.ir.relations[0].assembly.pinMapping.reason,
  ],
  ["missing note geometry", (x) => delete x.geometries[0].texts.at(-1).bbox],
  [
    "displaced actual link ink",
    (x) => {
      x.geometries[0].tranche4.assemblies[0].ink = [
        [
          { x: 90, y: 90 },
          { x: 110, y: 90 },
        ],
      ];
      x.geometries[0].tranche4.assemblies[0].paths = [
        {
          ends: [
            { x: 90, y: 90 },
            { x: 110, y: 90 },
          ],
        },
      ];
    },
  ],
  [
    "invalid native selector",
    (x) => (x.request.views[0].assemblies = ["FOREIGN"]),
  ],
])("N17 mutation killed: %s", (_name, mutate) => {
  const x = assemblyFixture();
  expect(audit(x).findings).toEqual([]);
  mutate(x);
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("N17 unoccupied port positive: native status is not a fabricated assembly", () => {
  const x = assemblyFixture(),
    g = x.geometries[0],
    r = x.geometries[1];
  g.tranche4.ports = g.tranche4.ports.filter(
    (p) => !(p.deviceUid === "D" && p.key === "Y"),
  );
  g.texts.push(
    text("1 other ports: schedule 02.A3.", {
      deviceUid: "D",
      textContainer: "other",
    }),
  );
  const row = nativeRows(x.ir).find(
    (n) => n.key === JSON.stringify(["D", "Y"]) && n.kind === "assemblies",
  );
  addRow(
    r,
    row.key,
    Object.values(row.required).map((v) => v.join(" ")),
  );
  expect(audit(x).findings).toEqual([]);
  r.texts.find((t) => t.row === row.key && t.columnIndex === 3).text = "CAP";
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("N17 omitted-port mutation killed: claimed count and native port owner cannot be forged", () => {
  const x = assemblyFixture(),
    g = x.geometries[0];
  g.texts.push(text("3 other ports: schedule 02.A3.", { deviceUid: "D" }));
  expect(audit(x).findings.map((f) => f.kind)).toContain(
    "assembly-note-omitted-port-count-disagrees",
  );
});
