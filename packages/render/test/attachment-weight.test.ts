import { directFixture } from "./direct-loop-fixture.js";
import { prepareCircuitView } from "../src/circuit.js";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { flows } from "./direct-loop-fixture.js";
import { assertAttachmentWeights } from "./attachment-weight-fixture.js";

it.each(flows)(
  "matches catalog and tag-lane rays to selected conductors in %s",
  assertAttachmentWeights,
);

it.each(flows)(
  "keeps an unused face of a shared physical terminal at symbol weight in %s",
  async (flow) => {
    const f = await directFixture((m) => {
      m.types[1].symbol = "thermite:terminal-strip";
      m.types[1].functions.signal = { kind: "bus", terminals: ["p"] };
      m.objects.find((o) => o.designation === "W10")!.kind = "jumper";
    });
    try {
      const result = await prepareCircuitView(f.ir, {
        format: "circuit-view-request/0.1",
        title: "One used face",
        flow,
        groups: [
          {
            id: "one-face",
            functions: [
              { device: { by: "designation", value: "TX1" }, key: "signal" },
            ],
            conductors: ["W10"],
          },
        ],
      });
      const uid = f.ir.devices.find((d) => d.designation === "TX1")!.uid;
      const rays = [
        ...parseHTML(result.groups[0]!.content).document.querySelectorAll(
          "[data-terminal-attachment]",
        ),
      ].filter(
        (r) =>
          JSON.parse(r.getAttribute("data-terminal-attachment")!)[0] === uid,
      );
      expect(rays).toHaveLength(2);
      expect(
        rays
          .map((r) =>
            Number(
              r
                .querySelector('path[stroke="#17212b"]')!
                .getAttribute("stroke-width"),
            ),
          )
          .sort(),
      ).toEqual([0.35, 0.55]);
    } finally {
      await f.dispose();
    }
  },
);
