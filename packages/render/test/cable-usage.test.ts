import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import { cableUsagePlan } from "../src/packet/cable-usage.js";
import { cableRowPlan } from "../src/packet/cable-row-plan.js";
import { labelMetrics, labelRows } from "../src/packet/label-text.js";
import { flows, offViewFixture, parseSvg } from "./off-view-fixtures.js";

it("measures and preserves literal spacing and whole graphemes", () => {
  expect(labelMetrics("A  B").advance).toBeGreaterThan(
    labelMetrics("A B").advance,
  );
  const source = "A  B e\u0301 Ω";
  const rows = labelRows(source, 5);
  expect(rows.join("")).toBe(source);
  expect(rows.some((r) => r.startsWith("\u0301"))).toBe(false);
  expect(rows.every((r) => labelMetrics(r).width <= 5.001)).toBe(true);
});

it("reserves complete usage rows, including descenders, or refuses an unfit glyph", () => {
  const plan = cableUsagePlan("unspecified", 25);
  expect(plan.rows.length).toBeGreaterThan(1);
  expect(plan.rows.join("")).toBe("ASSIGNED / USAGE UNSPECIFIED");
  expect(plan.extraHeight).toBeGreaterThanOrEqual(3.5);
  expect(plan.rows.every((r) => labelMetrics(r).width <= 25.001)).toBe(true);
  expect(cableUsagePlan("spare", 0.1).rows.join("")).toBe("SPARE");
  const refused = cableRowPlan(
    {
      id: "1",
      color: "",
      usage: "spare",
      status: "unassigned",
      endpoints: [null, null],
    } as Parameters<typeof cableRowPlan>[0],
    "CBL1",
    { left: 0, right: 100, jacketL: 40, jacketR: 46.1 },
  );
  expect(refused).toMatchObject({ ok: false, error: { code: "R006" } });
  if (!refused.ok) expect(refused.error.message).toContain("short by");
});

it.each(flows)(
  "prints usage at legal size with intact core rows (%s)",
  async (flow) => {
    const c = await offViewFixture((objects) => {
      objects.find((o) => o.kind === "cable").conductors[0].usage = "in-use";
    });
    try {
      const r = await renderSchematicPacket(c.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "CBL1" },
            family: "control",
            intent: { kind: "conductors" },
            flow,
          },
        ],
      });
      if (!r.ok) throw Error(JSON.stringify(r.error));
      const groups = r.value.sheets.flatMap((s) => [
        ...parseSvg(s.svg).querySelectorAll(
          "[data-cable-uid][data-conductor-id]",
        ),
      ]);
      expect(groups).toHaveLength(4);
      const usages = groups.flatMap((g) =>
        [...g.querySelectorAll("text")].filter((t) =>
          /^(IN-USE|SPARE|UNASSIGNED|ASSIGNED \/ USAGE UNSPECIFIED)$/u.test(
            t.textContent ?? "",
          ),
        ),
      );
      expect(usages).toHaveLength(4);
      expect(usages.some((t) => t.textContent === "IN-USE")).toBe(true);
      expect(usages.some((t) => t.textContent === "SPARE")).toBe(true);
      for (const t of usages)
        expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.5);
      expect(r.value.sheets.every((s) => s.continuations.length === 0)).toBe(
        true,
      );
    } finally {
      await c.dispose();
    }
  },
);
