import type { IrFunction } from "@thermite/compiler";
import { relationCaptionPlan } from "../src/symbols/circuit-relations.js";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { viewportSize } from "../src/packet/viewport-size.js";
import { legacyFooterNote } from "../src/packet/legacy-footer.js";
import { printableTextMetrics } from "../src/text-metrics.js";

it("cannot lose planned em through a rounded viewport dimension", () => {
  for (const span of [100.001, 100.003, 651.721, 1543.387]) {
    const scale = 0.25,
      viewBox = Number(span.toFixed(3));
    const old = Number((span * scale).toFixed(3));
    expect(viewportSize(span, scale)).toBeGreaterThanOrEqual(old);
    expect((viewportSize(span, scale) / viewBox) * 10).toBeGreaterThanOrEqual(
      2.5,
    );
  }
  expect((Number((100.001 * 0.25).toFixed(3)) / 100.001) * 10).toBeLessThan(
    2.5,
  );
});
it("wraps the complete footer into its measured pre-reserved band", () => {
  const note =
    "Whole wires; repeated symbols and terminal IDs describe the same physical equipment. P = group part, S = packet sheet.";
  const rows = legacyFooterNote(note, 14, 119.9, 269.4, 250);
  expect(rows).toHaveLength(2);
  const nodes = [
    ...parseHTML(`<svg>${rows.join("")}</svg>`).document.querySelectorAll(
      "text",
    ),
  ];
  expect(nodes.map((n) => n.textContent).join("")).toBe(note);
  for (const n of nodes) {
    expect(n.getAttribute("font-size")).toBe("2.5");
    expect(
      printableTextMetrics(n.textContent ?? "", 2.5).right,
    ).toBeLessThanOrEqual(119.9);
    expect(Number(n.getAttribute("y"))).toBeGreaterThan(250);
  }
});

it("does not newly abbreviate terminal references when the floor adds a fifth row", () => {
  const fn: IrFunction = {
    id: { deviceUid: "synthetic", functionKey: "contact" },
    kind: "contact",
    normal_state: "closed",
    source: {
      file: "synthetic.json",
      line: 1,
      column: 1,
      jsonPointer: "/functions/contact",
    },
    terminals: [
      { deviceUid: "synthetic", terminalKey: "11" },
      { deviceUid: "synthetic", terminalKey: "12" },
    ],
  };
  const plan = relationCaptionPlan(
    [
      {
        kind: "relation",
        destination: "100 / 200 / 300 / 400 / 500",
        functions: Array.from({ length: 41 }, () => fn),
      },
    ],
    28,
  );
  expect(plan.lines.length).toBeGreaterThan(4);
  expect(plan.lines.join(" ").match(/11–12/gu)).toHaveLength(41);
  expect(plan.lines.join(" ")).not.toContain("contacts:");
  for (const line of plan.lines)
    expect(printableTextMetrics(line, 2.5).advance + 4).toBeLessThanOrEqual(
      plan.width,
    );
});
