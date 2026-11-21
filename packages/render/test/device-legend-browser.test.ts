import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { dolFixture, actuation } from "./dol-control-junctions-fixture.js";
import {
  displaySheet,
  evaluateSheetGeometry,
  launch,
  drawingContextOptions,
} from "../../../evals/draw/browser.mjs";
import { deviceTags } from "../../../evals/draw/checks.mjs";
import {
  svgOutlineGeometry,
  bounds,
  distance,
  primitiveDistance,
  type Box,
} from "../../cli/test/helpers/svg-outline-geometry.js";
import { strokeMetadata } from "./helpers/painted-ink.js";
let browser: Awaited<ReturnType<typeof launch>>, page: any;
beforeAll(async () => {
  browser = await launch();
  const context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
  // CI can spend 30 s loading the dense plate after the full packet render.
  page.setDefaultTimeout(60000);
});
afterAll(async () => {
  await browser?.close();
});
function hideDistantShapes(legends: Box[]) {
  const root = document.querySelector("svg")!;
  const inverse = root.getScreenCTM()!.inverse();
  for (const e of document.querySelectorAll<SVGGeometryElement>(
    "line,path,polyline,rect,circle",
  )) {
    const css = getComputedStyle(e);
    if (
      e.closest("defs") ||
      css.display === "none" ||
      css.visibility === "hidden"
    )
      continue;
    const m = inverse.multiply(e.getScreenCTM()!);
    const b = e.getBBox();
    const corners = [
      new DOMPoint(b.x, b.y).matrixTransform(m),
      new DOMPoint(b.x + b.width, b.y).matrixTransform(m),
      new DOMPoint(b.x, b.y + b.height).matrixTransform(m),
      new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m),
    ];
    const scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
    const half =
      css.stroke === "none" ? 0 : (parseFloat(css.strokeWidth) * scale) / 2;
    // The transformed bbox encloses the full path. Include the oracle's
    // stroke radius and 0.125 mm legend padding before applying the 3 mm gap.
    const pad = half + 3.125;
    const left = Math.min(...corners.map((p) => p.x)) - pad;
    const right = Math.max(...corners.map((p) => p.x)) + pad;
    const top = Math.min(...corners.map((p) => p.y)) - pad;
    const bottom = Math.max(...corners.map((p) => p.y)) + pad;
    if (
      legends.every(
        (box) =>
          right < box.left ||
          left > box.right ||
          bottom < box.top ||
          top > box.bottom,
      )
    )
      e.style.setProperty("visibility", "hidden", "important");
  }
}

it("retains transformed and thick strokes near the legend in the outline audit", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect x="0" y="0" width="4" height="4" transform="translate(18 18) rotate(15)"/>
    <line x1="25" x2="25" y1="18" y2="22" stroke="black" stroke-width="6"/>
    <path d="M 60 60 C 65 85 85 65 90 90" stroke="black" fill="none"/>
  </svg>`;
  const full = await svgOutlineGeometry(page, svg);
  await page.evaluate(hideDistantShapes, [
    { left: 17, right: 20, top: 17, bottom: 20 },
  ]);
  const nearby = await svgOutlineGeometry(page, undefined);
  expect(full.shapes).toHaveLength(3);
  expect(nearby.shapes).toEqual(full.shapes.slice(0, 2));
});

function clippedBox(box: Box, clips: any[]): Box {
  for (const pts of clips) {
    const b = bounds(pts);
    box = {
      left: Math.max(box.left, b.left),
      top: Math.max(box.top, b.top),
      right: Math.min(box.right, b.right),
      bottom: Math.min(box.bottom, b.bottom),
    };
  }
  return box;
}
async function legendFrames(): Promise<Box[]> {
  return page.evaluate(() => {
    const root = document.querySelector("svg")!,
      inverse = (root as unknown as SVGSVGElement).getScreenCTM()!.inverse();
    return [...root.querySelectorAll("rect.device-legend-frame")].map((e) => {
      const b = (e as SVGGraphicsElement).getBBox(),
        m = inverse.multiply((e as SVGGraphicsElement).getScreenCTM()!),
        a = new DOMPoint(b.x, b.y).matrixTransform(m),
        z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
      return { left: a.x, top: a.y, right: z.x, bottom: z.y };
    });
  });
}

// The tag checker uses painted text, device and terminal measurements.
// The outline oracle measures clipped conductor and border ink separately.
async function audit(svg: string, ir: any, refs: any[]) {
  await displaySheet(page, svg);
  const measured = await evaluateSheetGeometry(page, { textOnly: true }),
    owned = new Set(
      measured.texts
        .filter((t) => t.tagKind === "legend")
        .map((t) => t.tagOwnerUid),
    );
  expect(
    deviceTags(measured, ir, refs, true).filter((f) =>
      ir.devices.some(
        (d) => owned.has(d.uid) && d.designation === f.designation,
      ),
    ),
  ).toEqual([]);
  const legends = await legendFrames();
  expect(legends.length).toBeGreaterThan(0);
  const native = await page.evaluate(() => {
    document
      .querySelectorAll("[data-device-legend]")
      .forEach((e) => e.remove());
    return document.querySelector("svg")!.outerHTML;
  });
  await page.setContent(native);
  await page.evaluate(hideDistantShapes, legends);
  const geometry = await svgOutlineGeometry(page, undefined),
    metadata = await page.evaluate(strokeMetadata, true),
    locations = await page.evaluate(() =>
      [...document.querySelectorAll("line,path,polyline,rect,circle")]
        .filter(
          (e) =>
            !e.closest("defs") &&
            getComputedStyle(e).display !== "none" &&
            getComputedStyle(e).visibility !== "hidden",
        )
        .map((e) => e.classList.contains("location-frame")),
    );
  const regionMetadata = metadata.map((m, i) => ({
    ...m,
    location: locations[i],
  }));
  for (const legend of legends) {
    let minimum = Infinity,
      closest = "";
    for (const text of geometry.texts.filter((t) => t.painted)) {
      const box = clippedBox(text.box, text.clips);
      if (box.left >= box.right || box.top >= box.bottom) continue;
      const d = distance(legend, box) - 0.125;
      if (d < minimum) {
        minimum = d;
        closest = text.text;
      }
    }
    for (const [i, shape] of geometry.shapes.entries()) {
      const info = regionMetadata[i];
      if (info?.location) {
        const box = clippedBox(bounds(shape.points), [
          [
            { x: info.clip.left, y: info.clip.top },
            { x: info.clip.right, y: info.clip.bottom },
          ],
        ]);
        if (box.left < box.right && box.top < box.bottom) {
          const points = [
            { x: box.left, y: box.top },
            { x: box.right, y: box.top },
            { x: box.right, y: box.bottom },
            { x: box.left, y: box.bottom },
            { x: box.left, y: box.top },
          ];
          const d = primitiveDistance(legend, points) - 0.125;
          if (d < minimum) {
            minimum = d;
            closest = "clipped location border";
          }
        }
      }
      if (!info?.ink) continue;
      for (let j = 1; j < shape.points.length; j++) {
        const raw = bounds([shape.points[j - 1]!, shape.points[j]!]),
          half = shape.stroke / 2;
        // Clip painted stroke, not its centreline: a cut viewport also clips
        // the cap/half-stroke at its edge. This retains the full 3 mm rule.
        const painted = {
          left: Math.max(raw.left - half, info.clip.left),
          top: Math.max(raw.top - half, info.clip.top),
          right: Math.min(raw.right + half, info.clip.right),
          bottom: Math.min(raw.bottom + half, info.clip.bottom),
        };
        if (painted.left > painted.right || painted.top > painted.bottom)
          continue;
        const d = distance(legend, painted) - 0.125;
        if (d < minimum) {
          minimum = d;
          closest = JSON.stringify(info);
        }
      }
    }
    expect(minimum, closest).toBeGreaterThanOrEqual(2.999);
  }
}
const flows = ["left-to-right", "top-to-bottom"] as const;
type Flow = (typeof flows)[number];

async function starterPacket(flow: Flow) {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw c;
  const r = await renderSchematicPacket(
    c.ir,
    {
      format: "schematic-packet-request/0.1",
      layout: "compact",
      page: { size: "letter", orientation: "portrait" },
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
    },
    c.presentation,
  );
  if (!r.ok) throw r;
  return { ir: c.ir, sheets: r.value.sheets };
}

for (const flow of flows)
  describe(`letter-portrait trim/fold/stack in ${flow}`, () => {
    let packet: ReturnType<typeof starterPacket> | undefined;
    const load = () => (packet ??= starterPacket(flow));
    it("renders the compact power and control packet once", async () => {
      expect((await load()).sheets.length).toBeGreaterThanOrEqual(5);
    });
    // The five reviewed sheets have independent outline checks. The final
    // group also audits any extra sheets produced by a future layout change.
    it.each([0, 1, 2, 3, 4])(
      "keeps 3 mm from all final ink and location borders, sheet group %i",
      async (index) => {
        const { ir, sheets } = await load();
        const group = sheets.slice(index, index === 4 ? undefined : index + 1);
        expect(group.length).toBeGreaterThan(0);
        for (const s of group) await audit(s.svg, ir, s.references);
      },
    );
  });

async function captionClearance() {
  const captions = await page.evaluate(() => {
    const root = document.querySelector("svg")! as unknown as SVGSVGElement,
      inverse = root.getScreenCTM()!.inverse();
    return [...root.querySelectorAll("text")]
      .filter((e) => e.textContent?.startsWith("CONTINUED LOCATION:"))
      .map((e) => {
        const b = e.getBBox(),
          m = inverse.multiply(e.getScreenCTM()!),
          a = new DOMPoint(b.x, b.y).matrixTransform(m),
          z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
        return { left: a.x, top: a.y, right: z.x, bottom: z.y };
      });
  });
  expect(captions.length).toBeGreaterThan(1);
  for (const [i, caption] of captions.entries())
    for (const other of captions.slice(i + 1))
      expect(distance(caption, other)).toBeGreaterThanOrEqual(0.999);
}
async function denseDolPacket() {
  const f = await dolFixture("saved");
  try {
    const r = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      layout: "standard",
      views: [actuation("K1", "top-to-bottom")],
    });
    if (!r.ok) throw r;
    return { ir: f.ir, sheets: r.value.sheets };
  } finally {
    await f.dispose();
  }
}
let dol: ReturnType<typeof denseDolPacket> | undefined;
const loadDol = () => (dol ??= denseDolPacket());
it("renders the dense DOL one-sheet packet", async () => {
  expect((await loadDol()).sheets).toHaveLength(1);
});
it("checks dense DOL legend ink and continued-location captions", async () => {
  const { ir, sheets } = await loadDol();
  const [sheet] = sheets;
  expect(sheet).toBeDefined();
  await audit(sheet!.svg, ir, sheet!.references);
  await captionClearance();
});

let machine: ReturnType<typeof compileProject> | undefined;
it.each(flows)("protects machine-demo PLC1 tags in %s", async (flow) => {
  const c = await (machine ??= compileProject("examples/machine-demo"));
  if (!c.ok) throw c;
  const r = await renderSchematicPacket(
    c.ir,
    {
      format: "schematic-packet-request/0.1",
      layout: "compact",
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "K1" },
          family: "control",
          flow,
        },
      ],
    },
    c.presentation,
  );
  if (!r.ok) throw r;
  expect(r.value.sheets.length).toBeGreaterThan(0);
  for (const s of r.value.sheets) await audit(s.svg, c.ir, s.references);
});
