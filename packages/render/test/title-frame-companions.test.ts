import { expect, it } from "vitest";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import { renderTitleFrameBenchmark } from "../src/internal/title-data/entry.js";
import type { PacketRequest } from "../src/internal/title-data/model.js";

it.each([1, 2])(
  "derives %s companion owners from native dependencies even with identical titles",
  async (count) => {
    const source = await offViewFixture();
    try {
      const request: PacketRequest = {
        format: "schematic-packet-request/0.2",
        views: Array.from({ length: count }, () => ({
          format: "wiring-view-request/0.1" as const,
          title: "Same title",
          conductors: ["W1"],
        })),
        titleData: {
          defaults: { values: { customer: "DEFAULT" } },
          byView: Array.from({ length: count }, (_, i) => ({
            viewIndex: i + 1,
            sheetTitle: `AUTHORED ${i + 1}`,
            values: { customer: `OWNER ${i + 1}` },
          })),
        },
      };
      const presentation = { format: "project-presentation/0.3" } as const;
      const result = await renderTitleFrameBenchmark(
        source.ir,
        request,
        presentation,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const companions = result.value.sheets.filter(
        (s) =>
          s.view.format === "documentation-view/0.1" &&
          ["wires", "terminals"].includes(s.view.kind),
      );
      expect(companions.length).toBeGreaterThan(0);
      for (const sheet of companions) {
        const paint = [...parseSvg(sheet.svg).querySelectorAll("text")].map(
          (e) => e.textContent,
        );
        expect(paint).toContain(count === 1 ? "OWNER 1" : "DEFAULT");
        expect(paint).not.toContain("AUTHORED 1");
        expect(paint).not.toContain("AUTHORED 2");
      }
      const key = companions[0]?.sheetKey;
      if (!key) throw Error("Missing companion sheet key.");
      const overridden = await renderTitleFrameBenchmark(
        source.ir,
        {
          ...request,
          titleData: {
            ...request.titleData,
            bySheet: [{ sheetKey: key, values: { customer: "EXACT" } }],
          },
        },
        presentation,
      );
      expect(overridden.ok).toBe(true);
      if (!overridden.ok) return;
      expect(
        overridden.value.sheets.find((s) => s.sheetKey === key)?.svg,
      ).toContain(">EXACT</text>");
    } finally {
      await source.dispose();
    }
  },
);
