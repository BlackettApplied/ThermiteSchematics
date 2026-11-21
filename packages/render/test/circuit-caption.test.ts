import { expect, it, vi } from "vitest";
import * as captions from "../src/symbols/circuit-caption.js";
import { breakerAuxiliaryFixture } from "./breaker-auxiliary-fixture.js";
import { renderSchematicPacket } from "../src/sheets.js";
it("omits a redundant caption when every owner-nearest position collides", () => {
  expect(
    captions.circuitCaptionPosition(
      "NC",
      { x: 10, y: 10, bounds: { left: 8, right: 12, top: 6, bottom: 14 } },
      [],
      [],
      [{ left: 0, right: 20, top: 0, bottom: 20 }],
      20,
      20,
    ),
  ).toBeUndefined();
});
it("keeps the view and authored contact marks, with W907, when captions cannot fit", async () => {
  const f = await breakerAuxiliaryFixture();
  const original = captions.emitCircuitContactCaption;
  const spy = vi
    .spyOn(captions, "emitCircuitContactCaption")
    .mockImplementation((c) =>
      original({
        ...c,
        occupied: [{ left: 0, right: c.width, top: 0, bottom: c.height }],
      }),
    );
  try {
    const r = await renderSchematicPacket(f.ir, f.request);
    if (!r.ok) throw Error(JSON.stringify(r));
    expect(
      r.value.coverage.diagnostics?.filter((d) => d.code === "W907"),
    ).toHaveLength(2);
    expect(r.value.sheets[0]!.svg).not.toContain("data-contact-caption=");
    expect(r.value.sheets[0]!.svg).toContain('data-circuit-mark="contact-nc"');
    expect(r.value.sheets[0]!.svg).toContain('data-circuit-mark="contact-no"');
  } finally {
    spy.mockRestore();
    await f.dispose();
  }
});
