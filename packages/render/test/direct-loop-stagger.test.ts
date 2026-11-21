import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import * as runtime from "../src/layout/elk-runtime.js";
import { measureText } from "../src/text-metrics.js";
import { layoutDirectLoop } from "../src/layout/direct-loop-layout.js";
import { InlineLabelFitError } from "../src/layout/inline-label-error.js";
import { assertTopologyRouteEndpoints } from "../src/layout/topology-conservation.js";
import graphFixture from "./direct-loop-jog.fixture.json";
import { checkLabels, prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { fixture, removeFixtures } from "../../cli/test/analog-output.cases.js";
import { flows } from "./direct-loop-fixture.js";
import { lengths, points } from "./helpers/route-quality.js";
import { elkWorkLedger, elkWorkScope } from "../src/layout/elk-work.js";

const names = ["W1XXXXXXX", "W2XXXXXX", "W3XXXXX", "W4XXX", "W5XXXXX", "W6"];
afterEach(async () => {
  vi.restoreAllMocks();
  await removeFixtures();
});

it.each(flows)(
  "keeps the mixed-width loop landed without printed sub-3 mm jogs in %s",
  async (flow) => {
    const f = await fixture();
    let index = 0;
    for (const object of f.source.objects)
      if (object.kind === "wire") object.designation = names[index++];
    const ir = await f.compile();
    const snapshot = JSON.stringify(ir);
    const request = { ...f.packet.views[0], flow };
    const work = elkWorkLedger("mixed-width-loop", 10);
    const drawing = await elkWorkScope.run(work, () =>
      prepareSignalLoopDrawing(ir, request),
    );
    const document = parseHTML(drawing.content).document;
    const routes = [...document.querySelectorAll("[data-loop-conductor]")];
    expect(routes).toHaveLength(6);
    expect(
      routes.map((route) => route.getAttribute("data-loop-conductor")).sort(),
    ).toEqual(ir.wires.map((wire) => wire.uid).sort());
    for (const route of routes) {
      const wire = ir.wires.find(
        (w) => w.uid === route.getAttribute("data-loop-conductor"),
      );
      if (!wire) throw new Error("Missing source wire");
      expect(
        JSON.parse(route.getAttribute("data-terminal-ends") ?? "null"),
      ).toEqual(wire.endpoints.map((end) => end.terminal));
      const net = ir.nets.find((net) =>
        wire.endpoints.every((end) =>
          net.terminalIds.some(
            (terminal) =>
              terminal.deviceUid === end.terminal.deviceUid &&
              terminal.terminalKey === end.terminal.terminalKey,
          ),
        ),
      );
      expect(net).toBeDefined();
      expect(route.getAttribute("data-net-id")).toBe(net?.id);
      expect(route.textContent).toContain(wire.designation);
      expect(
        lengths(points(route.querySelector("path")?.getAttribute("d") ?? ""))
          .slice(1, -1)
          .filter((length) => length > 0.05 && length < 3 - 1e-5),
        wire.designation,
      ).toEqual([]);
    }
    expect(work.calls).toBeLessThanOrEqual(3);
    expect(work.dispatches).toBe(work.calls);
    const rendered = await renderSchematicPacket(ir, {
      ...f.packet,
      views: [request],
      page: {
        ...f.packet.page,
        orientation: flow === "top-to-bottom" ? "portrait" : "landscape",
      },
    });
    expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
    if (rendered.ok) expect(rendered.value.sheets).toHaveLength(2);
    expect(JSON.stringify(ir)).toBe(snapshot);
  },
);

it("bounds rejected staggers and returns the complete native fallback graph", async () => {
  const { children, edges } = structuredClone(graphFixture);
  for (const [index, edge] of edges.slice(0, 6).entries())
    edge.labels[0].width = measureText(names[index] ?? "", 2.7).width + 2;
  const native: ElkNode[] = [];
  const factory = runtime.createElkEngine;
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory();
    const layout = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const graph = await layout(input, options);
      native.push(structuredClone(graph));
      return graph;
    };
    return engine;
  });
  let validations = 0;
  const work = elkWorkLedger("rejected-staggers", 10);
  const graph = await elkWorkScope.run(work, () =>
    layoutDirectLoop(
      children,
      edges,
      true,
      edges.slice(0, 6).map((edge) => edge.id),
      () => {
        validations++;
        throw new InlineLabelFitError("synthetic finite fit veto");
      },
    ),
  );
  expect(work.calls).toBe(3);
  expect(work.dispatches).toBe(3);
  expect(validations).toBe(5);
  expect(graph).toEqual(native[1]);
  checkLabels(graph);
  assertTopologyRouteEndpoints(graph);
});

it("retains every native route and fixed port in an accepted stagger", async () => {
  const { children, edges } = structuredClone(graphFixture);
  for (const [index, edge] of edges.slice(0, 6).entries())
    edge.labels[0].width = measureText(names[index] ?? "", 2.7).width + 2;
  const fixed = structuredClone(children);
  const native: ElkNode[] = [];
  const factory = runtime.createElkEngine;
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory();
    const layout = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const graph = await layout(input, options);
      native.push(structuredClone(graph));
      return graph;
    };
    return engine;
  });
  const graph = await layoutDirectLoop(
    children,
    edges,
    true,
    edges.slice(0, 6).map((edge) => edge.id),
    checkLabels,
  );
  expect(native).toHaveLength(3);
  expect(graph.children).toEqual(native[2]?.children);
  expect(JSON.stringify(graph.children?.map((node) => node.ports))).toBe(
    JSON.stringify(fixed.map((node) => node.ports)),
  );
  expect(graph.edges?.map(({ labels: _, ...edge }) => edge)).toEqual(
    native[2]?.edges?.map(({ labels: _, ...edge }) => edge),
  );
  expect(
    graph.edges?.map((edge) => ({
      id: edge.id,
      sources: edge.sources,
      targets: edge.targets,
    })),
  ).toEqual(
    edges.map((edge) => ({
      id: edge.id,
      sources: edge.sources,
      targets: edge.targets,
    })),
  );
  assertTopologyRouteEndpoints(graph);
  checkLabels(graph);
});

it("retains native fallback when a stagger would shave a neighbouring wire stroke", async () => {
  const { children, edges } = structuredClone(graphFixture);
  const crowded = ["W1XX", "W2XXXXXXXXXX", "W3", "W4XXXXXXXXX", "W5X", "W6"];
  for (const [index, edge] of edges.slice(0, 6).entries())
    edge.labels[0].width = measureText(crowded[index] ?? "", 2.7).width + 2;
  const native: ElkNode[] = [];
  const factory = runtime.createElkEngine;
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      layout = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const graph = await layout(input, options);
      native.push(structuredClone(graph));
      return graph;
    };
    return engine;
  });
  const graph = await layoutDirectLoop(
    children,
    edges,
    true,
    edges.slice(0, 6).map((edge) => edge.id),
    checkLabels,
  );
  expect(native).toHaveLength(3);
  expect(graph).toEqual(native[1]);
});

it("retains native fallback when an alternative grows the drawing envelope", async () => {
  const { children, edges } = structuredClone(graphFixture);
  for (const [index, edge] of edges.slice(0, 6).entries())
    edge.labels[0].width = measureText(names[index] ?? "", 2.7).width + 2;
  const native: ElkNode[] = [];
  const factory = runtime.createElkEngine;
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      layout = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const graph = await layout(input, options);
      if (native.length === 2) {
        const fallback = native[1];
        if (fallback?.height === undefined)
          throw new Error("Missing native envelope");
        graph.height = fallback.height + 1;
      }
      native.push(structuredClone(graph));
      return graph;
    };
    return engine;
  });
  const graph = await layoutDirectLoop(
    children,
    edges,
    true,
    edges.slice(0, 6).map((edge) => edge.id),
    checkLabels,
  );
  expect(native).toHaveLength(3);
  expect(graph).toEqual(native[1]);
});

it("retains native fallback when the optional candidate exhausts the work budget", async () => {
  const { children, edges } = structuredClone(graphFixture);
  for (const [index, edge] of edges.slice(0, 6).entries())
    edge.labels[0].width = measureText(names[index] ?? "", 2.7).width + 2;
  const native: ElkNode[] = [];
  const factory = runtime.createElkEngine;
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      layout = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      const graph = await layout(input, options);
      native.push(structuredClone(graph));
      return graph;
    };
    return engine;
  });
  const work = elkWorkLedger("optional-stagger-budget", 2);
  const outcome = await elkWorkScope
    .run(work, () =>
      layoutDirectLoop(
        children,
        edges,
        true,
        edges.slice(0, 6).map((edge) => edge.id),
        checkLabels,
      ),
    )
    .then(
      (graph) => ({ graph }),
      (error: unknown) => ({ error }),
    );
  expect(outcome).toEqual({ graph: native[1] });
  expect(work.calls).toBe(2);
  expect(work.dispatches).toBe(2);
});

it("propagates an unexpected optional-candidate layout error by identity", async () => {
  const { children, edges } = structuredClone(graphFixture);
  for (const [index, edge] of edges.slice(0, 6).entries())
    edge.labels[0].width = measureText(names[index] ?? "", 2.7).width + 2;
  const failure = new TypeError("synthetic optional layout failure");
  let layouts = 0;
  const factory = runtime.createElkEngine;
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      layout = engine.layout.bind(engine);
    engine.layout = async (input, options) => {
      if (++layouts === 3) throw failure;
      return layout(input, options);
    };
    return engine;
  });
  const outcome = await layoutDirectLoop(
    children,
    edges,
    true,
    edges.slice(0, 6).map((edge) => edge.id),
    checkLabels,
  ).then(
    (graph) => graph,
    (error: unknown) => error,
  );
  expect(layouts).toBe(3);
  expect(outcome).toBe(failure);
});
