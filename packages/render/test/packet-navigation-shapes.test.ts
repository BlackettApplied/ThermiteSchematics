import { expect, it } from "vitest";
import {
  allocateNavigationSlots,
  type SheetSlotRequest,
} from "../src/packet/navigation-slots.js";
const shape = (id: string, mode: "local" | "self-located", w: number) => ({
  id,
  mode,
  inkMm: { x: 0, y: 0, w, h: 6 },
  maximumForms: ["100.D1"],
  wrapWidthMm: w - 2,
});
function request(): SheetSlotRequest {
  return {
    owner: { x: 40, y: 30, w: 20, h: 20 },
    locality: {
      anchorMm: { x: 50, y: 40 },
      frameMm: { x: 40, y: 30, w: 20, h: 20 },
      framesMm: [],
      ownerLocation: { sheet: 1, zone: "C3" },
    },
    reservation: {
      id: "shapes",
      ownerOccurrence: "owner",
      ownerAppearance: "owner",
      profileId: "literal-shapes",
      space: "sheet-slot",
      inkMm: { x: 0, y: 0, w: 200, h: 6 },
      maximumForms: ["100.D1"],
      shapes: [
        shape("local-wide", "local", 200),
        shape("self-first", "self-located", 20),
        shape("local-narrow", "local", 20),
        shape("local-last", "local", 18),
      ],
    },
  } as SheetSlotRequest;
}
const svg =
  '<svg viewBox="0 0 300 80"><rect class="device-frame" x="40" y="30" width="20" height="20" fill="black"/></svg>';
it("tries every local shape before any self-located envelope", () => {
  const r = allocateNavigationSlots(
    [request()],
    { x: 0, y: 0, w: 120, h: 80 },
    svg,
    1,
  )[0]!;
  expect(r.allocatedMm).toMatchObject({
    placement: "local",
    shapeId: "local-narrow",
    rect: { w: 20, h: 6 },
  });
  expect(r.inkMm).toEqual({ x: 0, y: 0, w: 20, h: 6 });
});
it("uses a self-located envelope only after no local shape fits", () => {
  const r = allocateNavigationSlots(
    [request()],
    { x: 200, y: 0, w: 40, h: 80 },
    svg,
    1,
  )[0]!;
  expect(r.allocatedMm).toMatchObject({
    placement: "self-located",
    shapeId: "self-first",
    rect: { x: 200, w: 20, h: 6 },
  });
});
it("uses fixed shape order and returns identical allocations on repeated runs", () => {
  const r = request();
  r.reservation.inkMm = { x: 0, y: 0, w: 20, h: 6 };
  const shapes = (
    r.reservation as unknown as { shapes: ReturnType<typeof shape>[] }
  ).shapes;
  shapes[0] = shape("local-wide", "local", 20);
  const first = allocateNavigationSlots(
    [r],
    { x: 0, y: 0, w: 120, h: 80 },
    svg,
    1,
  );
  expect(first[0]!.allocatedMm).toMatchObject({
    shapeId: "local-wide",
    rect: { w: 20 },
  });
  expect(
    allocateNavigationSlots([r], { x: 0, y: 0, w: 120, h: 80 }, svg, 1),
  ).toEqual(first);
  expect(
    allocateNavigationSlots([r], { x: 0, y: 0, w: 120, h: 80 }, svg, 1),
  ).toEqual(first);
});

import {
  envelopeShapes,
  maximumRepeatForms,
  wrapNavigationText,
} from "../src/packet/navigation-labels.js";
import { communicationRowLayout } from "../src/packet/native-part-labels.js";
import { fieldTextLeftShift } from "../src/packet/svg.js";
import { printableTextMetrics } from "../src/text-metrics.js";
it("reserves fixed maximum tokens and multiplicity in every mode and shape", () => {
  const r = maximumRepeatForms("SRC1", "functions", [3, 2], "100.D1");
  expect(
    r.shapes.filter((s) => s.mode === "local").map((s) => s.wrapWidthMm),
  ).toEqual([79.843, 70, 56, 42, 28]);
  expect(
    r.shapes.filter((s) => s.mode === "self-located").map((s) => s.wrapWidthMm),
  ).toEqual([94.362, 84, 70, 56, 42, 28]);
  for (const s of r.shapes) {
    const prefix = s.mode === "local" ? "SRC1: " : "SRC1 (100.D1): ";
    expect(s.maximumForms.map((f) => f.replace(/\n/g, " "))).toEqual([
      prefix + "Also shown 100.D1, 100.D1, 100.D1",
      prefix + "Repeat of 100.D1, 100.D1 (same functions)",
      prefix + "Also shown 100.D1, 100.D1 Repeat of 100.D1 (same function)",
    ]);
    for (const form of s.maximumForms)
      for (const line of form.split("\n")) {
        const m = printableTextMetrics(line, 3.502);
        expect(
          Math.max(m.advance, m.right) - Math.min(m.left, 0) + 2,
        ).toBeLessThanOrEqual(s.inkMm.w + 0.000001);
      }
    expect(s.inkMm.h).toBe(
      Math.max(...s.maximumForms.map((f) => f.split("\n").length)) * 4.8 + 1,
    );
  }
});

it("keeps '→ SS.ZZ' atomic when wrapping narrow element references (#409)", () => {
  const wrapped = wrapNavigationText("OL1: NC contact 95–96 → 03.B2", 18);
  const lines = wrapped.split("\n");
  expect(lines.every((line) => !/(?:→|->)\s*$/u.test(line))).toBe(true);
  expect(lines.at(-1)).toBe("→ 03.B2");
  const shapes = envelopeShapes(
    "local",
    ["OL1: NC contact 95–96 → 88.D6"],
    [22, 18, 14],
  );
  for (const s of shapes)
    for (const form of s.maximumForms)
      expect(
        form.split("\n").every((line) => !/(?:→|->)\s*$/u.test(line)),
      ).toBe(true);
});

it("puts qualified port pointers on a separate line below repeated-body pointers (#430)", () => {
  const layout = communicationRowLayout(
    {
      deviceUid: "n05",
      label: "N05",
      targets: [
        { part: 1, sheet: 2, zone: "D2" },
        { part: 3, sheet: 4, zone: "A2" },
      ],
      ports: [
        { key: "B1", targets: [{ part: 1, sheet: 2, zone: "D2" }] },
        { key: "OUT", targets: [{ part: 3, sheet: 4, zone: "A2" }] },
      ],
    },
    300,
    ["N05 -> P1/S02.D2, P3/S04.A2"],
  );
  expect(layout.lines).toHaveLength(2);
  expect(layout.lines[0]).toBe("N05 -> P1/S02.D2, P3/S04.A2");
  expect(layout.entries.every((e) => e.line === 1)).toBe(true);
  expect(layout.entries[0]!.x).toBe(0);
});

it("counts the first negative-bearing port entry left shift once so two JB1 references fit on one row (#551)", () => {
  const target = { part: 3, sheet: 100, zone: "D6" };
  const keys = [
    "Ethernet uplink to remote panel A",
    "Ethernet uplink to remote panel B",
  ];
  const [first, last] = keys.map((key) => `JB1 port ${key} → 100.D6`);
  const m = printableTextMetrics(first!, 2.5);
  const z = printableTextMetrics(last!, 2.5);
  const startShift = fieldTextLeftShift(first!, 2.5);
  const fitWidth =
    startShift +
    Math.max(m.advance, m.right) +
    2 +
    Math.max(z.advance, z.right) -
    Math.min(0, z.left);
  const width = fitWidth + 0.04;
  const layout = communicationRowLayout(
    {
      deviceUid: "jb1",
      label: "JB1",
      targets: [target],
      ports: keys.map((key) => ({ key, targets: [target] })),
    },
    width,
    ["JB1 -> P3/S100.D6"],
  );
  expect(layout.lines).toHaveLength(2);
  expect(layout.entries.map((e) => e.line)).toEqual([1, 1]);
  expect(layout.entries[0]!.x).toBe(startShift);
  expect(
    layout.entries[1]!.x + Math.max(z.advance, z.right),
  ).toBeLessThanOrEqual(width);
});
