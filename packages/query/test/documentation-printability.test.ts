import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { renderSchematicPacket } from "@thermite/render";
import { buildDocumentation } from "../src/documentation.js";
import { createTerminalIr } from "./fixtures.js";

function describedInventory(count: number, identical: boolean) {
  const ir = createTerminalIr(
    Array.from({ length: count }, (_, i) => ({
      uid: `56000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`,
      designation: `SB${String(i + 1).padStart(2, "0")}`,
      terminalKeys: ["T"],
    })),
  );
  ir.deviceTypes[0]!.description = "Generic pushbutton";
  for (const [i, d] of ir.devices.entries()) {
    d.location = "CABINET-DOOR";
    d.description = identical
      ? "Emergency stop pushbutton, red mushroom head, latching"
      : `Station ${i + 1} emergency stop pushbutton, red mushroom head, latching`;
  }
  return ir;
}

describe("BOM description group printability", () => {
  it("keeps a fourteen-device pump/conveyor-like BOM on one tabloid sheet without splitting its location token", async () => {
    const ir = describedInventory(14, false);
    ir.project.name = "Conveyor-like report fixture";
    for (const d of ir.devices) d.location = "CONVEYOR-DISCHARGE";
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
    });
    expect(packet.ok, JSON.stringify(packet)).toBe(true);
    if (!packet.ok) return;
    expect(packet.value.sheets).toHaveLength(1);
    const document = parseHTML(packet.value.sheets[0]!.svg).document;
    expect(
      [...document.querySelectorAll('[data-report-column="3"] text')].filter(
        (t) => t.textContent === "CONVEYOR-DISCHARGE",
      ),
    ).toHaveLength(14);
  });
  it.each(["letter", "a4"] as const)(
    "prints 20–30 undescribed or identical devices with four- and five-character names on %s landscape, including both sides of the width threshold",
    async (size) => {
      for (const digits of [2, 3]) {
        for (const count of [
          14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
        ]) {
          for (const described of [false, true]) {
            const ir = describedInventory(count, true);
            for (const [i, d] of ir.devices.entries()) {
              d.designation = `SB${String(i + 1).padStart(digits, "0")}`;
              if (!described) delete d.description;
            }
            const table = buildDocumentation(ir, {
              format: "documentation-view-request/0.1",
              kind: "bom",
            });
            expect(table.rows).toHaveLength(1);
            expect(table.widths[1]).toBe(
              table.rows[0]!.cells[1]!.length > 100 ? 0.23 : 0.1,
            );
            expect(table.rows[0]!.cells[0]).toBe(String(count));
            expect(new Set(table.rows[0]!.deviceUids).size).toBe(count);
            const packet = await renderSchematicPacket(ir, {
              format: "schematic-packet-request/0.1",
              page: { size, orientation: "landscape", marginMm: 10 },
              views: [
                { format: "documentation-view-request/0.1", kind: "bom" },
              ],
            });
            expect(
              packet.ok,
              `${digits + 2}-character names, ${count} members, described=${described}: ${JSON.stringify(packet.ok ? null : packet.error)}`,
            ).toBe(true);
          }
        }
      }
    },
  );
  it.each([
    [25, false],
    [61, true],
  ] as const)(
    "renders %i described devices with four-character names (identical: %s) on letter landscape without losing instances",
    async (count, identical) => {
      const ir = describedInventory(count, identical),
        before = JSON.stringify(ir);
      const request = {
        format: "documentation-view-request/0.1" as const,
        kind: "bom" as const,
      };
      const table = buildDocumentation(ir, request);
      expect(table.rows).toHaveLength(identical ? 1 : count);
      expect(
        table.rows.reduce((sum, row) => sum + Number(row.cells[0]), 0),
      ).toBe(count);
      expect(table.rows.flatMap((row) => row.deviceUids).sort()).toEqual(
        ir.devices.map((d) => d.uid).sort(),
      );
      const packet = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        page: { size: "letter", orientation: "landscape", marginMm: 10 },
        views: [request],
      });
      expect(packet.ok, JSON.stringify(packet)).toBe(true);
      if (!packet.ok) return;
      const rendered = packet.value.sheets.flatMap((sheet) =>
        [
          ...parseHTML(sheet.svg).document.querySelectorAll(
            "[data-report-row]",
          ),
        ].map((row) => row.getAttribute("data-report-row")),
      );
      expect(rendered.sort()).toEqual(table.rows.map((row) => row.key).sort());
      expect(JSON.stringify(ir)).toBe(before);
    },
  );
});
