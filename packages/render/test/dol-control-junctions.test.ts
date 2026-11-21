import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { normalizeSchematicView } from "../src/view-spec.js";
import { selectSemanticSubgraph } from "../src/selection.js";
import {
  buildPresentationGraph,
  validatePresentationGraph,
} from "../src/presentation.js";
import {
  createSchematicRendererWithDependencies,
  prepareSchematicDrawing,
  renderSchematic,
} from "../src/renderer.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  dolFixture,
  actuation,
  flows,
  type DolCase,
} from "./dol-control-junctions-fixture.js";

const cases = ["p4", "p5", "saved", "rm3"] as const;

it.each(["K1", "R1"].flatMap((root) => flows.map((flow) => ({ root, flow }))))(
  "matches the saved $root control golden in $flow",
  async ({ root, flow }) => {
    const f = await dolFixture("saved");
    try {
      const result = await renderSchematic(f.ir, actuation(root, flow));
      if (!result.ok) throw Error(JSON.stringify(result.error));
      expect(result.value.svg).toBe(
        await readFile(
          new URL(
            `./goldens/dol-control/${root.toLowerCase()}-${flow}.svg`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    } finally {
      await f.dispose();
    }
  },
);
function expectedWires(name: DolCase, root: string): string[] {
  return [
    "W30",
    ...(name === "saved" || name === "rm3" ? ["W31"] : []),
    "W32",
    "W33",
    "W34",
    "W35",
    "W36",
    "W37",
    ...(name === "p5"
      ? root === "R1"
        ? ["W38"]
        : []
      : root === "K1"
        ? ["W38"]
        : []),
    root === "K1" ? "W41" : "W40",
  ].sort();
}
function expectedFunctions(name: DolCase, root: string): string[] {
  return [
    "PS1.dc_output",
    ...(name === "saved" || name === "rm3" ? ["F1.pole1"] : []),
    "S0.contact11",
    "S1.contact11",
    "OL1.aux95",
    "S2.contact13",
    "R1.contact14",
    `${root}.coil`,
  ].sort();
}

it.each(
  cases.flatMap((name) =>
    ["K1", "R1"].flatMap((root) => flows.map((flow) => ({ name, root, flow }))),
  ),
)(
  "draws $name $root with exact selected identities on default tabloid in $flow",
  async ({ name, root, flow }) => {
    const fixture = await dolFixture(name);
    try {
      const ir = fixture.ir,
        before = JSON.stringify(ir),
        req = actuation(root, flow);
      const n = normalizeSchematicView(ir, req);
      if (!n.ok) throw Error(JSON.stringify(n));
      const s = selectSemanticSubgraph({ ir, ...n.value });
      if (!s.ok) throw Error(JSON.stringify(s));
      const names = new Map(ir.devices.map((d) => [d.uid, d.designation]));
      expect(
        s.value.conductiveElementIds
          .map((id) => ir.wires.find((w) => w.uid === id.uid)!.designation)
          .sort(),
      ).toEqual(expectedWires(name, root));
      expect(
        s.value.functionIds
          .map((f) => `${names.get(f.deviceUid)}.${f.functionKey}`)
          .sort(),
      ).toEqual(expectedFunctions(name, root));
      const built = buildPresentationGraph({ ir, selected: s.value });
      if (!built.ok) throw Error(JSON.stringify(built));
      const graph = built.value.graph;
      const netByTerminal = new Map(
        ir.indexes.netIdByTerminal.map(({ key, value }) => [
          JSON.stringify(key),
          value,
        ]),
      );
      for (const edge of graph.edges) {
        const ports = [edge.sourcePortId, edge.targetPortId].map((id) =>
          graph.nodes.flatMap((n) => n.ports).find((p) => p.id === id)!,
        );
        expect(ports.every((p) => p.netId === edge.netId)).toBe(true);
        expect(
          ports.every(
            (p) => netByTerminal.get(JSON.stringify(p.terminal)) === edge.netId,
          ),
        ).toBe(true);
        if (edge.kind === "conductor") {
          const wire = ir.wires.find((w) => w.uid === edge.elementIds[0]!.uid)!;
          expect(ports.map((p) => JSON.stringify(p.terminal)).sort()).toEqual(
            wire.endpoints.map((e) => JSON.stringify(e.terminal)).sort(),
          );
        } else expect(edge.endpoints[0]).toEqual(edge.endpoints[1]);
      }
      for (const node of graph.nodes.filter((n) => n.kind === "junction")) {
        expect(new Set(node.ports.map((p) => p.side)).size).toBe(
          node.ports.length,
        );
        expect(
          node.ports.every(
            (p) =>
              graph.edges.filter(
                (e) => e.sourcePortId === p.id || e.targetPortId === p.id,
              ).length === 1,
          ),
        ).toBe(true);
      }
      if (name !== "rm3")
        for (const wire of ir.wires.filter((w) =>
          ["W34", "W35", "W36", "W37"].includes(w.designation),
        )) {
          const expected = ["W34", "W35"].includes(wire.designation)
            ? "net:sha256:5f735b4a219185b3b4f0ee45f4d391f7671404b731f6d0955a316a43accd0fb8"
            : "net:sha256:8601e5d40a2072cea4725f9772ce88ba51ea3eafb57a05c8ae4f0191dd2354b2";
          expect(
            netByTerminal.get(JSON.stringify(wire.endpoints[0]!.terminal)),
          ).toBe(expected);
        }
      const rendered = await renderSchematic(ir, req);
      expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
      const packet = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        views: [req],
      });
      expect(packet.ok, JSON.stringify(packet)).toBe(true);
      if (packet.ok) expect(packet.value.page.size).toBe("tabloid");
      expect(JSON.stringify(ir)).toBe(before);
    } finally {
      await fixture.dispose();
    }
  },
);

function geometry(
  prepared: Awaited<ReturnType<typeof prepareSchematicDrawing>>,
) {
  if (!prepared.ok) throw Error(JSON.stringify(prepared));
  const { graph, layout } = prepared.value;
  const name = (id: string) => {
    const node = graph.nodes.find((n) => n.id === id);
    if (node?.kind === "junction")
      return `junction:${node.terminal.terminalKey}:${graph.deviceGroups.find((g) => g.deviceUid === node.terminal.deviceUid)?.designation ?? node.terminal.deviceUid}`;
    if (node)
      return `${node.designation}:${node.kind}:${node.functionIds.map((f) => f.functionKey).join(",")}`;
    return (
      graph.deviceGroups.find((g) => g.id === id)?.designation ??
      graph.locationGroups.find((g) => g.id === id)?.label.text
    );
  };
  return {
    nodes: layout.nodes
      .map((n) => [name(n.id), n.x, n.y, n.width, n.height])
      .sort(),
    edges: layout.edges
      .map((e) => {
        const source = graph.edges.find((x) => x.id === e.id)!;
        const label =
          source.conductor?.kind === "wire"
            ? source.conductor.designation
            : `attachment:${source.endpoints[0].terminalKey}`;
        return [label, e.points];
      })
      .sort(),
  };
}

it.each(
  cases.flatMap((name) =>
    ["K1", "R1"].flatMap((root) => flows.map((flow) => ({ name, root, flow }))),
  ),
)(
  "keeps $name $root geometry after reordering objects and replacing UIDs in $flow",
  async ({ name, root, flow }) => {
    const base = await dolFixture(name),
      reordered = await dolFixture(name, true);
    try {
      const before = JSON.stringify(reordered.ir);
      const req = actuation(root, flow);
      expect(
        geometry(await prepareSchematicDrawing(reordered.ir, req)),
      ).toEqual(geometry(await prepareSchematicDrawing(base.ir, req)));
      const packet = await renderSchematicPacket(reordered.ir, {
        format: "schematic-packet-request/0.1",
        views: [req],
      });
      expect(packet.ok, JSON.stringify(packet)).toBe(true);
      expect(JSON.stringify(reordered.ir)).toBe(before);
    } finally {
      await base.dispose();
      await reordered.dispose();
    }
  },
);

it.each(flows)(
  "rejects same-port and erased-edge mutations in %s",
  async (flow) => {
    const f = await dolFixture("saved");
    try {
      const n = normalizeSchematicView(f.ir, actuation("K1", flow));
      if (!n.ok) throw Error(JSON.stringify(n));
      const s = selectSemanticSubgraph({ ir: f.ir, ...n.value });
      if (!s.ok) throw Error(JSON.stringify(s));
      const built = buildPresentationGraph({ ir: f.ir, selected: s.value });
      if (!built.ok) throw Error(JSON.stringify(built));
      const samePort = structuredClone(built.value.graph);
      const first = samePort.edges.find(
          (e) => e.conductor?.designation === "W34",
        )!,
        second = samePort.edges.find(
          (e) => e.conductor?.designation === "W35",
        )!;
      (second as { sourcePortId: string }).sourcePortId = first.sourcePortId;
      expect(() =>
        validatePresentationGraph(f.ir, s.value, samePort, n.value.mappings),
      ).toThrow(/port|incidence/);
      const erased = {
        ...built.value.graph,
        edges: built.value.graph.edges.filter(
          (e) => e.conductor?.designation !== "W34",
        ),
      };
      expect(() =>
        validatePresentationGraph(f.ir, s.value, erased, n.value.mappings),
      ).toThrow(/port|incidence|conductor/);
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "discloses the shorter fuse branch limitation and draws equal branches in %s",
  async (flow) => {
    for (const name of ["fuse-short", "fuse-equal", "rail-contacts"] as const) {
      const f = await dolFixture(name);
      try {
        const r = await renderSchematic(f.ir, actuation("K1", flow));
        expect(r.ok, JSON.stringify(r)).toBe(true);
        if (!r.ok) throw Error(JSON.stringify(r));
        expect(
          r.value.summary.conductiveElementIds
            .map((id) => f.ir.wires.find((w) => w.uid === id.uid)!.designation)
            .sort(),
        ).toEqual(
          name === "fuse-short"
            ? ["W1", "W2", "W6"]
            : ["W1", "W2", "W3", "W4", "W5"],
        );
        if (name === "fuse-short")
          expect(r.value.svg).toContain("data-off-view-terminal");
      } finally {
        await f.dispose();
      }
    }
  },
);

it.each(flows)(
  "names a source-rail endpoint in R004 messages in %s",
  async (flow) => {
    const f = await dolFixture("rail-contacts");
    try {
      const engine = createElkEngine(),
        layout = engine.layout.bind(engine);
      const wire = f.ir.wires.find((w) => w.designation === "W1")!;
      engine.layout = async (...args) => {
        const output = await layout(...args);
        const edge = output.edges!.find(
          (e) => e.id === JSON.stringify(["wire", wire.uid]),
        )!;
        edge.sources = [...edge.targets];
        return output;
      };
      const result = await createSchematicRendererWithDependencies({
        layoutEngine: engine,
      }).render(f.ir, actuation("K1", flow));
      expect(result).toMatchObject({ ok: false, error: { code: "R004" } });
      if (result.ok) throw Error("Expected attachment refusal");
      expect(result.error.message).toContain("PS1.+");
      expect(result.error.message).not.toContain(
        f.ir.devices.find((d) => d.designation === "PS1")!.uid,
      );
    } finally {
      await f.dispose();
    }
  },
);
