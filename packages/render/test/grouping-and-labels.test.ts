import type { ElectricalIr } from "@thermite/compiler";
import { beforeAll, describe, expect, it } from "vitest";

import { deepFreezeFixture } from "../fixtures/presentation-cases.js";
import { PRESENTATION_CLASS_RANK } from "../src/ordering.js";
import {
  buildPresentationGraph,
  serializePresentationGraphForTest,
} from "../src/presentation.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import { CORE_DEVICE_TYPE_SYMBOL_MAPPINGS } from "../src/symbols/mappings.js";
import type {
  PresentationGraph,
  PresentationLabel,
  SelectedSubgraph,
  SymbolPresentationNode,
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
): PresentationGraph {
  const result = buildPresentationGraph({ ir, selected });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.graph;
}

function allLabels(graph: PresentationGraph): PresentationLabel[] {
  return [
    ...graph.locationGroups.map(({ label }) => label),
    ...graph.deviceGroups.map(({ label }) => label),
    ...graph.nodes.flatMap((node) =>
      node.kind === "junction" ? [] : node.labels,
    ),
    ...graph.edges.flatMap((edge) => [
      ...(edge.label === undefined ? [] : [edge.label]),
      ...(edge.netLabel === undefined ? [] : [edge.netLabel]),
    ]),
  ];
}

function deviceUid(ir: ElectricalIr, designation: string): string {
  return required(
    ir.devices.find((device) => device.designation === designation),
  ).uid;
}

describe("presentation grouping and labels", () => {
  it("keeps opaque authored locations distinct from virtual and authored UNSPECIFIED", () => {
    const ir = structuredClone(coreIr);
    required(
      ir.devices.find(({ designation }) => designation === "PLC1"),
    ).location = undefined;
    required(
      ir.devices.find(({ designation }) => designation === "K1"),
    ).location = "UNSPECIFIED";
    const graph = build(ir, selectCoreSubgraph(ir, "K1", "control"));
    expect(graph.locationGroups.map(({ identity }) => identity)).toEqual([
      ["authored", "MAIN-PANEL"],
      ["authored", "MAIN-PANEL-DOOR"],
      ["authored", "UNSPECIFIED"],
      ["virtual", "UNSPECIFIED"],
    ]);
    const authored = required(
      graph.locationGroups.find(
        ({ identity }) =>
          identity[0] === "authored" && identity[1] === "UNSPECIFIED",
      ),
    );
    const virtual = required(
      graph.locationGroups.find(({ identity }) => identity[0] === "virtual"),
    );
    expect(authored.id).not.toBe(virtual.id);
    expect(authored.label.textSources).toMatchObject([
      { ownerKind: "device", field: "device.location", value: "UNSPECIFIED" },
    ]);
    expect(virtual.label.textSources).toEqual([]);
    const plc = required(
      graph.nodes.find(
        (node) => node.kind === "symbol" && node.designation === "PLC1",
      ),
    );
    const k1 = required(
      graph.nodes.find(
        (node) => node.kind === "symbol" && node.designation === "K1",
      ),
    );
    expect(plc.locationGroupId).toBe(virtual.id);
    expect(k1.locationGroupId).toBe(authored.id);
    expect(
      graph.locationGroups.find(
        ({ identity }) => identity[1] === "MAIN-PANEL-DOOR",
      )?.parentId,
    ).toBe("root");
  });

  it("records exact label roles, boxes, inline advance, and source descriptors", () => {
    const graph = build(coreIr, selectCoreSubgraph(coreIr, "K1", "control"));
    const labels = allLabels(graph);
    expect(new Set(labels.map(({ role }) => role))).toEqual(
      new Set([
        "location",
        "device",
        "function",
        "rail",
        "terminal",
        "conductor",
        "net",
      ]),
    );
    for (const label of labels) {
      const width = Math.max(
        12,
        Number((6 + 6.2 * [...label.text].length).toFixed(3)),
      );
      expect(label.width).toBe(width);
      expect(label.height).toBe(14);
      expect(label.textLength).toBe(Number((width - 6).toFixed(3)));
    }
    expect(
      labels.find(({ text }) => text === "aux95 NC")?.textSources,
    ).toMatchObject([
      { ownerKind: "function", field: "function.key", value: "aux95" },
    ]);
    expect(
      labels.find(({ text }) => text === "do0 DO")?.textSources,
    ).toMatchObject([
      { ownerKind: "function", field: "function.key", value: "do0" },
    ]);
    expect(
      labels.find(({ text, role }) => text === "0VDC" && role === "rail")
        ?.textSources,
    ).toBeDefined();
  });

  it("reserves deterministic leaf headers and rotates ports for top-to-bottom flow", () => {
    const left = build(
      coreIr,
      selectCoreSubgraph(coreIr, "K1", "control", "left-to-right"),
    );
    const down = build(
      coreIr,
      selectCoreSubgraph(coreIr, "K1", "control", "top-to-bottom"),
    );
    const leftCoil = required(
      left.nodes.find(
        (node): node is SymbolPresentationNode =>
          node.kind === "symbol" && node.symbolId === "ais:coil",
      ),
    );
    const downCoil = required(
      down.nodes.find(
        (node): node is SymbolPresentationNode =>
          node.kind === "symbol" && node.symbolId === "ais:coil",
      ),
    );
    expect(leftCoil.symbolSize).toEqual({ width: 40, height: 24 });
    expect(downCoil.symbolSize).toEqual({ width: 24, height: 40 });
    const leftLabel = required(
      leftCoil.labels.find(({ role }) => role === "function"),
    );
    expect(leftCoil.width).toBe(
      Math.max(leftCoil.symbolSize.width + 16, leftLabel.width + 16),
    );
    expect(leftCoil.height).toBe(22 + leftCoil.symbolSize.height + 8);
    expect(leftCoil.primitiveOrigin).toEqual({
      x: Number(((leftCoil.width - leftCoil.symbolSize.width) / 2).toFixed(3)),
      y: 22,
    });

    const downLabel = required(
      downCoil.labels.find(({ role }) => role === "function"),
    );
    expect(downCoil.width).toBe(
      downLabel.width + downCoil.symbolSize.width + 24,
    );
    expect(downCoil.height).toBe(22 + downCoil.symbolSize.height + 8);
    expect(downCoil.primitiveOrigin).toEqual({
      x: downLabel.width + 16,
      y: 22,
    });
    expect(leftCoil.ports.map(({ side }) => side)).toEqual(["west", "east"]);
    expect(downCoil.ports.map(({ side }) => side)).toEqual(["north", "south"]);
    expect(downCoil.ports.map(({ offset }) => offset)).toEqual([0.5, 0.5]);
  });

  it("emits one safe UID-owned device.type metadata source for every visible device", () => {
    const selected = selectCoreSubgraph(coreIr, "K1", "control");
    const graph = build(coreIr, selected);
    const typeSources = graph.metadataTextSources.filter(
      ({ field }) => field === "device.type",
    );
    expect(typeSources).toHaveLength(selected.deviceUids.length);
    for (const deviceUid of selected.deviceUids) {
      const device = required(
        coreIr.devices.find(({ uid }) => uid === deviceUid),
      );
      const source = required(
        typeSources.find(
          ({ ownerId }) =>
            ownerId ===
            `device-${[...deviceUid]
              .map((character) =>
                character.charCodeAt(0).toString(16).padStart(4, "0"),
              )
              .join("")}`,
        ),
      );
      expect(source).toEqual({
        ownerKind: "device",
        ownerId: source.ownerId,
        field: "device.type",
        value: device.typeId,
      });
    }
    const psuUid = deviceUid(coreIr, "PS1");
    expect(
      graph.deviceGroups.some(({ deviceUid }) => deviceUid === psuUid),
    ).toBe(false);
    expect(
      typeSources.some(
        ({ ownerId }) =>
          ownerId ===
          `device-${[...psuUid]
            .map((character) =>
              character.charCodeAt(0).toString(16).padStart(4, "0"),
            )
            .join("")}`,
      ),
    ).toBe(true);
  });

  it("sorts nodes only through the exhaustive presentation class table", () => {
    const graph = build(coreIr, selectCoreSubgraph(coreIr, "M1", "power"));
    const ranks = graph.nodes.map(
      ({ classification }) => PRESENTATION_CLASS_RANK[classification],
    );
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });

  it("does not mutate deeply frozen selector, IR, catalog, or mapping inputs", () => {
    const ir = deepFreezeFixture(structuredClone(coreIr));
    const selected = deepFreezeFixture(
      structuredClone(selectCoreSubgraph(coreIr, "M1", "power")),
    );
    const beforeIr = JSON.stringify(ir);
    const beforeSelected = JSON.stringify(selected);
    const result = buildPresentationGraph({
      ir,
      selected,
      catalog: SYMBOL_CATALOG,
      mappings: CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(ir)).toBe(beforeIr);
    expect(JSON.stringify(selected)).toBe(beforeSelected);
    if (result.ok) {
      expect(Object.isFrozen(result.value.graph)).toBe(true);
      expect(Object.isFrozen(result.value.graph.nodes)).toBe(true);
      expect(serializePresentationGraphForTest(result.value.graph)).toBe(
        serializePresentationGraphForTest(result.value.graph),
      );
    }
  });
});
