import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { prepareWiringDrawing } from "../src/wiring.js";
import { directFixture } from "./direct-loop-fixture.js";
import { wire } from "./series-loop-fixture.js";
import { points } from "./helpers/route-quality.js";
import { required } from "./fixtures.js";

it.each([false, true])(
  "lands on fractional-header terminal rows with self-loop=%s",
  async (selfLoop) => {
    const fixture = await directFixture((model) => {
      model.objects.push(
        ...(selfLoop ? [wire(12, "TX1", "spare", "TX1", "p")] : []),
      );
      for (const type of model.types)
        type.description = "Synthetic measured tag reservation";
    });
    try {
      const drawing = await prepareWiringDrawing(fixture.ir, {
        format: "wiring-view-request/0.1",
        title: "Fractional fixed ports",
        conductors: selfLoop ? ["W10", "W11", "W12"] : ["W10", "W11"],
      });
      const doc = parseHTML(`<svg>${drawing.content}</svg>`).document;
      let measured = 0;
      for (const route of doc.querySelectorAll("[data-wiring-conductor]")) {
        const ps = points(route.querySelector("path")!.getAttribute("d")!);
        for (const [end, p] of [
          ["source", ps[0]!],
          ["target", ps.at(-1)!],
        ] as const) {
          const port = doc.querySelector(
            `[data-layout-port="${route.getAttribute(`data-layout-${end}-port`)}"]`,
          )!;
          const declaredY = Number(port.getAttribute("cy"));
          const physicalId =
            port.getAttribute("data-wiring-landing-for") ??
            port.getAttribute("data-layout-port");
          const mark = required(
            doc.querySelector(`[data-layout-port="${physicalId}"]`),
          );
          const physicalY = Number(mark.getAttribute("cy"));
          expect(physicalY).toBe(Math.round(physicalY));
          expect(
            Math.hypot(
              Number(port.getAttribute("cx")) - Number(mark.getAttribute("cx")),
              declaredY - physicalY,
            ),
          ).toBeLessThanOrEqual(Number(mark.getAttribute("r")));
          const translation = port
            .parentElement!.getAttribute("transform")!
            .match(/translate\(([-\d.]+) ([-\d.]+)\)/)!;
          expect(
            Math.hypot(
              p.x - Number(translation[1]) - Number(port.getAttribute("cx")),
              p.y - Number(translation[2]) - Number(port.getAttribute("cy")),
            ),
          ).toBeLessThan(0.0011);
          measured++;
        }
      }
      expect(measured).toBe(selfLoop ? 6 : 4);
    } finally {
      await fixture.dispose();
    }
  },
);
