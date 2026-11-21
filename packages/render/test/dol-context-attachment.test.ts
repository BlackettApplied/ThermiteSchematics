import { controlInputRoles } from "../src/layout/topology-conservation.js";
import { functionIdKey } from "../src/ordering.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { normalizeSchematicView } from "../src/view-spec.js";
import { selectSemanticSubgraph } from "../src/selection.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { expect, it } from "vitest";
import { DOMParser } from "linkedom";
import { prepareSchematicDrawing, renderSchematic } from "../src/renderer.js";
import {
  dolFixture,
  actuation,
  flows,
} from "./dol-control-junctions-fixture.js";

it.each(flows)(
  "prints bounded non-conductor context references in %s",
  async (flow) => {
    const fixture = await dolFixture("saved");
    try {
      const request = actuation("K1", flow);
      const drawing = await prepareSchematicDrawing(fixture.ir, request);
      if (!drawing.ok) throw Error(JSON.stringify(drawing));
      const { graph, layout } = drawing.value;
      const context = graph.nodes.find(
        (n) => n.kind === "symbol" && n.representation === "terminal",
      )!;
      const ports = new Set(context.ports.map((p) => p.id));
      const edge = graph.edges.find(
        (e) =>
          e.kind === "boundary-segment" &&
          (ports.has(e.sourcePortId) || ports.has(e.targetPortId)),
      )!;
      const junction = graph.nodes.find(
        (n) =>
          n.kind === "junction" &&
          n.ports.some(
            (p) => p.id === edge.sourcePortId || p.id === edge.targetPortId,
          ),
      )!;
      const point = layout.nodes.find((n) => n.id === junction.id)!;
      const label = layout.labels.find(
        (l) => l.ownerId === edge.id && l.role === "reference",
      )!;
      expect(label.text).toBe("R1.A1 (reference, no wire)");
      const dx = Math.max(
        label.x - (point.x + 3),
        point.x + 3 - label.x - label.width,
        0,
      );
      const dy = Math.max(
        label.y - (point.y + 3),
        point.y + 3 - label.y - label.height,
        0,
      );
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(24); // Within 6 mm of the real common point.
      const svg = await renderSchematic(fixture.ir, request);
      if (!svg.ok) throw Error(JSON.stringify(svg));
      const document = new DOMParser().parseFromString(
        svg.value.svg,
        "image/svg+xml",
      );
      const association = document.querySelector("g.context-attachment")!;
      expect(association).not.toBeNull();
      expect(association.getAttribute("data-presentation-only")).toBe("true");
      const leaders = association.querySelectorAll("path");
      expect(leaders.length).toBe(2);
      for (const path of leaders) {
        expect(path.getAttribute("class")).toBe("context-reference-leader");
        expect(Number(path.getAttribute("stroke-width"))).toBe(0.5);
        expect(path.hasAttribute("stroke-dasharray")).toBe(false);
        let x = 0,
          y = 0,
          length = 0;
        for (const match of path
          .getAttribute("d")!
          .matchAll(/([MLHV])([\d.\s,-]+)/g)) {
          const n = match[2]!
            .trim()
            .split(/[\s,]+/)
            .map(Number);
          const nx = match[1] === "V" ? x : n[0]!;
          const ny = match[1] === "H" ? y : match[1] === "V" ? n[0]! : n[1]!;
          if (match[1] !== "M") length += Math.abs(nx - x) + Math.abs(ny - y);
          x = nx;
          y = ny;
        }
        expect(length).toBeGreaterThan(0);
        expect(length).toBeLessThanOrEqual(8); // Each solid hairline is at most 2 mm, never a wire run.
      }
      expect(document.querySelectorAll("path.wire-path").length).toBe(10);
      expect(document.querySelectorAll("path.boundary-path").length).toBe(1); // Ordinary OL1.96 attachment stays intact.
    } finally {
      await fixture.dispose();
    }
  },
);

it.each(flows)(
  "does not apply input-branch ordering on a return path in %s",
  async (flow) => {
    const fixture = await dolFixture("rail-contacts");
    try {
      const path = join(fixture.root, "source.json"),
        source = JSON.parse(await readFile(path, "utf8"));
      for (const object of source.objects)
        for (const endpoint of object.endpoints ?? []) {
          if (endpoint.device === "PS1")
            endpoint.terminal = endpoint.terminal === "+" ? "-" : "+";
          if (endpoint.device === "K1")
            endpoint.terminal = endpoint.terminal === "A1" ? "A2" : "A1";
        }
      await writeFile(path, JSON.stringify(source));
      const compiled = await compileProject(fixture.root);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const normalized = normalizeSchematicView(
        compiled.ir,
        actuation("K1", flow),
      );
      if (!normalized.ok) throw Error(JSON.stringify(normalized));
      const selected = selectSemanticSubgraph({
        ir: compiled.ir,
        ...normalized.value,
      });
      if (!selected.ok) throw Error(JSON.stringify(selected));
      expect(
        selected.value.paths
          .filter((p) => p.lane === "return")
          .flatMap((p) => p.steps.filter((s) => s.kind === "conductor")).length,
      ).toBeGreaterThan(1);
      const owner = compiled.ir.devices.find((d) => d.designation === "K1")!;
      const terminal = { deviceUid: owner.uid, terminalKey: "A2" };
      const uses = compiled.ir.wires
        .filter((w) => ["W2", "W4"].includes(w.designation))
        .map((w) => ({
          end: "source" as const,
          edge: {
            endpoints: w.endpoints.map(
              (e) => e.terminal,
            ) as unknown as readonly [typeof terminal, typeof terminal],
          },
        }));
      expect(
        controlInputRoles(
          {
            ...selected.value,
            view: { ...normalized.value.view, family: "power" },
          },
          new Map(compiled.ir.functions.map((f) => [functionIdKey(f.id), f])),
          uses,
          terminal,
        ),
      ).toBeUndefined();
      const result = await renderSchematic(compiled.ir, actuation("K1", flow));
      expect(result).toMatchObject({ ok: false, error: { code: "R004" } });
      if (!result.ok)
        expect(result.error.message).toBe(
          "Invalid layout: edges W2 (K1.A2 / coil → S1.12 / contact11) and W4 (K1.A2 / coil → S2.12 / contact11) overlap collinearly.",
        );
    } finally {
      await fixture.dispose();
    }
  },
);

it.each(flows)(
  "keeps return incidences out of the input template with control family in %s",
  async (flow) => {
    const fixture = await dolFixture("rail-contacts");
    try {
      const normalized = normalizeSchematicView(
        fixture.ir,
        actuation("K1", flow),
      );
      if (!normalized.ok) throw Error(JSON.stringify(normalized));
      const selected = selectSemanticSubgraph({
        ir: fixture.ir,
        ...normalized.value,
      });
      if (!selected.ok) throw Error(JSON.stringify(selected));
      expect(selected.value.view.family).toBe("control");
      expect(selected.value.paths.some((p) => p.lane === "input")).toBe(true);
      // Change only the path classification: the family guard still passes.
      const built = buildPresentationGraph({
        ir: fixture.ir,
        selected: {
          ...selected.value,
          paths: selected.value.paths.map((p) =>
            p.lane === "input" ? { ...p, lane: "return" as const } : p,
          ),
        },
      });
      if (!built.ok) throw Error(JSON.stringify(built));
      const ports = built.value.graph.edges
        .filter(
          (e) =>
            e.conductor?.designation === "W1" ||
            e.conductor?.designation === "W3",
        )
        .map((e) =>
          built.value.graph.nodes
            .flatMap((n) => n.ports)
            .find((p) => p.id === e.sourcePortId)!,
        );
      expect(ports).toHaveLength(2);
      expect(ports.map((p) => p.side)).toEqual(
        flow === "left-to-right" ? ["east", "east"] : ["south", "south"],
      );
    } finally {
      await fixture.dispose();
    }
  },
);

it.each(
  (["saved", "rm3"] as const).flatMap((name) =>
    (["a4", "letter"] as const).map((size) => ({ name, size })),
  ),
)(
  "omits reference continuations for $name K1 top-to-bottom on $size",
  async ({ name, size }) => {
    const fixture = await dolFixture(name);
    try {
      const request = actuation("K1", "top-to-bottom");
      const drawing = await prepareSchematicDrawing(fixture.ir, request);
      if (!drawing.ok) throw Error(JSON.stringify(drawing));
      const referenceLabels = drawing.value.graph.edges
        .filter((e) => e.label?.role === "reference")
        .map((e) => e.label!.text);
      expect(referenceLabels).toHaveLength(1);
      const packet = await renderSchematicPacket(fixture.ir, {
        format: "schematic-packet-request/0.1",
        page: { size, orientation: "landscape" },
        views: [request],
      });
      if (!packet.ok) throw Error(JSON.stringify(packet));
      expect(
        packet.value.sheets.some((s) =>
          s.references.some((r) => r.representation === "terminal"),
        ),
      ).toBe(true);
      const continuations = packet.value.sheets.flatMap((s) => s.continuations);
      expect(continuations.length).toBeGreaterThan(0);
      expect(
        continuations.filter((c) => referenceLabels.includes(c.conductor)),
      ).toEqual([]);
      expect(continuations.some((c) => c.conductor.includes("reference"))).toBe(
        false,
      );
    } finally {
      await fixture.dispose();
    }
  },
);
