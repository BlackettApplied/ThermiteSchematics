import { expect, it } from "vitest";
import { assemblyFixture, geometry4, text } from "./tranche4-fixtures.mjs";
import { assemblyNoteAudit } from "./assembly-note-oracle.mjs";
import { assemblyAppearances } from "./assembly-appearances.mjs";
import { viewBindings } from "./tranche4-views.mjs";
import {
  assemblySelection,
  assemblyPortNeeds,
  portId,
} from "./assembly-note-source.mjs";
import { nativeRows } from "./m3-native.mjs";
const audit = (x) => assemblyNoteAudit(x.packet, x.geometries, x.ir, x.request);
function split() {
  const x = assemblyFixture(),
    g = x.geometries[0],
    other = geometry4();
  const port = g.tranche4.ports.find(
    (p) => p.deviceUid === "D" && p.key === "Y",
  );
  port.point = { x: 60, y: 40 };
  g.tranche4.ports = g.tranche4.ports.filter((p) => p !== port);
  other.tranche4.ports = [port];
  other.devices = [{ deviceUid: "D" }];
  other.navigationViews = viewBindings(x.request, x.ir);
  x.packet.sheets.push({ number: 3, view: { kind: "connector-assembly" } });
  x.geometries.push(other);
  const dest = assemblyAppearances(x.packet, x.geometries, x.ir).ports.get(
    portId("D", "Y"),
  )[0];
  g.texts.push(
    text(`Y → P2/S03.${dest.zones[0]}`, {
      deviceUid: "D",
      textContainer: "pointer",
    }),
  );
  // Part 2 points back to every native port it does not draw locally.
  for (const key of ["X"])
    other.texts.push(
      text(`${key} → S01.A1`, {
        deviceUid: "D",
        textContainer: "pointer-" + key,
      }),
    );
  return x;
}
it("S1 positive: off-part port points to actual drawn part, without an unoccupied schedule row", () => {
  const x = split(),
    a = audit(x);
  expect(a.findings).toEqual([]);
  const d = assemblyAppearances(x.packet, x.geometries, x.ir);
  const needs = assemblyPortNeeds(
    x.geometries[0],
    assemblySelection(x.request.views[0], x.ir),
    x.ir,
    nativeRows(x.ir),
    d,
  );
  expect(needs).toMatchObject([
    { kind: "drawn-port", omitted: false, identity: portId("D", "Y") },
  ]);
});
it.each([
  ["wrong sheet", (x) => (x.geometries[0].texts.at(-1).text = "Y → P2/S99.A2")],
  ["wrong zone", (x) => (x.geometries[0].texts.at(-1).text = "Y → P2/S03.D6")],
  [
    "generic destination",
    (x) => (x.geometries[0].texts.at(-1).text = "1 other ports: schedule"),
  ],
  [
    "wrong port subject",
    (x) => (x.geometries[0].texts.at(-1).text = "WRONG → P2/S03.A2"),
  ],
  [
    "destination ink erased",
    (x) => (x.geometries[2].tranche4.ports[0].texts[0].painted = false),
  ],
  [
    "destination owner forged",
    (x) => (x.geometries[2].tranche4.ports[0].deviceUid = "FOREIGN"),
  ],
  ["destination grid missing", (x) => (x.geometries[2].texts = [])],
])("S1 mutation killed: %s", (_name, mutate) => {
  const x = split();
  expect(audit(x).findings).toEqual([]);
  mutate(x);
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("S1 positive: another issued view can supply the actual port destination", () => {
  const x = split();
  x.request.views.push({
    format: "connector-assembly-view-request/0.1",
    devices: ["K1"],
  });
  x.geometries[2].navigationViews = [viewBindings(x.request, x.ir)[1]];
  // The second request independently selects CAP, so retain its drawn link once too.
  x.geometries[2].tranche4.assemblies = structuredClone(
    x.geometries[0].tranche4.assemblies,
  );
  x.geometries[2].tranche4.ports.push(
    ...structuredClone(x.geometries[0].tranche4.ports),
  );
  x.geometries[2].devices.push({ deviceUid: "E" });
  x.geometries[2].texts.push(
    text("1 authored assembly. See assembly schedule 02.A3."),
  );
  expect(audit(x).findings).toEqual([]);
});
it("N5 positive and mutations: only unoccupied ports are an applicable source selection", () => {
  const x = assemblyFixture();
  x.ir.relations = [];
  x.request.views = [
    { format: "connector-assembly-view-request/0.1", devices: ["K1"] },
  ];
  x.geometries[0].navigationViews = viewBindings(x.request, x.ir);
  x.geometries[0].tranche4.assemblies = [];
  x.geometries[0].texts = x.geometries[0].texts.filter(
    (t) => !t.text.includes("authored assembly"),
  );
  expect(audit(x)).toMatchObject({ findings: [] });
  expect(audit(x).eligible).toBeGreaterThan(0);
  x.geometries[0].navigationViews = ["unresolved"];
  expect(audit(x).findings.map((f) => f.kind)).toContain(
    "assembly-selected-device-not-issued",
  );
});
