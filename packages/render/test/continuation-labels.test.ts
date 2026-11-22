import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { continuationIdentity } from "../src/packet/continuation-identity.js";
import {
  continuationLabel,
  continuationLabelSvg,
  continuationHeaderWidth,
} from "../src/packet/continuation-label.js";
import { labelMetrics, labelRows } from "../src/packet/label-text.js";
import { continuationOracle } from "./continuation-oracle.js";
import type { PresentationEdge } from "../src/types.js";
const wire = (label?: string) =>
  ({
    elementIds: [{ kind: "wire", uid: "w" }],
    conductor: { kind: "wire", uid: "w", designation: "W1" },
    label: {
      text: "display detail is not an identity",
      textSources:
        label === undefined
          ? []
          : [{ field: "wire.properties.label", value: label }],
    },
  }) as unknown as PresentationEdge;
it("uses authored printed wire number with designation kept separately", () => {
  expect(continuationIdentity(wire("PE-SRC-M1"))).toEqual({
    conductor: "PE-SRC-M1",
    designation: "W1",
    provenance: { kind: "wire", uid: "w" },
  });
  expect(continuationIdentity(wire())?.conductor).toBe("W1");
  expect(continuationIdentity(wire(""))).toBeUndefined();
});
it("retains the unnamed jumper UID in provenance", () => {
  const edge = {
    ...wire(),
    elementIds: [
      { kind: "jumper", uid: "84000000-0000-4000-8000-000000000020" },
    ],
    conductor: {
      kind: "jumper",
      uid: "84000000-0000-4000-8000-000000000020",
      designation: "jumper:wrong",
    },
  } as PresentationEdge;
  expect(continuationIdentity(edge)).toEqual({
    conductor: "JUMPER",
    provenance: edge.elementIds[0],
  });
});
it("refuses synthetic attachments and keeps core identity free of color/size detail", () => {
  expect(continuationIdentity({ elementIds: [] })).toBeUndefined();
  const c = {
    ...wire(),
    elementIds: [{ kind: "cable_conductor", cableUid: "c", conductorId: "1+" }],
    conductor: {
      kind: "cable-conductor",
      cableUid: "c",
      cableDesignation: "CBL1",
      conductorId: "1+",
    },
  } as PresentationEdge;
  expect(continuationIdentity(c)?.conductor).toBe("CBL1.1+");
});
it("reserves three-digit sheets and C1000 while retaining long ID characters", () => {
  const id = "LS1-RETURN-PLC1-DI0";
  expect(labelRows(id, 10).join("")).toBe(id);
  const l = continuationLabel(
    {
      id: "C1000",
      to: 100,
      toZone: "D6",
      conductor: id,
      netId: "N",
      x: 40,
      y: 50,
      side: "right",
    },
    18,
    continuationHeaderWidth(1000),
  );
  expect(l.rows[0]!.text).toBe("C1000 / 100.D6");
  expect(
    l.rows
      .slice(1)
      .map((r) => r.text)
      .join(""),
  ).toBe(id);
  expect(l.rows.map((r) => r.text)).toEqual(["C1000 / 100.D6", id]);
  expect(l.bounds.w).toBeGreaterThanOrEqual(labelMetrics(id).width);
  expect(l.bounds.h).toBeLessThan(7);
});
let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c));
  ir = c.ir;
});
const cases = [
  ["A", "tabloid", "landscape", "compact", "top-to-bottom", 5],
  ["B", "tabloid", "portrait", "compact", "top-to-bottom", 2],
  ["C", "a3", "landscape", "standard", "top-to-bottom", 5],
  ["D", "a3", "portrait", "compact", "top-to-bottom", 2],
  ["E", "letter", "landscape", "standard", "left-to-right", 5],
  ["F", "letter", "landscape", "compact", "left-to-right", 5],
  ["G", "letter", "portrait", "compact", "top-to-bottom", 5],
  ["fold", "a3", "portrait", "compact", "left-to-right", 2],
] as const;
for (const witness of cases)
  it.each([witness])(
    "resolves fit witness %s using independent printed anchors",
    async (name, size, orientation, layout, flow, base) => {
      const r = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        page: { size, orientation },
        layout,
        views: [
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "M1" },
            family: "power",
            flow,
          },
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "K1" },
            family: "control",
            flow,
          },
        ],
      });
      if (!r.ok) throw Error(JSON.stringify(r.error));
      expect(r.value.sheets.length).toBeLessThanOrEqual(base + 1);
      const result = continuationOracle(ir, r.value);
      if (name === "fold") expect(result.sameSheet).toBeGreaterThan(0);
      expect(r.value.sheets.every((s) => s.references.length > 0)).toBe(true);
    },
    witness[0] === "F" ? 60000 : 30000,
  );
it("keeps peers correct across repeated authored views and final indexes", async () => {
  const view = {
    format: "schematic-view-request/0.1" as const,
    root: { by: "designation" as const, value: "M1" },
    family: "power" as const,
    flow: "left-to-right" as const,
  };
  const r = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    layout: "compact",
    page: { size: "a3", orientation: "portrait" },
    index: true,
    views: [view, view],
  });
  if (!r.ok) throw Error(JSON.stringify(r.error));
  expect(continuationOracle(ir, r.value).ends).toBeGreaterThan(0);
});

it("uses a designated jumper's authored designation", () => {
  const edge = {
    ...wire(),
    elementIds: [{ kind: "jumper", uid: "j" }],
    conductor: { kind: "jumper", uid: "j", designation: "JP-1" },
    label: {
      text: "wrong",
      textSources: [{ field: "jumper.designation", value: "JP-1" }],
    },
  } as unknown as PresentationEdge;
  expect(continuationIdentity(edge)).toEqual({
    conductor: "JP-1",
    designation: "JP-1",
    provenance: { kind: "jumper", uid: "j" },
  });
});

it("prints both visible rows of a multiline continuation without a hidden substitute", () => {
  const link = {
    id: "C001",
    to: 2,
    toZone: "B1",
    conductor: "W7",
    netId: "N",
    x: 40,
    y: 50,
    side: "right" as const,
  };
  const label = continuationLabel(link, 18, continuationHeaderWidth(1));
  const svg = continuationLabelSvg({ ...link, label });
  expect(svg).toContain(">C001 / 02.B1</text>");
  expect(svg).toContain(">W7</text>");
  expect(svg).not.toContain("textLength");
});

it("prints JUMPER with the continuation reference", () => {
  const link = {
    id: "C001",
    to: 2,
    toZone: "B1",
    conductor: "JUMPER",
    netId: "N",
    x: 60,
    y: 70,
    side: "right" as const,
  };
  const label = continuationLabel(link, 18, continuationHeaderWidth(1));
  expect(
    label.rows
      .slice(1)
      .map((r) => r.text)
      .join(""),
  ).toBe("JUMPER");
  const svg = continuationLabelSvg({ ...link, label });
  expect(svg).toContain(">JUMPER</text>");
  expect(svg).not.toContain("no designation");
  expect(svg).not.toContain("UID ");
  expect(svg).not.toContain("tspan");
});
