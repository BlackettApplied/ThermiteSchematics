import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateRules, type ElectricalIr } from "@thermite/compiler";
import Elk from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildElkAdapterGraph,
  serializeElkAdapterForTest,
} from "../src/layout/elk-adapter.js";
import { ELK_OPTIONS } from "../src/layout/options.js";
import { normalizeAndValidateLayout } from "../src/layout/validate-output.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import type { InvalidLayoutError } from "../src/errors.js";
import type {
  PresentationGraph,
  JunctionPresentationNode,
  SchematicFlow,
  SelectedSubgraph,
} from "../src/types.js";
import {
  materializeAndCompileB4Tier2Fixture,
  selectB4Trace,
} from "./b4-fixtures.js";

const JB1_UID = "c93a0ba9-65f4-4ffa-a0a1-1fde4a511e88";

interface Tier2Case {
  readonly name: "right-deep" | "bridge";
  readonly flow: SchematicFlow;
  readonly netId: string;
  readonly rawSize: readonly [number, number];
  readonly boundaryTerminal: "6" | "7";
  readonly wireUid: string;
  readonly priorityWireUid: string;
  readonly collision: "form an ambiguous intersection" | "overlap collinearly";
  readonly humanBytes: number;
  readonly jsonBytes: number;
}

const CASES: readonly Tier2Case[] = [
  {
    name: "right-deep",
    flow: "left-to-right",
    netId:
      "net:sha256:1fcf84453b5d3f3e8329a721d27507407fe5d2459f887ee0eb251aca0370d0c9",
    rawSize: [1516.8, 639],
    boundaryTerminal: "6",
    wireUid: "f0000000-0000-4000-8000-000000000410",
    priorityWireUid: "f0000000-0000-4000-8000-000000000410",
    collision: "form an ambiguous intersection",
    humanBytes: 351,
    jsonBytes: 599,
  },
  {
    name: "right-deep",
    flow: "top-to-bottom",
    netId:
      "net:sha256:1fcf84453b5d3f3e8329a721d27507407fe5d2459f887ee0eb251aca0370d0c9",
    rawSize: [1042.4, 1202],
    boundaryTerminal: "7",
    wireUid: "e84a9629-373c-4946-8b48-184b7464d474",
    priorityWireUid: "f0000000-0000-4000-8000-000000000410",
    collision: "form an ambiguous intersection",
    humanBytes: 351,
    jsonBytes: 599,
  },
  {
    name: "bridge",
    flow: "left-to-right",
    netId:
      "net:sha256:c55a63c4fc47d3f27ef4b2b375c57112c9256428728f69ebf96505ce12560308",
    rawSize: [1514.4, 831],
    boundaryTerminal: "6",
    wireUid: "00000000-0000-4000-8000-000000000302",
    priorityWireUid: "f0000000-0000-4000-8000-000000000300",
    collision: "overlap collinearly",
    humanBytes: 340,
    jsonBytes: 588,
  },
  {
    name: "bridge",
    flow: "top-to-bottom",
    netId:
      "net:sha256:c55a63c4fc47d3f27ef4b2b375c57112c9256428728f69ebf96505ce12560308",
    rawSize: [1282.2, 1214],
    boundaryTerminal: "6",
    wireUid: "00000000-0000-4000-8000-000000000302",
    priorityWireUid: "f0000000-0000-4000-8000-000000000300",
    collision: "overlap collinearly",
    humanBytes: 340,
    jsonBytes: 588,
  },
];

function tuple(tag: string, ...parts: readonly string[]): string {
  return JSON.stringify([tag, ...parts]);
}

function expectedError(testCase: Tier2Case): InvalidLayoutError {
  const terminal = testCase.boundaryTerminal;
  const junctionId = tuple(
    "junction",
    testCase.netId,
    JB1_UID,
    "X1." + terminal,
  );
  const ownerId = tuple("function", JB1_UID, `terminal${terminal}`);
  const boundaryId = tuple("boundary-segment", junctionId, ownerId);
  const wireId = tuple("wire", testCase.wireUid);
  return {
    code: "R004",
    message: `Invalid layout: edges ${boundaryId} and ${wireId} ${testCase.collision}.`,
    family: "control",
    netId: testCase.netId,
    root: "LS1",
  };
}

const RIGHT_TO_DOWN = new Map([
  ["east", "south"],
  ["north", "east"],
  ["west", "north"],
  ["south", "west"],
]);

function terminalDesignation(
  ir: ElectricalIr,
  terminal: SelectedSubgraph["terminalIds"][number],
): string {
  const device = ir.devices.find(({ uid }) => uid === terminal.deviceUid);
  if (device === undefined)
    throw new Error("Tier 2 terminal device is missing.");
  return `${device.designation}.${terminal.terminalKey}`;
}

function adapterNodes(root: ElkNode): readonly ElkNode[] {
  return [root, ...(root.children ?? []).flatMap(adapterNodes)];
}

function expectedRows(
  fixture: Tier2Case["name"],
): Readonly<Record<string, readonly (readonly string[])[] | null>> {
  return fixture === "right-deep"
    ? {
        "LS1.4": [
          ["EQ-1:east", "W-FLD-003:north", "attachment:west", "link:south"],
          ["R3:east", "R2:south", "link:north"],
        ],
        "JB1.X1.5": null,
        "JB1.X1.6": [["R3:west", "R2:south", "A:east", "attachment:north"]],
        "JB1.X1.7": [["L1-B:south", "A:west", "B:east", "attachment:north"]],
        "TB1.3": [
          ["L0-C:south", "B:west", "W-FLD-001:north", "attachment:east"],
        ],
        "TB1.6": null,
        "TB1.8": null,
        "PLC1.X1.0": null,
      }
    : {
        "LS1.4": [
          ["EQ-1:east", "W-FLD-003:north", "L2-A:south", "attachment:west"],
        ],
        "TB1.7": [
          ["EQ-1:south", "W-FLD-003:west", "M1-S:north", "attachment:east"],
        ],
        "JB1.X1.5": null,
        "TB1.6": null,
        "JB1.X1.6": [["M1-S:west", "S-A:east", "S-B:east", "attachment:east"]],
        "JB1.X1.7": [
          ["L2-C:west", "S-A:south", "BLOCK-A:north", "attachment:east"],
        ],
        "TB1.8": null,
        "TB1.3": [
          [
            "BLOCK-B:west",
            "BLOCK-A:south",
            "W-FLD-001:north",
            "attachment:east",
          ],
        ],
        "PLC1.X1.0": null,
      };
}

function rotateRows(
  rows: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  return rows.map((row) =>
    row.map((entry) => {
      const split = entry.lastIndexOf(":");
      const side = entry.slice(split + 1);
      return `${entry.slice(0, split)}:${RIGHT_TO_DOWN.get(side) ?? side}`;
    }),
  );
}

function assertTier2Structure(
  testCase: Tier2Case,
  ir: ElectricalIr,
  selected: SelectedSubgraph,
  graph: PresentationGraph,
): void {
  const inventory = [
    ...new Set(
      selected.paths
        .flatMap(({ steps }) => steps)
        .filter((step) => step.kind === "conductor")
        .flatMap(({ from, to }) => [
          terminalDesignation(ir, from),
          terminalDesignation(ir, to),
        ]),
    ),
  ].sort();
  const rows = expectedRows(testCase.name);
  expect(inventory).toEqual(Object.keys(rows).sort());

  const portOwner = new Map(
    graph.nodes.flatMap((node) =>
      node.ports.map((port) => [port.id, node] as const),
    ),
  );
  for (const [terminalName, expectedRight] of Object.entries(rows)) {
    const junctions = graph.nodes.filter(
      (node): node is JunctionPresentationNode =>
        node.kind === "junction" &&
        terminalDesignation(ir, node.terminal) === terminalName,
    );
    if (expectedRight === null) {
      expect(junctions, terminalName).toHaveLength(0);
      continue;
    }
    const originalId = tuple(
      "junction",
      junctions[0]!.netId,
      junctions[0]!.terminal.deviceUid,
      junctions[0]!.terminal.terminalKey,
    );
    junctions.sort(
      (left, right) =>
        Number(right.id === originalId) - Number(left.id === originalId) ||
        left.id.localeCompare(right.id),
    );
    const actual = junctions.map((junction) =>
      junction.ports.map((port) => {
        const edge = graph.edges.find(
          ({ sourcePortId, targetPortId }) =>
            sourcePortId === port.id || targetPortId === port.id,
        );
        if (edge === undefined)
          throw new Error(`Tier 2 port ${port.id} has no edge.`);
        const name =
          edge.conductor?.kind === "cable-conductor"
            ? `${edge.conductor.cableDesignation}.${edge.conductor.conductorId}`
            : (edge.conductor?.designation ??
              (port.symbolPortId.startsWith("comb-link-")
                ? "link"
                : "attachment"));
        if (edge.conductor !== undefined) {
          const end = edge.sourcePortId === port.id ? "source" : "target";
          expect(port.id).toBe(
            tuple("port", originalId, "conductor", edge.id, end),
          );
        } else if (name === "attachment") {
          const otherPortId =
            edge.sourcePortId === port.id
              ? edge.targetPortId
              : edge.sourcePortId;
          const owner = portOwner.get(otherPortId);
          if (owner === undefined)
            throw new Error("Tier 2 attachment owner is missing.");
          expect(port.id).toBe(
            tuple("port", originalId, "attachment", owner.id),
          );
          expect(edge.id).toBe(tuple("boundary-segment", originalId, owner.id));
        }
        return `${name}:${port.side}`;
      }),
    );
    expect(actual, terminalName).toEqual(
      testCase.flow === "left-to-right"
        ? expectedRight
        : rotateRows(expectedRight),
    );
  }

  const build = buildElkAdapterGraph(graph, selected);
  const junctionIds = new Set(
    graph.nodes.filter(({ kind }) => kind === "junction").map(({ id }) => id),
  );
  for (const node of adapterNodes(build.graph).filter(({ id }) =>
    junctionIds.has(id),
  )) {
    expect([node.width, node.height]).toEqual([6, 6]);
    expect(
      node.ports?.map(({ x, y, width, height }) => [x, y, width, height]),
    ).toEqual(node.ports?.map(() => [3, 3, 0, 0]));
  }

  const plcUid = ir.devices.find(
    ({ designation }) => designation === "PLC1",
  )!.uid;
  const plcPort = graph.nodes
    .flatMap((node) => node.ports)
    .find(
      ({ terminal }) =>
        terminal.deviceUid === plcUid && terminal.terminalKey === "X1.0",
    );
  expect(plcPort).toBeDefined();
  expect(
    graph.edges.find(
      ({ conductor, sourcePortId, targetPortId }) =>
        conductor?.kind === "wire" &&
        conductor.designation === "W-FLD-001" &&
        (sourcePortId === plcPort!.id || targetPortId === plcPort!.id),
    ),
  ).toBeDefined();

  if (testCase.name === "right-deep") {
    const rootTerminal = selected.paths.find(({ lane }) => lane === "signal")!
      .start.terminal;
    const junctionId = tuple(
      "junction",
      testCase.netId,
      rootTerminal.deviceUid,
      rootTerminal.terminalKey,
    );
    const combId = tuple("junction-comb", junctionId, "split", "1");
    const original = graph.nodes.find(({ id }) => id === junctionId)!;
    const comb = graph.nodes.find(({ id }) => id === combId)!;
    expect(comb.parentId).toBe(original.parentId);
    expect(
      graph.edges.find(
        ({ id }) =>
          id ===
          tuple("boundary-segment", junctionId, "comb-link", "split", "0"),
      ),
    ).toMatchObject({
      parentId: "root",
      sourcePortId: tuple("port", junctionId, "comb-link", "split", "0", "out"),
      targetPortId: tuple("port", junctionId, "comb-link", "split", "0", "in"),
      pathRank: 0,
      elementIds: [],
    });
  }
}

async function runTier2(
  ir: ElectricalIr,
  testCase: Tier2Case,
): Promise<{
  readonly selected: SelectedSubgraph;
  readonly graph: PresentationGraph;
  readonly adapterBytes: string;
  readonly rawSize: readonly [number | undefined, number | undefined];
  readonly error: InvalidLayoutError;
}> {
  const selected = selectB4Trace(ir, testCase.flow);
  const presented = buildPresentationGraph({ ir, selected });
  if (!presented.ok) throw new Error(JSON.stringify(presented.error));
  const build = buildElkAdapterGraph(presented.value.graph, selected);
  expect(
    build.optionAssignments.filter(
      ({ option }) => option === ELK_OPTIONS.priorityDirection,
    ),
  ).toEqual([
    {
      targetKind: "edge",
      targetId: tuple("wire", testCase.priorityWireUid),
      option: ELK_OPTIONS.priorityDirection,
      value: "2",
    },
  ]);
  const output = await new Elk().layout(structuredClone(build.graph));
  const normalized = normalizeAndValidateLayout(
    presented.value.graph,
    build.graph,
    output,
    SYMBOL_CATALOG,
  );
  expect(normalized.ok).toBe(false);
  if (normalized.ok) throw new Error("Expected the frozen Tier 2 R004.");
  return {
    selected,
    graph: presented.value.graph,
    adapterBytes: serializeElkAdapterForTest(build),
    rawSize: [output.width, output.height],
    error: normalized.error,
  };
}

describe("Amendment B4 v20 Tier 2 deterministic failures", () => {
  const fixtureIr: Partial<Record<Tier2Case["name"], ElectricalIr>> = {};
  const fixtureDiagnostics: Partial<
    Record<Tier2Case["name"], readonly unknown[]>
  > = {};
  const temporaryRoots: string[] = [];

  beforeAll(async () => {
    for (const fixtureName of ["right-deep", "bridge"] as const) {
      const root = await mkdtemp(
        join(tmpdir(), "thermite-schematics-b4-tier2-"),
      );
      temporaryRoots.push(root);
      const compiled = await materializeAndCompileB4Tier2Fixture(
        root,
        fixtureName,
      );
      fixtureIr[fixtureName] = compiled.ir;
      fixtureDiagnostics[fixtureName] = compiled.diagnostics;
    }
  });

  afterAll(async () => {
    await Promise.all(
      temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  for (const testCase of CASES) {
    it(`${testCase.name} ${testCase.flow} locks live ELK, R004, and product bytes`, async () => {
      expect(fixtureDiagnostics[testCase.name]).toEqual([]);
      const ir = fixtureIr[testCase.name]!;
      expect(evaluateRules(ir)).toEqual([]);

      const first = await runTier2(ir, testCase);
      const second = await runTier2(ir, testCase);
      const error = expectedError(testCase);

      expect(first.rawSize).toEqual(testCase.rawSize);
      expect(first.error).toEqual(error);
      assertTier2Structure(testCase, ir, first.selected, first.graph);
      expect(Object.keys(first.error)).toEqual([
        "code",
        "message",
        "family",
        "netId",
        "root",
      ]);
      expect(JSON.stringify(first.selected)).toBe(
        JSON.stringify(second.selected),
      );
      expect(JSON.stringify(first.graph)).toBe(JSON.stringify(second.graph));
      expect(first.adapterBytes).toBe(second.adapterBytes);
      expect(second.rawSize).toEqual(first.rawSize);
      expect(second.error).toEqual(first.error);

      const human = `R004 ${error.message}\n`;
      const json = `${JSON.stringify({ diagnostics: [], error }, undefined, 2)}\n`;
      expect(Buffer.byteLength(human, "utf8")).toBe(testCase.humanBytes);
      expect(Buffer.byteLength(json, "utf8")).toBe(testCase.jsonBytes);
      const flowName = testCase.flow === "left-to-right" ? "right" : "down";
      const golden = readFileSync(
        new URL(
          `./goldens/tier2/${testCase.name}-${flowName}.r004.json`,
          import.meta.url,
        ),
        "utf8",
      );
      expect(golden).toBe(json);
    });
  }
});
