import { expect, it } from "vitest";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  directFixture,
  directPacket,
  directView,
  flows,
  withDirectFieldStage,
} from "./direct-loop-fixture.js";

const wirings = [
  {
    name: "straight wires through a strip",
    cable: false,
    cableCross: false,
    stripCross: false,
  },
  {
    name: "crossing after a strip",
    cable: false,
    cableCross: false,
    stripCross: true,
  },
  {
    name: "straight cable assembly through a strip",
    cable: true,
    cableCross: false,
    stripCross: false,
  },
  {
    name: "crossing after a strip with a cable assembly",
    cable: true,
    cableCross: false,
    stripCross: true,
  },
  {
    name: "crossing in a cable assembly",
    cable: true,
    cableCross: true,
    stripCross: false,
  },
  {
    name: "double crossing in cable and after strip",
    cable: true,
    cableCross: true,
    stripCross: true,
  },
];

for (const wiring of wirings) {
  it.each(flows)(
    "follows the final terminal: " + wiring.name + " in %s",
    async (flow) => {
      const f = await directFixture((m) =>
        withDirectFieldStage(
          m,
          wiring.cable,
          wiring.cableCross,
          wiring.stripCross,
        ),
      );
      try {
        const before = JSON.stringify(f.ir);
        const view = directView({
          flow,
          ...(wiring.cable
            ? {
                cableAssemblies: [
                  {
                    cable: "CB1",
                    connector: "PAIR",
                    description: "Synthetic pair assembly",
                  },
                ],
              }
            : {}),
        });
        const result = await renderSchematicPacket(f.ir, directPacket(view));
        if (wiring.cableCross !== wiring.stripCross) {
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: "R006",
              reason: "unprintable-layout",
              message:
                'Packet view[0] "TX1 - signal loop": Signal loop polarity: TX1.p (loop_positive) reaches AI1.n (analog_input_0_negative); correct the wiring or the authored roles.',
            },
          });
          expect(result).not.toHaveProperty("value");
        } else {
          expect(result.ok, JSON.stringify(result)).toBe(true);
          const drawing = await prepareSignalLoopDrawing(f.ir, view);
          expect(drawing).not.toHaveProperty("engineNotes");
          expect(drawing.note).not.toContain("polarity not verified");
          if (result.ok) {
            const svg = result.value.sheets[0]!.svg;
            expect(svg).not.toContain("polarity not verified");
            expect(svg).not.toContain("data-engine-notes");
            expect(svg).toContain("TB1");
            if (wiring.cable) expect(svg).toContain("data-cable-assembly");
          }
        }
        expect(JSON.stringify(f.ir)).toBe(before);
      } finally {
        await f.dispose();
      }
    },
  );
}
