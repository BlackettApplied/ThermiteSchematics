import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import { control, flows } from "./off-view-fixtures.js";
import { continuationFixture, literalNumber } from "./continuation-fixtures.js";
import { continuationOracle } from "./continuation-oracle.js";

for (const jumpers of [false, true])
  it.each(flows)(
    `preserves ${jumpers ? "unnamed jumper provenance" : "literal printed numbers"} through physical cuts (%s)`,
    async (flow) => {
      const c = await continuationFixture(jumpers);
      try {
        const r = await renderSchematicPacket(c.ir, {
          format: "schematic-packet-request/0.1",
          views: [control(flow)],
        });
        if (!r.ok) throw Error(JSON.stringify(r.error));
        expect(continuationOracle(c.ir, r.value).ends).toBeGreaterThan(0);
        const links = r.value.sheets.flatMap((s) => s.continuations);
        expect(
          links.some((l) =>
            jumpers
              ? l.provenance?.kind === "jumper" &&
                l.provenance.uid.startsWith("15400000-") &&
                l.conductor === "JUMPER"
              : l.conductor === literalNumber,
          ),
        ).toBe(true);
      } finally {
        await c.dispose();
      }
    },
    30000,
  );

it("refuses an indivisible protected long-ID span with its identity and shortfall", async () => {
  const label = "WIRE-" + "W".repeat(512);
  const c = await continuationFixture(false, label);
  try {
    const r = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      views: [control()],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw Error("Expected a complete refusal");
    expect(r.error.code).toBe("R006");
    expect(r.error.message).toContain(label);
    expect(r.error.message).toMatch(/by [\d.]+ mm/u);
    expect(r.error.message).toContain("larger sheet");
  } finally {
    await c.dispose();
  }
}, 30000);
