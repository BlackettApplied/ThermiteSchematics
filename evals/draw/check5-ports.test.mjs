import { expect, it } from "vitest";
import { portFixture } from "./check5-navigation-fixture.mjs";
import { portNavigationAudit } from "./port-navigation-oracle.mjs";
import { navigationExposure } from "./navigation-exposure-rows.mjs";
const audit = (x) =>
    portNavigationAudit(x.packet, x.geometries, x.ir, x.request),
  problems = (x) => {
    const a = audit(x);
    return [...a.findings, ...a.failures];
  };
it("CHECK5 branched device has ten per-port obligations, reciprocal and source-bound", () => {
  const x = portFixture();
  expect(problems(x)).toEqual([]);
  expect(audit(x).obligations).toHaveLength(10);
});
it.each([
  [
    "device-only valid zone",
    (x) =>
      x.geometries.forEach((g) =>
        g.tranche4.partRefs.forEach(
          (r) =>
            (r.texts[0].text = r.texts[0].text.replace(
              /N05\.[A-Z0-9]+/u,
              "N05",
            )),
        ),
      ),
  ],
  [
    "IN/B1 swapped destinations",
    (x) => {
      x.geometries[0].tranche4.partRefs[0].texts[0].text = "N05.IN → P1/S01.A1";
      x.geometries[1].tranche4.partRefs[0].texts[0].text = "N05.B1 → P2/S02.C3";
    },
  ],
  [
    "omitted B2 branch",
    (x) =>
      (x.geometries[1].tranche4.partRefs =
        x.geometries[1].tranche4.partRefs.filter(
          (r) => r.element !== "ref-B2",
        )),
  ],
  [
    "forged port name",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text =
        "N05.FAKE → P2/S02.C3"),
  ],
  [
    "correct sheet wrong port zone",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text =
        "N05.IN → P2/S02.D5"),
  ],
  [
    "hidden target",
    (x) =>
      (x.geometries[1].tranche4.ports.find((p) => p.deviceUid === "N").painted =
        false),
  ],
  [
    "hidden target label",
    (x) =>
      (x.geometries[1].tranche4.ports.find((p) => p.deviceUid === "N").texts =
        []),
  ],
  ["erased reverse", (x) => (x.geometries[1].tranche4.partRefs = [])],
  [
    "metadata without ink",
    (x) => {
      x.geometries[0].tranche4.partRefs[0].texts = [];
      Object.assign(x.geometries[0].tranche4.partRefs[0], {
        targetSheets: [2],
        targetParts: [2],
        port: "IN",
        correct: true,
      });
    },
  ],
  [
    "anonymous pointers",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text =
        "See P2/S02.C3, P3/S03.D5"),
  ],
  [
    "multi-port anonymous association",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text =
        "N05.IN, N05.OUT → P2/S02.C3, P3/S03.D5"),
  ],
  ["missing native source", (x) => delete x.ir.relations],
  [
    "unresolved request selection",
    (x) => (x.request.views[0].devices = ["UNKNOWN"]),
  ],
  ["missing measured ports", (x) => delete x.geometries[1].tranche4],
])("CHECK5 per-port adversary: %s", (_name, mutate) => {
  const x = portFixture();
  expect(problems(x)).toEqual([]);
  mutate(x);
  expect(problems(x).length).toBeGreaterThan(0);
});
it("CHECK5 an unoccupied or unselected port drawn nowhere adds no false obligation", () => {
  const x = portFixture();
  expect(audit(x).obligations.some((o) => o.portKey === "SPARE")).toBe(false);
  expect(problems(x)).toEqual([]);
});
it("CHECK5 any zone spanned by the actual port ink is accepted, not its device body", () => {
  const x = portFixture(),
    p = x.geometries[1].tranche4.ports.find((p) => p.deviceUid === "N");
  p.bbox = { x: 59, y: 74, w: 12, h: 2 };
  x.geometries[0].tranche4.partRefs.find(
    (r) => r.element === "ref-IN",
  ).texts[0].text = "N05.IN → P2/S02.C2";
  expect(problems(x)).toEqual([]);
});
it("CHECK5 exposure remains separate from strict results and carries every owner", () => {
  const x = portFixture();
  x.geometries[1].tranche4.partRefs = [];
  const rows = navigationExposure(x.packet, x.geometries, x.ir, x.request);
  expect(rows.some((r) => r.assessment === "fail")).toBe(true);
  expect(rows.every((r) => r.strict === false && r.repinNow === false)).toBe(
    true,
  );
});
it("CHECK5 one port can have multiple measured destinations, with deliberate boundary copies", () => {
  const x = portFixture(),
    p = structuredClone(
      x.geometries[0].tranche4.ports.find(
        (p) => p.deviceUid === "N" && p.key === "B1",
      ),
    );
  x.geometries[1].tranche4.ports.push(p);
  x.geometries[2].tranche4.partRefs.find(
    (r) => r.element === "ref-B1",
  ).texts[0].text = "N05.B1 → P1/S01.A1, P2/S02.A1";
  expect(problems(x)).toEqual([]);
});
