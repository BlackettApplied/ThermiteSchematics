import { expect, it } from "vitest";
import { compileProject } from "../../packages/compiler/src/index.ts";
import { renderSchematicPacket } from "../../packages/render/src/sheets.ts";
import { packetPdf } from "../../packages/cli/src/alpha-pdf.ts";
import { loadPdfBytes, pdfText } from "./pdf.mjs";
import { parseHTML } from "linkedom";

it.each(["left-to-right", "top-to-bottom"])(
  "preserves projected references, channels and cable captions in PDF extraction (%s)",
  async (flow) => {
    const compiled = await compileProject("examples/machine-demo");
    if (!compiled.ok) throw Error("compile");
    const packet = await renderSchematicPacket(compiled.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      index: true,
      views: [
        {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "CBL1" },
          intent: { kind: "conductors" },
          flow,
        },
        { format: "documentation-view-request/0.1", kind: "io" },
      ],
    });
    expect(packet.ok, JSON.stringify(packet)).toBe(true);
    if (!packet.ok) return;
    const pdf = await loadPdfBytes(
      await packetPdf(packet.value, "Synthetic print projection"),
    );
    try {
      for (const sheet of packet.value.sheets) {
        const page = await pdf.getPage(sheet.number),
          rows = await pdfText(page, pdf.fontFamilies, pdf.fontCaps);
        const extracted = rows
          .map((t) => t.text)
          .join("")
          .replace(/\s/gu, "");
        const doc = parseHTML(sheet.svg).document;
        const cells = [
          ...doc.querySelectorAll(
            '[data-report-row] [data-report-column="2"], [data-cable-type-caption]',
          ),
        ];
        expect(cells.length || sheet.view.root?.cableUid).toBeTruthy();
        if (sheet.view.root?.cableUid) {
          const cable = compiled.ir.cables.find(
            (c) => c.uid === sheet.view.root.cableUid,
          );
          const description =
            compiled.ir.cableTypes
              .find((t) => t.id === cable.typeId)
              ?.description?.trim() || "Cable type description not specified";
          expect(extracted).toContain(description.replace(/\s/gu, ""));
        }
        for (const cell of cells) {
          const expected = [...cell.querySelectorAll("text")]
            .map((t) => t.textContent)
            .join("")
            .replace(/\s/gu, "");
          expect(extracted).toContain(expected);
        }
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  },
  30000,
);
