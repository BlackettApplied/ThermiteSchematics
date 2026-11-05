import {
  irSemanticOrder,
  compareSemanticElementIds,
} from "../src/semantic-order.js";
import { renderSchematicSheets } from "../src/sheets.js";
import { createHash } from "node:crypto";
import { normalizeSchematicView } from "../src/view-spec.js";
import { selectLoadsSubgraph } from "../src/selection.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { buildElkAdapterGraph } from "../src/layout/elk-adapter.js";
import { compileCoreFixture } from "./fixtures.js";
import { b4Round9Fixture } from "./b4-fixtures.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  reidentify,
  rootedRequests,
  semanticIdentities,
} from "./semantic-ordering-fixture.js";
import type { SchematicViewRequest } from "../src/types.js";
import {
  createSchematicRendererWithDependencies,
  renderSchematic,
} from "../src/renderer.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import {
  robustnessFixture,
  byDesignation,
} from "./render-robustness-fixture.js";

let fixture: Awaited<ReturnType<typeof robustnessFixture>>;
beforeAll(async () => {
  fixture = await robustnessFixture();
});
afterAll(async () => {
  await fixture.close();
});
const flows = ["left-to-right", "top-to-bottom"] as const;
const loads = {
  format: "schematic-view-request/0.2",
  root: byDesignation("PS1"),
  intent: { kind: "loads" },
} as const;

it("keeps every plant power ELK input independent of UIDs (30 seeds)", async () => {
  const expected = new Map<string, unknown>();
  for (let seed = 0; seed < 30; seed++) {
    const { ir } = await fixture.compile("plant", seed);
    for (const flow of flows) {
      const engine = createElkEngine(),
        layout = engine.layout.bind(engine);
      const inputs: string[] = [];
      engine.layout = async (...args) => {
        inputs.push(digest(semanticIdentities(ir, args[0])));
        return layout(...args);
      };
      const r = await createSchematicRendererWithDependencies({
        layoutEngine: engine,
      }).render(ir, {
        format: "schematic-view-request/0.1",
        family: "power",
        root: byDesignation("M1"),
        flow,
      });
      expect(r.ok).toBe(true);
      if (!expected.has(flow)) expected.set(flow, inputs);
      expect(inputs, `seed=${seed} flow=${flow}`).toEqual(expected.get(flow));
    }
  }
}, 30000);

it.each(["plc3", "plc4", "daisy", "pnp"] as const)(
  "draws %s supplies in both flows",
  async (variant) => {
    const { ir } = await fixture.compile(variant, 0);
    for (const flow of flows) {
      const r = await renderSchematic(ir, { ...loads, flow });
      expect(r.ok, JSON.stringify(r.ok ? "ok" : r.error)).toBe(true);
    }
  },
);

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function checkSeeds(
  name: string,
  base: ElectricalIr,
  requests: readonly SchematicViewRequest[],
) {
  const expected = new Map<
    string,
    { inputs: string[]; svg: string | null; outcome: string }
  >();
  for (let seed = 0; seed < 30; seed++) {
    const ir = reidentify(base, seed);
    for (const request of requests)
      for (const flow of flows) {
        const engine = createElkEngine(),
          layout = engine.layout.bind(engine),
          inputs: string[] = [];
        engine.layout = async (...args) => {
          inputs.push(digest(semanticIdentities(ir, args[0])));
          return layout(...args);
        };
        const r = await createSchematicRendererWithDependencies({
          layoutEngine: engine,
        }).render(ir, { ...request, flow });
        const key = JSON.stringify({ ...request, flow });
        const actual = {
          inputs,
          svg: r.ok ? digest(semanticIdentities(ir, r.value.svg)) : null,
          outcome: r.ok ? "ok" : r.error.code,
        };
        if (!expected.has(key)) expected.set(key, actual);
        expect(actual, `${name} seed=${seed} ${key}`).toEqual(
          expected.get(key),
        );
      }
  }
}

it.each([
  "minimal",
  "min_sameloc",
  "plc3",
  "plc4",
  "daisy",
  "pnp",
  "two_psu",
  "loads_via_k2",
  "tb_loads",
  "coil_fork",
  "plant",
  "parallel",
] as const)(
  "%s has one ELK input sequence and SVG over 30 UID assignments",
  async (variant) => {
    const { ir } = await fixture.compile(
      variant === "min_sameloc" ? "minimal" : variant,
      0,
      variant === "min_sameloc" ? { plc2Location: "MAIN-PANEL" } : {},
    );
    const requests =
      variant === "plant" ||
      variant === "coil_fork" ||
      variant === "pnp" ||
      variant === "parallel"
        ? rootedRequests(ir)
        : [loads];
    if (variant === "two_psu")
      requests.push({ ...loads, root: byDesignation("PS2") });
    await checkSeeds(variant, ir, requests);
  },
  120000,
);

const exampleProjects = [
  ...new Set(
    (await readdir("examples", { recursive: true }))
      .filter((f) => basename(f) === "system.json")
      .map(dirname),
  ),
].sort();
it("discovers all 13 shipped example projects", () => {
  expect(exampleProjects).toHaveLength(13);
});
it.each(exampleProjects)(
  "shipped %s rooted views have one ELK input sequence and SVG over 30 UID assignments",
  async (project) => {
    const compiled = await compileProject(join("examples", project));
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    await checkSeeds(project, compiled.ir, rootedRequests(compiled.ir));
  },
  600000,
);

it("keeps a shared trace fork drawable and UID-independent over 30 assignments", async () => {
  const ir = b4Round9Fixture(await compileCoreFixture());
  const trace = {
    format: "schematic-view-request/0.2",
    root: byDesignation("LS1"),
    intent: { kind: "trace", to: byDesignation("PLC1"), includePower: false },
  } as const;
  for (const flow of flows)
    expect((await renderSchematic(ir, { ...trace, flow })).ok).toBe(true);
  await checkSeeds("shared trace fork", ir, [trace]);
}, 240000);

it("uses authored source positions for indistinguishable unnamed jumpers", async () => {
  const { ir: base } = await fixture.compile("unnamed_jumpers", 0);
  let expected: unknown;
  for (let seed = 0; seed < 30; seed++) {
    const ir = reidentify(base, seed),
      n = normalizeSchematicView(ir, loads);
    if (
      !n.ok ||
      n.value.view.format !== "schematic-view/0.2" ||
      n.value.view.intent !== "loads"
    )
      throw Error("Expected loads view");
    const selected = selectLoadsSubgraph({
      ir,
      view: n.value.view,
      engine: n.value.engine,
    });
    if (!selected.ok) throw Error(JSON.stringify(selected.error));
    const g = buildPresentationGraph({ ir, selected: selected.value });
    if (!g.ok) throw Error(JSON.stringify(g.error));
    const actual = semanticIdentities(
      ir,
      buildElkAdapterGraph(g.value.graph).graph,
    );
    expected ??= actual;
    expect(actual).toEqual(expected);
  }
});

it("keeps paginated rooted SVGs independent of UIDs over 30 assignments", async () => {
  const base = await compileCoreFixture(),
    expected = new Map<string, unknown>();
  for (let seed = 0; seed < 30; seed++) {
    const ir = reidentify(base, seed);
    for (const flow of flows) {
      const r = await renderSchematicSheets(ir, {
        format: "schematic-view-request/0.2",
        root: byDesignation("LS1"),
        intent: {
          kind: "trace",
          to: byDesignation("PLC1"),
          includePower: true,
        },
        flow,
      });
      const actual = r.ok
        ? {
            ok: true,
            sheets: r.value.sheets.map((s) =>
              digest(semanticIdentities(ir, s.svg)),
            ),
          }
        : { ok: false, code: r.error.code };
      if (!expected.has(flow)) expected.set(flow, actual);
      expect(actual).toEqual(expected.get(flow));
    }
  }
}, 120000);

it("keeps authored keys literal when they equal an instance UID", async () => {
  const ir = await compileCoreFixture(),
    first = ir.devices[0]!,
    uid = first.uid;
  const order = irSemanticOrder(ir),
    name = first.designation;
  expect(order.key(JSON.stringify(["function", uid, uid]))).toBe(
    JSON.stringify(["function", name, uid]),
  );
  expect(order.key(JSON.stringify([uid, uid]))).toBe(
    JSON.stringify([name, uid]),
  );
  expect(order.key(JSON.stringify(["location", "authored", uid]))).toBe(
    JSON.stringify(["location", "authored", uid]),
  );
  const owner = JSON.stringify(["function", uid, uid]);
  expect(order.key(JSON.stringify(["port", owner, uid]))).toBe(
    JSON.stringify(["port", JSON.stringify(["function", name, uid]), uid]),
  );
});

it("orders duplicate potential declarations by authored position over 30 UID sets", async () => {
  const { ir } = await fixture.compile("plant", 0, {
    duplicatePotentials: true,
  });
  await checkSeeds("duplicate potential anchors", ir, rootedRequests(ir));
}, 120000);

it("preserves wire, jumper and cable-core kind order", async () => {
  const ir = await compileCoreFixture(),
    order = irSemanticOrder(ir);
  const wire = { kind: "wire", uid: ir.wires[0]!.uid } as const;
  const jumper = { kind: "jumper", uid: ir.jumpers[0]!.uid } as const;
  const cable = {
    kind: "cable_conductor",
    ...ir.cableConductors[0]!.id,
  } as const;
  expect(compareSemanticElementIds(order, wire, jumper)).toBeLessThan(0);
  expect(compareSemanticElementIds(order, jumper, cable)).toBeLessThan(0);
});
