import { beforeAll, afterAll, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { selectSemanticSubgraph } from "../src/selection.js";
import { buildPresentationGraph } from "../src/presentation.js";
import {
  contextReferenceLeader,
  terminalContextAttachment,
} from "../src/terminal-context-reference.js";
import { buildElkAdapterGraph } from "../src/layout/elk-adapter.js";
import { contextForkOrderAlternatives } from "../src/layout/context-fork-order.js";
import { contextJunctionInk } from "../src/layout/context-reference-ink.js";
import { normalizeAndValidateLayout } from "../src/layout/validate-output.js";
import { validateContextReferenceClearance } from "../src/layout/context-reference-validation.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import type { PresentationGraph, LayoutPoint } from "../src/types.js";
import {
  dolFixture,
  actuation,
  flows,
  type DolCase,
} from "./dol-control-junctions-fixture.js";
import { launchBrowser } from "../../cli/test/helpers/pdf-raster.js";
import { referenceInkOracle } from "./helpers/context-reference-oracle.js";

const must = <T>(x: T | null | undefined): T => {
  if (x == null) throw Error("Missing fixture value");
  return x;
};
const names = ["saved", "p4", "p5", "rm3"] as const;
const fixtures = new Map<DolCase, Awaited<ReturnType<typeof dolFixture>>>();
beforeAll(async () => {
  for (const name of names) fixtures.set(name, await dolFixture(name));
});
afterAll(async () => {
  for (const f of fixtures.values()) await f.dispose();
});
function graphFor(
  name: DolCase,
  flow: (typeof flows)[number],
): PresentationGraph {
  const ir = must(fixtures.get(name)).ir,
    n = normalizeSchematicView(ir, actuation("K1", flow));
  if (!n.ok) throw Error(n.error.message);
  const selected = selectSemanticSubgraph({ ir, ...n.value });
  if (!selected.ok) throw Error(selected.error.message);
  const p = buildPresentationGraph({ ir, selected: selected.value });
  if (!p.ok) throw Error(p.error.message);
  return p.value.graph;
}
const same = (a: LayoutPoint, b: LayoutPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y) < 0.001;
/** Check the two authored fork routes without calling the production validator. */
function unmarkedCrossings(
  a: readonly LayoutPoint[],
  b: readonly LayoutPoint[],
) {
  const result: LayoutPoint[] = [];
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      const p = a[i - 1]!,
        q = a[i]!,
        r = b[j - 1]!,
        s = b[j]!;
      let hit: LayoutPoint | undefined;
      if (p.y === q.y && r.x === s.x) hit = { x: r.x, y: p.y };
      if (p.x === q.x && r.y === s.y) hit = { x: p.x, y: r.y };
      if (
        hit &&
        [p, q, r, s].every(
          (x) => Number.isFinite(x.x) && Number.isFinite(x.y),
        ) &&
        hit.x >= Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)) &&
        hit.x <= Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) &&
        hit.y >= Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)) &&
        hit.y <= Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) &&
        ![a[0], a.at(-1)].some(
          (x) =>
            x &&
            same(x, hit!) &&
            [b[0], b.at(-1)].some((y) => y && same(y, hit!)),
        )
      )
        result.push(hit);
    }
  return result;
}

it.each(flows)(
  "reserves local reference ink with no ELK edge, conserving every port and real route (%s)",
  async (flow) => {
    const graph = graphFor("saved", flow),
      build = buildElkAdapterGraph(graph),
      reference = must(
        graph.edges.find((e) => terminalContextAttachment(graph, e)),
      );
    const routed = build.graph.edges ?? [];
    expect(routed.map((e) => e.id).sort()).toEqual(
      graph.edges
        .filter((e) => e.id !== reference.id)
        .map((e) => e.id)
        .sort(),
    );
    expect(routed.some((e) => e.id === reference.id)).toBe(false);
    expect(graph.edges.filter((e) => e.kind === "conductor")).toHaveLength(10);
    const nodes: (typeof build.graph)[] = [],
      ports: string[] = [];
    const visit = (n: typeof build.graph) => {
      nodes.push(n);
      ports.push(...(n.ports ?? []).map((p) => p.id));
      n.children?.forEach(visit);
    };
    visit(build.graph);
    expect(ports.sort()).toEqual(
      graph.nodes.flatMap((n) => n.ports.map((p) => p.id)).sort(),
    );
    const association = must(terminalContextAttachment(graph, reference)),
      owner = must(nodes.find((n) => n.id === association.junction.id)),
      ink = contextJunctionInk(graph, association.junction);
    const label = must(owner.labels?.find((l) => l.id === reference.label?.id));
    expect(label.text).toBe("R1.A1 (reference, no wire)");
    expect(label).toMatchObject({ x: ink.labels[0]?.x, y: ink.labels[0]?.y });
    expect(label.x! + label.width!).toBeLessThanOrEqual(owner.width!);
    expect(label.y! + label.height!).toBeLessThanOrEqual(owner.height!);
    expect(
      graph.edges.filter(
        (e) =>
          e.kind === "boundary-segment" && !terminalContextAttachment(graph, e),
      ),
    ).toHaveLength(1);
  },
);

it("keeps conductor kind on the same visual port pair; source rejects literal self-links with E024", async () => {
  const graph = graphFor("saved", "left-to-right"),
    association = must(
      graph.edges.find((e) => terminalContextAttachment(graph, e)),
    ),
    real = must(graph.edges.find((e) => e.kind === "conductor"));
  // Defence at the adapter boundary: a conductor can never be filtered because
  // its owners look like a context association, even in malformed input.
  const wire = {
    ...association,
    kind: "conductor" as const,
    conductor: real.conductor,
    elementIds: real.elementIds,
  };
  expect(terminalContextAttachment(graph, wire)).toBeUndefined();
  const replaced = {
    ...graph,
    edges: graph.edges.map((e) => (e.id === association.id ? wire : e)),
  };
  expect(
    buildElkAdapterGraph(replaced).graph.edges?.map((e) => e.id),
  ).toContain(wire.id);
  expect(
    buildElkAdapterGraph(graph).graph.edges?.filter((e) =>
      graph.edges.some((g) => g.id === e.id && g.kind === "conductor"),
    ),
  ).toHaveLength(10);
  const f = await dolFixture("saved");
  try {
    const path = join(f.root, "source.json"),
      source = JSON.parse(await readFile(path, "utf8"));
    source.objects.push({
      uid: "10000000-0000-4000-8000-000000000099",
      kind: "wire",
      designation: "LOCAL",
      endpoints: [
        { device: "R1", terminal: "A1" },
        { device: "R1", terminal: "A1" },
      ],
    });
    await writeFile(path, JSON.stringify(source));
    const c = await compileProject(f.root);
    expect(c.ok).toBe(false);
    expect(c.diagnostics.some((d) => d.code === "E024")).toBe(true);
  } finally {
    await f.dispose();
  }
});

it.each(flows)(
  "bounds authored-incidence candidates and excludes graphs without detached references (%s)",
  (flow) => {
    const graph = graphFor("saved", flow),
      iterator = contextForkOrderAlternatives(graph),
      candidates: PresentationGraph[] = [];
    for (let i = 0; i < 17; i++) {
      const item = iterator.next();
      if (item.done) break;
      candidates.push(item.value);
    }
    expect(candidates).toHaveLength(3);
    expect(iterator.next().done).toBe(true);
    const fork = must(
      graph.nodes.find(
        (n) =>
          n.kind === "junction" &&
          n.ports.filter((p) =>
            graph.edges.some(
              (e) => e.kind === "conductor" && e.sourcePortId === p.id,
            ),
          ).length === 2 &&
          n.ports.length === 3,
      ),
    );
    const arms = fork.ports
      .filter((p) =>
        graph.edges.some(
          (e) => e.kind === "conductor" && e.sourcePortId === p.id,
        ),
      )
      .sort((a, b) => a.order - b.order);
    const changed = must(candidates[0]?.nodes.find((n) => n.id === fork.id));
    expect(changed.ports.find((p) => p.id === arms[0]?.id)?.side).toBe(
      arms[1]?.side,
    );
    expect(changed.ports.find((p) => p.id === arms[1]?.id)?.side).toBe(
      arms[0]?.side,
    );
    for (const c of candidates) {
      expect(c.edges).toEqual(graph.edges);
      expect(
        c.nodes.map((n) => ({
          ...n,
          ports: n.ports.map(({ side: _side, ...p }) => p),
        })),
      ).toEqual(
        graph.nodes.map((n) => ({
          ...n,
          ports: n.ports.map(({ side: _side, ...p }) => p),
        })),
      );
      const attachment = must(
        fork.ports.find((p) => !arms.some((a) => a.id === p.id)),
      );
      expect(
        c.nodes
          .find((n) => n.id === fork.id)
          ?.ports.find((p) => p.id === attachment.id)?.side,
      ).toBe(attachment.side);
    }
    const noReference = {
      ...graph,
      edges: graph.edges.filter((e) => !terminalContextAttachment(graph, e)),
    };
    expect([...contextForkOrderAlternatives(noReference)]).toEqual([]);
  },
);

for (const name of names)
  for (const flow of flows)
    it(`routes ${name} control fork without unmarked crossings (${flow})`, async () => {
      const f = must(fixtures.get(name)),
        r = await prepareSchematicDrawing(
          f.ir,
          actuation(name === "p5" ? "R1" : "K1", flow),
        );
      if (!r.ok) throw Error(r.error.message);
      if (name === "p5" && flow === "top-to-bottom") {
        const packet = await renderSchematicPacket(f.ir, {
          format: "schematic-packet-request/0.1",
          views: [actuation("R1", flow)],
        });
        expect(packet.ok, JSON.stringify(packet)).toBe(true);
      }
      const { graph, layout } = r.value,
        referenceIds = new Set(
          graph.edges
            .filter((e) => terminalContextAttachment(graph, e))
            .map((e) => e.id),
        );
      expect(layout.edges.map((e) => e.id).sort()).toEqual(
        graph.edges
          .filter((e) => !referenceIds.has(e.id))
          .map((e) => e.id)
          .sort(),
      );
      expect(layout.contextReferences).toHaveLength(referenceIds.size);
      const paths = ["W34", "W35"].map((w) => {
        const e = must(graph.edges.find((e) => e.conductor?.designation === w));
        return must(layout.edges.find((l) => l.id === e.id)).points;
      });
      expect(unmarkedCrossings(paths[0]!, paths[1]!)).toEqual([]);
      for (const reference of layout.contextReferences ?? [])
        for (const [i, leader] of reference.leaders.entries()) {
          const port = must(
            layout.ports.find(
              (p) =>
                p.id ===
                (i === 0 ? reference.sourcePortId : reference.targetPortId),
            ),
          );
          expect(leader[0]).toMatchObject({ x: port.x, y: port.y });
          expect(
            Math.hypot(leader[1]!.x - port.x, leader[1]!.y - port.y),
          ).toBeCloseTo(8, 8);
        }
    });

it.each(flows)(
  "rejects ghost edges and preserves explicit adapter/output contracts (%s)",
  async (flow) => {
    const graph = graphFor("saved", flow),
      engine = createElkEngine(),
      candidates = [graph, ...contextForkOrderAlternatives(graph)];
    let valid:
      | undefined
      | {
          graph: PresentationGraph;
          input: ReturnType<typeof buildElkAdapterGraph>["graph"];
          output: ReturnType<typeof buildElkAdapterGraph>["graph"];
        };
    for (const candidate of candidates) {
      const input = buildElkAdapterGraph(candidate).graph,
        output = await engine.layout(structuredClone(input));
      if (
        normalizeAndValidateLayout(candidate, input, output, SYMBOL_CATALOG).ok
      ) {
        valid = { graph: candidate, input, output };
        break;
      }
    }
    const v = must(valid),
      reference = must(
        v.graph.edges.find((e) => terminalContextAttachment(v.graph, e)),
      ),
      ghost = {
        id: reference.id,
        sources: [reference.sourcePortId],
        targets: [reference.targetPortId],
      };
    const badInput = structuredClone(v.input);
    badInput.edges!.push(ghost);
    expect(() =>
      normalizeAndValidateLayout(v.graph, badInput, v.output, SYMBOL_CATALOG),
    ).toThrow(/adapter routed edges/);
    const missing = structuredClone(v.input);
    const unlabelled = must(missing.edges?.find((e) => !e.labels?.length));
    missing.edges = missing.edges?.filter((e) => e.id !== unlabelled.id);
    expect(() =>
      normalizeAndValidateLayout(v.graph, missing, v.output, SYMBOL_CATALOG),
    ).toThrow(/adapter routed edges/);
    const badOutput = structuredClone(v.output);
    badOutput.edges!.push(ghost);
    const result = normalizeAndValidateLayout(
      v.graph,
      v.input,
      badOutput,
      SYMBOL_CATALOG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("unexpected edge");
    const labelOwner = must(terminalContextAttachment(v.graph, reference))
      .junction.id;
    const moved = structuredClone(v.input);
    const walk = (n: typeof moved): void => {
      if (n.id === labelOwner)
        must(n.labels?.find((l) => l.id === reference.label?.id)).x = 999;
      n.children?.forEach(walk);
    };
    walk(moved);
    expect(() =>
      normalizeAndValidateLayout(v.graph, moved, v.output, SYMBOL_CATALOG),
    ).toThrow(/reserved junction ink/);
  },
);

it("requires the 1 mm ink gap rather than merely non-overlap", () => {
  const reference = {
    id: "reference",
    sourcePortId: "a",
    targetPortId: "b",
    leaders: [
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
      ],
      [
        { x: 100, y: 0 },
        { x: 108, y: 0 },
      ],
    ] as const,
  };
  const label = {
    id: "caption",
    ownerKind: "edge" as const,
    ownerId: "reference",
    role: "reference" as const,
    text: "T.A (reference, no wire)",
    x: 12,
    y: 10,
    width: 20,
    height: 14,
  };
  const ink = new Map([
      ["caption", { left: 12, right: 32, top: 10, bottom: 20 }],
    ]),
    ports = new Map(
      ["a", "b"].map((id, i) => [
        id,
        {
          id,
          nodeId: id,
          side: "east" as const,
          x: i * 100,
          y: 0,
          width: 0,
          height: 0,
        },
      ]),
    );
  const reject = (s: string): never => {
    throw Error(s);
  };
  expect(() =>
    validateContextReferenceClearance(
      [reference],
      [label],
      ink,
      ports,
      [{ bounds: { left: 35, right: 40, top: 10, bottom: 20 } }],
      reject,
    ),
  ).toThrow(/label needs 1 mm/);
  expect(() =>
    validateContextReferenceClearance(
      [reference],
      [label],
      ink,
      ports,
      [{ bounds: { left: 0, right: 8, top: 3, bottom: 4 } }],
      reject,
    ),
  ).toThrow(/leader needs 1 mm/);
});

it("builds bounded leaders from each real port", () => {
  const origin = { x: 17, y: 23 };
  const cases = [
    ["west", { x: 9, y: 23 }],
    ["east", { x: 25, y: 23 }],
    ["north", { x: 17, y: 15 }],
    ["south", { x: 17, y: 31 }],
  ] as const;
  for (const [side, end] of cases) {
    const leader = contextReferenceLeader({ ...origin, side });
    expect(leader).toEqual([origin, end]);
    expect(Math.hypot(leader[1].x - origin.x, leader[1].y - origin.y)).toBe(8);
  }
});

for (const flow of flows)
  it.each(["standard", "compact"] as const)(
    `prints both port-anchored leaders and the label with independent 1 mm clearances (${flow}, %s)`,
    async (layout) => {
      const browser = await launchBrowser(),
        page = await browser.newPage();
      try {
        const r = await renderSchematicPacket(must(fixtures.get("saved")).ir, {
          format: "schematic-packet-request/0.1",
          layout,
          views: [actuation("K1", flow)],
        });
        if (!r.ok) throw Error(r.error.message);
        expect(r.value.sheets.length).toBeLessThanOrEqual(
          flow === "left-to-right"
            ? layout === "standard"
              ? 3
              : 2
            : layout === "standard"
              ? 4
              : 3,
        );
        const labels = [],
          leaders = [];
        for (const sheet of r.value.sheets) {
          if (!sheet.svg.includes("context-reference-leader")) continue;
          const ink = await referenceInkOracle(page, sheet.svg);
          labels.push(...ink.labels);
          leaders.push(...ink.leaders);
        }
        expect(labels).toHaveLength(1);
        expect(labels[0]?.text).toBe("R1.A1 (reference, no wire)");
        expect(leaders).toHaveLength(2);
        for (const l of labels) {
          expect(l.strokeGap).toBeGreaterThanOrEqual(1);
          expect(l.textGap).toBeGreaterThanOrEqual(1);
          expect(l.sizeMm).toBeGreaterThanOrEqual(2.5 - 0.001);
        }
        for (const l of leaders) {
          expect(l.length).toBeCloseTo(2, 3);
          expect(l.paintedLength).toBeCloseTo(2, 3);
          expect(l.strokeGap).toBeGreaterThanOrEqual(1);
          expect(l.textGap).toBeGreaterThanOrEqual(1);
        }
        expect(
          r.value.sheets
            .flatMap((s) => s.continuations)
            .some((c) => c.conductor.includes("reference, no wire")),
        ).toBe(false);
      } finally {
        await browser.close();
      }
    },
    // The standard top-to-bottom packet reached 160 s on native CI.
    flow === "top-to-bottom" ? 240_000 : 120_000,
  );
