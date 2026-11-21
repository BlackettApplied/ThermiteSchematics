import { assertTagRows } from "./helpers/tag-row-source.js";
import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { addDeviceLegend } from "../src/device-legend.js";
import { planDeviceTag } from "../src/device-tags.js";
import {
  legendFreeRegions,
  legendFitDiagnostic,
  legendFreeRegionSearch,
  MAX_FREE_REGIONS,
  MAX_FREE_REGION_OBSTACLES,
} from "../src/device-legend/failure.js";
import { placeLegend, legendColumns } from "../src/device-legend/placement.js";
import { generatedSvgInk } from "../src/device-legend/svg-ink.js";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { parseHTML } from "linkedom";
let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw c;
  ir = c.ir;
});
const view = {
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: "M1" },
  family: "power" as const,
  flow: "top-to-bottom" as const,
};
function tag() {
  const d = ir.devices.find((d) => d.designation === "M1")!,
    p = planDeviceTag(
      d,
      ir.deviceTypes.find((t) => t.id === d.typeId)!,
      50,
    );
  if (!p.ok) throw p;
  return p.value;
}
const area = { x: 10, y: 10, w: 180, h: 180 };
function source(obstacle = "") {
  const t = tag();
  return `<svg viewBox="0 0 200 200"><g class="device-group" data-device-uid="${t.ownerUid}"><rect class="device-frame" x="20" y="20" width="20" height="20" fill="white" stroke="black"/><text x="22" y="25" font-size="2.5" data-tag-owner-uid="${t.ownerUid}" data-tag-kind="body" data-tag-key="M1">M1</text></g>${obstacle}</svg>`;
}
it("prefers top-right, then bottom-right and reserves 3 mm around the frame", () => {
  const first = placeLegend([tag()], area, [], [])!;
  expect(first.box.x + first.box.w).toBe(190);
  expect(first.box.y).toBe(10);
  const blocker = { x: 130, y: 5, w: 70, h: 50 },
    second = placeLegend([tag()], area, [blocker], [])!;
  expect(second.box.y + second.box.h).toBe(190);
  expect(second.box.x + second.box.w).toBe(190);
  expect(
    placeLegend([tag()], area, [{ x: 0, y: 0, w: 210, h: 210 }], []),
  ).toBeUndefined();
});
it("protects actual location borders, routes, symbols, cards and gangs through final clipped ink", () => {
  for (const obstacle of [
    '<path d="M 0 100 H 200" stroke="black" fill="none"/>',
    '<rect class="location-frame" x="0" y="0" width="100" height="200" fill="#f7f8fa" stroke="black"/>',
    '<g class="off-view-annotation"><rect x="100" y="0" width="100" height="200" fill="none" stroke="black"/><text x="40" y="80">card</text></g>',
    '<line data-mechanical-association="ganged" x1="0" y1="100" x2="200" y2="100" stroke="black"/>',
  ]) {
    const measured = generatedSvgInk(source(obstacle));
    expect(measured.ink.length).toBeGreaterThan(1);
    const size = legendColumns([tag()], 1).box;
    const b = {
      x: 100 - (size.w + 5) / 2,
      y: 100 - (size.h + 5) / 2,
      w: size.w + 5,
      h: size.h + 5,
    };
    expect(placeLegend([tag()], b, [], [])).not.toBeUndefined();
    expect(
      placeLegend([tag()], b, measured.ink, measured.regions),
    ).toBeUndefined();
  }
  // A hidden copy outside its fold viewport is not physical ink on this sheet.
  const hidden = generatedSvgInk(
    '<svg viewBox="0 0 200 200"><svg x="0" y="0" width="20" height="20" viewBox="0 0 20 20"><rect x="80" y="80" width="20" height="20" fill="black"/></svg></svg>',
  );
  expect(hidden.ink).toEqual([]);
});
it("protects blank card interiors as well as their painted borders and captions", () => {
  const card = generatedSvgInk(
    source(
      '<g class="off-view-annotation" data-off-view-terminal="PS1.+"><rect x="60" y="60" width="135" height="135" fill="none" stroke="black"/><text x="63" y="67" font-size="2.5">Off-view at PS1.+</text></g>',
    ),
  );
  const blank = { x: 100, y: 100, w: 85, h: 85 };
  expect(placeLegend([tag()], blank, [], [])).not.toBeUndefined();
  expect(placeLegend([tag()], blank, card.ink, card.regions)).toBeUndefined();
});
it("emits one complete owned legend per local UID with the exact body key in both flows", async () => {
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      layout: "compact",
      page: { size: "letter", orientation: "portrait" },
      views: [{ ...view, flow }],
    });
    if (!r.ok) throw r;
    for (const s of r.value.sheets) {
      const doc = parseHTML(s.svg).document,
        entries = [
          ...doc.querySelectorAll(
            '[data-device-legend-entry][data-tag-kind="legend"]',
          ),
        ],
        uids = entries.map((e) => e.getAttribute("data-tag-owner-uid"));
      expect(new Set(uids).size).toBe(uids.length);
      for (const e of entries) {
        const uid = e.getAttribute("data-tag-owner-uid"),
          d = ir.devices.find((d) => d.uid === uid)!,
          t = ir.deviceTypes.find((t) => t.id === d.typeId)!;
        expect(
          doc.querySelector(
            `text[data-tag-kind="body"][data-tag-owner-uid="${uid}"]`,
          )!.textContent,
        ).toBe(d.designation);
        for (const [field, value] of Object.entries({
          designation: d.designation,
          description: d.description ?? t.description,
          part: t.catalog?.orderNumber,
        })) {
          const texts = [
            ...e.querySelectorAll(`text[data-tag-field="${field}"]`),
          ];
          assertTagRows(texts, (value ?? "").trim());
          for (const row of texts) {
            expect(
              Number(row.getAttribute("font-size")),
            ).toBeGreaterThanOrEqual(field === "designation" ? 2.7 : 2.5);
            expect(row.hasAttribute("textLength")).toBe(false);
          }
        }
      }
    }
  }
});
it("uses the same complete legend in continuous SVG without changing prepared geometry", async () => {
  const r = await renderSchematic(ir, view);
  if (!r.ok) throw r;
  const doc = parseHTML(r.value.svg).document;
  expect(doc.querySelector("[data-device-legend]")).not.toBeNull();
  expect(
    doc
      .querySelector('text[data-tag-kind="body"]')!
      .getAttribute("data-tag-field"),
  ).toBeNull();
});
it("keeps long Unicode descriptions and unbroken part numbers literal, or refuses dimensionally", () => {
  const input = structuredClone(ir),
    d = input.devices.find((d) => d.designation === "M1")!,
    t = input.deviceTypes.find((t) => t.id === d.typeId)!;
  d.description = "Δοκιμή λειτουργίας ".repeat(10).trim();
  t.catalog = { ...t.catalog, orderNumber: "PN" + "X".repeat(100) };
  const r = addDeviceLegend(input, source(), area);
  if (!r.ok) throw r;
  const doc = parseHTML(r.value).document;
  assertTagRows(
    [...doc.querySelectorAll('text[data-tag-field="description"]')],
    d.description,
  );
  expect(
    [...doc.querySelectorAll('text[data-tag-field="part"]')]
      .map((t) => t.textContent)
      .join(""),
  ).toBe(t.catalog.orderNumber);
  d.description = "Unavoidably long authored description ".repeat(1000);
  const refused = addDeviceLegend(input, source(), {
    x: 0,
    y: 0,
    w: 60,
    h: 60,
  });
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.error.code).toBe("R006");
    expect(refused.error.message).toMatch(
      /M1.*description.*requires.*available.*mm/,
    );
  }
});
it("returns R006 for a blocked sheet instead of dropping an entry", () => {
  const r = addDeviceLegend(
    ir,
    source('<rect x="0" y="0" width="200" height="200" fill="black"/>'),
    area,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.message).toMatch(/M1.*requires.*available free region/);
    expect(r.error.message).toContain(
      "available free region (largest tried) is 0.00 × 0.00 mm after 3 mm ink clearance.",
    );
    expect(r.error.details).toMatchObject({
      availableWidthMm: 0,
      availableHeightMm: 0,
      capacityKind: "free-region",
    });
  }
});

it("identifies the width-constraining part rather than the tallest description", () => {
  const input = structuredClone(ir),
    tall = input.devices.find((d) => d.designation === "M1")!,
    wide = input.devices.find((d) => d.designation === "CB1")!;
  tall.description = "maintenance ".repeat(20).trim();
  wide.description = "Breaker";
  const type = input.deviceTypes.find((t) => t.id === wide.typeId)!;
  type.catalog = { ...type.catalog, orderNumber: "W".repeat(17) };
  const planned = [tall, wide].map((d) => {
    const p = planDeviceTag(
      d,
      input.deviceTypes.find((t) => t.id === d.typeId)!,
      50,
    );
    if (!p.ok) throw p;
    return p.value;
  });
  expect(planned[0]!.heightMm).toBeGreaterThan(planned[1]!.heightMm);
  const failure = legendFitDiagnostic(planned, { x: 0, y: 0, w: 40, h: 200 });
  expect(failure.tag.ownerUid).toBe(wide.uid);
  expect(failure.field).toBe("part");
});

it("names the indivisible oversized device and field against the whole drawing area", () => {
  const input = structuredClone(ir),
    d = input.devices.find((d) => d.designation === "M1")!,
    other = input.devices.find((d) => d.designation === "CB1")!;
  d.description = "Motor";
  other.description = "Authored maintenance qualification ".repeat(200);
  const xml = source().replace(
    "</svg>",
    `<g data-device-uid="${other.uid}"><rect class="device-frame" x="50" y="20" width="10" height="10" stroke="black"/><text x="52" y="25" data-tag-kind="body" data-tag-owner-uid="${other.uid}" data-tag-key="CB1" font-size="2.5">CB1</text></g></svg>`,
  );
  const result = addDeviceLegend(input, xml, { x: 10, y: 10, w: 180, h: 60 });
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "R006",
      root: "CB1",
      details: {
        device: "CB1",
        field: "description",
        capacityKind: "drawing-area",
        availableWidthMm: 180,
        availableHeightMm: 60,
      },
    },
  });
  if (!result.ok)
    expect(result.error.message).toMatch(
      /Device CB1 legend field description.*single entry requires.*available drawing area is 180.00 × 60.00 mm/,
    );
  d.designation = "W".repeat(80);
  const wide = addDeviceLegend(
    input,
    source()
      .replace('viewBox="0 0 200 200"', 'viewBox="0 0 500 200"')
      .replaceAll('data-tag-key="M1"', `data-tag-key="${d.designation}"`)
      .replace(">M1</text>", `>${d.designation}</text>`),
    { x: 0, y: 0, w: 30, h: 180 },
  );
  expect(wide).toMatchObject({
    ok: false,
    error: {
      code: "R006",
      details: {
        device: d.designation,
        field: "designation",
        capacityKind: "drawing-area",
        availableWidthMm: 30,
      },
    },
  });
});
it("retains maximal free rectangles instead of discarding a later usable pocket", () => {
  const bounds = { x: 0, y: 0, w: 100, h: 100 },
    blocked = [
      { x: 40, y: 0, w: 20, h: 60 },
      { x: 0, y: 70, w: 80, h: 10 },
    ],
    regions = legendFreeRegions(bounds, blocked);
  expect(
    regions.some(
      (r) =>
        Math.abs(r.x) < 0.001 &&
        Math.abs(r.y) < 0.001 &&
        Math.abs(r.w - 36.87) < 0.001 &&
        Math.abs(r.h - 66.87) < 0.001,
    ),
  ).toBe(true);
  expect(regions[0]!.w).toBeCloseTo(36.87, 8);
  expect(regions[0]!.h).toBeCloseTo(66.87, 8);
});

it("bounds large free-region searches and reports only obstacle-free capacity", () => {
  const bounds = { x: 0, y: 0, w: 100, h: 100 },
    obstacles = Array.from({ length: 1200 }, (_, i) => ({
      x: 40,
      y: i % 90,
      w: 10,
      h: 1,
    })),
    search = legendFreeRegionSearch(bounds, obstacles);
  expect(obstacles.length).toBeGreaterThan(MAX_FREE_REGION_OBSTACLES);
  expect(search.bounded).toBe(true);
  expect(search.maximalObstacleTests).toBe(0);
  expect(search.peakRegions).toBeLessThanOrEqual(MAX_FREE_REGIONS);
  expect(search.regions).toHaveLength(1);
  expect(search.regions[0]!.w * search.regions[0]!.h).toBeGreaterThan(0);
  for (const r of search.regions)
    for (const o of obstacles)
      expect(
        r.w === 0 ||
          r.h === 0 ||
          r.x + r.w <= o.x - 3.13 ||
          r.x >= o.x + o.w + 3.13 ||
          r.y + r.h <= o.y - 3.13 ||
          r.y >= o.y + o.h + 3.13,
      ).toBe(true);
  expect(legendFreeRegions(bounds, [...obstacles, bounds])).toEqual([
    { ...bounds, w: 0, h: 0 },
  ]);
  const fragmented = legendFreeRegionSearch(
    { x: 0, y: 0, w: 1000, h: 1000 },
    Array.from({ length: MAX_FREE_REGION_OBSTACLES }, (_, i) => ({
      x: (i * 37) % 970,
      y: (i * 53) % 970,
      w: 1,
      h: 1,
    })),
  );
  expect(fragmented.bounded).toBe(true);
  expect(fragmented.peakRegions).toBeLessThanOrEqual(MAX_FREE_REGIONS);
  expect(fragmented.maximalObstacleTests).toBeLessThanOrEqual(
    MAX_FREE_REGION_OBSTACLES,
  );
});

it("refuses an oversized rail reference with its authored device and field", () => {
  const input = structuredClone(ir),
    device = input.devices.find((d) => d.designation === "PS1")!;
  device.description = "Authored reference maintenance instructions ".repeat(
    200,
  );
  const terminal = JSON.stringify({
      deviceUid: device.uid,
      terminalKey: "-",
    }).replaceAll('"', "&quot;"),
    xml = source().replace(
      "</svg>",
      `<g class="off-view-annotation"><text x="20" y="65" font-size="2.7" data-tag-owner-uid="${device.uid}" data-tag-kind="reference" data-tag-block="rail" data-tag-field="designation" data-tag-terminal-id="${terminal}">Off-view at PS1.-</text></g></svg>`,
    ),
    before = JSON.stringify(input);
  const result = addDeviceLegend(input, xml, area);
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "R006",
      root: "PS1",
      details: {
        device: "PS1",
        field: "description",
        capacityKind: "drawing-area",
      },
    },
  });
  expect(JSON.stringify(input)).toBe(before);
});
