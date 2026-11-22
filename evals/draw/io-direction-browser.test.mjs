import { expect, it } from "vitest";
import { compileProject } from "../../packages/compiler/dist/index.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { renderSchematicPacket } from "../../packages/render/dist/index.js";
import { drawingContextOptions, launch, openSheet } from "./browser.mjs";
import { functionKeys } from "./checks.mjs";

it("accepts the authored conveyor channel directions in the issued I/O schedule", async () => {
  const project = await compileProject("examples/conveyor-line");
  if (!project.ok) throw Error(JSON.stringify(project.diagnostics));
  const packet = await renderSchematicPacket(project.ir, {
    format: "schematic-packet-request/0.1",
    page: { size: "tabloid", orientation: "landscape", marginMm: 10 },
    views: [
      {
        format: "documentation-view-request/0.1",
        kind: "io",
        filter: { devices: ["PX1", "PLC1"] },
      },
    ],
  });
  if (!packet.ok) throw Error(packet.error.message);
  expect(packet.value.sheets).toHaveLength(1);
  const [sheet] = packet.value.sheets;
  const browser = await launch();
  try {
    const page = await browser.newPage(drawingContextOptions);
    const geometry = await openSheet(page, embedPrintableFont(sheet.svg));
    const sensor = project.ir.devices.find(
      (device) => device.designation === "PX1",
    );
    const plc = project.ir.devices.find(
      (device) => device.designation === "PLC1",
    );
    for (const [device, key] of [
      [sensor, "output"],
      [plc, "do0"],
    ]) {
      const row = JSON.stringify([device.uid, key]);
      const cell = geometry.texts.find(
        (text) => text.row === row && text.columnIndex === 2,
      );
      expect(cell).toMatchObject({ text: "output", painted: true });
    }
    expect(functionKeys(geometry, project.ir, { sheet })).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30_000);
