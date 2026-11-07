import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import { svgSemanticId } from "../src/svg/escape.js";
import { printableTextMetrics } from "../src/symbols/printable-font.js";
import type { LayoutPoint, SchematicViewRequest } from "../src/types.js";

function distance(
  box: { left: number; right: number; top: number; bottom: number },
  points: readonly LayoutPoint[],
) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const dx = Math.max(
        Math.min(a.x, b.x) - box.right,
        box.left - Math.max(a.x, b.x),
        0,
      ),
      dy = Math.max(
        Math.min(a.y, b.y) - box.bottom,
        box.top - Math.max(a.y, b.y),
        0,
      );
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
it("keeps every own-wire ink distance no worse than dev across 50 requests and both flows", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./printable-anchor-baseline.json", import.meta.url),
      "utf8",
    ),
  ) as {
    cases: {
      key: string;
      project: string;
      request: SchematicViewRequest;
      error?: string;
      distances?: Record<string, number>;
      facts?: Record<string, { role: string; text: string; netId: string }>;
    }[];
  };
  expect(fixture.cases).toHaveLength(50);
  expect(new Set(fixture.cases.map((c) => c.request.flow))).toEqual(
    new Set(["left-to-right", "top-to-bottom"]),
  );
  const projects = new Map<
    string,
    Awaited<ReturnType<typeof compileProject>>
  >();
  let count = 0;
  for (const c of fixture.cases) {
    if (!projects.has(c.project))
      projects.set(c.project, await compileProject(c.project));
    const compiled = projects.get(c.project)!;
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const drawing = await prepareSchematicDrawing(
      compiled.ir,
      c.request,
      compiled.presentation,
    );
    if (c.error) {
      expect(drawing.ok, c.key).toBe(false);
      if (!drawing.ok) expect(drawing.error.code).toBe(c.error);
      continue;
    }
    if (!drawing.ok) throw Error(c.key + ": " + JSON.stringify(drawing.error));
    const { graph, layout, titleContext } = drawing.value,
      svg = emitSchematicSvg(
        graph,
        layout,
        titleContext,
        undefined,
        false,
        0.25,
        compiled.ir,
      );
    if (!svg.ok) throw Error(JSON.stringify(svg.error));
    const doc = parseHTML(svg.value).document;
    for (const [id, baseline] of Object.entries(c.distances!)) {
      const fact = c.facts?.[id];
      const label =
        layout.labels.find((l) => l.id === id) ??
        (fact?.role === "net"
          ? layout.labels.find(
              (l) =>
                l.role === "net" &&
                l.text === fact.text &&
                graph.edges.find((e) => e.id === l.ownerId)?.netId ===
                  fact.netId,
            )
          : undefined)!;
      expect(label, c.key + id).toBeDefined();
      const text = doc.querySelector(
        `text[clip-path="url(#${svgSemanticId("clip", [label.id])})"]`,
      )!;
      const m = printableTextMetrics(text.textContent!),
        scale = text.hasAttribute("textLength")
          ? Number(text.getAttribute("textLength")) / m.advance
          : 1,
        x = Number(text.getAttribute("x")) - 20,
        y = Number(text.getAttribute("y")) - 20;
      expect(text.getAttribute("dominant-baseline")).toBe("alphabetic");
      const ink = {
        left: x + m.left * scale,
        right: x + m.right * scale,
        top: y - m.top,
        bottom: y - m.bottom,
      };
      const own = layout.edges.find((e) => e.id === label.ownerId)!;
      expect(
        distance(ink, own.points),
        c.key + " " + text.textContent,
      ).toBeLessThanOrEqual(baseline + 0.001);
      count++;
    }
  }
  expect(count).toBe(286);
}, 60000);

it("retains a narrow label's along-wire center and conductor-facing ink edge", async () => {
  const { printableLabelGeometry } =
    await import("../src/symbols/printable-label.js");
  const label = {
    id: "net",
    ownerKind: "edge" as const,
    ownerId: "wire",
    role: "net" as const,
    text: "L1",
    x: 10,
    y: 20,
    width: 40,
    height: 14,
  };
  const p = printableLabelGeometry(label, "L1", 34, [
    [
      { x: 0, y: 50 },
      { x: 80, y: 50 },
    ],
  ]);
  expect((p.ink.left + p.ink.right) / 2).toBeCloseTo(30, 6);
  expect(p.ink.bottom).toBeCloseTo(34, 6);
});

it("keeps the circuit J1 caption's ink at its conductor-facing reserved edge", async () => {
  const { renderSchematicPacket } = await import("../src/sheets.js");
  const c = await compileProject("examples/functional-symbols");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const request = JSON.parse(
    await readFile(
      "examples/functional-symbols/packet-left-to-right.request.json",
      "utf8",
    ),
  );
  const result = await renderSchematicPacket(c.ir, request, c.presentation);
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const doc = parseHTML(result.value.sheets[0]!.svg).document,
    label = doc.querySelector(
      '[data-wire-label="80000000-0000-4000-8000-000000000012"]',
    )!,
    t = [...label.querySelectorAll("text")].find(
      (t) => t.textContent === "J1",
    )!,
    plate = label.querySelector("rect")!,
    m = printableTextMetrics("J1", 2.5);
  expect(Number(t.getAttribute("x")) + m.right).toBeCloseTo(
    Number(plate.getAttribute("x")) +
      Number(plate.getAttribute("width")) -
      0.75,
    2,
  );
});
