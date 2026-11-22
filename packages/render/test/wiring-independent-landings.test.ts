import { beforeAll, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { prepareWiringDrawing } from "../src/wiring.js";
import { consoleWiringFixture } from "./wiring-landings-fixture.js";
import { physicalRoutes, sharedLengths } from "./helpers/wiring-landings.js";

let source: Awaited<ReturnType<typeof consoleWiringFixture>>;
beforeAll(async () => {
  source = await consoleWiringFixture();
});

it.each([0, 3])(
  "keeps each physical conductor independent up to its one terminal mark in console view %s",
  async (index) => {
    const drawing = await prepareWiringDrawing(
      source.ir,
      source.request.views[index],
    );
    const doc = parseHTML(`<svg>${drawing.content}</svg>`).document;
    const anchors = [...doc.querySelectorAll("[data-wiring-landing-for]")];
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor.getAttribute("fill")).toBe("none");
      expect(anchor.getAttribute("stroke")).toBe("none");
      expect(Number(anchor.getAttribute("r"))).toBe(0.001);
    }
    const routes = physicalRoutes(doc, source.ir);
    expect(routes).toHaveLength(index === 0 ? 5 : 3);
    const shared: number[] = [];
    for (const [i, a] of routes.entries())
      for (const b of routes.slice(i + 1)) {
        if (a.ends.some((t) => b.ends.includes(t)))
          shared.push(...sharedLengths(a.ps, b.ps));
      }
    expect(shared).toEqual([]);
    expect(doc.querySelectorAll("circle[data-wiring-junction]")).toHaveLength(
      0,
    );
  },
);
