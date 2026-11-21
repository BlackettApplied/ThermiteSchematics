import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { prepareWiringDrawing } from "../src/wiring.js";
import * as runtime from "../src/layout/elk-runtime.js";
import {
  chooseIndependentWiring,
  MAX_INDEPENDENT_WIRING_LAYOUTS,
} from "../src/layout/wiring-independent.js";
import { independentWiringInput } from "../src/layout/wiring-landings.js";
import { wiringGeometryInUnits } from "../src/layout/wiring-unit-space.js";
import {
  circuitConductorGuard,
  circuitConductorNonRegression,
} from "../src/layout/circuit-route-quality.js";
import { consoleWiringFixture } from "./wiring-landings-fixture.js";
import { required } from "./fixtures.js";
import { physicalRoutes } from "./helpers/wiring-landings.js";
import { lengths } from "./helpers/route-quality.js";
import { renderSchematicPacket } from "../src/sheets.js";
import * as landings from "../src/layout/wiring-landings.js";
import { compileCoreFixture } from "./fixtures.js";
import { b4Round9Fixture } from "./b4-fixtures.js";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import { svgSemanticId } from "../src/svg/escape.js";

const factory = runtime.createElkEngine;
let source: Awaited<ReturnType<typeof consoleWiringFixture>>;
let baseline: { input: ElkNode; output: ElkNode };
function recordingEngine(records: { input: ElkNode; output: ElkNode }[]) {
  const engine = factory(),
    native = engine.layout.bind(engine);
  engine.layout = async (input, options) => {
    const before = structuredClone(input),
      result = await native(input, options);
    records.push({ input: before, output: structuredClone(result) });
    return result;
  };
  return engine;
}
beforeAll(async () => {
  source = await consoleWiringFixture();
  const records: { input: ElkNode; output: ElkNode }[] = [];
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() =>
    recordingEngine(records),
  );
  try {
    await prepareWiringDrawing(source.ir, source.request.views[3]);
    baseline = required(records[0]);
  } finally {
    vi.restoreAllMocks();
  }
});
afterEach(() => vi.restoreAllMocks());

it("uses exactly one baseline and one constrained native layout for either landing repair", async () => {
  expect(MAX_INDEPENDENT_WIRING_LAYOUTS).toBe(2);
  for (const view of [0, 3]) {
    const records: { input: ElkNode; output: ElkNode }[] = [];
    vi.spyOn(runtime, "createElkEngine").mockImplementation(() =>
      recordingEngine(records),
    );
    const drawing = await prepareWiringDrawing(
      source.ir,
      source.request.views[view],
    );
    expect(records).toHaveLength(2);
    const doc = parseHTML(`<svg>${drawing.content}</svg>`).document;
    expect(doc.querySelectorAll("[data-wiring-landing-for]")).toHaveLength(2);
    const first = required(records[0]),
      second = required(records[1]);
    expect(required(second.input.children?.[0]).width).toBe(
      required(first.input.children?.[0]).width * 2,
    );
    expect(second.input.layoutOptions?.["elk.spacing.edgeLabel"]).toBe("4");
    expect(
      second.input.layoutOptions?.["elk.layered.spacing.edgeNodeBetweenLayers"],
    ).toBe("5");
    expect(
      second.input.layoutOptions?.["elk.layered.spacing.nodeNodeBetweenLayers"],
    ).toBe("10");
    vi.restoreAllMocks();
  }
});

it("retains the original drawing when the final sheet composition rejects a candidate", async () => {
  const admit = vi.fn(() => false);
  const drawing = await prepareWiringDrawing(
    source.ir,
    source.request.views[3],
    admit,
  );
  expect(admit).toHaveBeenCalledTimes(1);
  expect(
    parseHTML(`<svg>${drawing.content}</svg>`).document.querySelectorAll(
      "[data-wiring-landing-for]",
    ),
  ).toHaveLength(0);
});

it("keeps wire identity when the native output edge array is reordered", async () => {
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      native = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const result = await native(input, options);
      result.edges?.reverse();
      return result;
    };
    return engine;
  });
  const drawing = await prepareWiringDrawing(
    source.ir,
    source.request.views[3],
  );
  expect(
    physicalRoutes(
      parseHTML(`<svg>${drawing.content}</svg>`).document,
      source.ir,
    ),
  ).toHaveLength(3);
});

it("rejects a detached constrained endpoint without snapping it back after routing", async () => {
  const engine = factory(),
    native = engine.layout.bind(engine);
  engine.layout = async (input, options) => {
    const result = structuredClone(await native(input, options));
    const edge = required(
      result.edges?.find((e) => e.sources.some((id) => id.includes("landing"))),
    );
    const section = required(edge.sections?.[0]),
      next = section.bendPoints?.[0] ?? section.endPoint;
    // Detach 0.1 mm along the native run, inside the terminal mark. Other
    // geometry guards must not conceal a disabled native endpoint binding.
    if (Math.abs(next.x - section.startPoint.x) > 1e-7)
      section.startPoint.x += Math.sign(next.x - section.startPoint.x) * 0.2;
    else section.startPoint.y += Math.sign(next.y - section.startPoint.y) * 0.2;
    return result;
  };
  expect(
    await chooseIndependentWiring(baseline.input, baseline.output, engine),
  ).toBe(baseline.output);
});

it("rejects a same-net exchange of complete routes and port flags between physical conductors", async () => {
  const engine = factory(),
    native = engine.layout.bind(engine);
  engine.layout = async (input, options) => {
    const result = structuredClone(await native(input, options));
    const a = required(result.edges?.[0]),
      b = required(result.edges?.[1]);
    [a.sources, b.sources] = [b.sources, a.sources];
    [a.targets, b.targets] = [b.targets, a.targets];
    [a.sections, b.sections] = [b.sections, a.sections];
    return result;
  };
  expect(
    await chooseIndependentWiring(baseline.input, baseline.output, engine),
  ).toBe(baseline.output);
});

it("round-trips every native geometry population through solver units without mutating source", () => {
  const graph: ElkNode = {
    id: "units",
    width: 100,
    height: 50,
    children: [
      {
        id: "a",
        x: 5,
        y: 6,
        width: 20,
        height: 30,
        ports: [{ id: "p", x: 20, y: 6.5 }],
        labels: [{ text: "tag", x: 2, y: 3, width: 4, height: 5 }],
      },
    ],
    edges: [
      {
        id: "wire",
        sources: ["p"],
        targets: ["q"],
        junctionPoints: [{ x: 40, y: 12.5 }],
        labels: [{ text: "wire", x: 30, y: 5, width: 10, height: 8 }],
        sections: [
          {
            id: "s",
            startPoint: { x: 25, y: 12.5 },
            endPoint: { x: 80, y: 20 },
            bendPoints: [
              { x: 40, y: 12.5 },
              { x: 40, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  const original = structuredClone(graph),
    units = wiringGeometryInUnits(graph, 2);
  expect(required(required(units.children?.[0]).ports?.[0]).y).toBe(13);
  expect(required(required(units.edges?.[0]).junctionPoints?.[0]).y).toBe(25);
  expect(required(required(units.edges?.[0]).sections?.[0]).startPoint.y).toBe(
    25,
  );
  expect(required(required(units.edges?.[0]).labels?.[0]).height).toBe(16);
  expect(wiringGeometryInUnits(units, 0.5)).toEqual(original);
  expect(graph).toEqual(original);
});

function routed(height: number): ElkNode {
  return {
    id: "route",
    edges: [
      {
        id: "unchanged-wire",
        sources: ["a"],
        targets: ["b"],
        sections: [
          {
            id: "section",
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 100, y: 0 },
            bendPoints: [
              { x: 30, y: 0 },
              { x: 30, y: height },
              { x: 70, y: height },
              { x: 70, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}
it("uses the existing per-conductor envelope and preserves ordinary quality's strict improvement goal", () => {
  const original = routed(10),
    boundary = routed(25),
    overBudget = routed(25.1);
  expect(circuitConductorNonRegression(boundary, original)).toBe(true);
  expect(circuitConductorNonRegression(overBudget, original)).toBe(false);
  expect(circuitConductorGuard(boundary, original)).toBe(false);
});

it("keeps one physical port and bounded attachment coordinates for every declared incidence", () => {
  const plan = required(
    independentWiringInput(baseline.input, baseline.output),
  );
  expect(plan.aliases.size).toBe(2);
  const ports = (plan.input.children ?? []).flatMap((n) => n.ports ?? []);
  for (const [alias, physical] of plan.aliases) {
    const a = required(ports.find((p) => p.id === alias)),
      b = required(ports.find((p) => p.id === physical));
    expect(
      Math.hypot(required(a.x) - required(b.x), required(a.y) - required(b.y)),
    ).toBeLessThanOrEqual(0.7);
    expect(ports.filter((p) => p.id === physical)).toHaveLength(1);
  }
});

it("keeps every console supply route, including W-C06 and W-C10, at its accepted per-wire baseline", async () => {
  const drawing = await prepareWiringDrawing(
    source.ir,
    source.request.views[1],
  );
  const routes = physicalRoutes(
    parseHTML(`<svg>${drawing.content}</svg>`).document,
    source.ir,
  );
  const measured = Object.fromEntries(
    routes.map((r) => [
      required(source.ir.wires.find((w) => w.uid === r.id)).designation,
      {
        length: Number(
          lengths(r.ps)
            .reduce((a, b) => a + b, 0)
            .toFixed(3),
        ),
        bends: r.ps.length - 2,
      },
    ]),
  );
  expect(measured).toEqual({
    "W-C07": { length: 89.033, bends: 2 },
    "W-C08": { length: 122.033, bends: 2 },
    "W-C06": { length: 117.033, bends: 4 },
    "W-C09": { length: 54.045, bends: 0 },
    "W-C10": { length: 270.078, bends: 4 },
  });
});

it("retains the accepted wiring scale when a native reservation fits only the baseline at that scale", async () => {
  const request = {
    format: "schematic-packet-request/0.1" as const,
    page: {
      size: "tabloid" as const,
      orientation: "landscape" as const,
      marginMm: 20,
    },
    views: [source.request.views[0]],
    index: false,
  };
  vi.spyOn(landings, "independentWiringInput").mockReturnValue(undefined);
  const original = await renderSchematicPacket(source.ir, request);
  vi.restoreAllMocks();
  const oversized = vi.fn();
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      native = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const graph = await native(input, options);
      if (
        input.children?.some((node) =>
          node.ports?.some((p) => p.id.includes("-landing-")),
        )
      ) {
        graph.width = required(graph.width) + 400;
        oversized();
      }
      return graph;
    };
    return engine;
  });
  const candidate = await renderSchematicPacket(source.ir, request);
  expect(oversized).toHaveBeenCalled();
  expect(original.ok).toBe(true);
  expect(candidate.ok).toBe(true);
  if (!original.ok || !candidate.ok)
    throw Error("Missing public wiring packet");
  expect(candidate.value.sheets.map((s) => s.svg)).toEqual(
    original.value.sheets.map((s) => s.svg),
  );
});

it("does not let another conductor's savings pay for an over-budget route", () => {
  const before = routed(10),
    after = routed(25.1);
  required(before.edges).push({
    id: "large-saving",
    sources: ["c"],
    targets: ["d"],
    sections: [
      {
        id: "s",
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 200, y: 0 },
        bendPoints: [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
          { x: 150, y: 100 },
          { x: 150, y: 0 },
        ],
      },
    ],
  });
  required(after.edges).push({
    id: "large-saving",
    sources: ["c"],
    targets: ["d"],
    sections: [
      { id: "s", startPoint: { x: 0, y: 0 }, endPoint: { x: 200, y: 0 } },
    ],
  });
  expect(circuitConductorNonRegression(after, before)).toBe(false);
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps real native three-way junctions painted in %s",
  async (flow) => {
    const ir = b4Round9Fixture(await compileCoreFixture());
    const prepared = await prepareSchematicDrawing(ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: false,
      },
      flow,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw Error(JSON.stringify(prepared.error));
    const p = prepared.value,
      junctions = p.graph.nodes.filter((n) => n.kind === "junction");
    expect(junctions).toHaveLength(3);
    const emitted = emitSchematicSvg(
      p.graph,
      p.layout,
      p.titleContext,
      undefined,
      false,
      0.25,
      ir,
    );
    expect(emitted.ok).toBe(true);
    if (!emitted.ok) throw Error(JSON.stringify(emitted.error));
    const doc = parseHTML(emitted.value).document;
    for (const junction of junctions) {
      const mark = doc.querySelector(
        `[id="${svgSemanticId("junction", [junction.id])}"]`,
      );
      expect(mark?.tagName.toLowerCase()).toBe("circle");
      expect(Number(mark?.getAttribute("r"))).toBe(3);
      expect(mark?.getAttribute("fill")).not.toBe("none");
    }
  },
);

it("falls back when the native landing candidate has an unpaintable label reservation", async () => {
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      native = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const constrained = input.children?.some((n) =>
        n.ports?.some((p) => p.id.includes("landing")),
      );
      const result = await native(input, options);
      if (constrained)
        required(required(result.edges?.[0]).labels?.[0]).width = NaN;
      return result;
    };
    return engine;
  });
  const result = prepareWiringDrawing(
    source.ir,
    source.request.views[3],
    () => true,
  );
  await expect(result).resolves.toHaveProperty(
    "title",
    source.request.views[3].title,
  );
  const drawing = await result;
  expect(
    parseHTML(`<svg>${drawing.content}</svg>`).document.querySelectorAll(
      "[data-wiring-landing-for]",
    ),
  ).toHaveLength(0);
});
