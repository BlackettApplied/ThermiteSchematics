import type { ElectricalIr } from "@thermite/compiler";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { beforeAll, describe, expect, it } from "vitest";

import { createSchematicRenderer, renderSchematic } from "../src/index.js";
import { createSchematicRendererWithDependencies } from "../src/renderer.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import { CORE_DEVICE_TYPE_SYMBOL_MAPPINGS } from "../src/symbols/mappings.js";
import type { RenderedSchematic, SchematicViewRequest } from "../src/types.js";
import { compileCoreFixture, pnpTraceFixture } from "./fixtures.js";

const ElkConstructor = BundledElk as unknown as { new (): ELK };

let coreIr: ElectricalIr;
let pnpIr: ElectricalIr;

const requests = (["left-to-right", "top-to-bottom"] as const).flatMap(
  (flow) =>
    [
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
        flow,
      },
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "M1" },
        family: "power",
        flow,
      },
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: true,
        },
        flow,
      },
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "CBL1" },
        intent: { kind: "conductors" },
        flow,
      },
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
        flow,
      },
    ] as const satisfies readonly SchematicViewRequest[],
);

beforeAll(async () => {
  coreIr = await compileCoreFixture();
  pnpIr = pnpTraceFixture(coreIr);
});

function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const member of Object.values(value)) deepFreeze(member, seen);
  return Object.freeze(value);
}

async function valueFor(
  renderer: ReturnType<typeof createSchematicRenderer>,
  ir: Readonly<ElectricalIr>,
  request: Readonly<SchematicViewRequest>,
): Promise<RenderedSchematic> {
  const result = await renderer.render(ir, request);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("renderer purity and determinism", () => {
  it("does not mutate deep-frozen IR, requests, catalog, or mappings", async () => {
    const states = [
      deepFreeze(structuredClone(coreIr)),
      deepFreeze(structuredClone(pnpIr)),
    ];
    const frozenRequests = requests.map((request) =>
      deepFreeze(structuredClone(request)),
    );
    const beforeStates = states.map((ir) => JSON.stringify(ir));
    const beforeRequests = JSON.stringify(frozenRequests);
    const beforeCatalog = JSON.stringify(SYMBOL_CATALOG);
    const beforeMappings = JSON.stringify(CORE_DEVICE_TYPE_SYMBOL_MAPPINGS);

    for (const ir of states) {
      for (const request of frozenRequests) {
        const result = await renderSchematic(ir, request);
        expect(result.ok).toBe(true);
      }
    }

    expect(states.map((ir) => JSON.stringify(ir))).toEqual(beforeStates);
    expect(JSON.stringify(frozenRequests)).toBe(beforeRequests);
    expect(JSON.stringify(SYMBOL_CATALOG)).toBe(beforeCatalog);
    expect(JSON.stringify(CORE_DEVICE_TYPE_SYMBOL_MAPPINGS)).toBe(
      beforeMappings,
    );
  });

  it("returns detached frozen summaries that cannot affect future renders", async () => {
    const first = await valueFor(
      createSchematicRenderer(),
      coreIr,
      requests[0],
    );
    const snapshot = structuredClone(first);
    expect(() =>
      (first.summary.deviceUids as string[]).push("test-mutation"),
    ).toThrow(TypeError);
    expect(() => {
      (
        first.summary.terminalIds[0] as {
          deviceUid: string;
          terminalKey: string;
        }
      ).terminalKey = "test-mutation";
    }).toThrow(TypeError);

    const later = await valueFor(
      createSchematicRenderer(),
      coreIr,
      requests[0],
    );
    expect(first).toEqual(snapshot);
    expect(later).toEqual(snapshot);
    expect(later.summary).not.toBe(first.summary);
    expect(later.summary.terminalIds).not.toBe(first.summary.terminalIds);
    expect(later.summary.terminalIds[0]).not.toBe(first.summary.terminalIds[0]);
  });

  it("gives a deliberately mutating ELK engine only a disposable graph", async () => {
    const delegate = new ElkConstructor();
    let mutations = 0;
    const engine = {
      knownLayoutOptions: () => delegate.knownLayoutOptions(),
      async layout(graph: ElkNode) {
        graph.children?.reverse();
        graph.children?.reverse();
        mutations++;
        return delegate.layout(graph);
      },
    } as unknown as ELK;
    const irBefore = JSON.stringify(coreIr);
    const requestBefore = JSON.stringify(requests[0]);
    const injected = await valueFor(
      createSchematicRendererWithDependencies({ layoutEngine: engine }),
      coreIr,
      requests[0],
    );
    const baseline = await valueFor(
      createSchematicRenderer(),
      coreIr,
      requests[0],
    );

    expect(mutations).toBe(1);
    expect(injected).toEqual(baseline);
    expect(JSON.stringify(coreIr)).toBe(irBefore);
    expect(JSON.stringify(requests[0])).toBe(requestBefore);
  });

  it("is identical sequentially, concurrently, and in reversed call order", async () => {
    const renderer = createSchematicRenderer();
    const sequential: RenderedSchematic[] = [];
    for (const request of requests) {
      sequential.push(await valueFor(renderer, coreIr, request));
    }

    const reversedRequests = [...requests].reverse();
    const reversed = await Promise.all(
      reversedRequests.map((request) => valueFor(renderer, coreIr, request)),
    );
    expect(reversed.reverse()).toEqual(sequential);
  });
});
