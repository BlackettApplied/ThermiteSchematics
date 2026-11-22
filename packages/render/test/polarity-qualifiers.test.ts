import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import {
  SYMBOL_CATALOG,
  orientSymbolDefinition,
} from "../src/symbols/catalog.js";
import { validateSymbolCatalog } from "../src/symbols/validate.js";
import type { SchematicViewRequest } from "../src/types.js";
import { contractProject } from "./rooted-profile-contracts.js";
import { inkClearance, svgGeometry } from "./source-isolation.js";
import { paintedShape } from "./circuit-fidelity-oracle.js";

// This oracle reads emitted strokes and all nested SVG transforms. It never
// reads the catalog's qualifier centre or an orientation claim from the emitter.
function audit(owner: Element, width: number, height: number) {
  const local = owner.cloneNode(true) as Element;
  local.removeAttribute("transform");
  const qualifiers = [
    ...local.querySelectorAll('[data-symbol-qualifier="polarity"]'),
  ];
  expect(qualifiers).toHaveLength(3);
  const strokes = qualifiers.map((q) => {
    const wrapper = parseHTML("<svg/>").document.querySelector("svg")!;
    wrapper.append(q.cloneNode(true));
    const shapes = svgGeometry(wrapper).shapes;
    expect(shapes).toHaveLength(1);
    return shapes[0]!;
  });
  const terminals = [...local.querySelectorAll(".terminal-marker")].map((e) => {
    const ink = paintedShape(local, e);
    return {
      port: e.getAttribute("data-symbol-port-id"),
      x:
        (Math.min(...ink.points.map((p) => p.x)) +
          Math.max(...ink.points.map((p) => p.x))) /
        2,
      y:
        (Math.min(...ink.points.map((p) => p.y)) +
          Math.max(...ink.points.map((p) => p.y))) /
        2,
    };
  });
  expect(terminals.map((t) => t.port).sort()).toEqual(["positive", "return"]);
  for (const [i, q] of qualifiers.entries()) {
    const { points, stroke } = strokes[i]!;
    expect(points).toHaveLength(2);
    const [a, b] = points;
    const dx = Math.abs(a!.x - b!.x),
      dy = Math.abs(a!.y - b!.y);
    expect(dx < 0.001 || dy < 0.001).toBe(true);
    expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(6);
    if (q.getAttribute("data-polarity") === "negative") {
      expect(dy).toBeLessThan(0.001);
      expect(q.getAttribute("data-symbol-port-id")).toBe("return");
    } else expect(q.getAttribute("data-symbol-port-id")).toBe("positive");
    const centre = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
      own = terminals.find(
        (t) => t.port === q.getAttribute("data-symbol-port-id"),
      )!,
      opposite = terminals.find((t) => t !== own)!;
    expect(
      Math.hypot(centre.x - own.x, centre.y - own.y),
      "owned polarity adjacency",
    ).toBeLessThan(Math.hypot(centre.x - opposite.x, centre.y - opposite.y));
    for (const p of points) {
      expect(p.x - stroke / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + stroke / 2).toBeLessThanOrEqual(width);
      expect(p.y - stroke / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + stroke / 2).toBeLessThanOrEqual(height);
    }
  }
  const positive = qualifiers.flatMap((q, i) =>
    q.getAttribute("data-polarity") === "positive" ? [strokes[i]!] : [],
  );
  expect(positive).toHaveLength(2);
  expect(
    positive.filter((s) => Math.abs(s.points[0]!.y - s.points[1]!.y) < 0.001),
  ).toHaveLength(1);
  expect(
    positive.filter((s) => Math.abs(s.points[0]!.x - s.points[1]!.x) < 0.001),
  ).toHaveLength(1);
  expect(
    positive.map((s) => ({
      x: (s.points[0]!.x + s.points[1]!.x) / 2,
      y: (s.points[0]!.y + s.points[1]!.y) / 2,
    }))[0],
  ).toEqual(
    positive.map((s) => ({
      x: (s.points[0]!.x + s.points[1]!.x) / 2,
      y: (s.points[0]!.y + s.points[1]!.y) / 2,
    }))[1],
  );
  qualifiers.forEach((q) => q.remove());
  // Include the electrical leads and enclosure/body, with their painted stroke
  // widths. Four units are 1 mm at the minimum rooted print scale (0.25).
  const otherInk = svgGeometry(local).shapes;
  for (const qualifier of strokes)
    for (const ink of otherInk)
      expect(inkClearance(qualifier, ink)).toBeGreaterThanOrEqual(4);
}

describe("owned DC polarity qualifier geometry", () => {
  it.each([
    ["dc-source", "left-to-right"],
    ["dc-source", "top-to-bottom"],
    ["dc-load", "left-to-right"],
    ["dc-load", "top-to-bottom"],
  ] as const)(
    "keeps synthetic %s ink upright, reserved and clear in %s; mutations fail",
    async (mode, flow) => {
      const fixture = await contractProject(
        mode === "dc-source" ? "thermite:dc-supply" : "thermite:relay",
        mode,
        "loads",
      );
      try {
        const before = JSON.stringify(fixture.ir);
        const result = await renderSchematic(fixture.ir, {
          ...(fixture.request as SchematicViewRequest),
          flow,
        });
        if (!result.ok) throw Error(JSON.stringify(result.error));
        const doc = parseHTML(result.value.svg).document;
        for (const id of ["ais:power-source-dc", "ais:dc-load"] as const) {
          const owner = doc.querySelector(`[data-symbol-id="${id}"]`)!;
          expect(owner).toBeTruthy();
          const definition = orientSymbolDefinition(
            SYMBOL_CATALOG.find((s) => s.id === id)!,
            flow,
          );
          audit(owner, definition.size.width, definition.size.height);
          const swapped = owner.cloneNode(true) as Element;
          const plus = [
              ...swapped.querySelectorAll('[data-polarity="positive"]'),
            ],
            minus = swapped.querySelector('[data-polarity="negative"]')!;
          const dx =
              Number(minus.getAttribute("x1")) +
              (Number(minus.getAttribute("x2")) -
                Number(minus.getAttribute("x1"))) /
                2 -
              (Number(plus[0]!.getAttribute("x1")) +
                Number(plus[0]!.getAttribute("x2"))) /
                2,
            dy =
              Number(minus.getAttribute("y1")) -
              (Number(plus[0]!.getAttribute("y1")) +
                Number(plus[0]!.getAttribute("y2"))) /
                2;
          for (const q of plus)
            q.setAttribute("transform", `translate(${dx} ${dy})`);
          minus.setAttribute("transform", `translate(${-dx} ${-dy})`);
          expect(() =>
            audit(swapped, definition.size.width, definition.size.height),
          ).toThrow(/owned polarity adjacency/);
          const q = owner.querySelector('[data-polarity="negative"]')!;
          const x =
            (Number(q.getAttribute("x1")) + Number(q.getAttribute("x2"))) / 2;
          const y = Number(q.getAttribute("y1"));
          q.setAttribute("transform", `rotate(90 ${x} ${y})`);
          expect(() =>
            audit(owner, definition.size.width, definition.size.height),
          ).toThrow();
          q.removeAttribute("transform");
          const lead = owner.querySelectorAll("line.symbol-body")[1]!;
          const a = {
            x: Number(lead.getAttribute("x1")),
            y: Number(lead.getAttribute("y1")),
          };
          const b = {
            x: Number(lead.getAttribute("x2")),
            y: Number(lead.getAttribute("y2")),
          };
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const half =
            Math.abs(
              Number(q.getAttribute("x2")) - Number(q.getAttribute("x1")),
            ) / 2;
          q.setAttribute(
            "x1",
            String((a.x + b.x) / 2 - (half * (b.x - a.x)) / length),
          );
          q.setAttribute(
            "x2",
            String((a.x + b.x) / 2 + (half * (b.x - a.x)) / length),
          );
          q.setAttribute(
            "y1",
            String((a.y + b.y) / 2 - (half * (b.y - a.y)) / length),
          );
          q.setAttribute(
            "y2",
            String((a.y + b.y) / 2 + (half * (b.y - a.y)) / length),
          );
          expect(() =>
            audit(owner, definition.size.width, definition.size.height),
          ).toThrow();
        }
        expect(JSON.stringify(fixture.ir)).toBe(before);
        expect(doc.querySelector('[data-terminal-key="P"]')).toBeTruthy();
        expect(doc.querySelector('[data-terminal-key="N"]')).toBeTruthy();
      } finally {
        await fixture.dispose();
      }
    },
  );

  it("rejects foreign qualifier ownership and unreserved annotation geometry", () => {
    const symbol = structuredClone(
      SYMBOL_CATALOG.find((s) => s.id === "ais:power-source-dc")!,
    );
    const q = symbol.primitives.find((p) => p.kind === "line" && p.qualifier)!;
    if (q.kind !== "line" || !q.qualifier)
      throw Error("Missing synthetic qualifier");
    expect(() =>
      validateSymbolCatalog([
        {
          ...symbol,
          primitives: [
            ...symbol.primitives,
            { ...q, qualifier: { ...q.qualifier, portId: "foreign" } },
          ],
        },
      ]),
    ).toThrow(/unknown port/);
    expect(() =>
      validateSymbolCatalog([
        {
          ...symbol,
          primitives: [...symbol.primitives, { ...q, from: { x: -1, y: 0 } }],
        },
      ]),
    ).toThrow(/bounds/);
  });
});
