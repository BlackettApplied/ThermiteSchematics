import { expect, it } from "vitest";
import { navigationStrictObservations } from "./navigation-strict.mjs";
import { elementFixture, portFixture } from "./check5-navigation-fixture.mjs";
import { observation } from "./evaluate.mjs";
import { exitCode } from "./assessment.mjs";
const rows = (x) =>
  navigationStrictObservations(
    { id: "fixture" },
    x.packet,
    x.geometries,
    x.ir,
    x.request,
    observation,
  );
const own = (x, owner) => rows(x).filter((r) => r.owner === owner);
function elements() {
  const x = elementFixture();
  x.ir.terminals = x.ir.functions.flatMap((f) =>
    f.terminals.map((id) => ({ id })),
  );
  return x;
}
it("CHECK6 valid empty native navigation population is n/a, never a vacuous pass row", () => {
  const x = elements();
  x.ir.functions.forEach((f) => (f.kind = "channel"));
  x.ir.deviceTypes[0].circuitSymbols = {};
  x.geometries.forEach(
    (g) => (g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"))),
  );
  expect(rows(x)).toEqual([]);
});
it.each([
  ["#396", elements, (x) => delete x.ir.functions],
  ["#396", elements, (x) => (x.geometries[1] = null)],
  ["#398", portFixture, (x) => delete x.ir.relations],
  ["#398", portFixture, (x) => delete x.geometries[1].tranche4],
])(
  "CHECK6 missing native data/ink for %s remains infrastructure",
  (owner, make, mutate) => {
    const x = make();
    mutate(x);
    const r = own(x, owner);
    expect(r.some((r) => r.status === "infrastructure-error")).toBe(true);
    expect(exitCode(r)).toBe(2);
    expect(r.every((r) => r.status !== "pass")).toBe(true);
  },
);
it("CHECK6 partial zone measurement failure cannot relabel an observed drawing defect", () => {
  const x = elements();
  x.packet.sheets.push({ ...structuredClone(x.packet.sheets[0]), number: 3 });
  x.geometries.push(structuredClone(x.geometries[0]));
  x.geometries[2].texts = x.geometries[2].texts.filter((t) => !t.sheetText);
  x.geometries[1].texts.find((t) => t.element === "nav-pole1").text =
    "WRONG pole → 01.A1";
  const r = own(x, "#396");
  expect(
    r.some((r) => r.sheet === 2 && r.status === "infrastructure-error"),
  ).toBe(true);
  expect(r.some((r) => r.sheet === 2 && r.status === "fail")).toBe(true);
  expect(exitCode(r)).toBe(2);
});
it("CHECK6 clean strict rows retain native obligations and stable distinct criterion IDs", () => {
  for (const [x, owner, n] of [
    [elements(), "#396", 6],
    [portFixture(), "#398", 10],
  ]) {
    const r = own(x, owner);
    expect(
      r.every(
        (r) => r.status === "pass" && r.dq === "DQ-08" && r.repinNow === false,
      ),
    ).toBe(true);
    expect(r.flatMap((r) => r.evidence.obligations)).toHaveLength(n);
    expect(new Set(r.map((r) => r.id)).size).toBe(r.length);
  }
});
