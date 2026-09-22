import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import {
  sharedFunctionTerminalFixture,
  terminalPassThroughFixture,
  withParallelConductorsAt,
} from "../fixtures/presentation-cases.js";
import { buildPresentationGraph } from "../src/presentation.js";
import type {
  JunctionPresentationNode,
  PresentationGraph,
  SelectedSubgraph,
} from "../src/types.js";
import {
  compileCoreFixture,
  required,
  selectCoreSubgraph,
} from "./fixtures.js";

let coreIr: ElectricalIr;

beforeAll(async () => {
  coreIr = await compileCoreFixture();
});

function build(
  ir: ElectricalIr,
  selected: SelectedSubgraph,
  mappings?: Parameters<typeof buildPresentationGraph>[0]["mappings"],
): PresentationGraph {
  const result = buildPresentationGraph({
    ir,
    selected,
    ...(mappings === undefined ? {} : { mappings }),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.graph;
}

function deviceTerminal(
  ir: ElectricalIr,
  designation: string,
  terminalKey: string,
): TerminalId {
  return {
    deviceUid: required(
      ir.devices.find((device) => device.designation === designation),
    ).uid,
    terminalKey,
  };
}

function junctions(graph: PresentationGraph): JunctionPresentationNode[] {
  return graph.nodes.filter(
    (node): node is JunctionPresentationNode => node.kind === "junction",
  );
}

function physicalIncidenceByPort(
  graph: PresentationGraph,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of graph.edges.filter(({ kind }) => kind === "conductor")) {
    counts.set(edge.sourcePortId, (counts.get(edge.sourcePortId) ?? 0) + 1);
    counts.set(edge.targetPortId, (counts.get(edge.targetPortId) ?? 0) + 1);
  }
  return counts;
}

describe("semantic junction insertion", () => {
  it("connects two attachment-only functions with one dot-free same-terminal segment", () => {
    const fixture = sharedFunctionTerminalFixture(coreIr, 2);
    const graph = build(fixture.ir, fixture.selected, fixture.mappings);
    expect(junctions(graph)).toHaveLength(0);
    const boundary = graph.edges.filter(
      ({ kind }) => kind === "boundary-segment",
    );
    expect(boundary).toHaveLength(1);
    expect(boundary[0]).toMatchObject({
      netId: fixture.sharedNetId,
      elementIds: [],
      endpoints: [fixture.sharedTerminal, fixture.sharedTerminal],
    });
    const sharedPorts = graph.nodes.flatMap((node) =>
      node.ports.filter(
        ({ terminal }) =>
          terminal.deviceUid === fixture.sharedTerminal.deviceUid &&
          terminal.terminalKey === fixture.sharedTerminal.terminalKey,
      ),
    );
    expect(sharedPorts).toHaveLength(2);
    expect(
      sharedPorts.every(({ netId }) => netId === fixture.sharedNetId),
    ).toBe(true);
    expect(
      new Set([boundary[0]!.sourcePortId, boundary[0]!.targetPortId]),
    ).toEqual(new Set(sharedPorts.map(({ id }) => id)));
  });

  it("connects three attachment-only functions through one LCA-owned junction", () => {
    const fixture = sharedFunctionTerminalFixture(coreIr, 3);
    const graph = build(fixture.ir, fixture.selected, fixture.mappings);
    const junction = required(junctions(graph)[0]);
    expect(junctions(graph)).toHaveLength(1);
    expect(junction).toMatchObject({
      terminal: fixture.sharedTerminal,
      netId: fixture.sharedNetId,
    });
    expect(junction.parentId).toBe(graph.deviceGroups[0]!.id);
    expect(junction.ports).toHaveLength(3);
    const incident = graph.edges.filter((edge) =>
      junction.ports.some(
        ({ id }) => id === edge.sourcePortId || id === edge.targetPortId,
      ),
    );
    expect(incident).toHaveLength(3);
    expect(
      incident.every(
        ({ kind, netId, elementIds, endpoints }) =>
          kind === "boundary-segment" &&
          netId === fixture.sharedNetId &&
          elementIds.length === 0 &&
          endpoints.every(
            (terminal) =>
              terminal.deviceUid === fixture.sharedTerminal.deviceUid &&
              terminal.terminalKey === fixture.sharedTerminal.terminalKey,
          ),
      ),
    ).toBe(true);
  });

  it("keeps degree-two function, channel, and aggregate terminals dot-free", () => {
    const control = build(coreIr, selectCoreSubgraph(coreIr, "K1", "control"));
    const power = build(coreIr, selectCoreSubgraph(coreIr, "M1", "power"));
    expect(junctions(control)).toHaveLength(0);
    expect(junctions(power)).toHaveLength(0);

    const channel = required(
      control.nodes.find(
        (node) =>
          node.kind === "symbol" && node.classification === "plc-output",
      ),
    );
    expect(channel.attachments).toMatchObject([{ kind: "channel" }]);
    expect(channel.attachments).not.toMatchObject([{ kind: "function" }]);
    expect(physicalIncidenceByPort(control).get(channel.ports[0]!.id)).toBe(1);

    for (const aggregate of power.nodes.filter(
      (node) => node.kind === "symbol" && node.representation === "aggregate",
    )) {
      expect(
        aggregate.attachments.every(({ kind }) => kind === "aggregate"),
      ).toBe(true);
      for (const attachment of aggregate.attachments) {
        expect(
          attachment.portIds.reduce(
            (count, portId) =>
              count + (physicalIncidenceByPort(power).get(portId) ?? 0),
            0,
          ),
          "one conductor plus one aggregate incidence is degree two",
        ).toBe(1);
      }
    }
  });

  it("inserts a junction wherever two conductors add one function incidence", () => {
    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const fixture = withParallelConductorsAt(
      coreIr,
      selected,
      deviceTerminal(coreIr, "K1", "A1"),
      1,
    );
    const graph = build(fixture.ir, fixture.selected);
    const junction = required(
      junctions(graph).find(
        ({ terminal }) =>
          terminal.terminalKey === "A1" &&
          terminal.deviceUid === deviceTerminal(coreIr, "K1", "A1").deviceUid,
      ),
    );
    expect(junctions(graph)).toHaveLength(2);
    expect(junction.terminal).toEqual(deviceTerminal(coreIr, "K1", "A1"));
    expect(junction.parentId).toBe(
      graph.locationGroups.find(({ identity }) => identity[1] === "MAIN-PANEL")
        ?.id,
    );
    const incident = graph.edges.filter(
      (edge) =>
        junction.ports.some(({ id }) => id === edge.sourcePortId) ||
        junction.ports.some(({ id }) => id === edge.targetPortId),
    );
    expect(incident.filter(({ kind }) => kind === "conductor")).toHaveLength(2);
    expect(
      incident.filter(({ kind }) => kind === "boundary-segment"),
    ).toHaveLength(1);
    expect(
      incident
        .filter(({ kind }) => kind === "boundary-segment")
        .every(({ elementIds }) => elementIds.length === 0),
    ).toBe(true);
  });

  it("creates one degree-four junction without physical-port fanout", () => {
    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const fixture = withParallelConductorsAt(
      coreIr,
      selected,
      deviceTerminal(coreIr, "K1", "A1"),
      2,
    );
    const graph = build(fixture.ir, fixture.selected);
    const junction = required(
      junctions(graph).find(
        ({ terminal }) =>
          terminal.terminalKey === "A1" &&
          terminal.deviceUid === deviceTerminal(coreIr, "K1", "A1").deviceUid,
      ),
    );
    expect(junction.ports).toHaveLength(4);
    const counts = physicalIncidenceByPort(graph);
    for (const node of graph.nodes) {
      if (node.kind === "junction") continue;
      for (const port of node.ports)
        expect(counts.get(port.id) ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("uses root LCA for fanout at a collapsed boundary rail", () => {
    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const fixture = withParallelConductorsAt(
      coreIr,
      selected,
      deviceTerminal(coreIr, "PS1", "-"),
      1,
    );
    const graph = build(fixture.ir, fixture.selected);
    const junction = required(
      junctions(graph).find(
        ({ terminal }) =>
          terminal.terminalKey === "-" &&
          terminal.deviceUid === deviceTerminal(coreIr, "PS1", "-").deviceUid,
      ),
    );
    expect(junction.terminal).toEqual(deviceTerminal(coreIr, "PS1", "-"));
    expect(junction.parentId).toBe("root");
    const rail = required(graph.nodes.find((node) => node.kind === "rail"));
    expect(rail.attachments).toMatchObject([{ kind: "collapsed-boundary" }]);
  });

  it("keeps a terminal circle with one incoming and one outgoing edge dot-free", () => {
    const fixture = terminalPassThroughFixture(coreIr);
    const graph = build(fixture.ir, fixture.selected);
    expect(junctions(graph)).toHaveLength(0);
    const terminal = required(
      graph.nodes.find(
        (node) => node.kind === "symbol" && node.symbolId === "ais:terminal",
      ),
    );
    expect(terminal.ports.map(({ symbolPortId }) => symbolPortId)).toEqual([
      "in",
      "out",
    ]);
    expect(
      new Set(terminal.ports.map(({ terminal }) => terminal.terminalKey)),
    ).toEqual(new Set(["1"]));
    expect(terminal.attachments).toHaveLength(1);
    expect(terminal.attachments[0]!.kind).toBe("function");
    const counts = physicalIncidenceByPort(graph);
    expect(terminal.ports.map(({ id }) => counts.get(id))).toEqual([1, 1]);
  });

  it("never creates semantic junctions for unrelated different-net crossings", () => {
    const graph = build(coreIr, selectCoreSubgraph(coreIr, "M1", "power"));
    expect(new Set(graph.edges.map(({ netId }) => netId)).size).toBe(13);
    expect(junctions(graph)).toHaveLength(0);
  });
});
