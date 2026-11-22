import { expect, it } from "vitest";
import { DOMParser } from "linkedom";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { continuationFixture } from "../../render/test/continuation-fixtures.js";
import { control, flows } from "../../render/test/off-view-fixtures.js";
import { packetPdf } from "../src/alpha-pdf.js";
import { browserPath } from "./helpers/pdf-raster.js";
import {
  assertContinuationBrowser,
  assertContinuationPdf,
} from "./helpers/continuation-print.js";

it.each(flows)(
  "retains complete, legible continuation rows in PDF and the available browser (%s)",
  async (flow) => {
    const c = await continuationFixture(true);
    try {
      const r = await renderSchematicPacket(c.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          control(flow),
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
      const sheet = r.value.sheets.find((s) => s.continuations.length)!,
        root = new DOMParser().parseFromString(sheet.svg, "image/svg+xml"),
        a = root.querySelector("a[data-continuation-id]")!,
        rows = [...a.querySelectorAll("text")];
      expect(sheet.number).toBe(1);
      const bytes = await packetPdf(r.value, "Physical continuation type");
      await assertContinuationPdf(bytes, rows, r.value.page.heightMm);
      if (browserPath) await assertContinuationBrowser(r.value, sheet, bytes);
    } finally {
      await c.dispose();
    }
  },
  30000,
);
