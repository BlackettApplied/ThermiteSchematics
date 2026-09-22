import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ElectricalIr, FunctionId } from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import { beforeAll, describe, expect, it } from "vitest";

import { pnpAggregateFixture } from "../fixtures/presentation-cases.js";
import {
  buildElkAdapterGraph,
  serializeElkAdapterForTest,
} from "../src/layout/elk-adapter.js";
import { ELK_OPTIONS } from "../src/layout/options.js";
import {
  buildPresentationGraph,
  serializePresentationGraphForTest,
  validatePresentationGraph,
} from "../src/presentation.js";
import {
  selectCableConductorSubgraph,
  selectLoadsSubgraph,
  selectTraceSubgraph,
} from "../src/selection.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import type {
  PresentationGraph,
  SelectedSubgraph,
  SymbolPresentationNode,
} from "../src/types.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import {
  materializeAndCompileB4Tier2Fixture,
  selectB4Trace,
} from "./b4-fixtures.js";
import {
  compileCoreFixture,
  mutableCoreMappings,
  pnpParallelTraceFixture,
  pnpTraceFixture,
  required,
  selectCoreSubgraph,
} from "./fixtures.js";

let coreIr: ElectricalIr;

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

function presentation(
  ir: ElectricalIr,
  selected: SelectedSubgraph,
  mappings = mutableCoreMappings(),
) {
  const result = buildPresentationGraph({ ir, selected, mappings });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function loadsSelection(ir: ElectricalIr): SelectedSubgraph {
  const root = required(
    ir.devices.find(({ designation }) => designation === "PS1"),
  );
  const result = selectLoadsSubgraph({
    ir,
    view: {
      format: "schematic-view/0.1",
      family: "control",
      root: { deviceUid: root.uid, designation: root.designation },
      flow: "left-to-right",
    },
    engine: createQueryEngine(ir),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function intentSelection(
  ir: ElectricalIr,
  request:
    | {
        readonly format: "schematic-view-request/0.2";
        readonly root: { readonly by: "designation"; readonly value: string };
        readonly intent: {
          readonly kind: "trace";
          readonly to: {
            readonly by: "designation";
            readonly value: string;
          };
          readonly includePower: boolean;
        };
      }
    | {
        readonly format: "schematic-view-request/0.2";
        readonly root: { readonly by: "designation"; readonly value: string };
        readonly intent: { readonly kind: "conductors" };
      },
): SelectedSubgraph {
  const normalized = normalizeSchematicView(ir, request);
  if (!normalized.ok) throw new Error(JSON.stringify(normalized.error));
  if (normalized.value.view.format !== "schematic-view/0.2") {
    throw new Error("Expected an intent view.");
  }
  if (normalized.value.view.intent === "trace") {
    const selected = selectTraceSubgraph({
      ir,
      view: normalized.value.view,
      engine: normalized.value.engine,
      mappings: normalized.value.mappings,
      target: normalized.value.view.target,
      includePower: normalized.value.view.includePower,
    });
    if (!selected.ok) throw new Error(JSON.stringify(selected.error));
    return selected.value;
  }
  if (!("rootSelector" in normalized.value)) {
    throw new Error("Expected a prepared cable view.");
  }
  const selected = selectCableConductorSubgraph({
    ir,
    view: normalized.value.view,
    engine: normalized.value.engine,
    mappings: normalized.value.mappings,
    root: normalized.value.rootSelector,
  });
  if (!selected.ok) throw new Error(JSON.stringify(selected.error));
  return selected.value;
}

function traceSelection(ir: ElectricalIr): SelectedSubgraph {
  return intentSelection(ir, {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS1" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower: false,
    },
  });
}

function designation(ir: ElectricalIr, deviceUid: string): string {
  return required(ir.devices.find(({ uid }) => uid === deviceUid)).designation;
}

function deviceUidFor(ir: ElectricalIr, designation: string): string {
  return required(
    ir.devices.find((device) => device.designation === designation),
  ).uid;
}

function symbol(
  graph: PresentationGraph,
  deviceDesignation: string,
  representation: SymbolPresentationNode["representation"],
): SymbolPresentationNode {
  return required(
    graph.nodes.find(
      (node): node is SymbolPresentationNode =>
        node.kind === "symbol" &&
        node.designation === deviceDesignation &&
        node.representation === representation,
    ),
  );
}

describe("presentation transform", () => {
  it("presents all four cable lanes with exact canonical text provenance", () => {
    const selected = intentSelection(coreIr, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "CBL1" },
      intent: { kind: "conductors" },
    });
    const { graph, summary } = presentation(coreIr, selected);
    expect(graph.view).toEqual(selected.view);
    expect(graph.edges.map(({ label }) => label?.text).sort()).toEqual([
      "CBL1.1+ · black · 18AWG",
      "CBL1.1- · white · 18AWG",
      "CBL1.2+ · red · 18AWG",
      "CBL1.2- · green · 18AWG",
    ]);
    const expectedMetadata = required(
      graph.metadataTextSources.find(
        ({ ownerKind, field }) =>
          ownerKind === "cable" && field === "cable.designation",
      ),
    );
    expect(expectedMetadata).toEqual({
      ownerKind: "cable",
      ownerId: expectedMetadata.ownerId,
      field: "cable.designation",
      value: "CBL1",
    });
    for (const edge of graph.edges) {
      expect(edge.kind).toBe("conductor");
      expect(edge.conductor?.kind).toBe("cable-conductor");
      expect(
        edge.label?.textSources.map(({ ownerKind, field, value }) => [
          ownerKind,
          field,
          value,
        ]),
      ).toEqual([
        [
          "cable-conductor",
          "cable.conductor.color",
          edge.label.text.split(" · ")[1],
        ],
        ["cable-conductor", "cable.conductor.id", edge.conductor?.conductorId],
        ["cable-conductor", "cable.conductor.size", "18AWG"],
        ["cable-conductor", "cable.designation", "CBL1"],
      ]);
    }
    expect(summary).toMatchObject({
      deviceUids: selected.deviceUids,
      terminalIds: selected.terminalIds,
      functionIds: selected.functionIds,
      conductiveElementIds: selected.conductiveElementIds,
      netIds: selected.netIds,
    });
  });

  it.each([
    ["two-wire", () => coreIr, ["13", "14"]],
    ["PNP", () => pnpTraceFixture(coreIr), ["1", "3", "4"]],
  ] as const)(
    "keeps every %s root port net as provenance while omitting power arms",
    (_name, fixture, terminalKeys) => {
      const ir = fixture();
      const selected = traceSelection(ir);
      const { graph, summary } = presentation(ir, selected);
      const root = symbol(
        graph,
        "LS1",
        terminalKeys.length === 2 ? "function" : "aggregate",
      );
      expect(root.ports.map(({ terminal }) => terminal.terminalKey)).toEqual(
        terminalKeys,
      );
      for (const port of root.ports) {
        expect(selected.netIds).toContain(port.netId);
        expect(summary.netIds).toContain(port.netId);
      }
      const rootEdges = graph.edges.filter(({ endpoints }) =>
        endpoints.some(
          ({ deviceUid, terminalKey }) =>
            deviceUid === root.deviceUid &&
            terminalKey !== "14" &&
            terminalKey !== "4",
        ),
      );
      expect(rootEdges).toHaveLength(0);
      expect(selected.paths.map(({ lane }) => lane)).toEqual(["signal"]);
      expect(
        graph.edges.every(({ netId }) => netId === root.ports.at(-1)?.netId),
      ).toBe(true);
      expect(
        graph.deviceGroups.map(({ designation }) => designation),
      ).not.toContain("PS1");
    },
  );

  it("builds the exact K1 hierarchy, channel boundary, and collapsed return rail", () => {
    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const { graph, summary } = presentation(coreIr, selected);
    expect(graph.format).toBe("schematic-presentation/0.1");
    expect(graph.locationGroups.map(({ identity }) => identity)).toEqual([
      ["authored", "MAIN-PANEL"],
      ["authored", "MAIN-PANEL-DOOR"],
    ]);
    expect(graph.deviceGroups.map(({ designation }) => designation)).toEqual([
      "PLC1",
      "OL1",
      "PB1",
      "K1",
    ]);
    expect(
      graph.deviceGroups.some(({ designation }) => designation === "PS1"),
    ).toBe(false);
    const rail = required(graph.nodes.find((node) => node.kind === "rail"));
    expect(rail).toMatchObject({
      parentId: "root",
      designation: "PS1",
      typeId: "core:psu-24vdc",
      symbolId: "ais:rail-return",
      boundaryConstraint: "LAST",
      boundary: { terminal: { terminalKey: "-" }, label: "0VDC" },
      attachments: [{ kind: "collapsed-boundary" }],
    });
    const plc = symbol(graph, "PLC1", "function");
    expect(plc).toMatchObject({
      classification: "plc-output",
      boundaryConstraint: "FIRST",
      attachments: [{ kind: "channel" }],
    });
    expect(
      graph.nodes.filter(({ kind }) => kind === "junction"),
      "key-experiment K1 Junctions: none",
    ).toHaveLength(0);
    const ports = new Map(
      graph.nodes.flatMap((node) =>
        node.ports.map((port) => [port.id, port] as const),
      ),
    );
    const returning = required(
      graph.edges.find(({ endpoints }) =>
        endpoints.every(
          ({ deviceUid, terminalKey }) =>
            (deviceUid === deviceUidFor(coreIr, "K1") &&
              terminalKey === "A2") ||
            (deviceUid === deviceUidFor(coreIr, "PS1") && terminalKey === "-"),
        ),
      ),
    );
    expect(ports.get(returning.sourcePortId)?.terminal).toEqual({
      deviceUid: deviceUidFor(coreIr, "K1"),
      terminalKey: "A2",
    });
    expect(ports.get(returning.targetPortId)?.terminal).toEqual({
      deviceUid: deviceUidFor(coreIr, "PS1"),
      terminalKey: "-",
    });
    expect(summary.deviceUids.map((uid) => designation(coreIr, uid))).toEqual([
      "K1",
      "OL1",
      "PB1",
      "PLC1",
      "PS1",
    ]);
    expect(summary.terminalIds).toEqual(selected.terminalIds);
    expect(summary.functionIds).toEqual(selected.functionIds);
    expect(summary.conductiveElementIds).toEqual(selected.conductiveElementIds);
    expect(summary.netIds).toEqual(selected.netIds);
  });

  it("expands M1 power functions and complete source/load aggregates with exact provenance", () => {
    const selected = selectCoreSubgraph(coreIr, "M1", "power");
    const { graph, summary } = presentation(coreIr, selected);
    const source = symbol(graph, "SRC1", "aggregate");
    const motor = symbol(graph, "M1", "aggregate");
    expect(source.boundaryConstraint).toBe("FIRST");
    expect(motor.boundaryConstraint).toBe("LAST");
    expect(source.functionIds.map(({ functionKey }) => functionKey)).toEqual([
      "three_phase_source",
      "protective_earth",
    ]);
    expect(
      source.ports.map(({ symbolPortId, terminal, memberFunctionId }) => [
        symbolPortId,
        terminal.terminalKey,
        memberFunctionId?.functionKey,
      ]),
    ).toEqual([
      ["L1", "L1", "three_phase_source"],
      ["L2", "L2", "three_phase_source"],
      ["L3", "L3", "three_phase_source"],
      ["PE", "PE", "protective_earth"],
    ]);
    expect(
      motor.ports.map(({ symbolPortId, terminal, memberFunctionId }) => [
        symbolPortId,
        terminal.terminalKey,
        memberFunctionId?.functionKey,
      ]),
    ).toEqual([
      ["U", "U", "motor_load"],
      ["V", "V", "motor_load"],
      ["W", "W", "motor_load"],
      ["PE", "PE", "protective_earth"],
    ]);
    expect(source.attachments.every(({ kind }) => kind === "aggregate")).toBe(
      true,
    );
    expect(motor.attachments.every(({ kind }) => kind === "aggregate")).toBe(
      true,
    );
    expect(
      graph.nodes.filter(({ kind }) => kind === "junction"),
      "key-experiment M1 Junctions: none",
    ).toHaveLength(0);
    expect(summary.terminalIds).toEqual(selected.terminalIds);
    expect(summary.functionIds).toEqual(selected.functionIds);
  });

  it("preserves the PNP disjoint-function binding union in one aggregate node", () => {
    const fixture = pnpAggregateFixture(coreIr);
    const { graph } = presentation(fixture.ir, fixture.selected);
    const pnp = symbol(graph, "PNP1", "aggregate");
    expect(pnp.functionIds.map(({ functionKey }) => functionKey)).toEqual([
      "supply",
      "output",
    ]);
    expect(
      pnp.ports.map(({ symbolPortId, terminal, memberFunctionId }) => [
        symbolPortId,
        terminal.terminalKey,
        memberFunctionId?.functionKey,
      ]),
    ).toEqual([
      ["supply", "1", "supply"],
      ["return", "3", "supply"],
      ["signal", "4", "output"],
    ]);
    expect(pnp.attachments.every(({ kind }) => kind === "aggregate")).toBe(
      true,
    );
    expect(graph.nodes.filter(({ kind }) => kind === "junction")).toHaveLength(
      0,
    );
  });

  it("presents the complete PS1-to-PLC1 source/load pair with exact constraints", () => {
    const selected = loadsSelection(coreIr);
    const { graph, summary } = presentation(coreIr, selected);
    const source = symbol(graph, "PS1", "function");
    const load = symbol(graph, "PLC1", "function");
    expect(source).toMatchObject({
      symbolId: "ais:power-source-dc",
      symbolSize: { width: 36, height: 64 },
      boundaryConstraint: "FIRST",
      classification: "source",
    });
    expect(load).toMatchObject({
      symbolId: "ais:dc-load",
      symbolSize: { width: 40, height: 64 },
      boundaryConstraint: "LAST",
      classification: "load",
    });
    expect(
      source.ports.map(({ symbolPortId, terminal }) => [
        symbolPortId,
        terminal.terminalKey,
      ]),
    ).toEqual([
      ["positive", "+"],
      ["return", "-"],
    ]);
    expect(
      load.ports.map(({ symbolPortId, terminal }) => [
        symbolPortId,
        terminal.terminalKey,
      ]),
    ).toEqual([
      ["positive", "L+"],
      ["return", "M"],
    ]);
    expect(graph.edges).toHaveLength(2);
    expect(
      graph.edges.map(({ endpoints }) =>
        endpoints.map(({ deviceUid, terminalKey }) => [
          designation(coreIr, deviceUid),
          terminalKey,
        ]),
      ),
    ).toEqual([
      [
        ["PS1", "+"],
        ["PLC1", "L+"],
      ],
      [
        ["PS1", "-"],
        ["PLC1", "M"],
      ],
    ]);
    expect(summary).toMatchObject({
      terminalIds: selected.terminalIds,
      functionIds: selected.functionIds,
      conductiveElementIds: selected.conductiveElementIds,
      netIds: selected.netIds,
    });
  });

  it("keeps a PNP signal port as provenance without creating a signal edge", () => {
    const ir = pnpTraceFixture(coreIr);
    const selected = loadsSelection(ir);
    const { graph, summary } = presentation(ir, selected);
    const pnp = symbol(graph, "LS1", "aggregate");
    const pnpUid = deviceUidFor(ir, "LS1");
    expect(pnp.functionIds.map(({ functionKey }) => functionKey)).toEqual([
      "supply",
      "output",
    ]);
    expect(
      pnp.ports.map(({ symbolPortId, terminal, memberFunctionId }) => [
        symbolPortId,
        terminal.terminalKey,
        memberFunctionId?.functionKey,
      ]),
    ).toEqual([
      ["supply", "1", "supply"],
      ["return", "3", "supply"],
      ["signal", "4", "output"],
    ]);
    const pnpEdges = graph.edges.filter(({ endpoints }) =>
      endpoints.some(({ deviceUid }) => deviceUid === pnpUid),
    );
    expect(pnpEdges).toHaveLength(2);
    expect(
      pnpEdges.flatMap(({ endpoints }) =>
        endpoints
          .filter(({ deviceUid }) => deviceUid === pnpUid)
          .map(({ terminalKey }) => terminalKey),
      ),
    ).toEqual(["1", "3"]);
    expect(summary.netIds).toContain(
      required(
        ir.indexes.netIdByTerminal.find(
          ({ key }) => key.deviceUid === pnpUid && key.terminalKey === "4",
        ),
      ).value,
    );
  });

  it("routes a PNP equal-shortest signal fan-out through one stable first conductor", () => {
    const ir = pnpParallelTraceFixture(coreIr);
    const selected = traceSelection(ir);
    const { graph } = presentation(ir, selected);
    const pnp = symbol(graph, "LS1", "aggregate");
    const signalPort = required(
      pnp.ports.find(({ symbolPortId }) => symbolPortId === "signal"),
    );
    const signalAttachments = graph.edges.filter(
      ({ sourcePortId, targetPortId }) =>
        sourcePortId === signalPort.id || targetPortId === signalPort.id,
    );
    expect(signalAttachments).toHaveLength(1);
    const signalAttachment = signalAttachments[0]!;
    expect(signalAttachment.kind).toBe("boundary-segment");
    const junctionPortId =
      signalAttachment.sourcePortId === signalPort.id
        ? signalAttachment.targetPortId
        : signalAttachment.sourcePortId;
    const junction = required(
      graph.nodes.find(
        (node) =>
          node.kind === "junction" &&
          node.ports.some(({ id }) => id === junctionPortId),
      ),
    );
    expect(junction).toMatchObject({
      kind: "junction",
      terminal: { deviceUid: pnp.deviceUid, terminalKey: "4" },
      netId: signalPort.netId,
    });
    const junctionPortIds = new Set(junction.ports.map(({ id }) => id));
    const firstSignalConductors = graph.edges.filter(
      ({ kind, sourcePortId, targetPortId }) =>
        kind === "conductor" &&
        (junctionPortIds.has(sourcePortId) ||
          junctionPortIds.has(targetPortId)),
    );
    expect(
      firstSignalConductors.map(({ conductor }) => conductor?.designation),
    ).toEqual(["W-FLD-003", "EQ-1"]);
    expect(
      firstSignalConductors
        .map((edge) => {
          const portId = junctionPortIds.has(edge.sourcePortId)
            ? edge.sourcePortId
            : edge.targetPortId;
          const port = required(junction.ports.find(({ id }) => id === portId));
          return [edge.conductor?.designation, port.side, port.order];
        })
        .sort((left, right) => Number(left[2]) - Number(right[2])),
    ).toEqual([
      ["EQ-1", "east", 0],
      ["W-FLD-003", "north", 1],
    ]);
    const signalPath = required(
      selected.paths.find(({ lane }) => lane === "signal"),
    );
    const stableFirstStep = required(
      signalPath.steps.find(({ kind }) => kind === "conductor"),
    );
    expect(stableFirstStep).toMatchObject({
      kind: "conductor",
      elementId: {
        kind: "wire",
        uid: "f0000000-0000-4000-8000-000000000100",
      },
    });
    const stableFirstConductor = required(
      firstSignalConductors.find(
        ({ conductor }) => conductor?.designation === "EQ-1",
      ),
    );

    const adapter = buildElkAdapterGraph(graph);
    expect(
      adapter.optionAssignments.filter(
        ({ option }) => option === ELK_OPTIONS.priorityDirection,
      ),
    ).toEqual([
      {
        targetKind: "edge",
        targetId: stableFirstConductor.id,
        option: ELK_OPTIONS.priorityDirection,
        value: "2",
      },
    ]);

    const permuted = structuredClone(graph);
    permuted.edges.reverse();
    permuted.nodes.reverse();
    for (const node of permuted.nodes) node.ports.reverse();
    expect(serializeElkAdapterForTest(buildElkAdapterGraph(permuted))).toBe(
      serializeElkAdapterForTest(adapter),
    );

    const invalid = structuredClone(graph);
    invalid.edges = invalid.edges.filter(
      ({ id }) => id !== firstSignalConductors[1]!.id,
    );
    expect(() => buildElkAdapterGraph(invalid)).toThrow(
      "ELK adapter invariant: PNP trace root first signal conductor fan-out",
    );
  });

  it("rejects every closed-junction order degeneracy and repeated side", () => {
    const ir = pnpParallelTraceFixture(coreIr);
    const selected = traceSelection(ir);
    const graph = presentation(ir, selected).graph;
    const closedRoot = required(
      graph.nodes.find(
        (node) =>
          node.kind === "junction" &&
          node.terminal.deviceUid === graph.view.root.deviceUid &&
          node.terminal.terminalKey === "4",
      ),
    );

    const corruptions: readonly ((copy: PresentationGraph) => void)[] = [
      (copy) => {
        const root = required(
          copy.nodes.find(({ id }) => id === closedRoot.id),
        );
        for (const port of root.ports) (port as { order: number }).order += 1;
      },
      (copy) => {
        const root = required(
          copy.nodes.find(({ id }) => id === closedRoot.id),
        );
        (root.ports.at(-1)! as { order: number }).order += 1;
      },
      (copy) => {
        const root = required(
          copy.nodes.find(({ id }) => id === closedRoot.id),
        );
        (root.ports[1]! as { order: number }).order = root.ports[0]!.order;
      },
    ];
    for (const corrupt of corruptions) {
      const copy = structuredClone(graph);
      corrupt(copy);
      const root = required(copy.nodes.find(({ id }) => id === closedRoot.id));
      (root.ports as Array<{ id: string; order: number }>).sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id),
      );
      expect(() => validatePresentationGraph(ir, selected, copy)).toThrow(
        "dense junction port order",
      );
    }

    const repeatedSide = structuredClone(graph);
    const repeatedRoot = required(
      repeatedSide.nodes.find(({ id }) => id === closedRoot.id),
    );
    (repeatedRoot.ports[1]! as { side: string }).side =
      repeatedRoot.ports[0]!.side;
    expect(() => validatePresentationGraph(ir, selected, repeatedSide)).toThrow(
      "closed trace distinct sides",
    );
  });

  it("rejects a collapsed closed root comb and an incomplete comb link", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-b4-malformed-"),
    );
    try {
      const { ir } = await materializeAndCompileB4Tier2Fixture(
        temporaryRoot,
        "right-deep",
      );
      const selected = selectB4Trace(ir, "left-to-right");
      const graph = presentation(ir, selected).graph;
      const rootTerminal = required(
        selected.paths.find(({ lane }) => lane === "signal"),
      ).start.terminal;
      const rootComponents = graph.nodes.filter(
        (node) =>
          node.kind === "junction" &&
          node.terminal.deviceUid === rootTerminal.deviceUid &&
          node.terminal.terminalKey === rootTerminal.terminalKey,
      );
      expect(rootComponents).toHaveLength(2);
      const original = required(
        rootComponents.find(({ id }) => id.startsWith('["junction",')),
      );
      const comb = required(
        rootComponents.find(({ id }) => id.startsWith('["junction-comb",')),
      );
      const originalLinkPort = required(
        original.ports.find(({ symbolPortId }) =>
          symbolPortId.startsWith("comb-link-"),
        ),
      );
      const combLinkPort = required(
        comb.ports.find(({ symbolPortId }) =>
          symbolPortId.startsWith("comb-link-"),
        ),
      );
      const link = required(
        graph.edges.find(
          ({ sourcePortId, targetPortId }) =>
            (sourcePortId === originalLinkPort.id &&
              targetPortId === combLinkPort.id) ||
            (sourcePortId === combLinkPort.id &&
              targetPortId === originalLinkPort.id),
        ),
      );

      const collapsed = structuredClone(graph);
      const collapsedOriginal = required(
        collapsed.nodes.find(({ id }) => id === original.id),
      );
      const collapsedComb = required(
        collapsed.nodes.find(({ id }) => id === comb.id),
      );
      const collapsedPorts = [
        ...collapsedOriginal.ports,
        ...collapsedComb.ports,
      ]
        .filter(({ symbolPortId }) => !symbolPortId.startsWith("comb-link-"))
        .sort((left, right) => {
          const rank = (symbolPortId: string): number =>
            symbolPortId.startsWith("conductor-")
              ? Number(symbolPortId.slice("conductor-".length))
              : Number.MAX_SAFE_INTEGER;
          return rank(left.symbolPortId) - rank(right.symbolPortId);
        });
      for (const [order, port] of collapsedPorts.entries()) {
        (port as { order: number; side: string }).order = order;
        (port as { order: number; side: string }).side = "east";
      }
      (collapsedOriginal.ports as typeof collapsedPorts).splice(
        0,
        collapsedOriginal.ports.length,
        ...collapsedPorts,
      );
      const collapsedNodes = collapsed.nodes as Array<
        (typeof collapsed.nodes)[number]
      >;
      collapsedNodes.splice(
        collapsedNodes.findIndex(({ id }) => id === comb.id),
        1,
      );
      const collapsedEdges = collapsed.edges as Array<
        (typeof collapsed.edges)[number]
      >;
      collapsedEdges.splice(
        collapsedEdges.findIndex(({ id }) => id === link.id),
        1,
      );
      expect(() => validatePresentationGraph(ir, selected, collapsed)).toThrow(
        "closed trace degree",
      );

      const missingLink = structuredClone(graph);
      for (const nodeId of [original.id, comb.id]) {
        const node = required(
          missingLink.nodes.find(({ id }) => id === nodeId),
        );
        const ports = node.ports as Array<(typeof node.ports)[number]>;
        ports.splice(
          ports.findIndex(({ symbolPortId }) =>
            symbolPortId.startsWith("comb-link-"),
          ),
          1,
        );
      }
      const missingLinkEdges = missingLink.edges as Array<
        (typeof missingLink.edges)[number]
      >;
      missingLinkEdges.splice(
        missingLinkEdges.findIndex(({ id }) => id === link.id),
        1,
      );
      expect(() =>
        validatePresentationGraph(ir, selected, missingLink),
      ).toThrow("complete closed trace component");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("uses selected endpoint constraints without family or lane inference", () => {
    const renamedReturn = structuredClone(
      selectCoreSubgraph(coreIr, "K1", "control"),
    );
    const returning = required(
      renamedReturn.paths.find(({ lane }) => lane === "return"),
    );
    (returning as { lane: string }).lane = "renamed-return";
    const renamedGraph = presentation(coreIr, renamedReturn).graph;
    expect(
      required(renamedGraph.nodes.find((node) => node.kind === "rail"))
        .boundaryConstraint,
    ).toBe("LAST");

    const reversedInputConstraint = structuredClone(
      selectCoreSubgraph(coreIr, "K1", "control"),
    );
    const input = required(
      reversedInputConstraint.paths.find(({ lane }) => lane === "input"),
    );
    (input.start as { constraint?: "FIRST" | "LAST" }).constraint = "LAST";
    expect(
      symbol(
        presentation(coreIr, reversedInputConstraint).graph,
        "PLC1",
        "function",
      ).boundaryConstraint,
    ).toBe("LAST");

    const reversedLoadConstraints = structuredClone(
      selectCoreSubgraph(coreIr, "M1", "power"),
    );
    for (const path of reversedLoadConstraints.paths) {
      (path.end as { constraint?: "FIRST" | "LAST" }).constraint = "FIRST";
    }
    expect(
      symbol(
        presentation(coreIr, reversedLoadConstraints).graph,
        "M1",
        "aggregate",
      ).boundaryConstraint,
    ).toBe("FIRST");
  });

  it("uses exhaustive presentation classes rather than traversal roles for visual order", () => {
    const control = selectCoreSubgraph(coreIr, "K1", "control");
    const power = selectCoreSubgraph(coreIr, "M1", "power");
    const plcOutput = presentation(coreIr, control).graph.nodes.find(
      (node) => node.kind === "symbol" && node.classification === "plc-output",
    );
    const overloads = presentation(coreIr, power).graph.nodes.filter(
      (node) => node.kind === "symbol" && node.classification === "overload",
    );
    expect(plcOutput).toBeDefined();
    expect(overloads).toHaveLength(3);

    const plc = required(
      coreIr.devices.find(({ designation }) => designation === "PLC1"),
    );
    const di: FunctionId = { deviceUid: plc.uid, functionKey: "di0" };
    const terminal = required(
      coreIr.functions.find(
        ({ id }) => id.deviceUid === plc.uid && id.functionKey === "di0",
      ),
    ).terminals[0]!;
    const netId = required(
      coreIr.indexes.netIdByTerminal.find(
        ({ key }) =>
          key.deviceUid === terminal.deviceUid &&
          key.terminalKey === terminal.terminalKey,
      ),
    ).value;
    const selected: SelectedSubgraph = {
      view: {
        format: "schematic-view/0.1",
        family: "control",
        root: { deviceUid: plc.uid, designation: plc.designation },
        flow: "left-to-right",
      },
      paths: [],
      deviceUids: [plc.uid],
      terminalIds: [terminal],
      functionIds: [di],
      conductiveElementIds: [],
      netIds: [netId],
    };
    expect(
      symbol(presentation(coreIr, selected).graph, "PLC1", "function"),
    ).toMatchObject({
      classification: "plc-input",
    });

    const mappings = mutableCoreMappings();
    const breaker = required(
      mappings.find(({ typeId }) => typeId === "core:breaker-3p"),
    );
    for (const rule of breaker.functions)
      rule.traversalRole = "protection-contact";
    const baseline = presentation(coreIr, power).graph.nodes.map(
      ({ id }) => id,
    );
    const changed = presentation(coreIr, power, mappings).graph.nodes.map(
      ({ id }) => id,
    );
    expect(changed).toEqual(baseline);
  });

  it("returns R003 for corrupt function and aggregate mappings", () => {
    const control = selectCoreSubgraph(coreIr, "K1", "control");
    const functionMappings = mutableCoreMappings();
    required(
      functionMappings.find(({ typeId }) => typeId === "core:contactor-3p-1no"),
    )
      .functions.find(({ functionKey }) => functionKey === "coil")!
      .bindings.pop();
    expect(
      buildPresentationGraph({
        ir: coreIr,
        selected: control,
        mappings: functionMappings,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "R003", functionKey: "coil" },
    });

    const power = selectCoreSubgraph(coreIr, "M1", "power");
    const aggregateMappings = mutableCoreMappings();
    const motor = required(
      aggregateMappings.find(({ typeId }) => typeId === "core:motor-3ph"),
    ).aggregates[0]!;
    motor.bindings.find(
      ({ terminalKey }) => terminalKey === "PE",
    )!.memberFunctionKey = "motor_load";
    expect(
      buildPresentationGraph({
        ir: coreIr,
        selected: power,
        mappings: aggregateMappings,
      }),
    ).toMatchObject({ ok: false, error: { code: "R003" } });
  });

  it("validates every truth surface and rejects corrupt presentation DTOs", () => {
    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const graph = presentation(coreIr, selected).graph;
    expect(() =>
      validatePresentationGraph(coreIr, selected, graph),
    ).not.toThrow();
    const corruptions: Array<(graph: PresentationGraph) => void> = [
      (copy) => {
        const node = copy.nodes.find(
          (candidate): candidate is SymbolPresentationNode =>
            candidate.kind === "symbol",
        )!;
        (node.ports[0] as { netId: string }).netId = "wrong-net";
      },
      (copy) => {
        const node = copy.nodes.find(
          (candidate): candidate is SymbolPresentationNode =>
            candidate.kind === "symbol",
        )!;
        (node.ports[0] as { memberFunctionId: FunctionId }).memberFunctionId = {
          deviceUid: node.deviceUid,
          functionKey: "wrong-function",
        };
      },
      (copy) => {
        (
          copy.edges.find(({ kind }) => kind === "conductor")!
            .elementIds as Array<
            SelectedSubgraph["conductiveElementIds"][number]
          >
        )[0] = { kind: "wire", uid: "missing-wire" };
      },
      (copy) => {
        (copy.deviceGroups[0] as { parentId: string }).parentId =
          "wrong-parent";
      },
      (copy) => {
        const rail = copy.nodes.find((node) => node.kind === "rail")!;
        (rail.boundary as { potentialUid: string }).potentialUid =
          "missing-potential";
      },
    ];
    for (const corrupt of corruptions) {
      const copy = structuredClone(graph);
      corrupt(copy);
      expect(() => validatePresentationGraph(coreIr, selected, copy)).toThrow();
    }
  });

  it("produces a canonical serializable test view", () => {
    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const first = presentation(coreIr, selected).graph;
    const second = presentation(
      structuredClone(coreIr),
      structuredClone(selected),
    ).graph;
    expect(serializePresentationGraphForTest(second)).toBe(
      serializePresentationGraphForTest(first),
    );
  });

  it("is invariant to consumed IR, selector DTO, and catalog collection order", () => {
    const selected = selectCoreSubgraph(coreIr, "M1", "power");
    const baseline = presentation(coreIr, selected).graph;
    const ir = structuredClone(coreIr);
    for (const collection of [
      ir.deviceTypes,
      ir.devices,
      ir.terminals,
      ir.functions,
      ir.wires,
      ir.jumpers,
      ir.cables,
      ir.cableConductors,
      ir.potentials,
      ir.nets,
      ir.indexes.terminalIdsByDeviceUid,
      ir.indexes.conductiveElementIdsByTerminal,
      ir.indexes.terminalIdsByConductiveElement,
      ir.indexes.netIdByTerminal,
    ]) {
      collection.reverse();
    }
    for (const materialized of ir.functions) materialized.terminals.reverse();
    const shuffled = structuredClone(selected);
    shuffled.paths.reverse();
    shuffled.deviceUids.reverse();
    shuffled.terminalIds.reverse();
    shuffled.functionIds.reverse();
    shuffled.conductiveElementIds.reverse();
    shuffled.netIds.reverse();
    const result = buildPresentationGraph({
      ir,
      selected: shuffled,
      catalog: [...SYMBOL_CATALOG].reverse(),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(serializePresentationGraphForTest(result.value.graph)).toBe(
      serializePresentationGraphForTest(baseline),
    );
  });
});
