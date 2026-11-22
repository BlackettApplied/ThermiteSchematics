import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { fullyCoincidentCaption } from "../src/circuit/coincident-caption.js";
import type { CircuitLabelState } from "../src/circuit/layout-routes.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { jumperChainCircuitFixture } from "./circuit-fixture.js";
import base from "./fixtures/coincident-caption-base.json";
import { required } from "./fixtures.js";
import { printableTextWidth } from "../src/text-metrics.js";
type Segment = CircuitLabelState["segments"][number];
const segment = (index: number, x: number, end: number): Segment => ({
  index,
  a: { x, y: 10 },
  b: { x: end, y: 10 },
});
it("admits only complete foreign collinear coverage, including stitched and reversed segments", () => {
  expect(
    fullyCoincidentCaption(0, [
      segment(0, 0, 20),
      segment(1, 10, 0),
      segment(2, 10, 20),
    ]),
  ).toBe(true);
  expect(
    fullyCoincidentCaption(0, [
      segment(0, 0, 20),
      segment(1, 0, 9),
      segment(2, 10, 20),
    ]),
  ).toBe(false);
  expect(
    fullyCoincidentCaption(0, [segment(0, 0, 20), segment(1, 0, 19.99)]),
  ).toBe(false);
  expect(
    fullyCoincidentCaption(0, [
      segment(0, 0, 20),
      { ...segment(1, 0, 20), a: { x: 0, y: 10.01 }, b: { x: 20, y: 10.01 } },
    ]),
  ).toBe(false);
  expect(
    fullyCoincidentCaption(0, [segment(0, 0, 20), segment(0, 0, 20)]),
  ).toBe(false);
  expect(fullyCoincidentCaption(0, [])).toBe(false);
  expect(fullyCoincidentCaption(0, [segment(0, 0, 0), segment(1, 0, 20)])).toBe(
    false,
  );
  expect(
    fullyCoincidentCaption(0, [
      { index: 0, a: { x: 0, y: 0 }, b: { x: 20, y: 10 } },
      segment(1, 0, 20),
    ]),
  ).toBe(false);
  expect(
    fullyCoincidentCaption(0, [
      { index: 0, a: { x: 10, y: 0 }, b: { x: 10, y: 20 } },
      { index: 1, a: { x: 10, y: 20 }, b: { x: 10, y: 0 } },
    ]),
  ).toBe(true);
  expect(
    fullyCoincidentCaption(0, [
      segment(0, 0, 20),
      segment(1, 0, 20),
      { index: 0, a: { x: 20, y: 10 }, b: { x: 20, y: 11 } },
    ]),
  ).toBe(false);
});
function measureRoute(
  drawing: Element,
  route: Element,
  name: string,
  baseline: { ends: string[]; landings?: string; path?: string },
) {
  const uid = required(route.getAttribute("data-circuit-conductor"));
  const caption = required(drawing.querySelector(`[data-wire-label="${uid}"]`));
  expect(caption.hasAttribute("data-circuit-caption-fallback")).toBe(false);
  const printed = required(caption.querySelector("text"));
  expect(printed.textContent).toBe(name);
  expect(printed.getAttribute("font-size")).toBe("2.5");
  const width = Number(caption.querySelector("rect")?.getAttribute("width"));
  expect(width).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(printableTextWidth(name, 2.5) + 1.501);
  expect(
    JSON.parse(required(route.getAttribute("data-endpoints"))).map(
      (end: { terminalKey: string }) => end.terminalKey,
    ),
  ).toEqual(baseline.ends);
  const path = required(required(route.lastElementChild).getAttribute("d"));
  const actual = [...path.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/gu)].map(
    ([, x, y]) => ({ x: Number(x), y: Number(y) }),
  );
  if (baseline.landings !== undefined) {
    const first = required(actual[0]),
      last = required(actual.at(-1));
    expect(`${first.x} ${first.y} / ${last.x} ${last.y}`).toBe(
      baseline.landings,
    );
    expect(route.querySelector('path[stroke="white"]')).toBeNull();
    expect(route.lastElementChild?.getAttribute("data-circuit-fan-in")).toBe(
      `source:1 target:${actual.length - 3}`,
    );
  } else expect(path).toBe(baseline.path);
  return actual;
}

function expectTerminalFanJunctions(
  drawing: Element,
  indexed: ReturnType<typeof measureRoute>[],
  nested: ReturnType<typeof measureRoute>[],
) {
  const fan = nested.flatMap((p) => [
    required(p[1]),
    required(p[2]),
    required(p.at(-2)),
  ]);
  const dots = new Map(
    [...drawing.querySelectorAll("[data-circuit-junction]")].map((e) => [
      `${e.getAttribute("cx")},${e.getAttribute("cy")}`,
      e,
    ]),
  );
  for (const p of fan) {
    const directions = new Set<string>();
    for (const points of indexed)
      for (const [i, a] of points.slice(0, -1).entries()) {
        const b = required(points[i + 1]);
        if (
          p.x < Math.min(a.x, b.x) ||
          p.x > Math.max(a.x, b.x) ||
          p.y < Math.min(a.y, b.y) ||
          p.y > Math.max(a.y, b.y)
        )
          continue;
        for (const q of [a, b]) {
          if (q.x !== p.x) directions.add(q.x < p.x ? "W" : "E");
          if (q.y !== p.y) directions.add(q.y < p.y ? "N" : "S");
        }
      }
    expect(directions.size).toBeLessThanOrEqual(3);
    const dot = dots.get(`${p.x},${p.y}`);
    if (directions.size === 3) {
      expect(dot?.getAttribute("data-device-uid")).toBeTruthy();
      expect(dot?.getAttribute("data-terminal-key")).toBeTruthy();
    } else expect(dot).toBeUndefined();
  }
}
it.each(base.cases)(
  "separates the shared routes in $name ($flow) at their original terminals",
  async ({ name, flow, pages, groups }) => {
    const dir = `libraries/siemens-pilot/examples/${name}`,
      compiled = await compileProject(dir);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const request = JSON.parse(
      await readFile(`${dir}/packet.request.json`, "utf8"),
    );
    for (const view of request.views) view.flow = flow;
    const before = JSON.stringify([compiled.ir, request]);
    const rendered = await renderSchematicPacket(
      compiled.ir,
      request,
      compiled.presentation,
    );
    if (!rendered.ok) throw Error(JSON.stringify(rendered.error));
    expect(rendered.value.sheets).toHaveLength(pages);
    expect(JSON.stringify([compiled.ir, request])).toBe(before);

    for (const { sheet, group, routes: expected } of groups) {
      const { document } = parseHTML(
        required(rendered.value.sheets[sheet - 1]).svg,
      );
      const drawing = required(
        document.querySelector(`[data-circuit-group="${group}"]`),
      );
      const paths = [...drawing.querySelectorAll("[data-circuit-conductor]")];
      const indexed = Object.entries(expected).map(([name, baseline]) => {
        const route = required(
          paths.find(
            (p) => p.getAttribute("data-conductor-designation") === name,
          ),
        );
        return measureRoute(drawing, route, name, baseline);
      });
      expect(paths).toHaveLength(indexed.length);
      const nested = paths.filter((path) =>
        path.lastElementChild?.hasAttribute("data-circuit-fan-in"),
      );
      expect(nested.length).toBeGreaterThan(1);
      expect(paths.slice(-nested.length)).toEqual(nested);
      expectTerminalFanJunctions(
        drawing,
        indexed,
        indexed.filter((_, i) => !!Object.values(expected)[i]?.landings),
      );
      const segments = indexed.flatMap((points, index) =>
        points.slice(1).map((b, i) => ({ index, a: required(points[i]), b })),
      );
      for (const [index, name] of Object.keys(expected).entries())
        expect(fullyCoincidentCaption(index, segments), name).toBe(false);
    }
  },
);

it("records the retained fallback for parallel loops with identical terminal pairs", async () => {
  const dir = "packages/render/test/fixtures/coincident-loops",
    compiled = await compileProject(dir);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const request = JSON.parse(
    await readFile(`${dir}/packet.request.json`, "utf8"),
  );
  for (const flow of ["left-to-right", "top-to-bottom"]) {
    request.views[0].flow = flow;
    const rendered = await renderSchematicPacket(compiled.ir, request);
    if (!rendered.ok) throw Error(JSON.stringify(rendered.error));
    expect(rendered.value.sheets).toHaveLength(1);
    const { document } = parseHTML(required(rendered.value.sheets[0]).svg);
    const fallbacks = [
      ...document.querySelectorAll(
        '[data-circuit-caption-fallback="fully-coincident"]',
      ),
    ].map((label) => label.textContent);
    expect(fallbacks.sort(), flow).toEqual(["FIXED1", "FIXED2"]);
  }
});

it("recovers the ABB and both-flow external jumper positives without a new refusal or page", async () => {
  const dir = "libraries/abb-pilot/examples/1sna356204r1100",
    c = await compileProject(dir);
  expect(c.ok).toBe(true);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const abb = await renderSchematicPacket(
    c.ir,
    JSON.parse(await readFile(`${dir}/packet.request.json`, "utf8")),
  );
  expect(abb.ok).toBe(true);
  if (!abb.ok) throw Error(JSON.stringify(abb.error));
  expect(abb.value.sheets).toHaveLength(1);
  const f = await jumperChainCircuitFixture();
  try {
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      const request = {
          format: "schematic-packet-request/0.1",
          views: [{ ...f.view, flow }],
        },
        before = JSON.stringify([f.ir, request]),
        rendered = await renderSchematicPacket(f.ir, request);
      expect(rendered.ok, flow).toBe(true);
      if (!rendered.ok) throw Error(JSON.stringify(rendered.error));
      expect(rendered.value.sheets).toHaveLength(1);
      expect(JSON.stringify([f.ir, request])).toBe(before);
    }
  } finally {
    await f.dispose();
  }
});
