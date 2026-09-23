import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileProject,
  type CompiledProjectPresentation,
  type CompileResult,
  type ElectricalIr,
  type TerminalId,
} from "@thermite/compiler";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildElkAdapterGraph,
  layoutPresentationGraph,
  validateElkRuntimeOptions,
  type ElkAdapterBuild,
} from "../src/layout/elk-adapter.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { ELK_OPTIONS } from "../src/layout/options.js";
import { normalizeAndValidateLayout } from "../src/layout/validate-output.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { renderSchematic } from "../src/renderer.js";
import {
  selectCableConductorSubgraph,
  selectLoadsSubgraph,
  selectSemanticSubgraph,
  selectTraceSubgraph,
} from "../src/selection.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import { CORE_DEVICE_TYPE_SYMBOL_MAPPINGS } from "../src/symbols/mappings.js";
import type { SymbolSide } from "../src/symbols/types.js";
import { svgSemanticId } from "../src/svg/escape.js";
import type {
  NormalizedSchematicLayout,
  PresentationEdge,
  PresentationGraph,
  RenderedSchematic,
  SchematicFlow,
  SchematicViewRequest,
  SelectedSubgraph,
  SymbolPresentationNode,
} from "../src/types.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { required } from "./fixtures.js";
import {
  createMotorStarterPnpExperiment,
  snapshotMotorStarterExperimentFiles,
  type MotorStarterPnpExperiment,
} from "./motor-starter-pnp-fixture.js";
import { checkRestrictedSvgXml } from "./xml-checker.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const baselineGoldenRoot = join(testRoot, "goldens", "motor-starter");
const pnpGoldenRoot = join(testRoot, "goldens", "motor-starter-pnp");

type SuccessfulCompile = Extract<CompileResult, { readonly ok: true }>;
type FailedCompile = Extract<CompileResult, { readonly ok: false }>;
type ViewName = "m1" | "k1" | "trace" | "conductors" | "loads";

interface ViewStages {
  readonly request: SchematicViewRequest;
  readonly selected: SelectedSubgraph;
  readonly presentation: PresentationGraph;
  readonly adapter: ElkAdapterBuild;
  readonly layout: NormalizedSchematicLayout;
  readonly rendered: RenderedSchematic;
}

interface FileSnapshot {
  readonly project: ReadonlyMap<string, Buffer>;
  readonly library: ReadonlyMap<string, Buffer>;
}

let experiment: MotorStarterPnpExperiment | undefined;
let baselineCompile: SuccessfulCompile;
let typeOnlyCompile: FailedCompile;
let pnpCompile: SuccessfulCompile;
let untouchedFiles: FileSnapshot;
let typeOnlyFiles: FileSnapshot;
let pnpFiles: FileSnapshot;
let baselineViews: ReadonlyMap<string, ViewStages>;
let pnpViews: ReadonlyMap<string, ViewStages>;
let baselineSignalOnly: ReadonlyMap<SchematicFlow, ViewStages>;
let pnpSignalOnly: ReadonlyMap<SchematicFlow, ViewStages>;

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

function viewRequest(
  name: ViewName,
  flow: SchematicFlow,
  includePower = true,
): SchematicViewRequest {
  switch (name) {
    case "m1":
      return {
        format: "schematic-view-request/0.1",
        family: "power",
        root: { by: "designation", value: "M1" },
        flow,
      };
    case "k1":
      return {
        format: "schematic-view-request/0.1",
        family: "control",
        root: { by: "designation", value: "K1" },
        flow,
      };
    case "trace":
      return {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower,
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

async function buildViewStages(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: Readonly<CompiledProjectPresentation>,
): Promise<ViewStages> {
  const normalized = normalizeSchematicView(ir, request);
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.error));
  const prepared = normalized.value;
  const selected =
    prepared.view.format === "schematic-view/0.1"
      ? selectSemanticSubgraph({
          ir,
          view: prepared.view,
          engine: prepared.engine,
          mappings: prepared.mappings,
        })
      : prepared.view.intent === "trace"
        ? selectTraceSubgraph({
            ir,
            view: prepared.view,
            engine: prepared.engine,
            mappings: prepared.mappings,
            target: prepared.view.target,
            includePower: prepared.view.includePower,
          })
        : prepared.view.intent === "loads"
          ? selectLoadsSubgraph({
              ir,
              view: prepared.view,
              engine: prepared.engine,
              mappings: prepared.mappings,
            })
          : selectCableConductorSubgraph({
              ir,
              view: prepared.view,
              engine: prepared.engine,
              mappings: prepared.mappings,
              root: prepared.rootSelector,
            });
  if (!selected.ok) throw new Error(JSON.stringify(selected.error));
  const presented = buildPresentationGraph({ ir, selected: selected.value });
  if (!presented.ok) throw new Error(JSON.stringify(presented.error));
  const adapter = buildElkAdapterGraph(presented.value.graph);
  const layout = await layoutPresentationGraph(presented.value.graph);
  if (!layout.ok) throw new Error(JSON.stringify(layout.error));
  const rendered = await renderSchematic(ir, request, presentation);
  if (!rendered.ok) throw new Error(JSON.stringify(rendered.error));
  expect(rendered.value.view).toEqual(prepared.view);
  expect(rendered.value.summary).toEqual(presented.value.summary);
  return {
    request,
    selected: selected.value,
    presentation: presented.value.graph,
    adapter,
    layout: layout.value,
    rendered: rendered.value,
  };
}

async function viewMatrix(
  ir: Readonly<ElectricalIr>,
  presentation: Readonly<CompiledProjectPresentation>,
): Promise<ReadonlyMap<string, ViewStages>> {
  const names = ["m1", "k1", "trace", "conductors", "loads"] as const;
  const flows = ["left-to-right", "top-to-bottom"] as const;
  return new Map(
    await Promise.all(
      names.flatMap((name) =>
        flows.map(
          async (flow) =>
            [
              `${name}:${flow}`,
              await buildViewStages(ir, viewRequest(name, flow), presentation),
            ] as const,
        ),
      ),
    ),
  );
}

function view(
  matrix: ReadonlyMap<string, ViewStages>,
  name: ViewName,
  flow: SchematicFlow = "left-to-right",
): ViewStages {
  return required(matrix.get(`${name}:${flow}`));
}

async function signalOnlyMatrix(
  ir: Readonly<ElectricalIr>,
  presentation: Readonly<CompiledProjectPresentation>,
): Promise<ReadonlyMap<SchematicFlow, ViewStages>> {
  const entries = await Promise.all(
    (["left-to-right", "top-to-bottom"] as const).map(
      async (flow) =>
        [
          flow,
          await buildViewStages(
            ir,
            viewRequest("trace", flow, false),
            presentation,
          ),
        ] as const,
    ),
  );
  return new Map(entries);
}

beforeAll(async () => {
  const created = await createMotorStarterPnpExperiment();
  experiment = created;
  try {
    untouchedFiles = await snapshotMotorStarterExperimentFiles(created);
    const baseline = await compileProject(created.projectRoot);
    if (!baseline.ok) throw new Error(JSON.stringify(baseline.diagnostics));
    baselineCompile = { ...baseline, ir: deepFreeze(baseline.ir) };
    baselineViews = await viewMatrix(
      baselineCompile.ir,
      baselineCompile.presentation,
    );
    baselineSignalOnly = await signalOnlyMatrix(
      baselineCompile.ir,
      baselineCompile.presentation,
    );

    await created.applyTypeOnlyEdit();
    typeOnlyFiles = await snapshotMotorStarterExperimentFiles(created);
    const intermediate = await compileProject(created.projectRoot);
    if (intermediate.ok)
      throw new Error("Type-only edit unexpectedly compiled.");
    typeOnlyCompile = intermediate;

    await created.applyCompletedEdit();
    pnpFiles = await snapshotMotorStarterExperimentFiles(created);
    const completed = await compileProject(created.projectRoot);
    if (!completed.ok) throw new Error(JSON.stringify(completed.diagnostics));
    pnpCompile = { ...completed, ir: deepFreeze(completed.ir) };
    pnpViews = await viewMatrix(pnpCompile.ir, pnpCompile.presentation);
    pnpSignalOnly = await signalOnlyMatrix(
      pnpCompile.ir,
      pnpCompile.presentation,
    );
  } catch (error) {
    await created.cleanup();
    experiment = undefined;
    throw error;
  }
}, 120_000);

afterAll(async () => {
  await experiment?.cleanup();
});

function designation(ir: Readonly<ElectricalIr>, deviceUid: string): string {
  return required(ir.devices.find(({ uid }) => uid === deviceUid)).designation;
}

function terminalName(
  ir: Readonly<ElectricalIr>,
  terminal: TerminalId,
): string {
  return `${designation(ir, terminal.deviceUid)}.${terminal.terminalKey}`;
}

function functionNames(
  ir: Readonly<ElectricalIr>,
  functionIds: SelectedSubgraph["functionIds"],
): string[] {
  return functionIds.map(
    ({ deviceUid, functionKey }) =>
      `${designation(ir, deviceUid)}.${functionKey}`,
  );
}

function conductorNames(
  ir: Readonly<ElectricalIr>,
  elementIds: SelectedSubgraph["conductiveElementIds"],
): string[] {
  return elementIds.map((id) => {
    if (id.kind === "wire") {
      return required(ir.wires.find(({ uid }) => uid === id.uid)).designation;
    }
    if (id.kind === "jumper") {
      const jumper = required(ir.jumpers.find(({ uid }) => uid === id.uid));
      return jumper.designation ?? jumper.uid;
    }
    return `${required(ir.cables.find(({ uid }) => uid === id.cableUid)).designation}.${id.conductorId}`;
  });
}

function netIdAt(
  ir: Readonly<ElectricalIr>,
  deviceDesignation: string,
  terminalKey: string,
): string {
  const deviceUid = required(
    ir.devices.find(({ designation }) => designation === deviceDesignation),
  ).uid;
  return required(
    ir.indexes.netIdByTerminal.find(
      ({ key }) =>
        key.deviceUid === deviceUid && key.terminalKey === terminalKey,
    ),
  ).value;
}

function netMembers(ir: Readonly<ElectricalIr>, netId: string): string[] {
  return required(ir.nets.find(({ id }) => id === netId))
    .terminalIds.map((terminal) => terminalName(ir, terminal))
    .sort();
}

function symbol(
  graph: PresentationGraph,
  deviceDesignation: string,
): SymbolPresentationNode {
  return required(
    graph.nodes.find(
      (node): node is SymbolPresentationNode =>
        node.kind === "symbol" && node.designation === deviceDesignation,
    ),
  );
}

function replaceNetReferences<Value>(
  value: Value,
  replacements: readonly (readonly [string, string])[],
): Value {
  if (typeof value === "string") {
    let replaced = value;
    for (const [from, to] of replacements) {
      replaced = replaced.replaceAll(from, to);
      replaced = replaced.replaceAll(
        svgSemanticId("net", [from]),
        svgSemanticId("net", [to]),
      );
    }
    return replaced as Value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((member) =>
      replaceNetReferences(member, replacements),
    ) as Value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      key === "netIds" &&
      Array.isArray(member) &&
      member.every((item) => typeof item === "string")
        ? replaceNetReferences(member, replacements).sort()
        : replaceNetReferences(member, replacements),
    ]),
  ) as Value;
}

function presentationEdge(
  stages: ViewStages,
  conductorDesignation: string,
): PresentationEdge {
  return required(
    stages.presentation.edges.find((edge) => {
      const conductor = edge.conductor;
      return (
        ((conductor?.kind === "wire" || conductor?.kind === "jumper") &&
          conductor.designation === conductorDesignation) ||
        (conductor?.kind === "cable-conductor" &&
          `${conductor.cableDesignation}.${conductor.conductorId}` ===
            conductorDesignation)
      );
    }),
  );
}

function route(stages: ViewStages, conductorDesignation: string) {
  const edge = presentationEdge(stages, conductorDesignation);
  return required(stages.layout.edges.find(({ id }) => id === edge.id)).points;
}

function adapterNodes(root: Readonly<ElkNode>): ElkNode[] {
  return (root.children ?? []).flatMap((child) => [
    child,
    ...adapterNodes(child),
  ]);
}

function rawEdgePoints(edge: Readonly<ElkExtendedEdge>) {
  const section = required(edge.sections)[0]!;
  return [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ].map(({ x, y }) => ({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) }));
}

function isInteriorPointOnOrthogonalRoute(
  points: readonly Readonly<{ x: number; y: number }>[],
  point: Readonly<{ x: number; y: number }>,
): boolean {
  return points.slice(1).some((end, index) => {
    const start = points[index]!;
    if (start.x === end.x && point.x === start.x) {
      return (
        point.y > Math.min(start.y, end.y) && point.y < Math.max(start.y, end.y)
      );
    }
    if (start.y === end.y && point.y === start.y) {
      return (
        point.x > Math.min(start.x, end.x) && point.x < Math.max(start.x, end.x)
      );
    }
    return false;
  });
}

function removePriorityDirection(graph: ElkNode): ElkNode {
  const control = structuredClone(graph);
  for (const edge of control.edges ?? []) {
    if (edge.layoutOptions === undefined) continue;
    delete edge.layoutOptions[ELK_OPTIONS.priorityDirection];
    if (Object.keys(edge.layoutOptions).length === 0) {
      delete edge.layoutOptions;
    }
  }
  return control;
}

async function rawLayout(graph: ElkNode): Promise<ElkNode> {
  return createElkEngine().layout(structuredClone(graph));
}

function requiredPortLabelOffset(
  side: SymbolSide,
  width: number,
  height: number,
): Readonly<{ x: number; y: number }> {
  switch (side) {
    case "west":
      return { x: -width - 4, y: 4 };
    case "east":
      return { x: 4, y: 4 };
    case "north":
      return { x: 4, y: -height - 4 };
    case "south":
      return { x: 4, y: 4 };
  }
}

function terminalLabelOffsets(stages: ViewStages): readonly Readonly<{
  side: SymbolSide;
  returned: Readonly<{ x: number; y: number }>;
  required: Readonly<{ x: number; y: number }>;
}>[] {
  return stages.layout.labels
    .filter(({ role }) => role === "terminal")
    .map((label) => {
      const port = required(
        stages.layout.ports.find(({ id }) => id === label.ownerId),
      );
      return {
        side: port.side,
        returned: {
          x: Number((label.x - port.x).toFixed(3)),
          y: Number((label.y - port.y).toFixed(3)),
        },
        required: requiredPortLabelOffset(port.side, label.width, label.height),
      };
    });
}

function expectedIncidencePlacement(
  graph: PresentationGraph,
  node: Exclude<PresentationGraph["nodes"][number], { kind: "junction" }>,
): string {
  const incident = new Set(
    graph.edges.flatMap(({ sourcePortId, targetPortId }) => [
      sourcePortId,
      targetPortId,
    ]),
  );
  const hasLabeledZeroIncidencePort = node.ports.some(
    (port) =>
      node.labels.some(
        ({ ownerKind, ownerId }) => ownerKind === "port" && ownerId === port.id,
      ) && !incident.has(port.id),
  );
  return hasLabeledZeroIncidencePort
    ? "OUTSIDE ALWAYS_SAME_SIDE"
    : "OUTSIDE NEXT_TO_PORT_IF_POSSIBLE ALWAYS_SAME_SIDE";
}

function pnpRootAdapterNode(stages: ViewStages): ElkNode {
  const root = symbol(stages.presentation, "LS1");
  return required(
    adapterNodes(stages.adapter.graph).find(({ id }) => id === root.id),
  );
}

function preB2LoadsPresentation(stages: ViewStages): PresentationGraph {
  const control = structuredClone(stages.presentation);
  if (
    control.view.format !== "schematic-view/0.2" ||
    control.view.intent !== "loads" ||
    control.view.root.kind !== "device"
  ) {
    throw new Error("Expected a loads presentation control.");
  }
  const rootDeviceUid = control.view.root.deviceUid;
  const outgoing: SymbolSide =
    control.view.flow === "left-to-right" ? "east" : "south";
  const incoming: SymbolSide =
    control.view.flow === "left-to-right" ? "west" : "north";
  for (const node of control.nodes) {
    if (node.kind !== "junction" || node.terminal.deviceUid !== rootDeviceUid) {
      continue;
    }
    for (const port of node.ports) {
      const edge = required(
        control.edges.find(
          ({ sourcePortId, targetPortId }) =>
            sourcePortId === port.id || targetPortId === port.id,
        ),
      );
      (port as { side: SymbolSide }).side =
        edge.kind === "conductor" ? outgoing : incoming;
    }
  }
  return control;
}

function junctionSideFacts(stages: ViewStages, terminalKey: "+" | "-") {
  if (
    stages.presentation.view.format !== "schematic-view/0.2" ||
    stages.presentation.view.intent !== "loads" ||
    stages.presentation.view.root.kind !== "device"
  ) {
    throw new Error("Expected loads stages.");
  }
  const junction = required(
    stages.presentation.nodes.find(
      (node) =>
        node.kind === "junction" &&
        node.terminal.deviceUid === stages.presentation.view.root.deviceUid &&
        node.terminal.terminalKey === terminalKey,
    ),
  );
  if (junction.kind !== "junction") throw new Error("Expected a junction.");
  return {
    junction,
    sides: junction.ports.map((port) => {
      const edge = required(
        stages.presentation.edges.find(
          ({ sourcePortId, targetPortId }) =>
            sourcePortId === port.id || targetPortId === port.id,
        ),
      );
      const owner =
        edge.kind === "boundary-segment"
          ? "attachment"
          : edge.conductor?.kind === "cable-conductor"
            ? `${edge.conductor.cableDesignation}.${edge.conductor.conductorId}`
            : edge.conductor?.designation;
      return [owner, port.side] as const;
    }),
  };
}

function expectLayoutFailure(
  stages: ViewStages,
  adapterInput: ElkNode,
  output: ElkNode,
): void {
  const normalized = normalizeAndValidateLayout(
    stages.presentation,
    adapterInput,
    output,
    SYMBOL_CATALOG,
  );
  expect(normalized.ok).toBe(false);
  if (normalized.ok) return;
  expect(normalized.error.code).toBe("R004");
}

describe("M6 Task 7 staged source-only PNP experiment", () => {
  it("copies only ordinary files, validates untouched, and freezes the type-only E102 state", () => {
    const created = required(experiment);
    expect(baselineCompile.diagnostics).toEqual([]);
    expect(untouchedFiles.project).toEqual(created.baselineProjectFiles);
    expect(untouchedFiles.library).toEqual(created.baselineLibraryFiles);

    expect(typeOnlyCompile).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "E102",
          severity: "error",
          message:
            'Device "LS1" of type "core:prox-pnp-3wire" has no terminal "13".',
          file: "connections/field-terminations.json",
          line: 24,
          column: 40,
          jsonPointer: "/objects/1/endpoints/1/terminal",
          uid: "4f3f64e8-af7c-4b5d-9cbc-250368ad3e75",
          related: [
            {
              file: "@thermite/core-library/types/prox-pnp-3wire.json",
              line: 6,
              column: 13,
              note: 'Resolved device type "core:prox-pnp-3wire" is declared here.',
            },
          ],
        },
        {
          code: "E102",
          severity: "error",
          message:
            'Device "LS1" of type "core:prox-pnp-3wire" has no terminal "14".',
          file: "connections/field-terminations.json",
          line: 37,
          column: 40,
          jsonPointer: "/objects/2/endpoints/0/terminal",
          uid: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
          related: [
            {
              file: "@thermite/core-library/types/prox-pnp-3wire.json",
              line: 6,
              column: 13,
              note: 'Resolved device type "core:prox-pnp-3wire" is declared here.',
            },
          ],
        },
      ],
      toolFailure: false,
    });

    for (const [path, baselineBytes] of created.baselineProjectFiles) {
      const typeOnlyBytes = required(typeOnlyFiles.project.get(path));
      if (path === "devices/equipment.json") {
        expect(typeOnlyBytes.toString("utf8")).toBe(
          baselineBytes
            .toString("utf8")
            .replace(
              '"type": "core:limit-switch-2wire"',
              '"type": "core:prox-pnp-3wire"',
            ),
        );
      } else {
        expect(typeOnlyBytes).toEqual(baselineBytes);
      }
    }
    expect(typeOnlyFiles.library).toEqual(created.baselineLibraryFiles);

    const equipment = JSON.parse(
      required(typeOnlyFiles.project.get("devices/equipment.json")).toString(
        "utf8",
      ),
    ) as { objects: Array<Record<string, unknown>> };
    expect(
      required(
        equipment.objects.find(({ designation }) => designation === "LS1"),
      ),
    ).toEqual({
      uid: "596f728b-1445-4c4b-8974-a3b4ea703636",
      kind: "device",
      designation: "LS1",
      type: "core:prox-pnp-3wire",
      description: "Normally open field limit switch permissive",
      location: "FIELD",
    });
  });

  it("applies only the completed D10 edits and preserves manifest, library, and lock bytes", () => {
    const created = required(experiment);
    expect(pnpCompile.diagnostics).toEqual([]);
    expect(pnpFiles.library).toEqual(created.baselineLibraryFiles);
    expect(pnpFiles.project.get("system.json")).toEqual(
      created.baselineProjectFiles.get("system.json"),
    );
    expect(pnpFiles.project.get("electrical-system.lock.json")).toEqual(
      created.baselineProjectFiles.get("electrical-system.lock.json"),
    );
    expect([...pnpFiles.project.keys()]).toEqual([
      ...created.baselineProjectFiles.keys(),
    ]);
    for (const [path, baselineBytes] of created.baselineProjectFiles) {
      if (
        path !== "devices/equipment.json" &&
        path !== "connections/field-terminations.json"
      ) {
        expect(pnpFiles.project.get(path)).toEqual(baselineBytes);
      }
    }

    const completedEquipment = required(
      pnpFiles.project.get("devices/equipment.json"),
    ).toString("utf8");
    expect(completedEquipment).toBe(
      required(typeOnlyFiles.project.get("devices/equipment.json"))
        .toString("utf8")
        .replace(
          '"description": "Normally open field limit switch permissive"',
          '"description": "Three-wire PNP field proximity sensor permissive"',
        ),
    );

    const field = JSON.parse(
      required(
        pnpFiles.project.get("connections/field-terminations.json"),
      ).toString("utf8"),
    ) as { objects: Array<Record<string, unknown>> };
    const byDesignation = new Map(
      field.objects.map((object) => [object.designation, object]),
    );
    expect(required(byDesignation.get("W-FLD-002"))).toMatchObject({
      uid: "4f3f64e8-af7c-4b5d-9cbc-250368ad3e75",
      endpoints: [
        { device: "JB1", terminal: "X1.1" },
        { device: "LS1", terminal: "1" },
      ],
      properties: { label: "+24V-JB1-LS1", size: "18AWG", color: "blue" },
    });
    expect(required(byDesignation.get("W-FLD-003"))).toMatchObject({
      uid: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
      endpoints: [
        { device: "LS1", terminal: "4" },
        { device: "JB1", terminal: "X1.2" },
      ],
      properties: {
        label: "LS1-PNP-OUT-PLC1-DI0",
        size: "18AWG",
        color: "violet",
      },
    });
    expect(required(byDesignation.get("W-FLD-004"))).toEqual({
      uid: "4afbc8b2-5bd7-4b92-8f9d-dcf124b85d01",
      kind: "wire",
      designation: "W-FLD-004",
      endpoints: [
        { device: "JB1", terminal: "X1.3" },
        { device: "LS1", terminal: "3" },
      ],
      properties: {
        label: "0V-JB1-LS1",
        size: "18AWG",
        color: "blue/white",
      },
    });
    expect(field.objects.map(({ designation }) => designation)).toEqual([
      "W-FLD-001",
      "W-FLD-002",
      "W-FLD-003",
      "W-FLD-004",
      "JP1",
    ]);
  });

  it("changes the exact IR counts, three memberships, and only three net IDs", () => {
    const counts = (ir: Readonly<ElectricalIr>) => ({
      devices: ir.devices.length,
      terminals: ir.terminals.length,
      functions: ir.functions.length,
      internalRelations: ir.internalRelations.length,
      wires: ir.wires.length,
      jumpers: ir.jumpers.length,
      cableConductors: ir.cableConductors.length,
      physicalConductiveElements:
        ir.wires.length + ir.jumpers.length + ir.cableConductors.length,
      nets: ir.nets.length,
    });
    expect(counts(baselineCompile.ir)).toEqual({
      devices: 11,
      terminals: 62,
      functions: 43,
      internalRelations: 17,
      wires: 26,
      jumpers: 1,
      cableConductors: 4,
      physicalConductiveElements: 31,
      nets: 31,
    });
    expect(counts(pnpCompile.ir)).toEqual({
      devices: 11,
      terminals: 63,
      functions: 44,
      internalRelations: 18,
      wires: 27,
      jumpers: 1,
      cableConductors: 4,
      physicalConductiveElements: 32,
      nets: 31,
    });

    const before = {
      positive: netIdAt(baselineCompile.ir, "LS1", "13"),
      signal: netIdAt(baselineCompile.ir, "LS1", "14"),
      return: netIdAt(baselineCompile.ir, "PS1", "-"),
    };
    const after = {
      positive: netIdAt(pnpCompile.ir, "LS1", "1"),
      signal: netIdAt(pnpCompile.ir, "LS1", "4"),
      return: netIdAt(pnpCompile.ir, "LS1", "3"),
    };
    expect(before).toEqual({
      positive:
        "net:sha256:3d137761e58b445ed267e091f04cad782acdcec2f6a9f762594531476d54202a",
      signal:
        "net:sha256:af8c9ba2461a98df6aae2bc32934bfb43e00d202ef9d6a0b4f8c8be8409877b9",
      return:
        "net:sha256:72a015f08216f38a067efa9dcc5f76ad2ed9246cb564f07dcd2abaed457c366d",
    });
    expect(new Set(Object.values(after))).toHaveLength(3);
    for (const key of ["positive", "signal", "return"] as const) {
      expect(after[key]).not.toBe(before[key]);
    }
    expect(netMembers(baselineCompile.ir, before.positive)).toEqual(
      ["PS1.+", "PLC1.L+", "TB1.1", "TB1.2", "JB1.X1.1", "LS1.13"].sort(),
    );
    expect(netMembers(pnpCompile.ir, after.positive)).toEqual(
      ["PS1.+", "PLC1.L+", "TB1.1", "TB1.2", "JB1.X1.1", "LS1.1"].sort(),
    );
    expect(netMembers(baselineCompile.ir, before.signal)).toEqual(
      ["LS1.14", "JB1.X1.2", "TB1.3", "PLC1.X1.0"].sort(),
    );
    expect(netMembers(pnpCompile.ir, after.signal)).toEqual(
      ["LS1.4", "JB1.X1.2", "TB1.3", "PLC1.X1.0"].sort(),
    );
    expect(netMembers(baselineCompile.ir, before.return)).toEqual(
      ["PS1.-", "PLC1.M", "K1.A2", "TB1.4", "JB1.X1.3"].sort(),
    );
    expect(netMembers(pnpCompile.ir, after.return)).toEqual(
      ["PS1.-", "PLC1.M", "K1.A2", "TB1.4", "JB1.X1.3", "LS1.3"].sort(),
    );
    const unchangedBefore = baselineCompile.ir.nets
      .map(({ id }) => id)
      .filter((id) => !Object.values(before).includes(id))
      .sort();
    const unchangedAfter = pnpCompile.ir.nets
      .map(({ id }) => id)
      .filter((id) => !Object.values(after).includes(id))
      .sort();
    expect(unchangedBefore).toHaveLength(28);
    expect(unchangedAfter).toEqual(unchangedBefore);
  });
});

describe("M6 Task 7 before/after semantic propagation", () => {
  it("renders all five baseline requests from the one untouched copied IR", async () => {
    for (const [name, filename] of [
      ["m1", "m1-power-left-to-right.svg"],
      ["k1", "k1-control-left-to-right.svg"],
      ["trace", "ls1-to-plc1-include-power-left-to-right.svg"],
      ["conductors", "cbl1-conductors-left-to-right.svg"],
      ["loads", "ps1-loads-left-to-right.svg"],
    ] as const) {
      const stages = view(baselineViews, name);
      expect(stages.rendered.svg).toBe(
        await readFile(join(baselineGoldenRoot, filename), "utf8"),
      );
      checkRestrictedSvgXml(stages.rendered.svg);
    }
  });

  it("keeps M1 exact and changes K1 only where the regenerated 0 V ID is surfaced", async () => {
    const baselineM1 = view(baselineViews, "m1");
    const pnpM1 = view(pnpViews, "m1");
    expect(pnpM1.request).toEqual(baselineM1.request);
    expect(pnpM1.selected).toEqual(baselineM1.selected);
    expect(pnpM1.presentation).toEqual(baselineM1.presentation);
    expect(pnpM1.adapter).toEqual(baselineM1.adapter);
    expect(pnpM1.layout).toEqual(baselineM1.layout);
    expect(pnpM1.rendered).toEqual(baselineM1.rendered);
    expect(pnpM1.rendered.svg).toBe(
      await readFile(
        join(baselineGoldenRoot, "m1-power-left-to-right.svg"),
        "utf8",
      ),
    );

    const baselineK1 = view(baselineViews, "k1");
    const pnpK1 = view(pnpViews, "k1");
    const replacements = [
      [
        netIdAt(pnpCompile.ir, "PS1", "-"),
        netIdAt(baselineCompile.ir, "PS1", "-"),
      ],
    ] as const;
    expect(pnpK1.rendered.view).toEqual(baselineK1.rendered.view);
    expect(pnpK1.selected.deviceUids).toEqual(baselineK1.selected.deviceUids);
    expect(pnpK1.selected.functionIds).toEqual(baselineK1.selected.functionIds);
    expect(pnpK1.selected.conductiveElementIds).toEqual(
      baselineK1.selected.conductiveElementIds,
    );
    expect(replaceNetReferences(pnpK1.selected, replacements)).toEqual(
      baselineK1.selected,
    );
    expect(replaceNetReferences(pnpK1.presentation, replacements)).toEqual(
      baselineK1.presentation,
    );
    expect(replaceNetReferences(pnpK1.layout, replacements)).toEqual(
      baselineK1.layout,
    );
    expect(replaceNetReferences(pnpK1.rendered, replacements)).toEqual(
      baselineK1.rendered,
    );
    expect(pnpK1.rendered.svg).not.toBe(baselineK1.rendered.svg);
  });

  it("keeps CBL1 members/order/endpoints fixed, changes three nets, and preserves spare 2-", () => {
    const baseline = view(baselineViews, "conductors");
    const pnp = view(pnpViews, "conductors");
    const replacements = [
      [
        netIdAt(pnpCompile.ir, "LS1", "1"),
        netIdAt(baselineCompile.ir, "LS1", "13"),
      ],
      [
        netIdAt(pnpCompile.ir, "LS1", "4"),
        netIdAt(baselineCompile.ir, "LS1", "14"),
      ],
      [
        netIdAt(pnpCompile.ir, "LS1", "3"),
        netIdAt(baselineCompile.ir, "PS1", "-"),
      ],
    ] as const;
    const pathFacts = (stages: ViewStages, ir: Readonly<ElectricalIr>) =>
      stages.selected.paths.map((path) => ({
        lane: path.lane,
        start: terminalName(ir, path.start.terminal),
        end: terminalName(ir, path.end.terminal),
        elements: conductorNames(
          ir,
          path.steps
            .filter((step) => step.kind === "conductor")
            .map((step) => step.elementId),
        ),
      }));
    const expected = [
      { lane: "1+", start: "JB1.X1.1", end: "TB1.2", elements: ["CBL1.1+"] },
      { lane: "1-", start: "JB1.X1.2", end: "TB1.3", elements: ["CBL1.1-"] },
      { lane: "2+", start: "JB1.X1.3", end: "TB1.4", elements: ["CBL1.2+"] },
      { lane: "2-", start: "JB1.X1.4", end: "TB1.5", elements: ["CBL1.2-"] },
    ];
    expect(pathFacts(baseline, baselineCompile.ir)).toEqual(expected);
    expect(pathFacts(pnp, pnpCompile.ir)).toEqual(expected);
    expect(pnp.selected.conductiveElementIds).toEqual(
      baseline.selected.conductiveElementIds,
    );
    expect(pnp.selected.terminalIds).toEqual(baseline.selected.terminalIds);
    expect(
      required(pnp.selected.paths.find(({ lane }) => lane === "2-")),
    ).toEqual(
      required(baseline.selected.paths.find(({ lane }) => lane === "2-")),
    );
    expect(replaceNetReferences(pnp.selected, replacements)).toEqual(
      baseline.selected,
    );
    expect(replaceNetReferences(pnp.presentation.nodes, replacements)).toEqual(
      baseline.presentation.nodes,
    );
    expect(
      replaceNetReferences(pnp.presentation.summary, replacements),
    ).toEqual(baseline.presentation.summary);
    for (const designation of ["1+", "1-", "2+", "2-"]) {
      expect(
        replaceNetReferences(
          presentationEdge(pnp, `CBL1.${designation}`),
          replacements,
        ),
      ).toEqual(presentationEdge(baseline, `CBL1.${designation}`));
    }
    expect(pnp.rendered.svg).not.toBe(baseline.rendered.svg);
  });

  it("changes the include-power trace from two-wire contact arms to all PNP arms", () => {
    const baseline = view(baselineViews, "trace");
    const pnp = view(pnpViews, "trace");
    expect(pnp.request).toEqual(baseline.request);
    expect(pnp.rendered.view).toEqual(baseline.rendered.view);
    expect(baseline.selected.paths.map(({ lane }) => lane)).toEqual([
      "signal",
      "positive-supply",
    ]);
    expect(pnp.selected.paths.map(({ lane }) => lane)).toEqual([
      "signal",
      "positive-supply",
      "return-supply",
    ]);
    expect(
      conductorNames(
        baselineCompile.ir,
        baseline.selected.conductiveElementIds,
      ).sort(),
    ).toEqual([
      "CBL1.1+",
      "CBL1.1-",
      "JP1",
      "W-CTL-003",
      "W-FLD-001",
      "W-FLD-002",
      "W-FLD-003",
    ]);
    expect(
      conductorNames(pnpCompile.ir, pnp.selected.conductiveElementIds).sort(),
    ).toEqual([
      "CBL1.1+",
      "CBL1.1-",
      "CBL1.2+",
      "JP1",
      "W-CTL-003",
      "W-CTL-004",
      "W-FLD-001",
      "W-FLD-002",
      "W-FLD-003",
      "W-FLD-004",
    ]);
    expect(
      functionNames(baselineCompile.ir, baseline.selected.functionIds),
    ).toEqual([
      "JB1.terminal1",
      "JB1.terminal2",
      "LS1.contact13",
      "PLC1.di0",
      "PS1.dc_output",
      "TB1.terminal1",
      "TB1.terminal2",
      "TB1.terminal3",
    ]);
    expect(functionNames(pnpCompile.ir, pnp.selected.functionIds)).toEqual([
      "JB1.terminal1",
      "JB1.terminal2",
      "JB1.terminal3",
      "LS1.supply",
      "LS1.output",
      "PLC1.di0",
      "PS1.dc_output",
      "TB1.terminal1",
      "TB1.terminal2",
      "TB1.terminal3",
      "TB1.terminal4",
    ]);
    for (const [ir, stages] of [
      [baselineCompile.ir, baseline],
      [pnpCompile.ir, pnp],
    ] as const) {
      expect(
        functionNames(ir, stages.selected.functionIds).filter(
          (name) => name === "PS1.dc_output",
        ),
      ).toHaveLength(1);
      expect(
        functionNames(ir, stages.rendered.summary.functionIds).filter(
          (name) => name === "PS1.dc_output",
        ),
      ).toHaveLength(1);
      expect(
        required(
          stages.selected.paths.find(({ lane }) => lane === "positive-supply"),
        ).start.boundary,
      ).toMatchObject({
        kind: "potential",
        terminal: { terminalKey: "+" },
        potentialUid: "46be3efd-17b7-43ee-bb9d-a019c4fb2cdd",
      });
    }
    const pnpRoot = symbol(pnp.presentation, "LS1");
    expect(pnpRoot).toMatchObject({
      representation: "aggregate",
      typeId: "core:prox-pnp-3wire",
      symbolId: "ais:switch-sensor-pnp",
    });
    expect(pnpRoot.functionIds.map(({ functionKey }) => functionKey)).toEqual([
      "supply",
      "output",
    ]);
    expect(
      pnpRoot.ports.map(({ symbolPortId, terminal, memberFunctionId }) => [
        symbolPortId,
        terminal.terminalKey,
        memberFunctionId?.functionKey,
      ]),
    ).toEqual([
      ["supply", "1", "supply"],
      ["return", "3", "supply"],
      ["signal", "4", "output"],
    ]);
    expect(new Set(pnp.selected.netIds)).toEqual(
      new Set([
        netIdAt(pnpCompile.ir, "LS1", "1"),
        netIdAt(pnpCompile.ir, "LS1", "3"),
        netIdAt(pnpCompile.ir, "LS1", "4"),
      ]),
    );
  });

  it("retains every signal-only root-port net with no omitted supply-arm edge in either flow", () => {
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const baseline = required(baselineSignalOnly.get(flow));
      const pnp = required(pnpSignalOnly.get(flow));
      expect(baseline.selected.paths.map(({ lane }) => lane)).toEqual([
        "signal",
      ]);
      expect(pnp.selected.paths.map(({ lane }) => lane)).toEqual(["signal"]);
      expect(
        conductorNames(
          baselineCompile.ir,
          baseline.selected.conductiveElementIds,
        ).sort(),
      ).toEqual(["CBL1.1-", "W-FLD-001", "W-FLD-003"]);
      expect(
        conductorNames(pnpCompile.ir, pnp.selected.conductiveElementIds).sort(),
      ).toEqual(["CBL1.1-", "W-FLD-001", "W-FLD-003"]);
      expect(new Set(baseline.selected.netIds)).toEqual(
        new Set([
          netIdAt(baselineCompile.ir, "LS1", "13"),
          netIdAt(baselineCompile.ir, "LS1", "14"),
        ]),
      );
      expect(new Set(pnp.selected.netIds)).toEqual(
        new Set([
          netIdAt(pnpCompile.ir, "LS1", "1"),
          netIdAt(pnpCompile.ir, "LS1", "3"),
          netIdAt(pnpCompile.ir, "LS1", "4"),
        ]),
      );
      const pnpRoot = symbol(pnp.presentation, "LS1");
      expect(pnpRoot.ports.map(({ terminal }) => terminal.terminalKey)).toEqual(
        ["1", "3", "4"],
      );
      expect(
        pnp.presentation.edges.flatMap(({ endpoints }) =>
          endpoints
            .filter(({ deviceUid }) => deviceUid === pnpRoot.deviceUid)
            .map(({ terminalKey }) => terminalKey),
        ),
      ).toEqual(["4"]);
      expect(pnp.rendered.summary.netIds).toEqual(pnp.selected.netIds);
    }
  });

  it("adds the complete PNP load while keeping its signal net provenance non-conductive", () => {
    const baseline = view(baselineViews, "loads");
    const pnp = view(pnpViews, "loads");
    expect(
      baseline.selected.deviceUids.map((uid) =>
        designation(baselineCompile.ir, uid),
      ),
    ).toEqual(["PLC1", "PS1"]);
    expect(
      pnp.selected.deviceUids.map((uid) => designation(pnpCompile.ir, uid)),
    ).toEqual(["JB1", "LS1", "PLC1", "PS1", "TB1"]);
    expect(functionNames(pnpCompile.ir, pnp.selected.functionIds)).toEqual([
      "JB1.terminal1",
      "JB1.terminal3",
      "LS1.supply",
      "LS1.output",
      "PLC1.supply",
      "PS1.dc_output",
      "TB1.terminal1",
      "TB1.terminal2",
      "TB1.terminal4",
    ]);
    expect(
      conductorNames(pnpCompile.ir, pnp.selected.conductiveElementIds).sort(),
    ).toEqual([
      "CBL1.1+",
      "CBL1.2+",
      "JP1",
      "W-CTL-001",
      "W-CTL-002",
      "W-CTL-003",
      "W-CTL-004",
      "W-FLD-002",
      "W-FLD-004",
    ]);
    expect(new Set(pnp.selected.netIds)).toEqual(
      new Set([
        netIdAt(pnpCompile.ir, "LS1", "1"),
        netIdAt(pnpCompile.ir, "LS1", "3"),
        netIdAt(pnpCompile.ir, "LS1", "4"),
      ]),
    );
    expect(pnp.rendered.summary.netIds).toEqual(pnp.selected.netIds);
    for (const absent of ["W-FLD-003", "CBL1.1-", "W-FLD-001"]) {
      expect(
        conductorNames(pnpCompile.ir, pnp.selected.conductiveElementIds),
      ).not.toContain(absent);
    }
    expect(
      pnp.selected.paths.every(({ lane }) => !lane.includes("signal")),
    ).toBe(true);
    expect(
      pnp.presentation.edges.some(
        ({ netId }) => netId === netIdAt(pnpCompile.ir, "LS1", "4"),
      ),
    ).toBe(false);
    const pnpRoot = symbol(pnp.presentation, "LS1");
    expect(pnpRoot.functionIds.map(({ functionKey }) => functionKey)).toEqual([
      "supply",
      "output",
    ]);
    expect(pnpRoot.ports.map(({ terminal }) => terminal.terminalKey)).toEqual([
      "1",
      "3",
      "4",
    ]);
    expect(pnp.rendered.svg).not.toBe(baseline.rendered.svg);
  });
});

describe("Amendment B2 ELK input regression controls", () => {
  it("reproduces the pre-B2 trace crossings and proves value 1/spacing/port-order controls still fail", async () => {
    for (const [flow, expected] of [
      [
        "left-to-right",
        {
          graph: { width: 2151, height: 507 },
          wire: [
            { x: 2051, y: 308 },
            { x: 2093, y: 308 },
            { x: 2093, y: 81 },
            { x: 1475, y: 81 },
            { x: 1475, y: 189 },
            { x: 1597, y: 189 },
          ],
          cable: [
            { x: 1617, y: 189 },
            { x: 2135, y: 189 },
            { x: 2135, y: 471 },
            { x: 16, y: 471 },
            { x: 16, y: 411 },
            { x: 545.3, y: 411 },
          ],
          intersection: { x: 2093, y: 189 },
        },
      ],
      [
        "top-to-bottom",
        {
          graph: { width: 948.4, height: 1722 },
          wire: [
            { x: 523, y: 1622 },
            { x: 523, y: 1664 },
            { x: 214, y: 1664 },
            { x: 214, y: 1194 },
            { x: 366.4, y: 1194 },
            { x: 366.4, y: 1305 },
          ],
          cable: [
            { x: 366.4, y: 1325 },
            { x: 366.4, y: 1370 },
            { x: 353.4, y: 1370 },
            { x: 353.4, y: 1706 },
            { x: 931.4, y: 1706 },
            { x: 931.4, y: 16 },
            { x: 772.6, y: 16 },
            { x: 772.6, y: 461 },
          ],
          intersection: { x: 353.4, y: 1664 },
        },
      ],
    ] as const) {
      const stages = view(pnpViews, "trace", flow);
      const control = removePriorityDirection(stages.adapter.graph);
      const output = await rawLayout(control);
      expect({
        width: Number(required(output.width).toFixed(3)),
        height: Number(required(output.height).toFixed(3)),
      }).toEqual(expected.graph);
      const wireId = presentationEdge(stages, "W-FLD-003").id;
      const cableId = presentationEdge(stages, "CBL1.1-").id;
      expect(
        rawEdgePoints(required(output.edges?.find(({ id }) => id === wireId))),
      ).toEqual(expected.wire);
      expect(
        rawEdgePoints(required(output.edges?.find(({ id }) => id === cableId))),
      ).toEqual(expected.cable);
      expectLayoutFailure(stages, control, output);
      expect(
        isInteriorPointOnOrthogonalRoute(expected.wire, expected.intersection),
      ).toBe(true);
      expect(
        isInteriorPointOnOrthogonalRoute(expected.cable, expected.intersection),
      ).toBe(true);

      const valueOne = structuredClone(control);
      required(valueOne.edges?.find(({ id }) => id === wireId)).layoutOptions =
        {
          [ELK_OPTIONS.priorityDirection]: "1",
        };
      expectLayoutFailure(stages, valueOne, await rawLayout(valueOne));

      const spacing = structuredClone(control);
      spacing.layoutOptions = {
        ...spacing.layoutOptions,
        [ELK_OPTIONS.edgeEdgeSpacing]: "128",
        [ELK_OPTIONS.edgeNodeSpacing]: "128",
      };
      expectLayoutFailure(stages, spacing, await rawLayout(spacing));

      const reorderedPorts = structuredClone(control);
      const root = symbol(stages.presentation, "LS1");
      const leaf = required(
        adapterNodes(reorderedPorts).find(({ id }) => id === root.id),
      );
      for (const [index, port] of [...(leaf.ports ?? [])].reverse().entries()) {
        port.layoutOptions = {
          ...port.layoutOptions,
          [ELK_OPTIONS.portIndex]: String(index),
        };
      }
      expectLayoutFailure(
        stages,
        reorderedPorts,
        await rawLayout(reorderedPorts),
      );
    }
  });

  it("reproduces the pre-B2 zero-incidence PNP loads label offsets", async () => {
    for (const [flow, returned] of [
      ["left-to-right", { x: 4, y: -7 }],
      ["top-to-bottom", { x: -6.1, y: 4 }],
    ] as const) {
      const stages = view(pnpViews, "loads", flow);
      const presentation = preB2LoadsPresentation(stages);
      const build = buildElkAdapterGraph(presentation);
      const pnp = symbol(presentation, "LS1");
      const leaf = required(
        adapterNodes(build.graph).find(({ id }) => id === pnp.id),
      );
      leaf.layoutOptions = {
        ...leaf.layoutOptions,
        [ELK_OPTIONS.portLabelsPlacement]:
          "OUTSIDE NEXT_TO_PORT_IF_POSSIBLE ALWAYS_SAME_SIDE",
      };
      const output = await rawLayout(build.graph);
      const outputLeaf = required(
        adapterNodes(output).find(({ id }) => id === pnp.id),
      );
      const signal = required(
        pnp.ports.find(({ symbolPortId }) => symbolPortId === "signal"),
      );
      const label = required(
        required(outputLeaf.ports?.find(({ id }) => id === signal.id)).labels,
      )[0]!;
      expect({ x: label.x, y: label.y }).toEqual(returned);
      expect(
        requiredPortLabelOffset(
          signal.side,
          required(label.width),
          required(label.height),
        ),
      ).toEqual({ x: 4, y: 4 });
      expectLayoutFailure({ ...stages, presentation }, build.graph, output);
    }
  });

  it("targets exact documented option types and only the closed topology predicates", async () => {
    for (const stages of [
      ...pnpViews.values(),
      ...baselineViews.values(),
      ...pnpSignalOnly.values(),
      ...baselineSignalOnly.values(),
    ]) {
      const priority = stages.adapter.optionAssignments.filter(
        ({ option }) => option === ELK_OPTIONS.priorityDirection,
      );
      const expectedPriority =
        stages.presentation.view.format === "schematic-view/0.2" &&
        stages.presentation.view.intent === "trace" &&
        symbol(stages.presentation, "LS1").typeId === "core:prox-pnp-3wire";
      expect(priority).toHaveLength(expectedPriority ? 1 : 0);
      if (expectedPriority) {
        const signalEdge = presentationEdge(stages, "W-FLD-003");
        expect(priority).toEqual([
          {
            targetKind: "edge",
            targetId: signalEdge.id,
            option: ELK_OPTIONS.priorityDirection,
            value: "2",
          },
        ]);
        expect(
          signalEdge.endpoints.some(({ terminalKey }) => terminalKey === "4"),
        ).toBe(true);
        expect(signalEdge.id).not.toContain(
          "596f728b-1445-4c4b-8974-a3b4ea703636",
        );
      }

      const byId = new Map(
        adapterNodes(stages.adapter.graph).map((node) => [node.id, node]),
      );
      for (const node of stages.presentation.nodes) {
        if (node.kind === "junction") continue;
        expect(
          required(byId.get(node.id)).layoutOptions?.[
            ELK_OPTIONS.portLabelsPlacement
          ],
        ).toBe(expectedIncidencePlacement(stages.presentation, node));
      }
    }

    const metadata = await validateElkRuntimeOptions(
      view(pnpViews, "trace").adapter,
    );
    expect(metadata).toContainEqual({
      id: ELK_OPTIONS.priorityDirection,
      type: "INT",
      targets: ["EDGES"],
    });
    expect(metadata).toContainEqual({
      id: ELK_OPTIONS.portLabelsPlacement,
      type: "ENUMSET",
      targets: ["NODES"],
    });
  });
});

describe("Amendment B2 collision-free real-layout evidence", () => {
  it("freezes the full five-view matrix and both signal-only matrices", () => {
    const expectedPnp = {
      "m1:left-to-right": [1838.8, 396],
      "k1:left-to-right": [1222.4, 419],
      "conductors:left-to-right": [831.5, 453],
      "trace:left-to-right": [2171, 501],
      "loads:left-to-right": [1704.6, 493],
      "m1:top-to-bottom": [615.8, 1508],
      "k1:top-to-bottom": [638.8, 986],
      "conductors:top-to-bottom": [844.2, 606],
      "trace:top-to-bottom": [732.6, 1742],
      "loads:top-to-bottom": [716.2, 1440],
    } as const;
    for (const [key, [width, height]] of Object.entries(expectedPnp)) {
      expect(required(pnpViews.get(key)).layout).toMatchObject({
        width,
        height,
      });
    }
    expect(view(baselineViews, "trace").layout).toMatchObject({
      width: 1855.4,
      height: 554,
    });
    expect(view(baselineViews, "trace", "top-to-bottom").layout).toMatchObject({
      width: 883.8,
      height: 1438,
    });
    expect(view(baselineViews, "loads").layout).toMatchObject({
      width: 670,
      height: 277,
    });
    expect(view(baselineViews, "loads", "top-to-bottom").layout).toMatchObject({
      width: 417,
      height: 549,
    });
    expect(
      required(baselineSignalOnly.get("left-to-right")).layout,
    ).toMatchObject({
      width: 1486.8,
      height: 235,
    });
    expect(
      required(baselineSignalOnly.get("top-to-bottom")).layout,
    ).toMatchObject({
      width: 324.2,
      height: 1158,
    });
    expect(required(pnpSignalOnly.get("left-to-right")).layout).toMatchObject({
      width: 1480.6,
      height: 251,
    });
    expect(required(pnpSignalOnly.get("top-to-bottom")).layout).toMatchObject({
      width: 324.2,
      height: 1166,
    });
    for (const stages of [
      ...baselineViews.values(),
      ...pnpViews.values(),
      ...baselineSignalOnly.values(),
      ...pnpSignalOnly.values(),
    ]) {
      checkRestrictedSvgXml(stages.rendered.svg);
    }
  });

  it("freezes both passing PNP trace routes and root signal label coordinates", () => {
    const right = view(pnpViews, "trace");
    expect(route(right, "W-FLD-003")).toEqual([
      { x: 1615.6, y: 229 },
      { x: 1657.6, y: 229 },
      { x: 1657.6, y: 311 },
      { x: 1843.6, y: 311 },
      { x: 1843.6, y: 368 },
      { x: 2001.6, y: 368 },
    ]);
    expect(route(right, "CBL1.1-")).toEqual([
      { x: 2021.6, y: 368 },
      { x: 2155, y: 368 },
      { x: 2155, y: 465 },
      { x: 16, y: 465 },
      { x: 16, y: 405 },
      { x: 545.3, y: 405 },
    ]);
    const rightRoot = symbol(right.presentation, "LS1");
    const rightSignal = required(
      rightRoot.ports.find(({ symbolPortId }) => symbolPortId === "signal"),
    );
    expect(
      required(right.layout.nodes.find(({ id }) => id === rightRoot.id)),
    ).toMatchObject({ x: 1549.6, y: 187 });
    expect(
      required(right.layout.ports.find(({ id }) => id === rightSignal.id)),
    ).toMatchObject({ x: 1615.6, y: 229 });
    expect(
      required(
        right.layout.labels.find(({ ownerId }) => ownerId === rightSignal.id),
      ),
    ).toMatchObject({ x: 1619.6, y: 233 });

    const down = view(pnpViews, "trace", "top-to-bottom");
    expect(route(down, "W-FLD-003")).toEqual([
      { x: 547.6, y: 1350 },
      { x: 547.6, y: 1392 },
      { x: 348, y: 1392 },
      { x: 348, y: 1462 },
      { x: 218.4, y: 1462 },
      { x: 218.4, y: 1609 },
    ]);
    expect(route(down, "CBL1.1-")).toEqual([
      { x: 218.4, y: 1629 },
      { x: 218.4, y: 1726 },
      { x: 715.6, y: 1726 },
      { x: 715.6, y: 16 },
      { x: 521, y: 16 },
      { x: 521, y: 461 },
    ]);
    const downRoot = symbol(down.presentation, "LS1");
    const downSignal = required(
      downRoot.ports.find(({ symbolPortId }) => symbolPortId === "signal"),
    );
    expect(
      required(down.layout.nodes.find(({ id }) => id === downRoot.id)),
    ).toMatchObject({
      x: 443.6,
      y: 1280,
    });
    expect(
      required(down.layout.ports.find(({ id }) => id === downSignal.id)),
    ).toMatchObject({
      x: 547.6,
      y: 1350,
    });
    expect(
      required(
        down.layout.labels.find(({ ownerId }) => ownerId === downSignal.id),
      ),
    ).toMatchObject({
      x: 551.6,
      y: 1354,
    });
    expect(
      route(down, "CBL1.1-")[0]!.y - route(down, "W-FLD-003").at(-1)!.y,
    ).toBe(20);
  });

  it("freezes two-arm source-junction sides, centers, routes, and PNP loads label placement", () => {
    const right = view(pnpViews, "loads");
    expect(junctionSideFacts(right, "+").sides).toEqual([
      ["W-CTL-001", "east"],
      ["W-CTL-003", "north"],
      ["attachment", "west"],
    ]);
    expect(junctionSideFacts(right, "-").sides).toEqual([
      ["W-CTL-002", "east"],
      ["W-CTL-004", "north"],
      ["attachment", "west"],
    ]);
    expect(route(right, "W-CTL-001")).toEqual([
      { x: 312.4, y: 214 },
      { x: 513.2, y: 214 },
      { x: 513.2, y: 387 },
      { x: 642.4, y: 387 },
    ]);
    expect(route(right, "W-CTL-003")).toEqual([
      { x: 312.4, y: 214 },
      { x: 312.4, y: 173 },
      { x: 642.7, y: 173 },
    ]);

    const down = view(pnpViews, "loads", "top-to-bottom");
    expect(junctionSideFacts(down, "+").sides).toEqual([
      ["W-CTL-001", "south"],
      ["W-CTL-003", "east"],
      ["attachment", "north"],
    ]);
    expect(junctionSideFacts(down, "-").sides).toEqual([
      ["W-CTL-002", "south"],
      ["W-CTL-004", "east"],
      ["attachment", "north"],
    ]);
    expect(route(down, "W-CTL-001")).toEqual([
      { x: 587.8, y: 290 },
      { x: 587.8, y: 389 },
      { x: 295.4, y: 389 },
      { x: 295.4, y: 523 },
    ]);
    expect(route(down, "W-CTL-003")).toEqual([
      { x: 587.8, y: 290 },
      { x: 683.2, y: 290 },
      { x: 683.2, y: 389 },
      { x: 616, y: 389 },
      { x: 616, y: 523 },
    ]);

    for (const [stages, expected] of [
      [
        right,
        {
          node: { x: 1580.6, y: 141 },
          port: { x: 1646.6, y: 183 },
          label: { x: 1650.6, y: 187, width: 12.2, height: 14 },
        },
      ],
      [
        down,
        {
          node: { x: 392.2, y: 1312 },
          port: { x: 496.2, y: 1382 },
          label: { x: 500.2, y: 1386, width: 12.2, height: 14 },
        },
      ],
    ] as const) {
      const root = symbol(stages.presentation, "LS1");
      const signal = required(
        root.ports.find(({ symbolPortId }) => symbolPortId === "signal"),
      );
      expect(
        required(stages.layout.nodes.find(({ id }) => id === root.id)),
      ).toMatchObject(expected.node);
      expect(
        required(stages.layout.ports.find(({ id }) => id === signal.id)),
      ).toMatchObject(expected.port);
      expect(
        required(
          stages.layout.labels.find(({ ownerId }) => ownerId === signal.id),
        ),
      ).toMatchObject(expected.label);
      expect(
        terminalLabelOffsets(stages).every(
          ({ returned, required }) =>
            returned.x === required.x && returned.y === required.y,
        ),
      ).toBe(true);
      for (const terminalKey of ["+", "-"] as const) {
        const { junction } = junctionSideFacts(stages, terminalKey);
        const node = required(
          stages.layout.nodes.find(({ id }) => id === junction.id),
        );
        expect(node).toMatchObject({ width: 6, height: 6 });
        for (const port of junction.ports) {
          expect(
            required(stages.layout.ports.find(({ id }) => id === port.id)),
          ).toMatchObject({
            x: node.x + 3,
            y: node.y + 3,
          });
        }
      }
    }
  });

  it("retains B1's 64-high, 48-pitch DC geometry in the formerly failing DOWN loads flow", () => {
    const stages = view(baselineViews, "loads", "top-to-bottom");
    const source = symbol(stages.presentation, "PS1");
    expect(source).toMatchObject({
      symbolId: "ais:power-source-dc",
      symbolSize: { width: 64, height: 36 },
    });
    const anchors = source.ports
      .map((port) => {
        const adapted = required(
          required(
            adapterNodes(stages.adapter.graph).find(
              ({ id }) => id === source.id,
            ),
          ).ports?.find(({ id }) => id === port.id),
        );
        return required(adapted.x);
      })
      .sort((left, right) => left - right);
    expect(anchors).toEqual([85.8, 133.8]);
    expect(anchors[1]! - anchors[0]!).toBeCloseTo(48);
    expect(48).toBeGreaterThanOrEqual(3 + 43.2);
    expect(stages.layout).toMatchObject({
      width: 417,
      height: 549,
    });
  });
});

describe("M6 Task 7 reviewed PNP bytes and unchanged catalog contract", () => {
  it("keeps the PNP symbol, mapping, and exactly-once coverage unchanged", () => {
    expect(
      required(SYMBOL_CATALOG.find(({ id }) => id === "ais:switch-sensor-pnp")),
    ).toEqual({
      format: "ais-symbol/0.1",
      id: "ais:switch-sensor-pnp",
      size: { width: 48, height: 40 },
      ports: [
        { id: "supply", side: "west", offset: 1 / 4, order: 0 },
        { id: "return", side: "west", offset: 3 / 4, order: 1 },
        { id: "signal", side: "east", offset: 1 / 2, order: 2 },
      ],
      primitives: [
        {
          kind: "line",
          from: { x: 0, y: 10 },
          to: { x: 8, y: 10 },
          style: "body",
        },
        {
          kind: "line",
          from: { x: 0, y: 30 },
          to: { x: 8, y: 30 },
          style: "body",
        },
        {
          kind: "rect",
          x: 8,
          y: 4,
          width: 30,
          height: 32,
          radius: 2,
          style: "body",
        },
        {
          kind: "circle",
          center: { x: 21, y: 20 },
          radius: 6,
          style: "actuator",
        },
        {
          kind: "line",
          from: { x: 27, y: 20 },
          to: { x: 48, y: 20 },
          style: "body",
        },
        {
          kind: "polyline",
          points: [
            { x: 29, y: 14 },
            { x: 35, y: 20 },
            { x: 29, y: 26 },
          ],
          style: "operator",
        },
      ],
    });
    const mappings = CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.filter(
      ({ typeId }) => typeId === "core:prox-pnp-3wire",
    );
    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.aggregates).toEqual([
      {
        key: "pnp-sensor",
        families: ["control"],
        functionKeys: ["supply", "output"],
        symbolId: "ais:switch-sensor-pnp",
        bindings: [
          { portId: "supply", terminalKey: "1", memberFunctionKey: "supply" },
          { portId: "return", terminalKey: "3", memberFunctionKey: "supply" },
          { portId: "signal", terminalKey: "4", memberFunctionKey: "output" },
        ],
        classification: "permissive",
        traversalRole: "non-traversable",
      },
    ]);
    expect(
      CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.flatMap((mapping) =>
        mapping.aggregates.filter(
          ({ key, families }) =>
            mapping.typeId === "core:prox-pnp-3wire" &&
            key === "pnp-sensor" &&
            families.includes("control"),
        ),
      ),
    ).toHaveLength(1);
  });

  it.each([
    ["k1-control-left-to-right.svg", "k1"],
    ["ls1-to-plc1-include-power-left-to-right.svg", "trace"],
    ["cbl1-conductors-left-to-right.svg", "conductors"],
    ["ps1-loads-left-to-right.svg", "loads"],
  ] as const)(
    "matches reviewed after-state golden %s",
    async (filename, name) => {
      const expected = await readFile(join(pnpGoldenRoot, filename), "utf8");
      const actual = view(pnpViews, name).rendered.svg;
      expect(actual).toBe(expected);
      expect(expected).not.toContain("\r");
      expect(expected).not.toContain("\t");
      expect(expected.endsWith("\n")).toBe(true);
      expect(expected.endsWith("\n\n")).toBe(false);
      checkRestrictedSvgXml(expected);
    },
  );

  it("checks in exactly four PNP renderer goldens and no duplicate M1", async () => {
    expect((await readdir(pnpGoldenRoot)).sort()).toEqual([
      "cbl1-conductors-left-to-right.svg",
      "k1-control-left-to-right.svg",
      "ls1-to-plc1-include-power-left-to-right.svg",
      "ps1-loads-left-to-right.svg",
    ]);
    expect(view(pnpViews, "m1").rendered.svg).toBe(
      await readFile(
        join(baselineGoldenRoot, "m1-power-left-to-right.svg"),
        "utf8",
      ),
    );
  });

  it("is byte-stable across a concurrent repeat of all five completed-state requests", async () => {
    const repeated = await Promise.all(
      (["m1", "k1", "trace", "conductors", "loads"] as const).map(
        async (name) => {
          const result = await renderSchematic(
            pnpCompile.ir,
            viewRequest(name, "left-to-right"),
            pnpCompile.presentation,
          );
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          return [name, result.value] as const;
        },
      ),
    );
    for (const [name, result] of repeated) {
      expect(result).toEqual(view(pnpViews, name).rendered);
    }
  });
});
