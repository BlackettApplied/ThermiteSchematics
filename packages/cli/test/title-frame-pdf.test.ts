import { expect, it } from "vitest";
import { compileCoreFixture } from "../../render/test/fixtures.js";
import { renderTitleFrameBenchmark } from "../../render/src/internal/title-data/entry.js";
import { renderSchematicPacket } from "@thermite/render";
import { packetPdf } from "../src/alpha-pdf.js";
it("omits packet Author on 0.3, including supplied personnel, preserving legacy Author", async () => {
  const ir = await compileCoreFixture();
  const views = [
    { format: "documentation-view-request/0.1", kind: "bom" },
  ] as const;
  for (const drawnBy of [undefined, "TEST"]) {
    const result = await renderTitleFrameBenchmark(
      ir,
      {
        format: "schematic-packet-request/0.2",
        views,
        ...(drawnBy
          ? { titleData: { defaults: { values: { drawnBy } } } }
          : {}),
      },
      { format: "project-presentation/0.3" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pdf = (
      await packetPdf(result.value, "Synthetic title fixture")
    ).toString("latin1");
    expect(pdf).not.toMatch(/\/Author\b/);
    expect(pdf).toMatch(/\/Creator \d+ 0 R/);
    expect(pdf).toMatch(/\/Producer \d+ 0 R/);
  }
  const legacy = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    views,
  });
  expect(legacy.ok).toBe(true);
  if (!legacy.ok) return;
  expect(
    (await packetPdf(legacy.value, "Synthetic legacy fixture")).toString(
      "latin1",
    ),
  ).toMatch(/\/Author \d+ 0 R/);
});
