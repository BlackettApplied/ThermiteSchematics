import { expect } from "vitest";
import { parseHTML } from "linkedom";
import { prepareCircuitView } from "../src/circuit.js";
import { directFixture } from "./direct-loop-fixture.js";
import { wire } from "./series-loop-fixture.js";

export async function assertAttachmentWeights(
  flow: "left-to-right" | "top-to-bottom",
) {
  const f = await directFixture((m) => {
    m.types[1].description =
      "Synthetic relay with a deliberately tall tag field " +
      "description ".repeat(15);
    m.types[1].symbol = "thermite:relay";
    m.types[1].functions.signal = { kind: "coil", terminals: ["p", "n"] };
    m.types[2].symbol = "thermite:pushbutton";
    m.types[2].functions.input = {
      kind: "contact",
      normal_state: "open",
      terminals: ["p", "n"],
    };
    m.objects.find((o) => o.designation === "W10")!.kind = "jumper";
    m.objects.push(wire(12, "TX1", "p", "AI1", "p"));
  });
  try {
    for (const selected of [["W10"], ["W10", "W11"], ["W10", "W11", "W12"]]) {
      const result = await prepareCircuitView(f.ir, {
        format: "circuit-view-request/0.1",
        title: "Attachment weight",
        flow,
        groups: [
          {
            id: "weights",
            functions: [
              { device: { by: "designation", value: "TX1" }, key: "signal" },
              { device: { by: "designation", value: "AI1" }, key: "input" },
            ],
            conductors: selected,
          },
        ],
      });
      const doc = parseHTML(result.groups[0]!.content).document;
      const routes = [...doc.querySelectorAll("[data-circuit-conductor]")];
      const rays = [...doc.querySelectorAll("[data-terminal-attachment]")];
      expect(routes).toHaveLength(selected.length);
      expect(
        rays.filter((ray) => ray.querySelector('path[stroke="white"]')).length,
      ).toBeGreaterThan(0);
      expect(
        rays.filter((ray) => !ray.querySelector('path[stroke="white"]')).length,
      ).toBeGreaterThan(0);
      for (const mark of doc.querySelectorAll("[data-circuit-mark]"))
        expect(Number(mark.getAttribute("stroke-width"))).toBe(0.4);
      expect(doc.querySelector("[data-circuit-tag-lane]")).not.toBeNull();
      for (const ray of rays) {
        const owner = JSON.parse(ray.getAttribute("data-terminal-attachment")!);
        const incident = routes.filter((r) =>
          JSON.parse(r.getAttribute("data-endpoints")!).some(
            (t: any) =>
              JSON.stringify([t.deviceUid, t.terminalKey]) ===
              JSON.stringify(owner),
          ),
        );
        const weights = incident.map((r) =>
          Number(
            r
              .querySelector('path[stroke="#17212b"]')!
              .getAttribute("stroke-width"),
          ),
        );
        const expected = weights.length ? Math.min(...weights) : 0.35;
        expect(
          Number(
            ray
              .querySelector('path[stroke="#17212b"]')!
              .getAttribute("stroke-width"),
          ),
          `${flow} ${selected} ${owner}`,
        ).toBe(expected);
      }
    }
  } finally {
    await f.dispose();
  }
}
