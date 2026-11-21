import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { renderSchematicPacket } from "@thermite/render";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { singleSheetSvg } from "../src/terminal-report-svg.js";

async function fixture(duplicate = false) {
  const ir = createTerminalIr([
    { uid: "native-svg-strip", designation: "XT", terminalKeys: ["1", "2"] },
  ]);
  ir.deviceTypes[0]!.terminals[0]!.description =
    'Keep data-strip-ref="authored"';
  const view = {
    format: "documentation-view-request/0.1" as const,
    kind: "terminals" as const,
    device: "XT",
  };
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    index: false,
    views: duplicate ? [view, view] : [view],
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return result.value;
}
it("removes only generated strip links while preserving authored inventory text and native row identity", async () => {
  const packet = await fixture();
  const original = parseHTML(packet.sheets[0]!.svg).document;
  const svg = singleSheetSvg(packet);
  expect(svg).toBeDefined();
  const doc = parseHTML(svg!).document;
  const rows = [...doc.querySelectorAll("[data-report-row]")];
  expect(rows.map((r) => r.getAttribute("data-report-row"))).toEqual(
    [...original.querySelectorAll("[data-report-row]")].map((r) =>
      r.getAttribute("data-report-row"),
    ),
  );
  expect(rows[0]!.querySelector('[data-report-column="4"]')!.textContent).toBe(
    original.querySelector('[data-report-row] [data-report-column="4"]')!
      .textContent,
  );
  expect(
    doc.querySelectorAll("[data-strip-row],[data-strip-ref]"),
  ).toHaveLength(0);
  const labels = [...doc.querySelectorAll("text")].map((t) => t.textContent);
  expect(labels).not.toContain("Strip");
  expect(labels).not.toContain("row");
});
it("does not discard a second requested inventory to force one-sheet SVG output", async () => {
  expect(singleSheetSvg(await fixture(true))).toBeUndefined();
});
it("preserves a genuine one-sheet SVG byte for byte", async () => {
  const ir = createTerminalIr([
    { uid: "native-bom", designation: "XT", terminalKeys: ["1", "2"] },
  ]);
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    index: false,
    views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(result.value.sheets).toHaveLength(1);
  expect(singleSheetSvg(result.value)).toBe(result.value.sheets[0]!.svg);
});
