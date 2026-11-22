import { beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import type { RenderedPacket } from "../src/packet/types.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { prepareCircuitView } from "../src/circuit.js";
import type { SchematicPacketRequest } from "../src/packet/types.js";
import type { CompiledProjectPresentation } from "@thermite/compiler";
import { required } from "./fixtures.js";
import * as packing from "../src/packet/circuit-part-packing.js";
import * as engines from "../src/layout/elk-runtime.js";
import { navigationGeometry } from "../src/packet/navigation-walk.js";
import type { SvgNode } from "../src/device-legend/svg-tree.js";
const examples = [
  {
    project: "examples/motor-starter",
    packet: "examples/alpha/motor-starter-documentation.packet.json",
    nativePages: 1,
    parts: 2,
    references: 12,
  },
  {
    project: "examples/circuit-pagination",
    packet: "examples/circuit-pagination/packet.json",
    nativePages: 4,
    parts: 8,
    references: 32,
  },
];
type PacketSheet = RenderedPacket["sheets"][number];
const inputs: {
  ir: ElectricalIr;
  presentation: CompiledProjectPresentation | undefined;
  request: SchematicPacketRequest;
}[] = [];
beforeAll(async () => {
  for (const spec of examples) {
    const c = await compileProject(spec.project);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const request: SchematicPacketRequest = JSON.parse(
      await readFile(spec.packet, "utf8"),
    );
    inputs.push({ ir: c.ir, presentation: c.presentation, request });
  }
});
it.each(examples)(
  "packs complete native parts on the same paper: $project",
  async (spec) => {
    const input = required(inputs[examples.indexOf(spec)]);
    const request = {
      ...input.request,
      views: input.request.views.map((v) =>
        v.format === "circuit-view-request/0.1" ||
        v.format === "schematic-view-request/0.2"
          ? { ...v, flow: "top-to-bottom" as const }
          : v,
      ),
    };
    const view = required(
      request.views.find((v) => v.format === "circuit-view-request/0.1"),
    );
    if (view.format !== "circuit-view-request/0.1")
      throw Error("Wrong fixture");
    const original = (await prepareCircuitView(input.ir, view)).groups[0];
    const before = JSON.stringify(input);
    const r = await renderSchematicPacket(
      input.ir,
      request,
      input.presentation,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const native = r.value.sheets.filter(
      (s) =>
        s.view.format === "documentation-view/0.1" && s.view.kind === "circuit",
    );
    expect(native).toHaveLength(spec.nativePages);
    const docs = native.map((s) => parseHTML(s.svg).document);
    expect(
      docs.flatMap((d) => [...d.querySelectorAll("[data-circuit-part]")]),
    ).toHaveLength(spec.parts);
    expect(
      docs
        .flatMap((d) => [...d.querySelectorAll("[data-circuit-conductor]")])
        .map((e) => e.getAttribute("data-circuit-conductor"))
        .sort(),
    ).toEqual(required(original).coverage.conductorIds);
    assertPeerReferences(native, spec.references);
    expect(
      docs
        .flatMap((d) => [...d.querySelectorAll("[data-wire-label]")])
        .map((e) => e.getAttribute("data-wire-label"))
        .sort(),
    ).toEqual(required(original).coverage.conductorIds);
    assertConductorIdentities(docs, r.value.coverage, input.ir);
    assertPrintedTextFloor(native);
    expect(
      docs
        .flatMap((d) => [...d.querySelectorAll("text")])
        .filter((e) => e.textContent?.startsWith("Whole wires;")),
    ).toHaveLength(spec.parts);
    for (const doc of docs)
      for (const text of doc.querySelectorAll(
        "[data-wire-label] text, [data-terminal-id] text, [data-function-id] text, [data-circuit-continuation] text",
      ))
        expect(Number(text.getAttribute("font-size"))).toBeGreaterThanOrEqual(
          2.5,
        );
    expect(JSON.stringify(input)).toBe(before);
  },
);

it("uses exactly the existing ELK requests when placing the complete native parts", async () => {
  const input = required(inputs[1]);
  const request = {
    ...input.request,
    views: input.request.views.map((v) =>
      v.format === "circuit-view-request/0.1"
        ? { ...v, flow: "top-to-bottom" as const }
        : v,
    ),
  };
  const create = engines.createElkEngine;
  const calls: string[][] = [[], []];
  let phase = 0;
  const engineSpy = vi
    .spyOn(engines, "createElkEngine")
    .mockImplementation(() => {
      const engine = create(),
        layout = engine.layout.bind(engine);
      engine.layout = (graph, options) => {
        required(calls[phase]).push(JSON.stringify([graph, options]));
        return layout(graph, options);
      };
      return engine;
    });
  const planner = packing.circuitPartRows;
  const legacy = vi
    .spyOn(packing, "circuitPartRows")
    .mockImplementation((groups, field) =>
      planner(groups, { ...field, flow: "left-to-right" }),
    );
  try {
    const before = await renderSchematicPacket(
      input.ir,
      request,
      input.presentation,
    );
    expect(before.ok).toBe(true);
    legacy.mockRestore();
    phase = 1;
    const after = await renderSchematicPacket(
      input.ir,
      request,
      input.presentation,
    );
    expect(after.ok).toBe(true);
    expect(required(calls[0]).length).toBeGreaterThan(0);
    expect(calls[1]).toEqual(calls[0]);
    if (!before.ok || !after.ok) throw Error("Fixture refused");
    expect(after.value.sheets).toHaveLength(before.value.sheets.length - 4);
  } finally {
    legacy.mockRestore();
    engineSpy.mockRestore();
  }
});

function assertPeerReferences(
  native: readonly PacketSheet[],
  expectedCount: number,
) {
  const appearances = native.flatMap((sheet) =>
    [
      ...parseHTML(sheet.svg).document.querySelectorAll("[data-circuit-part]"),
    ].map((part) => ({
      part: Number(part.getAttribute("data-circuit-part")),
      sheet: sheet.number,
      terminals: new Set(
        [...part.querySelectorAll("[data-terminal-id]")].map((t) =>
          required(t.getAttribute("data-terminal-id")),
        ),
      ),
    })),
  );
  const expected = appearances.flatMap((from) =>
    appearances
      .filter((to) => to.part !== from.part)
      .flatMap((to) =>
        [...from.terminals]
          .filter((id) => to.terminals.has(id))
          .map((id) => JSON.stringify([from.part, to.part, id, to.sheet])),
      ),
  );
  const references = native.flatMap((s) => s.circuitContinuations ?? []);
  expect(references).toHaveLength(expectedCount);
  expect(
    references
      .map((r) =>
        JSON.stringify([r.fromPart, r.toPart, r.terminalId, r.toSheet]),
      )
      .sort(),
  ).toEqual(expected.sort());
}

function assertConductorIdentities(
  docs: ReturnType<typeof parseHTML>["document"][],
  coverage: RenderedPacket["coverage"],
  ir: ElectricalIr,
) {
  for (const element of docs.flatMap((d) => [
    ...d.querySelectorAll("[data-circuit-conductor]"),
  ])) {
    const c = required(
      coverage.conductors.find(
        (c) => c.id === element.getAttribute("data-circuit-conductor"),
      ),
    );
    expect(
      JSON.parse(required(element.getAttribute("data-endpoints"))),
    ).toEqual(c.terminals);
    const net = required(
      ir.indexes.netIdByTerminal.find(
        (n) => JSON.stringify(n.key) === JSON.stringify(c.terminals[0]),
      ),
    );
    expect(element.getAttribute("data-net-id")).toBe(net.value);
  }
}

function assertPrintedTextFloor(native: readonly PacketSheet[]) {
  for (const sheet of native) {
    const all = navigationGeometry(sheet.svg),
      parents = new Map<SvgNode, SvgNode>();
    for (const g of all)
      for (const child of g.node.children) parents.set(child, g.node);
    for (const g of all.filter((g) => g.node.name === "text")) {
      let owned = false;
      for (let p: SvgNode | undefined = g.node; p; p = parents.get(p))
        owned ||= [
          "data-wire-label",
          "data-terminal-id",
          "data-circuit-continuation",
        ].some((key) => !!p?.attrs[key]);
      if (owned) {
        const m = g.matrix,
          scale = Math.min(
            Math.hypot(m[0] ?? 0, m[1] ?? 0),
            Math.hypot(m[2] ?? 0, m[3] ?? 0),
          );
        expect(
          Number(g.node.attrs["font-size"]) * scale,
        ).toBeGreaterThanOrEqual(2.5);
      }
    }
  }
}
