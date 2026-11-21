import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  directFixture,
  directPacket,
  directView,
  flows,
  roleFree,
} from "./direct-loop-fixture.js";

it.each(flows)(
  "a request note identical to the generated note does not launder it (%s)",
  async (flow) => {
    const f = await directFixture(roleFree);
    try {
      const generated =
        "polarity not verified: AI1 terminals p–n, TX1 terminals p–n.";
      const view = directView({ flow, notes: [generated] });
      const result = await renderSchematicPacket(f.ir, directPacket(view));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const { document } = parseHTML(result.value.sheets[0]!.svg);
      const hits = [...document.querySelectorAll("text")].filter(
        (t) => t.textContent === generated,
      );
      expect(hits.map((t) => t.getAttribute("data-authored-text"))).toEqual([
        null,
        "request-note",
      ]);
    } finally {
      await f.dispose();
    }
  },
);
