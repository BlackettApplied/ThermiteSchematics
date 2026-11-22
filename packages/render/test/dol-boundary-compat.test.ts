import { expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import { renderSchematicPacket, renderSchematicSheets } from "../src/sheets.js";
import { dolProbeFixture } from "./dol-control-probes-fixture.js";
import { actuation, flows } from "./dol-control-junctions-fixture.js";
import diagnostics from "../../core-library/test/fixtures/transformer-control/p7-diagnostics.json";

// P7 is deliberately only a compatibility probe: its transformer waveform is
// unassessed against K1's DC rating. No printed circuit or page count is golden.
it.each(["R1", "K1"].flatMap((root) => flows.map((flow) => ({ root, flow }))))(
  "preserves the P7 diagnostic and truthful printable outcome for $root in $flow",
  async ({ root, flow }) => {
    const f = await dolProbeFixture("p7");
    try {
      expect(f.diagnostics).toEqual(diagnostics);
      const before = JSON.stringify(f.ir);
      const request = actuation(root, flow);
      const continuous = await renderSchematic(f.ir, request);
      expect(continuous.ok, JSON.stringify(continuous)).toBe(true);
      const result = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        page: { size: "tabloid", orientation: "landscape", marginMm: 10 },
        layout: "standard",
        views: [request],
      });
      if (root !== "R1" || flow !== "top-to-bottom")
        expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) {
        expect(result.error.code).toBe("R006");
        expect(result.error.message).toContain(
          "Continuation labels are too close to print clearly",
        );
        expect(result.error.details).toMatchObject({
          boundaryCutRetry: {
            continuationSpacing: { minimumMm: 18 },
            conductorIds: [{ kind: "wire" }, { kind: "wire" }],
          },
          compactLayoutAvailable: true,
        });
        expect(result.error.message).toContain(
          "presentation-only boundary segment",
        );
        expect(result.error.message).toContain("must remain uncut");
        expect(result.error.message).not.toContain(
          "Provide a usable authored printed identity",
        );
        const single = await renderSchematicSheets(f.ir, request);
        expect(single).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            details: {
              boundaryCutRetry: result.error.details?.boundaryCutRetry,
              diagnosticContext: {
                views: [{ viewIndex: 0, title: "R1 / control" }],
              },
            },
          },
        });
      } else {
        const authored = new Set(f.ir.wires.map((w) => w.uid));
        for (const sheet of result.value.sheets)
          for (const link of sheet.continuations)
            if (link.provenance?.kind === "wire")
              expect(authored.has(link.provenance.uid)).toBe(true);
      }
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  },
);
