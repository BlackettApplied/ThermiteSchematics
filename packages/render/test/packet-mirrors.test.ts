import { expect, it } from "vitest";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import { navigationFixture } from "./packet-navigation-fixture.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";

it("prints every native contact at each full coil, with explicit undrawn status", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir, true);
    for (const [i, sheet] of f.sheets.entries()) {
      f.drafts[i]!.drawingBounds = { x: 0, y: 0, w: 240, h: 160 };
      sheet.svg = sheet.svg.replace(
        'width="120" height="80" viewBox="0 0 120 80"',
        'width="240" height="160" viewBox="0 0 240 160"',
      );
    }
    const result = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!result.ok) throw Error(JSON.stringify(result.error));
    for (const sheet of result.value.sheets) {
      const dom = parseSvg(sheet.svg);
      const table = dom.querySelector('[data-navigation-role="mirror"]')!;
      expect(
        [...table.querySelectorAll("text")].map((t) =>
          t.getAttribute("font-size"),
        ),
      ).toEqual(["3.782", ...Array(12).fill("3.502")]);
      const rows = [...dom.querySelectorAll("[data-navigation-mirror-row]")];
      expect(rows.map((row) => row.textContent)).toEqual([
        "NO1/L1–2/T1not drawn",
        "NO3/L2–4/T2not drawn",
        "NO5/L3–6/T3not drawn",
        "NO13–14not drawn",
      ]);
      expect(
        dom.querySelectorAll('[data-navigation-role="mirror"]'),
      ).toHaveLength(1);
    }
    const notices = result.value.sheets.flatMap((s) => [
      ...parseSvg(s.svg).querySelectorAll(
        '[data-navigation-role="contact-notice"] text',
      ),
    ]);
    expect(notices.map((n) => n.textContent).join(" ")).toBe(
      "Contact tables list device data; contacts not drawn in this packet are marked.",
    );
    expect(notices.every((n) => n.getAttribute("font-size") === "2.7")).toBe(
      true,
    );
  } finally {
    await source.dispose();
  }
});
