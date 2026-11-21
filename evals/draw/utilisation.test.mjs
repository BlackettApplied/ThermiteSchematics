import { expect, it } from "vitest";
import { utilisation, visibleShapeBounds } from "./utilisation.mjs";
import { evaluatePacket } from "./evaluate.mjs";

const box = (x, y, w, h) => ({ x, y, w, h });
const sheet = box(0, 0, 300, 250);
const shape = (bbox, extra = {}) => ({ bbox, conductor: true, ...extra });
const geometry = (shapes = [], extra = {}) => ({
  width: 300,
  height: 250,
  shapes,
  texts: [],
  catalogs: [],
  reportRows: [],
  ...extra,
});

it("keeps unfolded, fully painted envelopes unchanged", () => {
  const b = box(30, 40, 100, 60);
  expect(utilisation(geometry([shape(b)]))).toEqual({
    bbox: b,
    fraction: 6000 / (244 * 170),
  });
});
it("applies furniture eligibility to visible bounds, including off-sheet origins", () => {
  const furniture = shape(box(10, 10, 200, 180), {
    viewport: box(30, 40, 150, 100),
  });
  const drawing = shape(box(40, 50, 20, 30));
  expect(utilisation(geometry([furniture, drawing]))).toEqual({
    bbox: box(30, 40, 150, 100),
    fraction: 15000 / (244 * 170),
  });
  expect(
    utilisation(
      geometry([
        shape(box(-128, 20, 360.6, 100), {
          viewport: box(28, 40, 204.5, 26),
        }),
      ]),
    ).bbox,
  ).toEqual(box(28, 40, 204.5, 26));
  expect(utilisation(geometry([shape(box(10, 10, 200, 180))]))).toBeNull();
});
it("clips a partly visible shape before forming the envelope", () => {
  const s = shape(box(30, 40, 400, 100), {
    viewport: box(50, 60, 120, 80),
  });
  expect(utilisation(geometry([s]))).toEqual({
    bbox: box(50, 60, 120, 80),
    fraction: 9600 / (244 * 170),
  });
});
it("uses the measured painted outline rather than a phantom bbox corner", () => {
  const s = shape(box(40, 60, 170, 120), {
    viewport: box(30, 40, 100, 100),
    paintedBbox: box(40, 60, 90, 0),
  });
  expect(visibleShapeBounds(s, sheet)).toEqual(box(40, 60, 90, 0));
});
it("intersects every nested clip, in sheet coordinates", () => {
  const s = shape(box(30, 40, 200, 150), {
    viewport: box(40, 50, 150, 120),
    clips: [box(50, 60, 80, 70), box(60, 70, 40, 30)],
  });
  expect(visibleShapeBounds(s, sheet)).toEqual(box(60, 70, 40, 30));
  expect(utilisation(geometry([s])).fraction).toBe(1200 / (244 * 170));
});
it("keeps separate viewport clips for multiple strips on one sheet", () => {
  const a = shape(box(30, 40, 400, 40), {
    viewport: box(40, 50, 60, 20),
  });
  const b = shape(box(30, 100, 400, 40), {
    viewport: box(150, 110, 50, 20),
  });
  expect(utilisation(geometry([a, b])).bbox).toEqual(box(40, 50, 160, 80));
});
it("clips to the physical sheet even without a nested viewport", () => {
  expect(visibleShapeBounds(shape(box(270, 30, 150, 20)), sheet)).toEqual(
    box(270, 30, 30, 20),
  );
});
it("drops fully clipped or hidden geometry and preserves horizontal strokes", () => {
  const hidden = shape(box(30, 40, 100, 100), { clips: null });
  const outside = shape(box(100, 100, 20, 20), {
    viewport: box(30, 40, 20, 20),
  });
  expect(utilisation(geometry([hidden, outside]))).toBeNull();
  expect(
    visibleShapeBounds(
      shape(box(20, 50, 200, 0), { viewport: box(30, 40, 100, 20) }),
      sheet,
    ),
  ).toEqual(box(30, 50, 100, 0));
});
it("refuses a partial packet median when any sheet has a DQ-12 measurement error", () => {
  const g = geometry([shape(box(30, 40, 100, 60))]),
    refused = {
      ...g,
      utilisationErrors: [
        { element: "path-1", reason: "DQ-12 unsupported mask" },
      ],
    },
    packet = {
      sheets: [1, 2].map((number) => ({
        number,
        view: { kind: "drawing" },
        references: [],
        continuations: [],
      })),
    };
  expect(() => utilisation(refused)).toThrow(/DQ-12 unsupported mask/);
  const rows = evaluatePacket({ id: "refused", family: "test" }, packet, [
    g,
    refused,
  ]);
  expect(rows.some((r) => r.id === "refused/DQ-12/packet-median")).toBe(false);
  expect(rows.some((r) => r.dq === "DQ-20")).toBe(true);
});
it("treats an empty clip as empty and bounds occupancy at 100 percent", () => {
  expect(
    visibleShapeBounds(
      shape(box(30, 40, 100, 100), { clips: [box(0, 0, 0, 0)] }),
      sheet,
    ),
  ).toBeNull();
  expect(
    utilisation(geometry([shape(box(20, 25, 280, 130))], { height: 200 }))
      .fraction,
  ).toBe(1);
});
it("excludes furniture and refuses a non-positive denominator", () => {
  expect(utilisation(geometry([{ bbox: box(30, 40, 50, 50) }]))).toBeNull();
  expect(() =>
    utilisation(
      geometry([shape(box(25, 30, 20, 5))], { width: 56, height: 100 }),
    ),
  ).toThrow(/positive drawing area/);
});
it("retains the packet median, 40 percent threshold and passing measurements", () => {
  const g = (w, h) =>
    geometry([shape(box(30, 30, w, h))], { width: 256, height: 180 });
  const packet = {
    sheets: [1, 2, 3].map((number) => ({
      number,
      view: { kind: "drawing" },
      references: [],
      continuations: [],
    })),
  };
  const result = evaluatePacket({ id: "synthetic", family: "test" }, packet, [
    g(100, 40),
    g(200, 60),
    geometry([]),
  ]).find((r) => r.dq === "DQ-12");
  expect(result.evidence.findings).toEqual([]);
  expect(result.evidence.measurement.median).toBe(0.4);
  expect(result.evidence.measurement.perSheet.map((x) => x.sheet)).toEqual([
    1, 2,
  ]);
  const failed = evaluatePacket(
    { id: "synthetic", family: "test" },
    { sheets: packet.sheets.slice(0, 2) },
    [g(100, 40), g(200, 58)],
  ).find((r) => r.dq === "DQ-12");
  expect(failed.evidence.findings[0].kind).toBe(
    "median-utilisation-below-40-percent",
  );
});
