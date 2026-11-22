import { beforeAll, expect, it } from "vitest";
import { DOMParser } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import { terminalPassThroughFixture } from "../fixtures/presentation-cases.js";
import { layoutPresentationGraph } from "../src/layout/elk-adapter.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import { svgSemanticId, decodeSvgSemanticId } from "../src/svg/escape.js";
import { duplicateTerminalCaptionIds } from "../src/svg/terminal-captions.js";
import { redundantNetLabelIds } from "../src/svg/net-labels.js";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { prepareSchematicTitleContext } from "../src/title-block.js";
import { compileCoreFixture } from "./fixtures.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});

async function drawing(flow: "left-to-right" | "top-to-bottom") {
  // Synthetic two-wire pass-through: PS1.+ -> TB1.1 -> TB1.2. The
  // intermediate physical terminal has two distinct conductor landing ports.
  const f = terminalPassThroughFixture(ir);
  const b = buildPresentationGraph({
    ir: f.ir,
    selected: { ...f.selected, view: { ...f.selected.view, flow } },
  });
  if (!b.ok) throw Error(JSON.stringify(b));
  const l = await layoutPresentationGraph(b.value.graph);
  if (!l.ok) throw Error(JSON.stringify(l));
  return { graph: b.value.graph, layout: l.value };
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "prints one owned caption while preserving both landings and all layout data in %s",
  async (flow) => {
    const { graph, layout } = await drawing(flow);
    const node = graph.nodes.find(
      (n) =>
        n.kind === "symbol" &&
        n.symbolId === "ais:terminal" &&
        n.ports[0]?.terminal.terminalKey === "1",
    )!;
    const captions = node.labels.filter((l) => l.role === "terminal");
    expect(captions).toHaveLength(2);
    expect(node.ports).toHaveLength(2);
    expect(
      node.ports.map(
        (p) =>
          graph.edges.filter(
            (e) => e.sourcePortId === p.id || e.targetPortId === p.id,
          ).length,
      ),
    ).toEqual([1, 1]);
    const before = JSON.stringify({ graph, layout });
    const title = prepareSchematicTitleContext(
      "Synthetic pass-through",
      graph.view,
    );
    if (!title.ok) throw Error(JSON.stringify(title));
    const result = emitSchematicSvg(graph, layout, title.value);
    if (!result.ok) throw Error(JSON.stringify(result));
    const document = new DOMParser().parseFromString(
      result.value,
      "image/svg+xml",
    );
    const printed = captions.filter(
      (c) =>
        document.querySelector(
          `text[clip-path="url(#${svgSemanticId("clip", [c.id])})"]`,
        )?.textContent === "1",
    );
    expect(printed).toHaveLength(1);
    for (const p of node.ports)
      expect(
        document.getElementById(
          svgSemanticId("terminal", [
            p.terminal.deviceUid,
            p.terminal.terminalKey,
            p.symbolPortId,
          ]),
        ),
      ).not.toBeNull();
    expect(document.querySelectorAll("path.wire-path")).toHaveLength(2);
    expect(JSON.stringify({ graph, layout })).toBe(before);
  },
);

it("uses the nearest existing body slot and keeps a separate appearance's caption", async () => {
  const { graph, layout } = await drawing("left-to-right");
  const node = graph.nodes.find(
    (n) =>
      n.kind === "symbol" &&
      n.labels.filter((l) => l.role === "terminal").length === 2,
  )!;
  const [first, second] = node.labels.filter((l) => l.role === "terminal");
  const positions = layout.labels.map((l) =>
    l.id === first!.id ? { ...l, x: -1000 } : l,
  );
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  expect(
    duplicateTerminalCaptionIds(graph, positions, nodes).has(first!.id),
  ).toBe(true);
  expect(
    duplicateTerminalCaptionIds(graph, positions, nodes).has(second!.id),
  ).toBe(false);
  const separate = {
    ...second!,
    id: "separate-caption",
    ownerId: "separate-port",
  };
  const port = node.ports.find((p) => p.id === second!.ownerId)!;
  const appearance = {
    ...node,
    id: "separate-appearance",
    labels: [separate],
    ports: [{ ...port, id: separate.ownerId }],
  };
  const separatePosition = {
    ...positions.find((l) => l.id === second!.id)!,
    id: separate.id,
    ownerId: separate.ownerId,
  };
  nodes.set(appearance.id, { ...nodes.get(node.id)!, id: appearance.id });
  expect(
    duplicateTerminalCaptionIds(
      { ...graph, nodes: [...graph.nodes, appearance] },
      [...positions, separatePosition],
      nodes,
    ).has(separate.id),
  ).toBe(false);
  expect(
    duplicateTerminalCaptionIds(
      { ...graph, nodes: [...graph.nodes].reverse() },
      [...positions].reverse(),
      nodes,
    ),
  ).toEqual(duplicateTerminalCaptionIds(graph, positions, nodes));
});

it("breaks equally near caption-slot ties by catalog port order", async () => {
  const { graph, layout } = await drawing("top-to-bottom");
  const node = graph.nodes.find(
    (n) =>
      n.kind === "symbol" &&
      n.labels.filter((l) => l.role === "terminal").length === 2,
  )!;
  const ports = [...node.ports].sort((a, b) => a.order - b.order);
  const captions = node.labels.filter((l) => l.role === "terminal");
  const positions = layout.labels.map((l) =>
    captions.some((c) => c.id === l.id) ? { ...l, x: 0, y: 0 } : l,
  );
  const hidden = duplicateTerminalCaptionIds(
    graph,
    positions,
    new Map(layout.nodes.map((n) => [n.id, n])),
  );
  expect(hidden.has(captions.find((c) => c.ownerId === ports[0]!.id)!.id)).toBe(
    false,
  );
  expect(hidden.has(captions.find((c) => c.ownerId === ports[1]!.id)!.id)).toBe(
    true,
  );
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "prints each phase name at its terminal without redundant net ink in %s",
  async (flow) => {
    const request = {
      format: "schematic-view-request/0.1" as const,
      family: "power" as const,
      root: { by: "designation" as const, value: "M1" },
      flow,
    };
    for (const renamed of [false, true]) {
      const source = structuredClone(ir);
      if (renamed) source.potentials.find((p) => p.name === "L1")!.name = "ZZ";
      const result = await renderSchematic(source, request);
      if (!result.ok) throw Error(JSON.stringify(result));
      const doc = new DOMParser().parseFromString(
        result.value.svg,
        "image/svg+xml",
      );
      const captions = [...doc.querySelectorAll("text.label-terminal")].map(
        (t) => t.textContent,
      );
      for (const phase of ["L1", "L2", "L3", "PE"])
        expect(captions).toContain(phase);
      const nets = [...doc.querySelectorAll("text.label-net")].map(
        (t) => t.textContent,
      );
      expect(nets).toEqual(renamed ? ["ZZ"] : []);
      expect(doc.querySelectorAll("path.wire-path").length).toBeGreaterThan(0);
      for (const wire of doc.querySelectorAll("path.wire-path")) {
        expect(
          JSON.parse(
            decodeSvgSemanticId(
              "port",
              wire.getAttribute("data-route-source-port-key")!,
            )[0]!,
          )[0],
        ).toBe("port");
        expect(
          JSON.parse(
            decodeSvgSemanticId(
              "edge",
              wire.getAttribute("data-edge-key")!,
            )[0]!,
          )[0],
        ).toBe("wire");
      }
    }
  },
);

it("retains a unique net name when only a hidden or remote appearance repeats it", async () => {
  const { graph } = await drawing("left-to-right");
  const edge = graph.edges[0]!;
  const node = graph.nodes.find((n) =>
    n.ports.some((p) => p.id === edge.sourcePortId),
  )!;
  if (node.kind === "junction") throw Error("Expected terminal body");
  const caption = node.labels.find(
    (l) => l.ownerId === edge.sourcePortId && l.role === "terminal",
  )!;
  const label = {
    ...caption,
    text: "LOCAL",
    id: "net-label",
    ownerId: edge.id,
    ownerKind: "edge" as const,
    role: "net" as const,
  };
  const changed = {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === node.id
        ? { ...node, labels: [{ ...caption, text: "LOCAL" }] }
        : n,
    ),
    edges: [{ ...edge, netLabel: label }],
  };
  const before = JSON.stringify(changed);
  expect(redundantNetLabelIds(changed, new Set())).toEqual(new Set([label.id]));
  expect(redundantNetLabelIds(changed, new Set([caption.id]))).toEqual(
    new Set(),
  );
  expect(
    redundantNetLabelIds(
      {
        ...changed,
        edges: [{ ...edge, netLabel: { ...label, text: "UNIQUE" } }],
      },
      new Set(),
    ),
  ).toEqual(new Set());
  const remote = {
    ...node,
    id: "remote-body",
    ports: node.ports.map((p) => ({ ...p, id: `remote-${p.id}` })),
  };
  expect(
    redundantNetLabelIds(
      {
        ...changed,
        nodes: graph.nodes.map((n) => (n.id === node.id ? remote : n)),
      },
      new Set(),
    ),
  ).toEqual(new Set());
  expect(JSON.stringify(changed)).toBe(before);
});

it.each([
  ["left-to-right", "tabloid", "standard"],
  ["top-to-bottom", "tabloid", "standard"],
  ["left-to-right", "letter", "compact"],
  ["top-to-bottom", "letter", "compact"],
] as const)(
  "retains L+/M at PS1 when only the far PLC landing repeats them: %s %s %s",
  async (flow, size, layout) => {
    const source = structuredClone(ir);
    source.potentials.find((p) => p.name === "+24VDC")!.name = "L+";
    source.potentials.find((p) => p.name === "0VDC")!.name = "M";
    const result = await renderSchematicPacket(source, {
      format: "schematic-packet-request/0.1",
      layout,
      page: { size, orientation: "landscape" },
      views: [
        {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "PS1" },
          intent: { kind: "loads" },
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
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "K1" },
          family: "control",
          flow,
        },
      ],
    });
    if (!result.ok) throw Error(JSON.stringify(result));
    const loads = result.value.sheets.filter(
      (s) =>
        s.view.format === "schematic-view/0.2" && s.view.intent === "loads",
    );
    expect(loads.length).toBeGreaterThan(0);
    for (const svg of loads.map((s) => s.svg)) {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const names = [...doc.querySelectorAll("text.label-net")].map(
        (t) => t.textContent,
      );
      expect(names).toEqual(expect.arrayContaining(["L+", "M"]));
      const terminals = [...doc.querySelectorAll("text.label-terminal")].map(
        (t) => t.textContent,
      );
      expect(terminals).toEqual(expect.arrayContaining(["+", "-", "L+", "M"]));
    }
  },
);
