import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createQueryEngine, type QueryEngine } from "@thermite/query";
import { beforeAll, describe, expect, it } from "vitest";

import {
  selectCableConductors,
  selectSemanticSubgraph,
  selectTraceSubgraph,
} from "../src/selection.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { compileCoreFixture } from "./fixtures.js";

let ir: Awaited<ReturnType<typeof compileCoreFixture>>;

beforeAll(async () => {
  ir = await compileCoreFixture();
});

describe("query ownership and reuse", () => {
  it("constructs one engine after validation and reuses cached public net/component DTOs", () => {
    let constructions = 0;
    let resolveCalls = 0;
    let followCalls = 0;
    const netCalls = new Map<string, number>();
    const returnedElementIds = new Set<string>();
    let wrapped: QueryEngine | undefined;

    const normalized = normalizeSchematicView(
      ir,
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
      },
      {
        queryEngineFactory: (input) => {
          constructions++;
          const base = createQueryEngine(input);
          wrapped = {
            resolveObject(selector) {
              resolveCalls++;
              return base.resolveObject(selector);
            },
            resolveTerminal: (selector) => base.resolveTerminal(selector),
            inspect: (selector) => base.inspect(selector),
            neighbors: (selector) => base.neighbors(selector),
            trace: (selector) => base.trace(selector),
            net(selector) {
              const id =
                selector.by === "id"
                  ? JSON.stringify([
                      selector.value.deviceUid,
                      selector.value.terminalKey,
                    ])
                  : JSON.stringify(selector);
              netCalls.set(id, (netCalls.get(id) ?? 0) + 1);
              const result = base.net(selector);
              if (result.ok) {
                for (const edge of result.value.net.elements) {
                  const element = edge.element;
                  returnedElementIds.add(
                    element.kind === "cable_conductor"
                      ? JSON.stringify([
                          element.kind,
                          element.cableUid,
                          element.conductorId,
                        ])
                      : JSON.stringify([element.kind, element.uid]),
                  );
                }
              }
              return result;
            },
            cable: (selector) => base.cable(selector),
            followConductive(starts) {
              followCalls++;
              return base.followConductive(starts);
            },
          };
          return wrapped;
        },
      },
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.engine).toBe(wrapped);

    const graph = selectSemanticSubgraph({
      ir,
      view: normalized.value.view,
      engine: normalized.value.engine,
      mappings: normalized.value.mappings,
    });
    expect(graph.ok).toBe(true);
    expect(constructions).toBe(1);
    expect(resolveCalls).toBe(1);
    expect(followCalls).toBe(2);
    expect([...netCalls.values()].every((count) => count === 1)).toBe(true);
    if (graph.ok) {
      for (const id of graph.value.conductiveElementIds) {
        const key =
          id.kind === "cable_conductor"
            ? JSON.stringify([id.kind, id.cableUid, id.conductorId])
            : JSON.stringify([id.kind, id.uid]);
        expect(returnedElementIds.has(key)).toBe(true);
      }
    }
  });

  it("reuses one injected engine for conductor-only trace arms", () => {
    let constructions = 0;
    let resolveCalls = 0;
    let followCalls = 0;
    let traceCalls = 0;
    let neighborCalls = 0;
    const netCalls = new Map<string, number>();
    const base = createQueryEngine(ir);
    constructions++;
    const engine: QueryEngine = {
      resolveObject(selector) {
        resolveCalls++;
        return base.resolveObject(selector);
      },
      resolveTerminal: (selector) => base.resolveTerminal(selector),
      inspect: (selector) => base.inspect(selector),
      neighbors(selector) {
        neighborCalls++;
        return base.neighbors(selector);
      },
      trace(selector) {
        traceCalls++;
        return base.trace(selector);
      },
      net(selector) {
        const key = JSON.stringify(selector);
        netCalls.set(key, (netCalls.get(key) ?? 0) + 1);
        return base.net(selector);
      },
      cable: (selector) => base.cable(selector),
      followConductive(starts) {
        followCalls++;
        return base.followConductive(starts);
      },
    };
    const root = ir.devices.find(({ designation }) => designation === "LS1")!;
    const target = ir.devices.find(
      ({ designation }) => designation === "PLC1",
    )!;
    const result = selectTraceSubgraph({
      ir,
      view: {
        format: "schematic-view/0.1",
        family: "control",
        root: { deviceUid: root.uid, designation: root.designation },
        flow: "left-to-right",
      },
      target: { deviceUid: target.uid, designation: target.designation },
      includePower: true,
      engine,
    });
    expect(result.ok).toBe(true);
    expect(constructions).toBe(1);
    expect(resolveCalls).toBe(0);
    expect(followCalls).toBe(2);
    expect(traceCalls).toBe(0);
    expect(neighborCalls).toBe(0);
    expect([...netCalls.values()].every((count) => count === 1)).toBe(true);
  });

  it("consumes one cable DTO without net or traversal reimplementation", () => {
    let resolveCalls = 0;
    let terminalCalls = 0;
    let inspectCalls = 0;
    let neighborCalls = 0;
    let traceCalls = 0;
    let netCalls = 0;
    let cableCalls = 0;
    let followCalls = 0;
    const base = createQueryEngine(ir);
    const engine: QueryEngine = {
      resolveObject(selector) {
        resolveCalls++;
        return base.resolveObject(selector);
      },
      resolveTerminal(selector) {
        terminalCalls++;
        return base.resolveTerminal(selector);
      },
      inspect(selector) {
        inspectCalls++;
        return base.inspect(selector);
      },
      neighbors(selector) {
        neighborCalls++;
        return base.neighbors(selector);
      },
      trace(selector) {
        traceCalls++;
        return base.trace(selector);
      },
      net(selector) {
        netCalls++;
        return base.net(selector);
      },
      cable(selector) {
        cableCalls++;
        return base.cable(selector);
      },
      followConductive(starts) {
        followCalls++;
        return base.followConductive(starts);
      },
    };
    const result = selectCableConductors({
      ir,
      root: { by: "designation", value: "CBL1" },
      engine,
    });
    expect(result.ok).toBe(true);
    expect(cableCalls).toBe(1);
    expect({
      resolveCalls,
      terminalCalls,
      inspectCalls,
      neighborCalls,
      traceCalls,
      netCalls,
      followCalls,
    }).toEqual({
      resolveCalls: 0,
      terminalCalls: 0,
      inspectCalls: 0,
      neighborCalls: 0,
      traceCalls: 0,
      netCalls: 0,
      followCalls: 0,
    });
  });

  it("constructs and calls no query engine for any malformed stage", () => {
    let constructions = 0;
    for (const request of [
      null,
      {},
      { format: "bad" },
      { format: "schematic-view-request/0.1", root: undefined },
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "bad",
      },
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
        flow: "bad",
      },
    ]) {
      const result = normalizeSchematicView(ir, request, {
        queryEngineFactory: (input) => {
          constructions++;
          return createQueryEngine(input);
        },
      });
      expect(result.ok).toBe(false);
    }
    expect(constructions).toBe(0);
  });

  it("keeps selection on compiler/query public boundaries", () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(testDirectory, "../src/selection.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@thermite\/query\//u);
    expect(source).not.toMatch(/packages\/query\/src/u);
    expect(source).not.toMatch(/loader|loadProject|glob/u);
    expect(source).not.toMatch(/deriveProjectNets|union.?find|UnionFind/u);
    expect(source).not.toMatch(/\.nets\b|indexes\.netIdByTerminal/u);
    expect(source).toContain("compareConductiveElementId");
    expect(source).toContain("engine.net");
    expect(source).toContain("engine.cable");
    expect(source).toContain("engine.followConductive");
  });
});
