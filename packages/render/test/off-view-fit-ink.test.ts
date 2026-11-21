import { expect, it } from "vitest";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { compileProject } from "@thermite/compiler";
import { printableTextMetrics } from "../src/text-metrics.js";
import { CARD_FONT, CARD_PITCH, CARD_PAD } from "../src/off-view/card.js";
import { cardInkFits } from "../src/off-view/ink.js";
import { nativeReservations } from "../src/off-view/native.js";
import { flows, offViewFixture, control } from "./off-view-fixtures.js";

it("keeps 3 mm natural regular/bold/math ink, 4 mm pitch and padding for wrapped Unicode", async () => {
  const f = await offViewFixture((objects) => {
    objects.find((o) => o.designation === "W3").designation =
      "Ω → " + "W".repeat(140);
  });
  try {
    const p = await prepareSchematicDrawing(f.ir, control());
    if (!p.ok) throw Error(JSON.stringify(p));
    expect(CARD_FONT * 0.25).toBe(3);
    expect(CARD_PITCH * 0.25).toBe(4);
    for (const label of p.value.graph.nodes.flatMap((n) =>
      n.kind === "junction" ? [] : n.labels.filter((l) => l.offView),
    )) {
      expect(cardInkFits(label)).toBe(true);
      const c = label.offView!;
      for (let i = 1; i < c.lines.length; i++)
        expect(c.lines[i]!.baseline - c.lines[i - 1]!.baseline).toBeCloseTo(
          16,
          8,
        );
      for (const line of c.lines) {
        const m = printableTextMetrics(line.text, 12, line.bold),
          x = 4 + line.offsetX;
        expect(x + m.left).toBeGreaterThanOrEqual(CARD_PAD - 0.001);
        expect(x + m.right).toBeLessThanOrEqual(label.width - CARD_PAD + 0.001);
        expect(line.baseline - m.top).toBeGreaterThanOrEqual(CARD_PAD - 0.001);
        expect(line.baseline - m.bottom).toBeLessThanOrEqual(
          label.height - CARD_PAD + 0.001,
        );
      }
      expect(cardInkFits({ ...label, width: 2 * CARD_PAD })).toBe(false);
      expect(
        cardInkFits({
          ...label,
          offView: {
            ...c,
            lines: c.lines.map((l) => ({ ...l, baseline: l.baseline + 1000 })),
          },
        }),
      ).toBe(false);
    }
  } finally {
    await f.dispose();
  }
});
it.each(flows)(
  "aligns only the gang's required axis and keeps the third pole native (%s)",
  async (flow) => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error("Compile failed");
    const p = await prepareSchematicDrawing(c.ir, {
      format: "schematic-view-request/0.1",
      family: "power",
      root: { by: "designation", value: "M1" },
      flow,
    });
    if (!p.ok) throw Error(JSON.stringify(p));
    const poles = p.value.graph.nodes.filter(
      (n) => n.kind === "symbol" && n.designation === "CB1",
    );
    const native = nativeReservations(p.value.graph);
    expect(poles).toHaveLength(3);
    const offsets = poles.map((n) =>
      n.kind === "symbol"
        ? n.primitiveOrigin[flow === "top-to-bottom" ? "y" : "x"]
        : NaN,
    );
    expect(new Set(offsets).size).toBe(1);
    const blank = poles.find(
      (n) => n.kind === "symbol" && !n.labels.some((l) => l.offView),
    )!;
    const old = native.nodes.find((n) => n.id === blank.id)!;
    expect(blank[flow === "top-to-bottom" ? "width" : "height"]).toBe(
      old[flow === "top-to-bottom" ? "width" : "height"],
    );
    const ports = poles.flatMap((n) => (n.kind === "symbol" ? n.ports : []));
    expect(ports.map((p) => p.terminal.terminalKey).sort()).toEqual(
      ["1/L1", "2/T1", "3/L2", "4/T2", "5/L3", "6/T3"].sort(),
    );
  },
);

it("reserves only pinned natural ink/advance plus padding for the short transformer cards", async () => {
  const c = await compileProject(
    "packages/core-library/test/fixtures/transformer-control",
  );
  if (!c.ok) throw Error("Compile failed");
  const p = await prepareSchematicDrawing(c.ir, {
    format: "schematic-view-request/0.1",
    family: "control",
    root: { by: "designation", value: "R1" },
    flow: "left-to-right",
  });
  if (!p.ok) throw Error(JSON.stringify(p.error));
  const labels = p.value.graph.nodes.flatMap((n) =>
    n.kind === "junction" ? [] : n.labels.filter((l) => l.offView),
  );
  expect(labels).toHaveLength(2);
  for (const label of labels) {
    expect(label.width).toBeLessThan(240);
    const measured = Math.max(
      ...label.offView!.lines.map((line) => {
        const ink = printableTextMetrics(line.text, 12, line.bold);
        return Math.max(ink.advance, ink.right) - Math.min(0, ink.left);
      }),
    );
    expect(label.width).toBeCloseTo(Math.ceil((measured + 8) * 1000) / 1000, 3);
  }
});
