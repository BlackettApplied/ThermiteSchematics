import { expect, it } from "vitest";
import {
  assemblyDeliveryFindings,
  portNoteNeeds,
  portSubjects,
} from "./assembly-note-delivery.mjs";
import { assemblyFixture, text } from "./tranche4-fixtures.mjs";
import { assemblyNoteAudit } from "./assembly-note-oracle.mjs";
const need = (key, sheet, zone) => ({
  uid: "R1",
  owner: "R1",
  key,
  kind: "drawn-port",
  identity: "R1:" + key,
  targets: [{ sheet, zones: [zone] }],
});
const needs = [need("X10", 2, "C4"), need("X11", 3, "B2")];
const note = (value, deviceUid = "R1") => text(value, { deviceUid });
it.each(["2 other ports:", "Other parts:"])(
  "B1 positive and swapped/anonymous mutations: %s",
  (header) => {
    const correct = note(`${header} X10 → S2.C4; X11 → S3.B2`);
    const selected = portNoteNeeds(correct, needs);
    expect(selected).toEqual(needs);
    expect(assemblyDeliveryFindings(correct, selected, [], 1)).toEqual([]);
    const swapped = note(`${header} X10 → S3.B2; X11 → S2.C4`);
    const f = assemblyDeliveryFindings(
      swapped,
      portNoteNeeds(swapped, needs),
      [],
      1,
    );
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({
      nativePort: "R1:X10",
      printedTargets: [{ sheet: 3, zone: "B2" }],
    });
    expect(f[1]).toMatchObject({
      nativePort: "R1:X11",
      printedTargets: [{ sheet: 2, zone: "C4" }],
    });
    const anonymous = note(`${header} see S2.C4, S3.B2`);
    expect(
      assemblyDeliveryFindings(
        anonymous,
        portNoteNeeds(anonymous, needs),
        [],
        1,
      ),
    ).toHaveLength(2);
  },
);
it("B1 unbound other-parts footer uses native-qualified subjects", () => {
  const n = note("Other parts: R1.X10 → S2.C4; R1:X11 → S3.B2");
  delete n.deviceUid;
  expect(assemblyDeliveryFindings(n, needs, [], 1)).toEqual([]);
  n.text = "Other parts: R1.X10 → S3.B2; R1:X11 → S2.C4";
  expect(assemblyDeliveryFindings(n, needs, [], 1)).toHaveLength(2);
  n.text = "Other parts: X10 → S2.C4; X11 → S3.B2";
  expect(assemblyDeliveryFindings(n, needs, [], 1)).toHaveLength(2);
});
it("B1 retains single-port targets and accepts any genuine spanned destination zone", () => {
  const one = { ...needs[0], targets: [{ sheet: 2, zones: ["C4", "C5"] }] };
  const n = note("X10 → S2.C5");
  expect(portSubjects(n, [one])).toEqual([one]);
  expect(assemblyDeliveryFindings(n, [one], [], 1)).toEqual([]);
  n.text = "X10 → S99.Z9; S2.C5";
  expect(assemblyDeliveryFindings(n, [one], [], 1)).toEqual([]);
  n.text = "X10 → S3.B2";
  expect(assemblyDeliveryFindings(n, [one], [], 1)).toHaveLength(1);
});
it("B1 rejects borrowed targets even when two arrows lack a subject delimiter", () => {
  const n = note("2 other ports: X10 → S3.B2, X11 → S2.C4");
  expect(assemblyDeliveryFindings(n, needs, [], 1)).toHaveLength(2);
});
it("B1 a single sufficient schedule zone may serve multiple native row needs", () => {
  const rows = ["a", "b"].map((key) => ({
    kind: "assemblies",
    key,
    visible: true,
    sheet: 2,
    zones: ["C4"],
    cells: { 0: key },
  }));
  const rowNeeds = rows.map((r) => ({
    kind: "reason-row",
    row: {
      kind: r.kind,
      key: r.key,
      required: { 0: [r.key] },
      exactColumns: [0],
    },
  }));
  expect(
    assemblyDeliveryFindings(
      note("See assembly schedule S2.C4"),
      rowNeeds,
      rows,
      1,
    ),
  ).toEqual([]);
});
it.each(["See assembly schedule", "See other parts and assembly schedule"])(
  "Generic note fails when native need exists: %s",
  (value) => {
    const x = assemblyFixture();
    x.geometries[0].texts = x.geometries[0].texts.filter(
      (t) => !t.text.includes("authored assembly"),
    );
    x.geometries[0].texts.push(text(value));
    expect(
      assemblyNoteAudit(x.packet, x.geometries, x.ir, x.request).findings.map(
        (f) => f.kind,
      ),
    ).toContain("assembly-note-native-row-target-unavailable");
  },
);
