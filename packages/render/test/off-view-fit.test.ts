import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket, renderSchematicSheets } from "../src/sheets.js";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { buildRootedCandidates } from "../src/packet/rooted-build.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { parseSvg } from "./off-view-fixtures.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c));
  ir = c.ir;
});
const views = (flow: "top-to-bottom" | "left-to-right") => [
  {
    format: "schematic-view-request/0.1" as const,
    family: "power" as const,
    root: { by: "designation" as const, value: "M1" },
    flow,
  },
  {
    format: "schematic-view-request/0.1" as const,
    family: "control" as const,
    root: { by: "designation" as const, value: "K1" },
    flow,
  },
];
const cases = [
  ["A", "tabloid", "landscape", "compact", "top-to-bottom", 4],
  ["B", "tabloid", "portrait", "compact", "top-to-bottom", 2],
  ["C", "a3", "landscape", "standard", "top-to-bottom", 5],
  ["D", "a3", "portrait", "compact", "top-to-bottom", 2],
  ["E", "letter", "landscape", "standard", "left-to-right", 5],
  ["F", "letter", "landscape", "compact", "left-to-right", 4],
  ["G", "letter", "portrait", "compact", "top-to-bottom", 6],
] as const;

for (const witness of cases)
  it.each([witness])(
    "keeps fit witness %s complete within its page-cost bound",
    async (name, size, orientation, layout, flow, base) => {
      const r = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        views: views(flow),
        page: { size, orientation },
        layout,
      });
      if (name === "G" && !r.ok) {
        expect(r).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            details: {
              constraint: "page-cost-bound",
              basePages: 6,
              maximumPages: 12,
            },
          },
        });
        for (const text of [
          "PS1.-",
          "W-CTL-002",
          "W-CTL-004",
          "landscape",
          "sheets",
        ])
          expect(r.error.message).toContain(text);
        return;
      }
      if (!r.ok) throw Error(JSON.stringify(r.error));
      expect(r.value.sheets.length).toBeLessThanOrEqual(2 * base);
      for (const sheet of r.value.sheets) {
        const doc = parseSvg(sheet.svg);
        expect(
          doc.querySelectorAll("[data-selected-view-notice]"),
        ).toHaveLength(1);
        expect(
          [...doc.querySelectorAll(".off-view-heading,.off-view-row")].every(
            (t) => Number(t.getAttribute("font-size")) >= 12,
          ),
        ).toBe(true);
        expect(
          doc.querySelectorAll(".off-view-annotation [textLength]"),
        ).toHaveLength(0);
      }
    },
    // The bounded F packet search took 30.6 s on Windows check.
    witness[0] === "F" ? 60000 : 30000,
  );

it("finds K1's alternate PS1.- placement after its default G reservation refuses", async () => {
  const view = views("top-to-bottom")[1]!;
  const prepared = await prepareSchematicDrawing(ir, view);
  const page = normalizePaperPage({ size: "letter", orientation: "portrait" });
  if (!prepared.ok || !page.ok) throw Error("Fixture did not prepare");
  const local = buildRootedCandidates(ir, prepared.value, page.value);
  expect(local).toMatchObject({ ok: false, error: { code: "R006" } });
  if (local.ok) throw Error("Expected secondary local constraint");
  expect(local.error.message).toContain("PS1.-");
  expect(local.error.message).toContain("W-CTL-002");
  const recovered = await renderSchematicSheets(
    ir,
    view,
    undefined,
    { size: "letter", orientation: "portrait" },
    { layout: "compact" },
  );
  if (!recovered.ok) throw Error(JSON.stringify(recovered.error));
  expect(recovered.value.sheets.length).toBeLessThanOrEqual(8);
  const text = recovered.value.sheets.map((s) => s.svg).join("");
  expect(text).toContain("W-CTL-004 → TB1.4");
});
