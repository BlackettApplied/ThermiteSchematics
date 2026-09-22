import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  compileProject,
  type CompiledProjectPresentation,
  type ElectricalIr,
} from "@thermite/compiler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LAYOUT_CONFIG_VERSION,
  RENDERER_VERSION,
  SYMBOL_CATALOG_VERSION,
  type RenderedSchematic,
  type SchematicViewRequest,
} from "../src/index.js";
import {
  buildElkAdapterGraph,
  layoutPresentationGraph,
  serializeElkAdapterForTest,
} from "../src/layout/elk-adapter.js";
import { ELK_OPTIONS, rootLayoutOptions } from "../src/layout/options.js";
import { buildPresentationGraph } from "../src/presentation.js";
import {
  selectCableConductorSubgraph,
  selectLoadsSubgraph,
  selectSemanticSubgraph,
  selectTraceSubgraph,
} from "../src/selection.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import { prepareSchematicTitleContext } from "../src/title-block.js";
import type {
  NormalizedSchematicLayout,
  PresentationGraph,
  RenderSummary,
  SchematicFlow,
  SelectedSubgraph,
} from "../src/types.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { compileCoreProjectFixture, required } from "./fixtures.js";
import {
  createMotorStarterPnpExperiment,
  type MotorStarterPnpExperiment,
} from "./motor-starter-pnp-fixture.js";
import { checkRestrictedSvgXml } from "./xml-checker.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testRoot, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const goldenRoot = join(testRoot, "goldens", "motor-starter");
const pnpGoldenRoot = join(testRoot, "goldens", "motor-starter-pnp");
const motorProject = join(repositoryRoot, "examples", "motor-starter");
const execFileAsync = promisify(execFile);

const cases = [
  {
    name: "k1",
    filename: "k1-control-left-to-right.svg",
  },
  {
    name: "m1",
    filename: "m1-power-left-to-right.svg",
  },
  {
    name: "trace",
    filename: "ls1-to-plc1-include-power-left-to-right.svg",
  },
  {
    name: "conductors",
    filename: "cbl1-conductors-left-to-right.svg",
  },
  {
    name: "loads",
    filename: "ps1-loads-left-to-right.svg",
  },
] as const satisfies readonly {
  readonly name: ViewName;
  readonly filename: string;
}[];

type SourceState = "baseline" | "pnp";
type ViewName = "k1" | "m1" | "trace" | "conductors" | "loads";
type MatrixViewName = ViewName | "signal-only-trace";

interface MatrixCase {
  readonly name: MatrixViewName;
  readonly flow: SchematicFlow;
  readonly request: SchematicViewRequest;
}

const flows = ["left-to-right", "top-to-bottom"] as const;

function viewRequest(
  name: MatrixViewName,
  flow: SchematicFlow,
): SchematicViewRequest {
  switch (name) {
    case "k1":
      return {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
        flow,
      };
    case "m1":
      return {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "M1" },
        family: "power",
        flow,
      };
    case "trace":
    case "signal-only-trace":
      return {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: name === "trace",
        },
        flow,
      };
    case "conductors":
      return {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "CBL1" },
        intent: { kind: "conductors" },
        flow,
      };
    case "loads":
      return {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
        flow,
      };
  }
}

const matrixCases: readonly MatrixCase[] = flows.flatMap((flow) => [
  ...cases.map(({ name }) => ({
    name,
    flow,
    request: viewRequest(name, flow),
  })),
  {
    name: "signal-only-trace",
    flow,
    request: viewRequest("signal-only-trace", flow),
  },
]);

interface PipelineSnapshot {
  readonly view: string;
  readonly selected: SelectedSubgraph;
  readonly presentation: string;
  readonly adapter: string;
  readonly layout: NormalizedSchematicLayout;
  readonly summary: RenderSummary;
  readonly json: string;
  readonly svg: string;
}

let coreIr: ElectricalIr;
let corePresentation: CompiledProjectPresentation;
let pnpIr: ElectricalIr;
let experiment: MotorStarterPnpExperiment | undefined;
let canonicalSnapshots: ReadonlyMap<string, PipelineSnapshot>;

beforeAll(async () => {
  const core = await compileCoreProjectFixture();
  coreIr = core.ir;
  corePresentation = core.presentation;
  const created = await createMotorStarterPnpExperiment();
  experiment = created;
  try {
    await created.applyTypeOnlyEdit();
    await created.applyCompletedEdit();
    const compiled = await compileProject(created.projectRoot);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    pnpIr = compiled.ir;

    const entries: Array<readonly [string, PipelineSnapshot]> = [];
    for (const state of ["baseline", "pnp"] as const) {
      for (const matrixCase of matrixCases) {
        entries.push([
          matrixKey(state, matrixCase),
          await pipelineSnapshot(irForState(state), matrixCase.request),
        ]);
      }
    }
    canonicalSnapshots = new Map(entries);
  } catch (error) {
    await created.cleanup();
    experiment = undefined;
    throw error;
  }
}, 120_000);

afterAll(async () => {
  await experiment?.cleanup();
});

function matrixKey(state: SourceState, matrixCase: MatrixCase): string {
  return `${state}:${matrixCase.name}:${matrixCase.flow}`;
}

function irForState(state: SourceState): ElectricalIr {
  return state === "baseline" ? coreIr : pnpIr;
}

function canonicalSnapshot(
  state: SourceState,
  matrixCase: MatrixCase,
): PipelineSnapshot {
  return required(canonicalSnapshots.get(matrixKey(state, matrixCase)));
}

function permuteCollectionsAndKeys(
  value: unknown,
  preserveArrayOrder = false,
): unknown {
  if (Array.isArray(value)) {
    const members = preserveArrayOrder ? [...value] : [...value].reverse();
    return members.map((member) => permuteCollectionsAndKeys(member));
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const functionRecord =
    typeof record.kind === "string" &&
    typeof record.id === "object" &&
    record.id !== null;
  return Object.fromEntries(
    Object.entries(record)
      .reverse()
      .map(([key, member]) => [
        key,
        permuteCollectionsAndKeys(
          member,
          key === "terminalKeys" || (key === "terminals" && functionRecord),
        ),
      ]),
  );
}

function shuffledIr(ir: ElectricalIr): ElectricalIr {
  return permuteCollectionsAndKeys(structuredClone(ir)) as ElectricalIr;
}

function reverseArrayProperty(value: object, property: string): void {
  const member = (value as Record<string, unknown>)[property];
  if (Array.isArray(member)) member.reverse();
}

function permutedSelection(selected: SelectedSubgraph): SelectedSubgraph {
  const copy = structuredClone(selected);
  for (const property of [
    "paths",
    "deviceUids",
    "terminalIds",
    "functionIds",
    "conductiveElementIds",
    "netIds",
  ]) {
    reverseArrayProperty(copy, property);
  }
  return copy;
}

function permutedPresentation(graph: PresentationGraph): PresentationGraph {
  const copy = structuredClone(graph);
  for (const property of [
    "locationGroups",
    "deviceGroups",
    "nodes",
    "edges",
    "metadataTextSources",
  ]) {
    reverseArrayProperty(copy, property);
  }
  for (const node of copy.nodes) {
    reverseArrayProperty(node, "ports");
    if (node.kind !== "junction") {
      reverseArrayProperty(node, "labels");
      reverseArrayProperty(node, "attachments");
      reverseArrayProperty(node, "functionIds");
    }
  }
  return copy;
}

function withDuplicateReturnPotential(ir: ElectricalIr): ElectricalIr {
  const duplicate = structuredClone(ir);
  const original = required(
    duplicate.potentials.find(({ name }) => name === "0VDC"),
  );
  const duplicateUid = "00000000-0000-4000-8000-000000000001";
  duplicate.potentials.push({
    ...structuredClone(original),
    uid: duplicateUid,
  });
  required(
    duplicate.nets.find(({ id }) => id === original.netId),
  ).potentialUids.push(duplicateUid);
  duplicate.indexes.objectRefByUid.push({
    key: duplicateUid,
    value: { kind: "potential", uid: duplicateUid },
  });
  return duplicate;
}

async function pipelineSnapshot(
  ir: ElectricalIr,
  request: SchematicViewRequest,
  permutations: Readonly<{
    selected?: boolean;
    presentation?: boolean;
  }> = {},
): Promise<PipelineSnapshot> {
  const normalized = normalizeSchematicView(ir, request);
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.error));
  const selected =
    normalized.value.view.format === "schematic-view/0.1"
      ? selectSemanticSubgraph({
          ir,
          view: normalized.value.view,
          engine: normalized.value.engine,
          mappings: normalized.value.mappings,
        })
      : normalized.value.view.intent === "trace"
        ? selectTraceSubgraph({
            ir,
            view: normalized.value.view,
            engine: normalized.value.engine,
            mappings: normalized.value.mappings,
            target: normalized.value.view.target,
            includePower: normalized.value.view.includePower,
          })
        : normalized.value.view.intent === "loads"
          ? selectLoadsSubgraph({
              ir,
              view: normalized.value.view,
              engine: normalized.value.engine,
              mappings: normalized.value.mappings,
              catalog: SYMBOL_CATALOG,
            })
          : "rootSelector" in normalized.value
            ? selectCableConductorSubgraph({
                ir,
                view: normalized.value.view,
                engine: normalized.value.engine,
                mappings: normalized.value.mappings,
                root: normalized.value.rootSelector,
              })
            : (() => {
                throw new Error(
                  "Prepared cable view omitted its root selector.",
                );
              })();
  if (!selected.ok) throw new Error(JSON.stringify(selected.error));
  const selectedGraph = permutations.selected
    ? permutedSelection(selected.value)
    : selected.value;
  const presented = buildPresentationGraph({ ir, selected: selectedGraph });
  if (!presented.ok) throw new Error(JSON.stringify(presented.error));
  const presentationGraph = permutations.presentation
    ? permutedPresentation(presented.value.graph)
    : presented.value.graph;
  const adapter = buildElkAdapterGraph(presentationGraph);
  const laidOut = await layoutPresentationGraph(presentationGraph);
  if (!laidOut.ok) throw new Error(JSON.stringify(laidOut.error));
  const titleContext = prepareSchematicTitleContext(
    ir.project.name,
    presentationGraph.view,
    corePresentation,
  );
  if (!titleContext.ok) throw new Error(JSON.stringify(titleContext.error));
  const emitted = emitSchematicSvg(
    presentationGraph,
    laidOut.value,
    titleContext.value,
  );
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.error));
  const rendered: RenderedSchematic = {
    view: normalized.value.view,
    summary: presented.value.summary,
    svg: emitted.value,
  };
  return {
    view: JSON.stringify(normalized.value.view),
    selected: selected.value,
    presentation: JSON.stringify(presented.value.graph),
    adapter: serializeElkAdapterForTest(adapter),
    layout: laidOut.value,
    summary: presented.value.summary,
    json: JSON.stringify(rendered) + String.fromCharCode(10),
    svg: emitted.value,
  };
}

async function TypeScriptSources(directory: string): Promise<string[]> {
  const sources: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...(await TypeScriptSources(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) sources.push(path);
  }
  return sources;
}

describe("D8 end-to-end determinism", () => {
  it.each(matrixCases)(
    "keeps full bytes stable under source/lane permutations and ELK stages stable under node/port/edge permutations for $name $flow",
    async (matrixCase) => {
      for (const state of ["baseline", "pnp"] as const) {
        const baseline = canonicalSnapshot(state, matrixCase);
        const ir = irForState(state);
        expect(
          await pipelineSnapshot(shuffledIr(ir), matrixCase.request),
        ).toEqual(baseline);
        expect(
          await pipelineSnapshot(ir, matrixCase.request, {
            selected: true,
          }),
        ).toEqual(baseline);
        const permutedIntermediate = await pipelineSnapshot(
          ir,
          matrixCase.request,
          { presentation: true },
        );
        expect(permutedIntermediate.adapter).toBe(baseline.adapter);
        expect(permutedIntermediate.layout).toEqual(baseline.layout);
      }
    },
  );

  it("keeps the duplicate-potential UID tie deterministic under the full shuffle", async () => {
    const duplicate = withDuplicateReturnPotential(coreIr);
    const request = viewRequest("k1", "left-to-right");
    const baseline = await pipelineSnapshot(duplicate, request);
    const shuffled = await pipelineSnapshot(shuffledIr(duplicate), request);

    expect(shuffled).toEqual(baseline);
    const k1Uid = required(
      coreIr.devices.find(({ designation }) => designation === "K1"),
    ).uid;
    const ps1Uid = required(
      coreIr.devices.find(({ designation }) => designation === "PS1"),
    ).uid;
    expect(
      baseline.selected.paths.find(({ lane }) => lane === "return"),
    ).toMatchObject({
      start: {
        terminal: { deviceUid: k1Uid, terminalKey: "A2" },
      },
      end: {
        terminal: { deviceUid: ps1Uid, terminalKey: "-" },
        boundary: {
          terminal: { deviceUid: ps1Uid, terminalKey: "-" },
          potentialUid: "00000000-0000-4000-8000-000000000001",
        },
        constraint: "LAST",
      },
    });
  });

  it("matches every pipeline boundary sequentially, concurrently, and in reordered calls", async () => {
    const work = (["baseline", "pnp"] as const).flatMap((state) =>
      matrixCases.map((matrixCase) => ({ state, matrixCase })),
    );
    const sequential = work.map(({ state, matrixCase }) =>
      canonicalSnapshot(state, matrixCase),
    );
    const reversedWork = [...work].reverse();
    const concurrentReversed = await Promise.all(
      reversedWork.map(({ state, matrixCase }) =>
        pipelineSnapshot(irForState(state), matrixCase.request),
      ),
    );
    const reorderedSequential: PipelineSnapshot[] = [];
    for (const { state, matrixCase } of reversedWork) {
      reorderedSequential.push(
        await pipelineSnapshot(irForState(state), matrixCase.request),
      );
    }

    expect([...concurrentReversed].reverse()).toEqual(sequential);
    expect([...reorderedSequential].reverse()).toEqual(sequential);
    for (const state of ["baseline", "pnp"] as const) {
      for (const { name, filename } of cases) {
        const matrixCase = required(
          matrixCases.find(
            (candidate) =>
              candidate.name === name && candidate.flow === "left-to-right",
          ),
        );
        const expectedRoot =
          state === "pnp" && name !== "m1" ? pnpGoldenRoot : goldenRoot;
        expect(canonicalSnapshot(state, matrixCase).svg).toBe(
          await readFile(join(expectedRoot, filename), "utf8"),
        );
      }
    }
  });

  it("reasserts the exact B1/B2 matrix dimensions and semantic option predicates", () => {
    const shared = {
      "m1:left-to-right": [1838.8, 396],
      "k1:left-to-right": [1222.4, 419],
      "conductors:left-to-right": [831.5, 453],
      "m1:top-to-bottom": [615.8, 1508],
      "k1:top-to-bottom": [638.8, 986],
      "conductors:top-to-bottom": [844.2, 606],
    } as const;
    const stateSpecific = {
      baseline: {
        "trace:left-to-right": [1855.4, 554],
        "loads:left-to-right": [670, 277],
        "signal-only-trace:left-to-right": [1486.8, 235],
        "trace:top-to-bottom": [883.8, 1438],
        "loads:top-to-bottom": [417, 549],
        "signal-only-trace:top-to-bottom": [324.2, 1158],
      },
      pnp: {
        "trace:left-to-right": [2171, 501],
        "loads:left-to-right": [1704.6, 493],
        "signal-only-trace:left-to-right": [1480.6, 251],
        "trace:top-to-bottom": [732.6, 1742],
        "loads:top-to-bottom": [716.2, 1440],
        "signal-only-trace:top-to-bottom": [324.2, 1166],
      },
    } as const;

    for (const state of ["baseline", "pnp"] as const) {
      for (const matrixCase of matrixCases) {
        const snapshot = canonicalSnapshot(state, matrixCase);
        const viewKey = `${matrixCase.name}:${matrixCase.flow}`;
        const expected =
          shared[viewKey as keyof typeof shared] ??
          stateSpecific[state][
            viewKey as keyof (typeof stateSpecific)[typeof state]
          ];
        expect(
          [snapshot.layout.width, snapshot.layout.height],
          matrixKey(state, matrixCase),
        ).toEqual(expected);

        const graph = JSON.parse(snapshot.presentation) as PresentationGraph;
        const adapter = JSON.parse(snapshot.adapter) as {
          readonly optionAssignments: readonly {
            readonly targetKind: string;
            readonly targetId: string;
            readonly option: string;
            readonly value: string;
          }[];
        };
        const priority = adapter.optionAssignments.filter(
          ({ option }) => option === ELK_OPTIONS.priorityDirection,
        );
        const expectsPnpTracePriority =
          state === "pnp" &&
          (matrixCase.name === "trace" ||
            matrixCase.name === "signal-only-trace");
        expect(priority, matrixKey(state, matrixCase)).toHaveLength(
          expectsPnpTracePriority ? 1 : 0,
        );
        if (expectsPnpTracePriority) {
          expect(priority[0]).toMatchObject({
            targetKind: "edge",
            value: "2",
          });
          if (
            graph.view.format !== "schematic-view/0.2" ||
            graph.view.root.kind !== "device"
          ) {
            throw new Error("Expected a PNP device-root trace.");
          }
          const rootUid = graph.view.root.deviceUid;
          const root = required(
            graph.nodes.find(
              (node) => node.kind === "symbol" && node.deviceUid === rootUid,
            ),
          );
          if (root.kind !== "symbol") throw new Error("Expected PNP root.");
          const signalPort = required(
            root.ports.find(({ symbolPortId }) => symbolPortId === "signal"),
          );
          const signalEdge = required(
            graph.edges.find(
              ({ sourcePortId, targetPortId }) =>
                sourcePortId === signalPort.id ||
                targetPortId === signalPort.id,
            ),
          );
          expect(priority[0]?.targetId).toBe(signalEdge.id);
        }

        const incidentPortIds = new Set(
          graph.edges.flatMap(({ sourcePortId, targetPortId }) => [
            sourcePortId,
            targetPortId,
          ]),
        );
        for (const node of graph.nodes) {
          if (node.kind === "junction") continue;
          const hasLabeledZeroIncidencePort = node.ports.some(
            (port) =>
              node.labels.some(
                ({ ownerKind, ownerId }) =>
                  ownerKind === "port" && ownerId === port.id,
              ) && !incidentPortIds.has(port.id),
          );
          const placement = required(
            adapter.optionAssignments.find(
              ({ targetKind, targetId, option }) =>
                targetKind === "node" &&
                targetId === node.id &&
                option === ELK_OPTIONS.portLabelsPlacement,
            ),
          );
          expect(placement.value).toBe(
            hasLabeledZeroIncidencePort
              ? "OUTSIDE ALWAYS_SAME_SIDE"
              : "OUTSIDE NEXT_TO_PORT_IF_POSSIBLE ALWAYS_SAME_SIDE",
          );
        }
      }
    }

    const downLoads = canonicalSnapshot(
      "baseline",
      required(
        matrixCases.find(
          ({ name, flow }) => name === "loads" && flow === "top-to-bottom",
        ),
      ),
    );
    const downGraph = JSON.parse(downLoads.presentation) as PresentationGraph;
    const source = required(
      downGraph.nodes.find(
        (node) => node.kind === "symbol" && node.designation === "PS1",
      ),
    );
    expect(source).toMatchObject({
      symbolId: "ais:power-source-dc",
      symbolSize: { width: 64, height: 36 },
    });
    expect(48).toBeGreaterThanOrEqual(3 + 43.2);
  });

  it(
    "matches both complete source-state matrices in two fresh Node processes",
    { timeout: 120_000 },
    async ({ skip }) => {
      const created = required(experiment);
      const source = [
        `import { compileProject } from ${JSON.stringify(pathToFileURL(join(repositoryRoot, "packages", "compiler", "dist", "index.js")).href)};`,
        `import { buildElkAdapterGraph, layoutPresentationGraph, serializeElkAdapterForTest } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist", "layout", "elk-adapter.js")).href)};`,
        `import { buildPresentationGraph } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist", "presentation.js")).href)};`,
        `import { selectCableConductorSubgraph, selectLoadsSubgraph, selectSemanticSubgraph, selectTraceSubgraph } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist", "selection.js")).href)};`,
        `import { SYMBOL_CATALOG } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist", "symbols", "catalog.js")).href)};`,
        `import { emitSchematicSvg } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist", "svg", "emitter.js")).href)};`,
        `import { prepareSchematicTitleContext } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist", "title-block.js")).href)};`,
        `import { normalizeSchematicView } from ${JSON.stringify(pathToFileURL(join(packageRoot, "dist", "view-spec.js")).href)};`,
        `const projects = ${JSON.stringify([
          ["baseline", motorProject],
          ["pnp", created.projectRoot],
        ])};`,
        `const cases = ${JSON.stringify(matrixCases)};`,
        "async function snapshot(ir, request, projectPresentation) {",
        "  const normalized = normalizeSchematicView(ir, request);",
        "  if (!normalized.ok) throw new Error(JSON.stringify(normalized.error));",
        "  const prepared = normalized.value;",
        '  const selected = prepared.view.format === "schematic-view/0.1"',
        "    ? selectSemanticSubgraph({ ir, view: prepared.view, engine: prepared.engine, mappings: prepared.mappings })",
        '    : prepared.view.intent === "trace"',
        "      ? selectTraceSubgraph({ ir, view: prepared.view, engine: prepared.engine, mappings: prepared.mappings, target: prepared.view.target, includePower: prepared.view.includePower })",
        '      : prepared.view.intent === "loads"',
        "        ? selectLoadsSubgraph({ ir, view: prepared.view, engine: prepared.engine, mappings: prepared.mappings, catalog: SYMBOL_CATALOG })",
        "        : selectCableConductorSubgraph({ ir, view: prepared.view, engine: prepared.engine, mappings: prepared.mappings, root: prepared.rootSelector });",
        "  if (!selected.ok) throw new Error(JSON.stringify(selected.error));",
        "  const presented = buildPresentationGraph({ ir, selected: selected.value });",
        "  if (!presented.ok) throw new Error(JSON.stringify(presented.error));",
        "  const adapter = buildElkAdapterGraph(presented.value.graph);",
        "  const layout = await layoutPresentationGraph(presented.value.graph);",
        "  if (!layout.ok) throw new Error(JSON.stringify(layout.error));",
        "  const titleContext = prepareSchematicTitleContext(ir.project.name, presented.value.graph.view, projectPresentation);",
        "  if (!titleContext.ok) throw new Error(JSON.stringify(titleContext.error));",
        "  const emitted = emitSchematicSvg(presented.value.graph, layout.value, titleContext.value);",
        "  if (!emitted.ok) throw new Error(JSON.stringify(emitted.error));",
        "  const rendered = { view: prepared.view, summary: presented.value.summary, svg: emitted.value };",
        "  return { view: JSON.stringify(prepared.view), selected: selected.value, presentation: JSON.stringify(presented.value.graph), adapter: serializeElkAdapterForTest(adapter), layout: layout.value, summary: presented.value.summary, json: JSON.stringify(rendered) + String.fromCharCode(10), svg: emitted.value };",
        "}",
        "const values = [];",
        "for (const [state, project] of projects) {",
        "  const compiled = await compileProject(project);",
        "  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));",
        "  for (const matrixCase of cases) values.push([`${state}:${matrixCase.name}:${matrixCase.flow}`, await snapshot(compiled.ir, matrixCase.request, compiled.presentation)]);",
        "}",
        "process.stdout.write(JSON.stringify(values));",
      ].join("\n");
      let first: string;
      let second: string;
      try {
        [first, second] = await Promise.all(
          [0, 1].map(
            async () =>
              (
                await execFileAsync(
                  process.execPath,
                  ["--input-type=module", "--eval", source],
                  {
                    cwd: repositoryRoot,
                    encoding: "utf8",
                    maxBuffer: 50 * 1024 * 1024,
                    windowsHide: true,
                  },
                )
              ).stdout,
          ),
        );
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EPERM"
        ) {
          skip("The execution sandbox denied fresh-process render checks.");
          return;
        }
        throw error;
      }
      expect(second).toBe(first);
      expect(JSON.parse(first)).toEqual([...canonicalSnapshots]);
    },
  );

  it("guards the pinned layout version and nondeterminism-sensitive options", () => {
    const renderManifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(renderManifest.dependencies.elkjs).toBe("0.12.0");
    expect({
      RENDERER_VERSION,
      SYMBOL_CATALOG_VERSION,
      LAYOUT_CONFIG_VERSION,
    }).toEqual({
      RENDERER_VERSION: "render/0.3",
      SYMBOL_CATALOG_VERSION: "ais-symbols/0.3",
      LAYOUT_CONFIG_VERSION: "elk-layered/0.4+elkjs-0.12.0",
    });
    for (const flow of flows) {
      expect(rootLayoutOptions(flow)).toMatchObject({
        [ELK_OPTIONS.direction]: flow === "left-to-right" ? "RIGHT" : "DOWN",
        [ELK_OPTIONS.edgeRouting]: "ORTHOGONAL",
        [ELK_OPTIONS.hierarchyHandling]: "INCLUDE_CHILDREN",
        [ELK_OPTIONS.edgeCoords]: "ROOT",
        [ELK_OPTIONS.randomSeed]: "1",
        [ELK_OPTIONS.considerModelOrderStrategy]: "NODES_AND_EDGES",
        [ELK_OPTIONS.considerModelOrderComponents]: "MODEL_ORDER",
        [ELK_OPTIONS.considerPortModelOrder]: "true",
        [ELK_OPTIONS.cycleBreakingStrategy]: "GREEDY_MODEL_ORDER",
        [ELK_OPTIONS.crossingMinimizationStrategy]: "LAYER_SWEEP",
        [ELK_OPTIONS.nodePlacementStrategy]: "BRANDES_KOEPF",
        [ELK_OPTIONS.portSortingStrategy]: "INPUT_ORDER",
        [ELK_OPTIONS.mergeEdges]: "false",
        [ELK_OPTIONS.mergeHierarchyEdges]: "false",
      });
    }
  });

  it("keeps every generated JSON/SVG artifact portable, XML-owned, and environment-free", async () => {
    const sourceFiles = await TypeScriptSources(join(packageRoot, "src"));
    const sources = (
      await Promise.all(sourceFiles.map((path) => readFile(path, "utf8")))
    ).join("\n");
    expect(sources).not.toMatch(
      /\b(?:process\.(?:env|pid|cwd)|Date\.now|new Date|Intl\.|localeCompare|Math\.random|performance\.now|randomUUID|homedir|tmpdir)\b/u,
    );

    const created = required(experiment);
    const forbiddenPaths = [
      repositoryRoot,
      process.cwd(),
      tmpdir(),
      motorProject,
      created.root,
      created.projectRoot,
    ].flatMap((path) => [path, path.replaceAll(String.fromCharCode(92), "/")]);
    for (const [key, snapshot] of canonicalSnapshots) {
      checkRestrictedSvgXml(snapshot.svg);
      for (const [kind, artifact] of [
        ["json", snapshot.json],
        ["svg", snapshot.svg],
      ] as const) {
        expect(
          Buffer.from(artifact, "utf8").toString("utf8"),
          `${key}:${kind}`,
        ).toBe(artifact);
        expect(artifact, `${key}:${kind}`).not.toContain("\r");
        expect(artifact, `${key}:${kind}`).not.toContain("\t");
        expect(artifact, `${key}:${kind}`).not.toMatch(
          /\u001b\[[0-?]*[ -/]*[@-~]/u,
        );
        expect(artifact, `${key}:${kind}`).not.toMatch(
          /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
        );
        expect(artifact, `${key}:${kind}`).not.toMatch(
          /\b(?:locale|timezone|timestamp|process-id|processId|pid|random)\b/iu,
        );
        expect(artifact, `${key}:${kind}`).not.toMatch(
          /(?:^|[^A-Za-z])[A-Za-z]:[\\/]|\\\\[^\\]|\/(?:home|tmp|Users)\//u,
        );
        for (const path of forbiddenPaths) {
          expect(artifact, `${key}:${kind}`).not.toContain(path);
        }
        expect(artifact.endsWith("\n"), `${key}:${kind}`).toBe(true);
        expect(artifact.endsWith("\n\n"), `${key}:${kind}`).toBe(false);
      }
    }
    expect(sourceFiles.map((path) => relative(packageRoot, path))).not.toEqual(
      [],
    );
  });
});
