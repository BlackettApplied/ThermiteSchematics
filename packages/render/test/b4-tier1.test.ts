import { beforeAll, describe, expect, it } from "vitest";

import { evaluateRules, type ElectricalIr } from "@thermite/compiler";

import {
  buildElkAdapterGraph,
  serializeElkAdapterForTest,
} from "../src/layout/elk-adapter.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { normalizeAndValidateLayout } from "../src/layout/validate-output.js";
import {
  buildPresentationGraph,
  emitClosedTraceStructuresForTest,
  serializePresentationGraphForTest,
} from "../src/presentation.js";
import { renderSchematic } from "../src/renderer.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import type { SchematicFlow, SchematicViewRequest } from "../src/types.js";
import { b4Round9Fixture, selectB4Trace } from "./b4-fixtures.js";
import { compileCoreFixture } from "./fixtures.js";
import { checkRestrictedSvgXml } from "./xml-checker.js";

type Tree = number | readonly Tree[];
type Terminal = { readonly deviceUid: string; readonly terminalKey: string };
type Merge = {
  readonly id: string;
  readonly terminal: Terminal;
  readonly children: readonly Tree[];
  readonly order: number;
};

const terminal = (deviceUid: string, terminalKey = "T"): Terminal => ({
  deviceUid,
  terminalKey,
});
const port = (
  id: string,
  owner: Terminal,
  side = "east",
  order = 0,
  symbolPortId = id,
) => ({
  id,
  symbolPortId,
  terminal: owner,
  netId: "signal",
  side,
  offset: 0.5,
  order,
  label: "",
});
const junction = (id: string, owner: Terminal, portIds: readonly string[]) => ({
  kind: "junction",
  id,
  parentId: "root",
  classification: "junction",
  netId: "signal",
  terminal: owner,
  ports: portIds.map((portId, order) => port(portId, owner, "east", order)),
});
const edge = (
  id: string,
  kind: "conductor" | "boundary-segment",
  sourcePortId: string,
  targetPortId: string,
  endpoints: readonly [Terminal, Terminal],
  rank = 0,
) => ({
  id,
  parentId: "root",
  kind,
  sourcePortId,
  targetPortId,
  netId: "signal",
  elementIds: kind === "conductor" ? [{ kind: "wire", uid: id }] : [],
  ...(kind === "conductor"
    ? { conductor: { kind: "wire", uid: id, designation: id } }
    : {}),
  endpoints,
  pathRank: rank,
});

/** Constructs the exact v23 Amendment B4 frozen minimal structural model. */
function tier1Fixture(
  tree: readonly Tree[],
  flow: SchematicFlow,
  vias: boolean,
): { readonly graph: any; readonly selected: any } {
  const rootTerminal = terminal("root", "4");
  const targetTerminal = terminal("plc", "X1.0");
  const leaves: number[] = [];
  const merges: Merge[] = [];
  let mergeSequence = 0;
  const visit = (children: readonly Tree[]): Merge => {
    const merge: Merge = {
      id: `merge-${mergeSequence}`,
      terminal: terminal(`merge-${mergeSequence}`),
      children,
      order: mergeSequence++,
    };
    for (const child of children) {
      if (typeof child === "number") leaves.push(child);
      else visit(child);
    }
    merges.push(merge);
    return merge;
  };
  const finalMerge = visit(tree);
  const parentByLeaf = new Map<number, Merge>();
  const parentByMerge = new Map<Merge, Merge>();
  const indexTree = (parent: Merge): void => {
    for (const child of parent.children) {
      if (typeof child === "number") parentByLeaf.set(child, parent);
      else {
        const candidate = merges.find((merge) => merge.children === child);
        if (candidate === undefined)
          throw new Error("Missing Tier 1 child merge.");
        parentByMerge.set(candidate, parent);
        indexTree(candidate);
      }
    }
  };
  indexTree(finalMerge);

  const leafCount = Math.max(...leaves) + 1;
  const nodes: any[] = [];
  const edges: any[] = [];
  const steps: any[] = [];
  const portsByNode = new Map<string, string[]>();
  const nodePorts = (id: string): string[] => {
    const value = portsByNode.get(id) ?? [];
    portsByNode.set(id, value);
    return value;
  };
  const addConductor = (
    id: string,
    sourceNode: string,
    targetNode: string,
    from: Terminal,
    to: Terminal,
    rank: number,
  ): void => {
    const sourcePort = `${sourceNode}:${id}:out`;
    const targetPort = `${targetNode}:${id}:in`;
    nodePorts(sourceNode).push(sourcePort);
    nodePorts(targetNode).push(targetPort);
    edges.push(edge(id, "conductor", sourcePort, targetPort, [from, to], rank));
    steps.push({
      kind: "conductor",
      elementId: { kind: "wire", uid: id },
      from,
      to,
      netId: "signal",
      rank,
    });
  };
  for (let leaf = 0; leaf < leafCount; leaf += 1) {
    const parent = parentByLeaf.get(leaf)!;
    if (vias) {
      const via = terminal(`via-${leaf}`);
      addConductor(
        `R${leaf}`,
        "root-junction",
        `via-${leaf}`,
        rootTerminal,
        via,
        leaf,
      );
      addConductor(
        `C${leaf}`,
        `via-${leaf}`,
        parent.id,
        via,
        parent.terminal,
        leafCount + leaf,
      );
    } else {
      addConductor(
        `C${leaf}`,
        "root-junction",
        parent.id,
        rootTerminal,
        parent.terminal,
        leaf,
      );
    }
  }
  for (const merge of merges) {
    const parent = parentByMerge.get(merge);
    addConductor(
      merge === finalMerge ? "OUT" : `M${merge.order}`,
      merge.id,
      parent?.id ?? "target",
      merge.terminal,
      parent?.terminal ?? targetTerminal,
      leafCount * (vias ? 2 : 1) + merge.order,
    );
  }
  steps.sort((left, right) => left.rank - right.rank);

  const vertical = flow === "top-to-bottom";
  nodes.push({
    kind: "symbol",
    representation: "aggregate",
    id: "root-symbol",
    deviceUid: "root",
    designation: "LS1",
    typeId: "core:prox-pnp-3wire",
    functionIds: [],
    symbolId: "ais:switch-sensor-pnp",
    classification: "command",
    parentId: "root",
    locationGroupId: "root",
    deviceGroupId: "root",
    orientation: flow,
    symbolSize: vertical
      ? { width: 40, height: 48 }
      : { width: 48, height: 40 },
    width: vertical ? 40 : 48,
    height: vertical ? 48 : 40,
    primitiveOrigin: { x: 0, y: 0 },
    ports: [
      port(
        "root:signal",
        rootTerminal,
        vertical ? "south" : "east",
        0,
        "signal",
      ),
    ],
    attachments: [],
    labels: [],
  });
  nodePorts("root-junction").push("root-junction:attachment");
  nodes.push(
    junction("root-junction", rootTerminal, nodePorts("root-junction")),
  );
  edges.push(
    edge(
      "root-attachment",
      "boundary-segment",
      "root:signal",
      "root-junction:attachment",
      [rootTerminal, rootTerminal],
    ),
  );
  if (vias) {
    for (let leaf = 0; leaf < leafCount; leaf += 1) {
      nodes.push(
        junction(
          `via-${leaf}`,
          terminal(`via-${leaf}`),
          nodePorts(`via-${leaf}`),
        ),
      );
    }
  }
  for (const merge of merges) {
    const attachmentPort = `${merge.id}:attachment`;
    const ownerPort = `z-owner-${merge.id}:port`;
    nodePorts(merge.id).push(attachmentPort);
    nodes.push(junction(merge.id, merge.terminal, nodePorts(merge.id)));
    const owner = junction(`z-owner-${merge.id}`, merge.terminal, [ownerPort]);
    owner.ports[0]!.side = vertical ? "west" : "south";
    nodes.push(owner);
    edges.push(
      edge(
        `attachment-${merge.id}`,
        "boundary-segment",
        attachmentPort,
        ownerPort,
        [merge.terminal, merge.terminal],
      ),
    );
  }
  const target = junction("target", targetTerminal, nodePorts("target"));
  target.ports[0]!.side = vertical ? "north" : "west";
  nodes.push(target);

  const graph = {
    format: "schematic-presentation/0.1",
    view: {
      format: "schematic-view/0.2",
      family: "control",
      intent: "trace",
      root: { kind: "device", deviceUid: "root", designation: "LS1" },
      target: { deviceUid: "plc", designation: "PLC1" },
      includePower: false,
      flow,
    },
    locationGroups: [],
    deviceGroups: [],
    nodes,
    edges,
    metadataTextSources: [],
  };
  const selected = {
    view: graph.view,
    paths: [
      {
        id: "trace:signal",
        lane: "signal",
        start: { terminal: rootTerminal },
        steps,
        end: { terminal: targetTerminal },
      },
    ],
  };
  return { graph, selected };
}

const CASES = [
  // M6_PLAN v23 Amendment B4 row "Plain N=2": Tree=[0,1], vias=false.
  {
    key: "plain-N2",
    planRow: "Plain N=2",
    tree: [0, 1],
    vias: false,
    leafCount: 2,
    mergePostorder: [0],
    rightSize: [266, 112],
    downSize: [112, 266],
  },
  // M6_PLAN v23 Amendment B4 row "Plain N=3": Tree=[0,1,2], vias=false.
  {
    key: "plain-N3",
    planRow: "Plain N=3",
    tree: [0, 1, 2],
    vias: false,
    leafCount: 3,
    mergePostorder: [0],
    rightSize: [328, 112],
    downSize: [112, 328],
  },
  // M6_PLAN v23 Amendment B4 row "N=4 comb": Tree=[0,1,2,3], vias=false.
  {
    key: "plain-N4",
    planRow: "N=4 comb",
    tree: [0, 1, 2, 3],
    vias: false,
    leafCount: 4,
    mergePostorder: [0],
    rightSize: [390, 150],
    downSize: [149, 390],
  },
  // M6_PLAN v23 Amendment B4 row "Round-8 split/swap": Tree=[0,1], vias=true.
  {
    key: "round-8",
    planRow: "Round-8 split/swap",
    tree: [0, 1],
    vias: true,
    leafCount: 2,
    mergePostorder: [0],
    rightSize: [328, 123],
    downSize: [123, 328],
  },
  // M6_PLAN v23 Amendment B4 row "Balanced B_4": Tree=[[0,1],[2,3]], vias=true.
  {
    key: "balanced-B4",
    planRow: "Balanced B_4",
    tree: [
      [0, 1],
      [2, 3],
    ],
    vias: true,
    leafCount: 4,
    mergePostorder: [1, 2, 0],
    rightSize: [452, 224],
    downSize: [223, 452],
  },
  // M6_PLAN v23 Amendment B4 row "Left-deep L_4": Tree=[[[0,1],2],3], vias=true.
  {
    key: "left-deep-L4",
    planRow: "Left-deep L_4",
    tree: [[[0, 1], 2], 3],
    vias: true,
    leafCount: 4,
    mergePostorder: [2, 1, 0],
    rightSize: [452, 217],
    downSize: [218, 452],
  },
] as const;

type FrozenMinimalStep = {
  readonly kind: "conductor";
  readonly elementId: { readonly kind: "wire"; readonly uid: string };
  readonly from: Terminal;
  readonly to: Terminal;
  readonly netId: "signal";
  readonly rank: number;
};

// Literal transcription of M6_PLAN v23 lines 846-922 for the six rows at
// lines 926-933. These expected DTOs intentionally do not reuse fixture output.
const FROZEN_MINIMAL_STEPS = {
  "plain-N2": [
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C0" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 0,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C1" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 1,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "OUT" },
      from: { deviceUid: "merge-0", terminalKey: "T" },
      to: { deviceUid: "plc", terminalKey: "X1.0" },
      netId: "signal",
      rank: 2,
    },
  ],
  "plain-N3": [
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C0" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 0,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C1" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 1,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C2" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 2,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "OUT" },
      from: { deviceUid: "merge-0", terminalKey: "T" },
      to: { deviceUid: "plc", terminalKey: "X1.0" },
      netId: "signal",
      rank: 3,
    },
  ],
  "plain-N4": [
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C0" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 0,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C1" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 1,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C2" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 2,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C3" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 3,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "OUT" },
      from: { deviceUid: "merge-0", terminalKey: "T" },
      to: { deviceUid: "plc", terminalKey: "X1.0" },
      netId: "signal",
      rank: 4,
    },
  ],
  "round-8": [
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R0" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-0", terminalKey: "T" },
      netId: "signal",
      rank: 0,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R1" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-1", terminalKey: "T" },
      netId: "signal",
      rank: 1,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C0" },
      from: { deviceUid: "via-0", terminalKey: "T" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 2,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C1" },
      from: { deviceUid: "via-1", terminalKey: "T" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 3,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "OUT" },
      from: { deviceUid: "merge-0", terminalKey: "T" },
      to: { deviceUid: "plc", terminalKey: "X1.0" },
      netId: "signal",
      rank: 4,
    },
  ],
  "balanced-B4": [
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R0" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-0", terminalKey: "T" },
      netId: "signal",
      rank: 0,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R1" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-1", terminalKey: "T" },
      netId: "signal",
      rank: 1,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R2" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-2", terminalKey: "T" },
      netId: "signal",
      rank: 2,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R3" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-3", terminalKey: "T" },
      netId: "signal",
      rank: 3,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C0" },
      from: { deviceUid: "via-0", terminalKey: "T" },
      to: { deviceUid: "merge-1", terminalKey: "T" },
      netId: "signal",
      rank: 4,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C1" },
      from: { deviceUid: "via-1", terminalKey: "T" },
      to: { deviceUid: "merge-1", terminalKey: "T" },
      netId: "signal",
      rank: 5,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C2" },
      from: { deviceUid: "via-2", terminalKey: "T" },
      to: { deviceUid: "merge-2", terminalKey: "T" },
      netId: "signal",
      rank: 6,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C3" },
      from: { deviceUid: "via-3", terminalKey: "T" },
      to: { deviceUid: "merge-2", terminalKey: "T" },
      netId: "signal",
      rank: 7,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "OUT" },
      from: { deviceUid: "merge-0", terminalKey: "T" },
      to: { deviceUid: "plc", terminalKey: "X1.0" },
      netId: "signal",
      rank: 8,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "M1" },
      from: { deviceUid: "merge-1", terminalKey: "T" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 9,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "M2" },
      from: { deviceUid: "merge-2", terminalKey: "T" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 10,
    },
  ],
  "left-deep-L4": [
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R0" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-0", terminalKey: "T" },
      netId: "signal",
      rank: 0,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R1" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-1", terminalKey: "T" },
      netId: "signal",
      rank: 1,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R2" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-2", terminalKey: "T" },
      netId: "signal",
      rank: 2,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "R3" },
      from: { deviceUid: "root", terminalKey: "4" },
      to: { deviceUid: "via-3", terminalKey: "T" },
      netId: "signal",
      rank: 3,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C0" },
      from: { deviceUid: "via-0", terminalKey: "T" },
      to: { deviceUid: "merge-2", terminalKey: "T" },
      netId: "signal",
      rank: 4,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C1" },
      from: { deviceUid: "via-1", terminalKey: "T" },
      to: { deviceUid: "merge-2", terminalKey: "T" },
      netId: "signal",
      rank: 5,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C2" },
      from: { deviceUid: "via-2", terminalKey: "T" },
      to: { deviceUid: "merge-1", terminalKey: "T" },
      netId: "signal",
      rank: 6,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "C3" },
      from: { deviceUid: "via-3", terminalKey: "T" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 7,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "OUT" },
      from: { deviceUid: "merge-0", terminalKey: "T" },
      to: { deviceUid: "plc", terminalKey: "X1.0" },
      netId: "signal",
      rank: 8,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "M1" },
      from: { deviceUid: "merge-1", terminalKey: "T" },
      to: { deviceUid: "merge-0", terminalKey: "T" },
      netId: "signal",
      rank: 9,
    },
    {
      kind: "conductor",
      elementId: { kind: "wire", uid: "M2" },
      from: { deviceUid: "merge-2", terminalKey: "T" },
      to: { deviceUid: "merge-1", terminalKey: "T" },
      netId: "signal",
      rank: 10,
    },
  ],
} as const satisfies Readonly<Record<string, readonly FrozenMinimalStep[]>>;

const FROZEN_MERGE_ATTACHMENT_ORDERS = {
  "plain-N2": { "merge-0": 3 },
  "plain-N3": { "merge-0": 4 },
  "plain-N4": { "merge-0": 5 },
  "round-8": { "merge-0": 3 },
  "balanced-B4": { "merge-0": 3, "merge-1": 3, "merge-2": 3 },
  "left-deep-L4": { "merge-0": 3, "merge-1": 3, "merge-2": 3 },
} as const;

const FROZEN_PRIORITY_EDGE_IDS = {
  "plain-N2": "C0",
  "plain-N3": "C0",
  "plain-N4": "C0",
  "round-8": "R0",
  "balanced-B4": "R0",
  "left-deep-L4": "R0",
} as const;

function assertFrozenMinimalModelSpecification(
  fixture: ReturnType<typeof tier1Fixture>,
  testCase: (typeof CASES)[number],
  flow: SchematicFlow,
): void {
  const { graph, selected } = fixture;
  const vertical = flow === "top-to-bottom";
  const leafSourceIds = Array.from({ length: testCase.leafCount }, (_, leaf) =>
    testCase.vias ? [`R${leaf}`, `C${leaf}`] : [`C${leaf}`],
  ).flat();
  const mergeConductorIds = testCase.mergePostorder.map((merge) =>
    merge === 0 ? "OUT" : `M${merge}`,
  );
  const expectedNodeIds = [
    "root-symbol",
    "root-junction",
    ...(testCase.vias
      ? Array.from({ length: testCase.leafCount }, (_, leaf) => `via-${leaf}`)
      : []),
    ...testCase.mergePostorder.flatMap((merge) => [
      `merge-${merge}`,
      `z-owner-merge-${merge}`,
    ]),
    "target",
  ];
  const expectedEdgeIds = [
    ...leafSourceIds,
    ...mergeConductorIds,
    "root-attachment",
    ...testCase.mergePostorder.map((merge) => `attachment-merge-${merge}`),
  ];

  const expectedView = {
    format: "schematic-view/0.2",
    family: "control",
    intent: "trace",
    root: { kind: "device", deviceUid: "root", designation: "LS1" },
    target: { deviceUid: "plc", designation: "PLC1" },
    includePower: false,
    flow,
  };
  expect(graph.format).toBe("schematic-presentation/0.1");
  expect(graph.view).toEqual(expectedView);
  expect(graph.locationGroups).toEqual([]);
  expect(graph.deviceGroups).toEqual([]);
  expect(graph.metadataTextSources).toEqual([]);
  expect(graph.nodes.map(({ id }: any) => id)).toEqual(expectedNodeIds);
  expect(graph.edges.map(({ id }: any) => id)).toEqual(expectedEdgeIds);
  expect(
    graph.nodes
      .filter(({ kind }: any) => kind === "symbol")
      .map(({ id }: any) => id),
  ).toEqual(["root-symbol"]);

  const rootTerminal = { deviceUid: "root", terminalKey: "4" } as const;
  const targetTerminal = { deviceUid: "plc", terminalKey: "X1.0" } as const;
  const rootSymbol = graph.nodes.find(({ id }: any) => id === "root-symbol");
  expect(rootSymbol).toEqual({
    kind: "symbol",
    representation: "aggregate",
    id: "root-symbol",
    deviceUid: "root",
    designation: "LS1",
    typeId: "core:prox-pnp-3wire",
    functionIds: [],
    symbolId: "ais:switch-sensor-pnp",
    classification: "command",
    parentId: "root",
    locationGroupId: "root",
    deviceGroupId: "root",
    orientation: flow,
    symbolSize: vertical
      ? { width: 40, height: 48 }
      : { width: 48, height: 40 },
    width: vertical ? 40 : 48,
    height: vertical ? 48 : 40,
    primitiveOrigin: { x: 0, y: 0 },
    ports: [
      {
        id: "root:signal",
        symbolPortId: "signal",
        terminal: rootTerminal,
        netId: "signal",
        side: vertical ? "south" : "east",
        offset: 0.5,
        order: 0,
        label: "",
      },
    ],
    attachments: [],
    labels: [],
  });
  expect(graph.edges.find(({ id }: any) => id === "root-attachment")).toEqual({
    id: "root-attachment",
    parentId: "root",
    kind: "boundary-segment",
    sourcePortId: "root:signal",
    targetPortId: "root-junction:attachment",
    netId: "signal",
    elementIds: [],
    endpoints: [rootTerminal, rootTerminal],
    pathRank: 0,
  });

  for (const merge of testCase.mergePostorder) {
    const mergeTerminal = {
      deviceUid: `merge-${merge}`,
      terminalKey: "T",
    } as const;
    const ownerId = `z-owner-merge-${merge}`;
    const ownerPortId = `${ownerId}:port`;
    expect(graph.nodes.find(({ id }: any) => id === ownerId)).toEqual({
      kind: "junction",
      id: ownerId,
      parentId: "root",
      classification: "junction",
      netId: "signal",
      terminal: mergeTerminal,
      ports: [
        {
          id: ownerPortId,
          symbolPortId: ownerPortId,
          terminal: mergeTerminal,
          netId: "signal",
          side: vertical ? "west" : "south",
          offset: 0.5,
          order: 0,
          label: "",
        },
      ],
    });
    const mergeNode = graph.nodes.find(
      ({ id }: any) => id === `merge-${merge}`,
    );
    expect(mergeNode.ports.at(-1)).toEqual({
      id: `merge-${merge}:attachment`,
      symbolPortId: `merge-${merge}:attachment`,
      terminal: mergeTerminal,
      netId: "signal",
      side: "east",
      offset: 0.5,
      order: FROZEN_MERGE_ATTACHMENT_ORDERS[testCase.key][`merge-${merge}`],
      label: "",
    });
    expect(
      graph.edges.find(({ id }: any) => id === `attachment-merge-${merge}`),
    ).toEqual({
      id: `attachment-merge-${merge}`,
      parentId: "root",
      kind: "boundary-segment",
      sourcePortId: `merge-${merge}:attachment`,
      targetPortId: ownerPortId,
      netId: "signal",
      elementIds: [],
      endpoints: [mergeTerminal, mergeTerminal],
      pathRank: 0,
    });
  }

  expect(graph.nodes.find(({ id }: any) => id === "target")).toEqual({
    kind: "junction",
    id: "target",
    parentId: "root",
    classification: "junction",
    netId: "signal",
    terminal: targetTerminal,
    ports: [
      {
        id: "target:OUT:in",
        symbolPortId: "target:OUT:in",
        terminal: targetTerminal,
        netId: "signal",
        side: vertical ? "north" : "west",
        offset: 0.5,
        order: 0,
        label: "",
      },
    ],
  });

  expect(selected).toEqual({
    view: expectedView,
    paths: [
      {
        id: "trace:signal",
        lane: "signal",
        start: { terminal: rootTerminal },
        steps: FROZEN_MINIMAL_STEPS[testCase.key],
        end: { terminal: targetTerminal },
      },
    ],
  });
}

function reverseMinimalSourceCollections(graph: any): any {
  const reversed = structuredClone(graph);
  reversed.locationGroups.reverse();
  reversed.deviceGroups.reverse();
  reversed.nodes = reversed.nodes
    .map((node: any) => ({ ...node, ports: [...node.ports].reverse() }))
    .reverse();
  reversed.edges.reverse();
  reversed.metadataTextSources.reverse();
  return reversed;
}

function compareDtoId(
  left: { readonly id: string },
  right: { readonly id: string },
) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function keyedPresentationBytes(graph: any): string {
  return serializePresentationGraphForTest({
    ...structuredClone(graph),
    locationGroups: [...graph.locationGroups].sort(compareDtoId),
    deviceGroups: [...graph.deviceGroups].sort(compareDtoId),
    nodes: [...graph.nodes]
      .map((node: any) => ({
        ...node,
        ports: [...node.ports].sort(compareDtoId),
      }))
      .sort(compareDtoId),
    edges: [...graph.edges].sort(compareDtoId),
  });
}

function canonicalElkOutput(value: unknown): string {
  return JSON.stringify(value, (key, member) =>
    key.startsWith("$") ? undefined : member,
  );
}

const CENTERS: Readonly<Record<string, readonly (readonly number[])[]>> = {
  "plain-N2:right": [
    [123, 76],
    [185, 57],
  ],
  "plain-N2:down": [
    [36, 123],
    [55, 185],
  ],
  "plain-N3:right": [
    [123, 76],
    [185, 57],
    [247, 57],
  ],
  "plain-N3:down": [
    [36, 123],
    [55, 185],
    [55, 247],
  ],
  "plain-N4:right": [
    [123, 76],
    [185, 114],
    [185, 57],
    [247, 57],
    [309, 57],
  ],
  "plain-N4:down": [
    [73, 123],
    [35, 185],
    [92, 185],
    [92, 247],
    [92, 309],
  ],
  "round-8:right": [
    [123, 87],
    [185, 87],
    [185, 57],
    [247, 57],
  ],
  "round-8:down": [
    [36, 123],
    [36, 185],
    [66, 185],
    [66, 247],
  ],
  "balanced-B4:right": [
    [123, 137],
    [185, 175],
    [185, 137],
    [185, 107],
    [247, 175],
    [247, 205],
    [247, 107],
    [309, 175],
    [371, 68],
  ],
  "balanced-B4:down": [
    [87, 123],
    [49, 185],
    [87, 185],
    [117, 185],
    [49, 247],
    [19, 247],
    [117, 247],
    [49, 309],
    [155, 371],
  ],
  "left-deep-L4:right": [
    [123, 141],
    [185, 179],
    [185, 141],
    [185, 111],
    [247, 179],
    [309, 198],
    [247, 111],
    [309, 111],
    [371, 111],
  ],
  "left-deep-L4:down": [
    [77, 123],
    [39, 185],
    [77, 185],
    [107, 185],
    [39, 247],
    [19, 309],
    [107, 247],
    [107, 309],
    [107, 371],
  ],
};

const PORT_ROWS: Readonly<
  Record<string, Readonly<Record<string, readonly (readonly string[])[]>>>
> = {
  "plain-N2": {
    root: [["C0:P", "C1:Q", "attachment:R"]],
    "merge-0": [["C0:S", "C1:R", "OUT:P", "attachment:Q"]],
  },
  "plain-N3": {
    root: [["C0:P", "C1:Q", "C2:S", "attachment:R"]],
    "merge-0": [
      ["C0:S", "C1:R", "attachment:Q", "link:P"],
      ["C2:S", "OUT:P", "link:R"],
    ],
  },
  "plain-N4": {
    root: [
      ["C0:P", "C1:Q", "attachment:R", "link:S"],
      ["C2:P", "C3:S", "link:Q"],
    ],
    "merge-0": [
      ["C0:S", "C1:R", "attachment:Q", "link:P"],
      ["C2:S", "link:R", "link:P"],
      ["C3:S", "OUT:P", "link:R"],
    ],
  },
  "round-8": {
    root: [["R0:P", "R1:Q", "attachment:R"]],
    "via-0": [["R0:R", "C0:P"]],
    "via-1": [["R1:R", "C1:P"]],
    "merge-0": [["C0:S", "C1:R", "OUT:P", "attachment:Q"]],
  },
  "balanced-B4": {
    root: [
      ["R0:P", "R1:Q", "attachment:R", "link:S"],
      ["R2:P", "R3:S", "link:Q"],
    ],
    "via-0": [["R0:R", "C0:P"]],
    "via-1": [["R1:R", "C1:P"]],
    "via-2": [["R2:R", "C2:P"]],
    "via-3": [["R3:R", "C3:P"]],
    "merge-1": [["C0:S", "C1:R", "M1:Q", "attachment:P"]],
    "merge-2": [["C2:R", "C3:S", "M2:Q", "attachment:P"]],
    "merge-0": [["M1:R", "M2:S", "OUT:Q", "attachment:P"]],
  },
  "left-deep-L4": {
    root: [
      ["R0:P", "R1:Q", "attachment:R", "link:S"],
      ["R2:P", "R3:S", "link:Q"],
    ],
    "via-0": [["R0:R", "C0:P"]],
    "via-1": [["R1:R", "C1:P"]],
    "via-2": [["R2:R", "C2:P"]],
    "via-3": [["R3:R", "C3:P"]],
    "merge-2": [["C0:S", "C1:R", "M2:P", "attachment:Q"]],
    "merge-1": [["C2:S", "M2:R", "M1:P", "attachment:Q"]],
    "merge-0": [["C3:S", "M1:R", "OUT:Q", "attachment:P"]],
  },
};

const ROLE_SIDES = {
  "left-to-right": { P: "east", Q: "north", R: "west", S: "south" },
  "top-to-bottom": { P: "south", Q: "east", R: "north", S: "west" },
} as const;

function componentIndex(id: string): number {
  const tuple = JSON.parse(id) as string[];
  return tuple[0] === "junction-comb" ? Number(tuple.at(-1)) : 0;
}

function assertPortRows(
  graph: any,
  flow: SchematicFlow,
  expected: Readonly<Record<string, readonly (readonly string[])[]>>,
): void {
  for (const [deviceUid, rows] of Object.entries(expected)) {
    const components = graph.nodes
      .filter(
        (node: any) =>
          node.kind === "junction" &&
          node.terminal.deviceUid === deviceUid &&
          !node.id.startsWith("z-owner-"),
      )
      .sort(
        (left: any, right: any) =>
          componentIndex(left.id) - componentIndex(right.id),
      );
    expect(components).toHaveLength(rows.length);
    const terminalKey = deviceUid === "root" ? "4" : "T";
    const originalId = JSON.stringify([
      "junction",
      "signal",
      deviceUid,
      terminalKey,
    ]);
    const combRole = deviceUid === "root" ? "split" : "merge";
    expect(components.map(({ id }: any) => id)).toEqual(
      rows.map((_, index) =>
        index === 0
          ? originalId
          : JSON.stringify([
              "junction-comb",
              originalId,
              combRole,
              String(index),
            ]),
      ),
    );
    for (let linkIndex = 0; linkIndex < rows.length - 1; linkIndex += 1) {
      const link = graph.edges.find(
        ({ id }: any) =>
          id ===
          JSON.stringify([
            "boundary-segment",
            originalId,
            "comb-link",
            combRole,
            String(linkIndex),
          ]),
      );
      expect(link).toMatchObject({
        sourcePortId: JSON.stringify([
          "port",
          originalId,
          "comb-link",
          combRole,
          String(linkIndex),
          "out",
        ]),
        targetPortId: JSON.stringify([
          "port",
          originalId,
          "comb-link",
          combRole,
          String(linkIndex),
          "in",
        ]),
        // Every comb-bearing frozen minimal row has incident minimum rank 0.
        pathRank: 0,
      });
    }
    for (const [component, expectedPorts] of components.map(
      (node: any, index: number) => [node, rows[index]!] as const,
    )) {
      const ports = [...component.ports].sort(
        (left: any, right: any) => left.order - right.order,
      );
      expect(ports.map(({ order }: any) => order)).toEqual(
        expectedPorts.map((_, order) => order),
      );
      expect(
        ports.map((candidate: any) => {
          const incident = graph.edges.find(
            ({ sourcePortId, targetPortId }: any) =>
              sourcePortId === candidate.id || targetPortId === candidate.id,
          );
          const label = candidate.symbolPortId.startsWith("conductor-")
            ? incident.conductor.designation
            : candidate.symbolPortId.startsWith("comb-link-")
              ? "link"
              : "attachment";
          const role = expectedPorts[candidate.order]!.slice(-1) as
            "P" | "Q" | "R" | "S";
          expect(candidate.side).toBe(ROLE_SIDES[flow][role]);
          return `${label}:${role}`;
        }),
      ).toEqual(expectedPorts);
    }
  }
}

function assertTerminalRoleRows(
  graph: any,
  terminal: Terminal,
  flow: SchematicFlow,
  expected: readonly (readonly ("P" | "Q" | "R" | "S")[])[],
): void {
  const components = graph.nodes
    .filter(
      (node: any) =>
        node.kind === "junction" &&
        node.terminal.deviceUid === terminal.deviceUid &&
        node.terminal.terminalKey === terminal.terminalKey,
    )
    .sort(
      (left: any, right: any) =>
        componentIndex(left.id) - componentIndex(right.id),
    );
  expect(components).toHaveLength(expected.length);
  for (const [index, component] of components.entries()) {
    const ports = [...component.ports].sort(
      (left: any, right: any) => left.order - right.order,
    );
    expect(ports.map(({ order }: any) => order)).toEqual(
      expected[index]!.map((_, order) => order),
    );
    expect(ports.map(({ side }: any) => side)).toEqual(
      expected[index]!.map((role) => ROLE_SIDES[flow][role]),
    );
  }
}

function sortedCenters(values: readonly (readonly number[])[]) {
  return [...values].sort(
    (left, right) => left[0]! - right[0]! || left[1]! - right[1]!,
  );
}

const ROUND9_DEVICE_UIDS = {
  LS1: "596f728b-1445-4c4b-8974-a3b4ea703636",
  TB1: "10418711-330f-4482-8dab-a274923215cb",
  PLC1: "81148ad3-8c03-4c8d-8c70-6b33bb3b0266",
} as const;

const ROUND9_SIGNAL_NET_ID =
  "net:sha256:af8c9ba2461a98df6aae2bc32934bfb43e00d202ef9d6a0b4f8c8be8409877b9";

const ROUND9_PRIORITY_EDGE_ID =
  '["wire","f0000000-0000-4000-8000-000000000200"]';

const ROUND9_STRUCTURAL_TERMINALS = [
  { deviceUid: ROUND9_DEVICE_UIDS.LS1, terminalKey: "4" },
  { deviceUid: ROUND9_DEVICE_UIDS.TB1, terminalKey: "7" },
  { deviceUid: ROUND9_DEVICE_UIDS.TB1, terminalKey: "3" },
] as const;

function permuteRound9CollectionsAndKeys(
  value: unknown,
  preserveArrayOrder = false,
): unknown {
  if (Array.isArray(value)) {
    const members = preserveArrayOrder ? [...value] : [...value].reverse();
    return members.map((member) => permuteRound9CollectionsAndKeys(member));
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
        permuteRound9CollectionsAndKeys(
          member,
          key === "terminalKeys" || (key === "terminals" && functionRecord),
        ),
      ]),
  );
}

function reorderedRound9Ir(ir: ElectricalIr): ElectricalIr {
  return permuteRound9CollectionsAndKeys(structuredClone(ir)) as ElectricalIr;
}

function round9Request(flow: SchematicFlow): SchematicViewRequest {
  return {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS1" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower: false,
    },
    flow,
  };
}

function assertRound9ProductSvgStructure(svg: string): void {
  const junctionTags =
    svg.match(/<circle\b[^>]*class="junction-dot"[^>]*\/>/g) ?? [];
  const boundaryTags =
    svg.match(/<path\b[^>]*class="boundary-path"[^>]*\/>/g) ?? [];
  expect(junctionTags).toHaveLength(3);
  expect(boundaryTags).toHaveLength(3);

  for (const { deviceUid, terminalKey } of ROUND9_STRUCTURAL_TERMINALS) {
    expect(
      junctionTags.filter(
        (tag) =>
          tag.includes(`data-device-uid="${deviceUid}"`) &&
          tag.includes(`data-terminal-key="${terminalKey}"`),
      ),
    ).toHaveLength(1);
    expect(
      boundaryTags.filter(
        (tag) =>
          tag.includes(`data-source-device-uid="${deviceUid}"`) &&
          tag.includes(`data-source-terminal-key="${terminalKey}"`) &&
          tag.includes(`data-target-device-uid="${deviceUid}"`) &&
          tag.includes(`data-target-terminal-key="${terminalKey}"`),
      ),
    ).toHaveLength(1);
  }
}

describe("Amendment B4 v23 Tier 1 evidence matrix", () => {
  for (const testCase of CASES) {
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      it(`${testCase.planRow} ${flow} locks the frozen grammar model and reordered-input boundary`, async () => {
        const fixture = tier1Fixture(
          testCase.tree as readonly Tree[],
          flow,
          testCase.vias,
        );
        assertFrozenMinimalModelSpecification(fixture, testCase, flow);
        const graph = emitClosedTraceStructuresForTest(
          fixture.selected,
          fixture.graph,
        );
        assertPortRows(graph, flow, PORT_ROWS[testCase.key]!);
        const build = buildElkAdapterGraph(graph, fixture.selected);
        const priority = build.graph.edges?.find(
          ({ id }) => id === FROZEN_PRIORITY_EDGE_IDS[testCase.key],
        );
        if (priority === undefined)
          throw new Error("Missing Tier 1 priority edge.");
        expect(priority.layoutOptions).toMatchObject({
          "org.eclipse.elk.layered.priority.direction": "2",
        });
        expect(
          build.graph.edges
            ?.filter(
              ({ layoutOptions }) =>
                layoutOptions?.[
                  "org.eclipse.elk.layered.priority.direction"
                ] === "2",
            )
            .map(({ id }) => id),
        ).toEqual([FROZEN_PRIORITY_EDGE_IDS[testCase.key]]);

        const reversedSource = reverseMinimalSourceCollections(fixture.graph);
        const reversedGraph = emitClosedTraceStructuresForTest(
          fixture.selected,
          reversedSource,
        );
        expect(serializePresentationGraphForTest(reversedGraph)).not.toBe(
          serializePresentationGraphForTest(graph),
        );
        expect(keyedPresentationBytes(reversedGraph)).toBe(
          keyedPresentationBytes(graph),
        );
        const reversedBuild = buildElkAdapterGraph(
          reversedGraph,
          fixture.selected,
        );
        expect(serializeElkAdapterForTest(reversedBuild)).toBe(
          serializeElkAdapterForTest(build),
        );

        const output = await createElkEngine().layout(
          structuredClone(build.graph),
        );
        const reversedOutput = await createElkEngine().layout(
          structuredClone(reversedBuild.graph),
        );
        expect(canonicalElkOutput(reversedOutput)).toBe(
          canonicalElkOutput(output),
        );
        const valid = normalizeAndValidateLayout(
          graph,
          build.graph,
          output,
          SYMBOL_CATALOG,
        );
        const reversedValid = normalizeAndValidateLayout(
          reversedGraph,
          reversedBuild.graph,
          reversedOutput,
          SYMBOL_CATALOG,
        );
        expect(valid.ok, valid.ok ? "" : valid.error.message).toBe(true);
        expect(
          reversedValid.ok,
          reversedValid.ok ? "" : reversedValid.error.message,
        ).toBe(true);
        expect(JSON.stringify(reversedValid)).toBe(JSON.stringify(valid));
        if (!valid.ok) return;
        expect([valid.value.width, valid.value.height]).toEqual(
          flow === "left-to-right" ? testCase.rightSize : testCase.downSize,
        );
        const structuralIds = new Set(
          graph.nodes
            .filter(
              ({ id, kind }) =>
                kind === "junction" &&
                id !== "target" &&
                !id.startsWith("z-owner-"),
            )
            .map(({ id }) => id),
        );
        const centers = valid.value.nodes
          .filter(({ id }) => structuralIds.has(id))
          .map(({ x, y }) => [x + 3, y + 3]);
        const key = `${testCase.key}:${flow === "left-to-right" ? "right" : "down"}`;
        expect(sortedCenters(centers)).toEqual(sortedCenters(CENTERS[key]!));
      });
    }
  }

  let coreIr: ElectricalIr;
  beforeAll(async () => {
    coreIr = await compileCoreFixture();
  });

  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    it(`round-9 M3 ${flow} stays on the full compiled production pipeline and reproduces the frozen table`, async () => {
      const ir = b4Round9Fixture(coreIr);
      const reorderedIr = reorderedRound9Ir(ir);
      expect(evaluateRules(ir)).toEqual([]);
      expect(evaluateRules(reorderedIr)).toEqual([]);
      const selected = selectB4Trace(ir, flow);
      const reorderedSelected = selectB4Trace(reorderedIr, flow);
      expect(reorderedSelected).toEqual(selected);
      expect(
        selected.paths.filter(({ lane }) => lane === "signal"),
      ).toHaveLength(1);
      expect(selected.paths.find(({ lane }) => lane === "signal")!.end).toEqual(
        {
          terminal: {
            deviceUid: ROUND9_DEVICE_UIDS.PLC1,
            terminalKey: "X1.0",
          },
          constraint: "LAST",
          boundary: {
            kind: "channel",
            terminal: {
              deviceUid: ROUND9_DEVICE_UIDS.PLC1,
              terminalKey: "X1.0",
            },
            netId: ROUND9_SIGNAL_NET_ID,
            label: "PLC1.X1.0",
          },
        },
      );
      const presented = buildPresentationGraph({ ir, selected });
      if (!presented.ok) throw new Error(JSON.stringify(presented.error));
      const reorderedPresented = buildPresentationGraph({
        ir: reorderedIr,
        selected: reorderedSelected,
      });
      if (!reorderedPresented.ok) {
        throw new Error(JSON.stringify(reorderedPresented.error));
      }
      expect(
        serializePresentationGraphForTest(reorderedPresented.value.graph),
      ).toBe(serializePresentationGraphForTest(presented.value.graph));
      const rootTerminal = {
        deviceUid: ROUND9_DEVICE_UIDS.LS1,
        terminalKey: "4",
      } as const;
      assertTerminalRoleRows(presented.value.graph, rootTerminal, flow, [
        ["P", "Q", "S", "R"],
      ]);
      for (const terminalKey of ["7", "3"]) {
        assertTerminalRoleRows(
          presented.value.graph,
          { deviceUid: ROUND9_DEVICE_UIDS.TB1, terminalKey },
          flow,
          [["S", "R", "Q", "P"]],
        );
      }
      const build = buildElkAdapterGraph(presented.value.graph, selected);
      const reorderedBuild = buildElkAdapterGraph(
        reorderedPresented.value.graph,
        reorderedSelected,
      );
      expect(serializeElkAdapterForTest(reorderedBuild)).toBe(
        serializeElkAdapterForTest(build),
      );
      expect(
        build.graph.edges
          ?.filter(
            ({ layoutOptions }) =>
              layoutOptions?.["org.eclipse.elk.layered.priority.direction"] ===
              "2",
          )
          .map(({ id }) => id),
      ).toEqual([ROUND9_PRIORITY_EDGE_ID]);
      const output = await createElkEngine().layout(
        structuredClone(build.graph),
      );
      const valid = normalizeAndValidateLayout(
        presented.value.graph,
        build.graph,
        output,
        SYMBOL_CATALOG,
      );
      expect(valid.ok, valid.ok ? "" : valid.error.message).toBe(true);
      if (!valid.ok) return;
      const expectedSize =
        flow === "left-to-right" ? [1315, 537] : [792.8, 1032];
      expect([valid.value.width, valid.value.height]).toEqual(expectedSize);
      const expectedCenters =
        flow === "left-to-right"
          ? [
              [393.2, 425],
              [641.2, 393],
              [790, 319],
            ]
          : [
              [294.4, 396],
              [342.2, 528],
              [489.2, 660],
            ];
      const terminalKeys = new Set([
        JSON.stringify([ROUND9_DEVICE_UIDS.LS1, "4"]),
        JSON.stringify([ROUND9_DEVICE_UIDS.TB1, "7"]),
        JSON.stringify([ROUND9_DEVICE_UIDS.TB1, "3"]),
      ]);
      const ids = new Set(
        presented.value.graph.nodes
          .filter(
            (node) =>
              node.kind === "junction" &&
              terminalKeys.has(
                JSON.stringify([
                  node.terminal.deviceUid,
                  node.terminal.terminalKey,
                ]),
              ),
          )
          .map(({ id }) => id),
      );
      expect(
        sortedCenters(
          valid.value.nodes
            .filter(({ id }) => ids.has(id))
            .map(({ x, y }) => [x + 3, y + 3]),
        ),
      ).toEqual(sortedCenters(expectedCenters));

      const request = round9Request(flow);
      const [firstProduct, secondProduct, reorderedProduct] = await Promise.all(
        [
          renderSchematic(ir, request),
          renderSchematic(ir, request),
          renderSchematic(reorderedIr, request),
        ],
      );
      expect(
        firstProduct.ok,
        firstProduct.ok ? "" : JSON.stringify(firstProduct.error),
      ).toBe(true);
      expect(
        secondProduct.ok,
        secondProduct.ok ? "" : JSON.stringify(secondProduct.error),
      ).toBe(true);
      expect(
        reorderedProduct.ok,
        reorderedProduct.ok ? "" : JSON.stringify(reorderedProduct.error),
      ).toBe(true);
      if (!firstProduct.ok || !secondProduct.ok || !reorderedProduct.ok) return;

      expect(Object.keys(firstProduct.value)).toEqual([
        "view",
        "summary",
        "svg",
      ]);
      expect(firstProduct.value.view).toEqual({
        format: "schematic-view/0.2",
        family: "control",
        intent: "trace",
        root: {
          kind: "device",
          deviceUid: ROUND9_DEVICE_UIDS.LS1,
          designation: "LS1",
        },
        target: {
          deviceUid: ROUND9_DEVICE_UIDS.PLC1,
          designation: "PLC1",
        },
        includePower: false,
        flow,
      });
      const firstJsonBytes = `${JSON.stringify(firstProduct.value)}\n`;
      const secondJsonBytes = `${JSON.stringify(secondProduct.value)}\n`;
      const reorderedJsonBytes = `${JSON.stringify(reorderedProduct.value)}\n`;
      expect(secondProduct.value.svg).toBe(firstProduct.value.svg);
      expect(reorderedProduct.value.svg).toBe(firstProduct.value.svg);
      expect(secondJsonBytes).toBe(firstJsonBytes);
      expect(reorderedJsonBytes).toBe(firstJsonBytes);
      const expectedSvgSize =
        flow === "left-to-right" ? [1355, 681] : [832.8, 1176];
      expect(firstProduct.value.svg).toContain(
        `viewBox="0 0 ${expectedSvgSize[0]} ${expectedSvgSize[1]}" width="${expectedSvgSize[0]}" height="${expectedSvgSize[1]}"`,
      );
      assertRound9ProductSvgStructure(firstProduct.value.svg);
      checkRestrictedSvgXml(firstProduct.value.svg);
    });
  }
});
