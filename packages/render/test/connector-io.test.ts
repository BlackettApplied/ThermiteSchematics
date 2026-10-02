import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { connectorIoFixture } from "../../compiler/test/connector-io-fixture.js";
import { renderSchematicPacket } from "../src/sheets.js";

describe("printable connector I/O schedules", () => {
  it.each(["a4", "tabloid"] as const)(
    "prints every socket and its unresolved mapping on %s without electrical geometry",
    async (size) => {
      const f = await connectorIoFixture();
      try {
        if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
        const request = {
          format: "schematic-packet-request/0.1" as const,
          page: { size, orientation: "landscape" as const },
          views: [
            {
              format: "documentation-view-request/0.1" as const,
              kind: "io-ports" as const,
              device: "R1",
            },
          ],
        };
        const result = await renderSchematicPacket(f.result.ir, request);
        if (!result.ok) throw new Error(result.error.message);
        const svg = result.value.sheets.map((s) => s.svg).join("\n");
        const doc = parseHTML(svg).document;
        const printed = [...doc.querySelectorAll("text")]
          .map((n) => n.textContent)
          .join(" ");
        for (const label of [
          "X1",
          "X2",
          "X3",
          "X4",
          "S1.M12",
          "CAP1.P",
          "Y1.IN",
          "Unoccupied",
          "unresolved",
          "not-applicable",
          "Reserved socket.",
        ])
          expect(printed).toContain(label);
        expect(svg).not.toContain("data-circuit-conductor");
        expect(
          Math.min(
            ...[...doc.querySelectorAll("[data-report-row] text")].map((n) =>
              Number(n.getAttribute("font-size")),
            ),
          ),
        ).toBeGreaterThanOrEqual(2.5);
        expect(await renderSchematicPacket(f.result.ir, request)).toEqual(
          result,
        );
      } finally {
        await f.dispose();
      }
    },
  );
});
