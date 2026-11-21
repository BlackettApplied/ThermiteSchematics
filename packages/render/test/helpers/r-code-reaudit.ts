import type { ElectricalIr } from "@thermite/compiler";
import type { RenderFailure } from "../../src/types.js";
import { expect, vi } from "vitest";
import * as pagination from "../../src/packet/legend-pagination.js";
import * as budget from "../../src/packet/rooted-bound.js";
import * as runtime from "../../src/layout/elk-runtime.js";
import * as loops from "../../src/layout/direct-loop-layout.js";
import { fixture } from "../../../cli/test/analog-output.cases.js";

export function nativeDevice(ir: ElectricalIr, designation: string) {
  const found = ir.devices.find((d) => d.designation === designation);
  if (!found) throw Error(`Missing native device ${designation}`);
  return found;
}

const description =
  "Equipment identification and maintenance access for the process cell. Verify the labelled terminal against the installation drawing before planned maintenance.";
export function legendIr(core: ElectricalIr) {
  const ir = structuredClone(core);
  for (const d of ir.devices)
    d.description = Array(5).fill(description).join(" ");
  return ir;
}
export function legendRequest(ir: ElectricalIr) {
  return {
    format: "schematic-packet-request/0.1",
    layout: "compact",
    page: { size: "letter", orientation: "portrait" },
    views: [
      {
        format: "schematic-view-request/0.1",
        root: { by: "uid", value: nativeDevice(ir, "M1").uid },
        family: "power",
        flow: "top-to-bottom",
      },
      {
        format: "schematic-view-request/0.1",
        root: { by: "uid", value: nativeDevice(ir, "K1").uid },
        family: "control",
        flow: "top-to-bottom",
      },
    ],
  } as const;
}

/** Only pagination/cost geometry is injected. Every rejected draft retains its
 * real native view, legend source and identities; no candidate is issued. */
export function rejectLegendCandidate(mode: "page-cost" | "sheet-limit") {
  const calls = vi.spyOn(budget, "rootedPageCostFailure");
  vi.spyOn(pagination, "legendPagination").mockImplementation(
    function* (_ir, original) {
      const source = original[0],
        count = mode === "page-cost" ? 9 : 101;
      const context =
        source?.rootedLegendSource?.prepared.view.root.designation;
      if (!source || !context) throw Error("Missing native legend source");
      const candidate = Array.from({ length: count }, () => {
        const draft = { ...source };
        delete draft.rootedFit;
        return draft;
      });
      const first = candidate[0];
      if (!first) throw Error("Missing candidate");
      first.rootedFit = {
        basePages: mode === "page-cost" ? 1 : 51,
        actualPages: count,
        context,
      };
      yield candidate;
    },
  );
  return calls;
}

export function assertNativeLegend(ir: ElectricalIr, error: RenderFailure) {
  const entries = "details" in error ? error.details?.legendEntries : undefined;
  expect(Array.isArray(entries)).toBe(true);
  if (!Array.isArray(entries)) throw Error("Missing legend entries");
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries)
    assertNativeEntry(
      ir,
      entry,
      JSON.stringify({
        message: error.message,
        details: "details" in error ? error.details : undefined,
      }),
    );
}
function assertNativeEntry(ir: ElectricalIr, entry: unknown, message: string) {
  if (
    !entry ||
    typeof entry !== "object" ||
    !("deviceUid" in entry) ||
    !("designation" in entry)
  )
    throw Error("Malformed native legend entry");
  const native = ir.devices.find((d) => d.uid === entry.deviceUid);
  expect(native).toBeDefined();
  if (!native) throw Error("Unknown native legend owner");
  expect(entry.designation).toBe(native.designation);
  expect(message).toContain(native.designation);
}

export async function loopFixture() {
  const f = await fixture();
  const labels = ["W1XXXXXXX", "W2XXXXXX", "W3XXXXX", "W4XXX", "W5XXXXX", "W6"];
  let index = 0;
  for (const object of f.source.objects)
    if (object.kind === "wire") object.designation = labels[index++];
  const ir = await f.compile(),
    view = { ...f.packet.views[0], flow: "top-to-bottom" };
  view.from = { ...view.from, device: nativeDevice(ir, "AQ1").uid };
  view.to = { ...view.to, device: nativeDevice(ir, "V1").uid };
  view.notes = Array(6).fill(
    "Equipment identification and maintenance access. Verify the labelled terminal before planned maintenance. ".repeat(
      2,
    ),
  );
  return {
    ir,
    request: {
      ...f.packet,
      page: { size: "letter", orientation: "landscape" },
      views: [view],
    },
  };
}

export function captureLoopFallback(fault: boolean) {
  const outputs: Awaited<
    ReturnType<ReturnType<typeof runtime.createElkEngine>["layout"]>
  >[] = [];
  const factory = runtime.createElkEngine,
    layout = loops.layoutDirectLoop;
  let chosen: (typeof outputs)[number] | undefined,
    reads = 0;
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory(),
      native = engine.layout.bind(engine);
    engine.layout = async (...args) => {
      const graph = await native(...args);
      if (fault && outputs.length === 1) {
        const label = graph.edges?.[1]?.labels?.[0];
        if (!label) throw Error("Missing native fallback label");
        Object.defineProperty(label, "x", {
          get() {
            reads++;
            return -1;
          },
        });
      }
      outputs.push(graph);
      return graph;
    };
    return engine;
  });
  vi.spyOn(loops, "layoutDirectLoop").mockImplementation(async (...args) => {
    chosen = await layout(...args);
    return chosen;
  });
  return () => ({ outputs, chosen, reads });
}
