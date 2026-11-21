import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import {
  robustnessFixture,
  byDesignation,
} from "./render-robustness-fixture.js";
import {
  renderSchematic,
  createSchematicRendererWithDependencies,
} from "../src/renderer.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { selectLoadsSubgraph } from "../src/selection.js";
import {
  buildPresentationGraph,
  validatePresentationGraph,
} from "../src/presentation.js";
import * as validation from "../src/layout/validate-output.js";
import type { InvalidLayoutError } from "../src/errors.js";
import { rootedRouteAlternatives } from "../src/layout/direct-load-routes.js";

let fixture: Awaited<ReturnType<typeof robustnessFixture>>;
beforeAll(async () => {
  fixture = await robustnessFixture();
});
afterAll(async () => {
  await fixture.close();
});
const request = {
  format: "schematic-view-request/0.2",
  root: byDesignation("PS1"),
  intent: { kind: "loads" },
} as const;
// Update using: VITEST_MAX_WORKERS=2 bun run test -- packages/render/test/load-layout.test.ts --update
it.each(["plc3", "daisy"] as const)(
  "locks the %s golden in both flows",
  async (variant) => {
    const { ir } = await fixture.compile(variant, 0);
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const r = await renderSchematic(ir, { ...request, flow });
      if (!r.ok) throw Error(JSON.stringify(r.error));
      expect(r.value.summary.conductiveElementIds).toHaveLength(
        variant === "plc3" ? 6 : 4,
      );
      await expect(r.value.svg).toMatchFileSnapshot(
        fileURLToPath(
          new URL(
            `snapshots/semantic-ordering/${variant}-${flow}.svg`,
            import.meta.url,
          ),
        ),
      );
    }
  },
);

async function comb(variant: "plc3" | "plc4" | "daisy" = "plc4") {
  const { ir } = await fixture.compile(variant, 0);
  const normalized = normalizeSchematicView(ir, request);
  if (
    !normalized.ok ||
    normalized.value.view.format !== "schematic-view/0.2" ||
    normalized.value.view.intent !== "loads"
  )
    throw Error("Expected loads view");
  const selected = selectLoadsSubgraph({
    ir,
    view: normalized.value.view,
    engine: normalized.value.engine,
  });
  if (!selected.ok) throw Error(JSON.stringify(selected.error));
  const presented = buildPresentationGraph({ ir, selected: selected.value });
  if (!presented.ok) throw Error(JSON.stringify(presented.error));
  return { ir, selected: selected.value, graph: presented.value.graph };
}

it.each([
  ["plc3", 36],
  ["plc4", 285],
  ["daisy", 36],
] as const)(
  "tries every %s side assignment only once (%s layouts)",
  async (variant, expected) => {
    const { graph } = await comb(variant);
    const keys = [graph, ...rootedRouteAlternatives(graph)].map((g) =>
      JSON.stringify(
        g.nodes
          .filter((n) => n.kind === "junction")
          .map((n) => n.ports.map((p) => p.side)),
      ),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(expected);
  },
);

it("rejects a missing load conductor, a missing comb link and an inter-terminal link", async () => {
  const { ir, selected, graph } = await comb();
  const link = graph.edges.find(
    (e) => e.kind === "boundary-segment" && e.id.includes("comb-link"),
  )!;
  const wire = graph.edges.find((e) => e.kind === "conductor")!;
  for (const removed of [wire, link]) {
    const copy = {
      ...structuredClone(graph),
      edges: graph.edges.filter((e) => e.id !== removed.id),
    };
    expect(() => validatePresentationGraph(ir, selected, copy)).toThrow();
  }
  const copy = structuredClone(graph);
  const wrong = copy.edges.find(
    (e) => e.kind === "conductor" && e.netId !== link.netId,
  )!;
  const cross = {
    ...copy,
    edges: copy.edges.map((e) =>
      e.id === link.id ? { ...e, targetPortId: wrong.targetPortId } : e,
    ),
  };
  expect(() => validatePresentationGraph(ir, selected, cross)).toThrow(
    "port nets",
  );
});

it.each(["collinear-overlap", "contract-violation"] as const)(
  "bounds larger-load recovery after %s and preserves every refusal field",
  async (failureKind) => {
    const { ir } = await comb();
    const failure: InvalidLayoutError = {
      code: "R004",
      family: "control",
      root: "PS1",
      message: "Invalid layout: synthetic overlap.",
      netId: ir.nets[0]!.id,
    };
    const spy = vi
      .spyOn(validation, "normalizeAndValidateLayout")
      .mockReturnValue({
        ok: false,
        error: failure,
        failureKind,
      });
    const engine = createElkEngine();
    let count = 0,
      identities: string | undefined;
    engine.layout = async (input) => {
      count++;
      const current = JSON.stringify(
        input.edges!.map((e) => [e.id, e.sources, e.targets]),
      );
      identities ??= current;
      expect(current).toBe(identities);
      return input;
    };
    try {
      const r = await createSchematicRendererWithDependencies({
        layoutEngine: engine,
      }).render(ir, request);
      expect(count).toBeGreaterThan(36);
      expect(count).toBeLessThanOrEqual(291);
      expect(r).toMatchObject({
        ok: false,
        error: {
          ...failure,
          message: expect.stringContaining(failure.message),
          details: { loads: expect.any(Array) },
        },
      });
    } finally {
      spy.mockRestore();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "recovers duplicate-potential plc4 after its label collision in %s",
  async (flow) => {
    const { ir } = await fixture.compile("plc4", 0, {
      duplicatePotentials: true,
    });
    const engine = createElkEngine();
    const layout = engine.layout.bind(engine);
    let count = 0;
    engine.layout = (input, options) => {
      count++;
      return layout(input, options);
    };
    const r = await createSchematicRendererWithDependencies({
      layoutEngine: engine,
    }).render(ir, { ...request, flow });
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(291);
    expect(r.ok, JSON.stringify(r.ok ? {} : r.error)).toBe(true);
    if (!r.ok) throw Error(r.error.message);
    for (const designation of ["PLC1", "PLC2", "PLC3", "PLC4"])
      expect(r.value.svg).toContain(`data-designation="${designation}"`);
  },
);
