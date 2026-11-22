import { expect, it } from "vitest";
import { partFixture, box, text } from "./tranche4-fixtures.mjs";
import { nativePartAudit } from "./native-part-references.mjs";
import { viewBindings } from "./tranche4-views.mjs";
const audit = (x) => nativePartAudit(x.packet, x.geometries, x.ir, x.request);
it.each(["circuit", "communication"])(
  "N11 positive: reciprocal native %s parts and any spanned zone",
  (kind) => {
    const x = partFixture(kind);
    expect(audit(x).findings).toEqual([]);
    for (const g of x.geometries)
      g.tranche4.partRefs[0].texts[0].text =
        g.tranche4.partRefs[0].texts[0].text.replace("B2", "A1");
    expect(audit(x).findings).toEqual([]);
    expect(audit(x).feasibility).toHaveLength(2);
  },
);
it.each([
  ["lost native wire", (x) => (x.geometries[0].shapes = [])],
  ["erased conductor ink", (x) => (x.geometries[0].tranche3.routeInk = {})],
  [
    "broken P/S reference",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text =
        "K1.T -> P99/S99.B2"),
  ],
  [
    "wrong peer terminal",
    (x) => (x.geometries[0].tranche4.partRefs[0].terminalId = ["E", "T"]),
  ],
  [
    "wrong printed subject",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text =
        "K2.T -> P2/S02.B2"),
  ],
  [
    "missing zone",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text = "K1.T -> P2/S02"),
  ],
  [
    "wrong zone",
    (x) =>
      (x.geometries[0].tranche4.partRefs[0].texts[0].text =
        "K1.T -> P2/S02.D6"),
  ],
  ["nonreciprocal", (x) => (x.geometries[1].tranche4.partRefs = [])],
  [
    "foreign destination",
    (x) => (x.geometries[0].tranche4.partRefs[0].targetSheets = [3]),
  ],
  [
    "invented physical identity",
    (x) => {
      x.geometries[1].terminals[0].deviceUid = "CLONE";
    },
  ],
  ["missing destination grid", (x) => (x.geometries[1].texts = [])],
  ["missing native data", (x) => delete x.ir.relations],
  [
    "missing part terminal geometry",
    (x) => delete x.geometries[0].tranche4.circuitParts[0].terminals,
  ],
  [
    "invented duplicate part number",
    (x) => {
      x.geometries[1].tranche4.circuitParts[0].part = 1;
    },
  ],
  [
    "wrong view binding",
    (x) => (x.geometries[0].navigationViews = ["view/1/foreign"]),
  ],
])("N11 mutation killed: %s", (_name, mutate) => {
  const x = partFixture();
  expect(audit(x).findings).toEqual([]);
  mutate(x);
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it.each([
  [
    "lost native port link",
    (x) => (x.geometries[0].tranche4.communicationLinks = []),
  ],
  [
    "forged link",
    (x) => (x.geometries[0].tranche4.communicationLinks[0].uid = "FOREIGN"),
  ],
  ["wrong port", (x) => (x.geometries[0].tranche4.ports[0].key = "WRONG")],
  [
    "erased link",
    (x) => (x.geometries[0].tranche4.communicationLinks[0].ink = []),
  ],
  [
    "endpoint changed",
    (x) =>
      (x.geometries[0].tranche4.communicationLinks[0].ends[0].deviceUid =
        "FOREIGN"),
  ],
  [
    "missing port geometry",
    (x) => delete x.geometries[1].tranche4.ports[0].point,
  ],
])("N11 network mutation killed: %s", (_name, mutate) => {
  const x = partFixture("communication");
  expect(audit(x).findings).toEqual([]);
  mutate(x);
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("N11 positive: distinct parts can share a sheet; target identity is part and sheet", () => {
  const x = partFixture();
  x.packet.sheets = x.packet.sheets.slice(0, 1);
  const [a, b] = x.geometries;
  a.tranche4.circuitParts.push(...b.tranche4.circuitParts);
  a.tranche4.partRefs.push(...b.tranche4.partRefs);
  a.tranche4.partRefs[0].texts[0].text = "K1.T -> P2/S01.B2";
  a.tranche4.partRefs[1].texts[0].text = "K1.T -> P1/S01.B2";
  a.tranche4.partRefs.forEach((r) => (r.targetSheets = [1]));
  x.geometries = [a];
  expect(audit(x).findings).toEqual([]);
});
it("N11 view binding: duplicate titles cannot merge or swap native selections", () => {
  const x = partFixture();
  x.request.views[0].title = "Same";
  const other = structuredClone(x.request.views[0]);
  other.groups[0].id = "Other";
  other.title = "Same";
  x.request.views.push(other);
  const keys = viewBindings(x.request, x.ir);
  expect(keys[0]).not.toBe(keys[1]);
  const duplicate = viewBindings({ views: [other, other] }, x.ir);
  expect(duplicate[0]).not.toBe(duplicate[1]);
});

it("N11 mutation killed: painted link displaced from actual native ports", () => {
  const x = partFixture("communication");
  x.geometries[0].tranche4.communicationLinks[0].ink = [
    [
      { x: 90, y: 90 },
      { x: 110, y: 90 },
    ],
  ];
  x.geometries[0].tranche4.communicationLinks[0].paths = [
    {
      ends: [
        { x: 90, y: 90 },
        { x: 110, y: 90 },
      ],
    },
  ];
  expect(audit(x).findings.map((f) => f.kind)).toContain(
    "native-part-port-link-disagrees",
  );
});
