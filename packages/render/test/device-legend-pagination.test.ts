import { afterAll, beforeAll, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { renderSchematicPacket } from "../src/sheets.js";
import { continuationOracle } from "./continuation-oracle.js";
import { assertTagRows } from "./helpers/tag-row-source.js";
import {
  launch,
  openSheet,
  drawingContextOptions,
} from "../../../evals/draw/browser.mjs";
import { deviceTags } from "../../../evals/draw/checks.mjs";
let browser: Awaited<ReturnType<typeof launch>>, page: any;

let compiled: Extract<Awaited<ReturnType<typeof compileProject>>, { ok: true }>;
beforeAll(async () => {
  const result = await compileProject("examples/motor-starter");
  if (!result.ok) throw result;
  compiled = result;
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
const note =
  "Equipment identification and maintenance access for the process cell. Verify the labelled terminal against the installation drawing before planned maintenance.";
const request = (flow: "left-to-right" | "top-to-bottom") => ({
  format: "schematic-packet-request/0.1" as const,
  layout: "compact" as const,
  page: { size: "letter" as const, orientation: "portrait" as const },
  views: [
    {
      format: "schematic-view-request/0.1" as const,
      root: { by: "designation" as const, value: "M1" },
      family: "power" as const,
      flow,
    },
    {
      format: "schematic-view-request/0.1" as const,
      root: { by: "designation" as const, value: "K1" },
      family: "control" as const,
      flow,
    },
  ],
});
/** Read native source incidence, including paths that become whole after a
 * different legal cut. Continuation identities alone depend on composition. */
const sourceIncidences = (sheets: readonly { svg: string }[]) =>
  [
    ...new Set(
      sheets.flatMap(({ svg }) =>
        [...parseHTML(svg).document.querySelectorAll("path.net-path")].map(
          (p) =>
            JSON.stringify(
              [
                "data-wire-uid",
                "data-jumper-uid",
                "data-cable-uid",
                "data-conductor-id",
                "data-designation",
                "data-net-id",
                "data-source-device-uid",
                "data-source-terminal-key",
                "data-target-device-uid",
                "data-target-terminal-key",
              ].map((key) => p.getAttribute(key)),
            ),
        ),
      ),
    ),
  ].sort();
for (const flow of ["left-to-right", "top-to-bottom"] as const) {
  async function nativeTags() {
    const native = await renderSchematicPacket(
      compiled.ir,
      request(flow),
      compiled.presentation,
    );
    if (!native.ok) throw native;
    const originalIncidences = sourceIncidences(native.value.sheets);
    const bodyUids = new Set<string>();
    for (const sheet of native.value.sheets) {
      const measured = await openSheet(page, sheet.svg);
      for (const body of measured.devices)
        if (body.tagKind !== "reference") bodyUids.add(body.deviceUid);
    }
    return { native: native.value, originalIncidences, bodyUids };
  }
  let tags: ReturnType<typeof nativeTags> | undefined;
  it.each([2, 5])(
    `reserves readable same-sheet tags with %i copies of the authored note in ${flow} without new electrical identities`,
    async (repetitions) => {
      const { native, originalIncidences, bodyUids } = await (tags ??=
        nativeTags());
      const ir = structuredClone(compiled.ir),
        description = Array(repetitions).fill(note).join(" ");
      expect(description.length).toBeGreaterThan(repetitions === 2 ? 280 : 745);
      expect(description.length).toBeLessThan(repetitions === 2 ? 325 : 800);
      // Stress the actual body population. Reference-only devices retain their
      // authored fields, which the independent sheet oracle also requires.
      for (const device of ir.devices)
        if (bodyUids.has(device.uid)) device.description = description;
      const before = JSON.stringify(ir),
        nets = JSON.stringify(ir.nets);
      const rendered = await renderSchematicPacket(
        ir,
        request(flow),
        compiled.presentation,
      );
      if (!rendered.ok) throw Error(JSON.stringify(rendered.error));
      expect(rendered.value.sheets.length).toBeLessThanOrEqual(8); // unchanged 2× native four-sheet packet cost
      expect(JSON.stringify(ir)).toBe(before);
      expect(JSON.stringify(ir.nets)).toBe(nets);
      expect(rendered.value.coverage.counts).toEqual(native.coverage.counts);
      expect(rendered.value.coverage.conductors).toEqual(
        native.coverage.conductors,
      );
      expect(rendered.value.coverage.functions).toEqual(
        native.coverage.functions,
      );
      expect(sourceIncidences(rendered.value.sheets)).toEqual(
        originalIncidences,
      );
      expect(continuationOracle(ir, rendered.value).ends).toBeGreaterThan(0);
      for (const sheet of rendered.value.sheets) {
        const doc = parseHTML(sheet.svg).document,
          measured = await openSheet(page, sheet.svg),
          bodies = new Set(
            measured.devices
              .filter((d) => d.tagKind !== "reference")
              .map((d) => d.deviceUid),
          ),
          entries = [
            ...doc.querySelectorAll(
              '[data-device-legend-entry][data-tag-kind="legend"]',
            ),
          ];
        expect(
          deviceTags(measured, ir, sheet.references, true, sheet.view),
        ).toEqual([]);
        expect(entries).toHaveLength(bodies.size);
        expect(
          new Set(entries.map((e) => e.getAttribute("data-tag-owner-uid")))
            .size,
        ).toBe(entries.length);
        for (const entry of entries) {
          const uid = entry.getAttribute("data-tag-owner-uid"),
            device = ir.devices.find((d) => d.uid === uid)!,
            type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
          expect(entry.getAttribute("data-tag-key")).toBe(device.designation);
          expect(
            doc.querySelector(
              `text[data-tag-kind="body"][data-tag-key="${device.designation}"]`,
            )?.textContent,
          ).toBe(device.designation);
          for (const [field, value] of Object.entries({
            designation: device.designation,
            description,
            part: type.catalog?.orderNumber,
          })) {
            const rows = [
              ...entry.querySelectorAll(`text[data-tag-field="${field}"]`),
            ];
            assertTagRows(rows, value ?? "");
            for (const row of rows) {
              expect(
                Number(row.getAttribute("font-size")),
              ).toBeGreaterThanOrEqual(field === "designation" ? 2.7 : 2.5);
              expect(row.hasAttribute("textLength")).toBe(false);
            }
          }
        }
      }
    },
    120000,
  );
}

it("reports the observed plan cap for the all-device 799-character stress without inventing page-cost exhaustion", async () => {
  const ir = structuredClone(compiled.ir),
    description = Array(5).fill(note).join(" ");
  for (const d of ir.devices) d.description = description;
  const before = JSON.stringify(ir),
    result = await renderSchematicPacket(
      ir,
      request("top-to-bottom"),
      compiled.presentation,
    );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "R006", reason: "unprintable-layout" },
  });
  if (!result.ok) {
    expect(result.error.message).toContain(
      "recorded pruning at the 6 retained axis plans per search state",
    );
    expect(result.error.message).not.toContain("page-cost bound");
    expect(result.error.message).toContain(
      "final sheet of K1 / control cannot fit complete entries for PB1 (body), PS1 (reference)",
    );
    expect(result.error.message).toContain(
      "Use larger paper, another flow, or split the view.",
    );
    expect(result.error.message).not.toContain("OL1");
    expect(result.error).toMatchObject({
      root: "packet",
      details: {
        constraint: "legend-search-limit",
        searchCaps: ["axis-plans"],
        sheet: "final",
        legendEntries: [
          expect.objectContaining({ designation: "PB1", kind: "body" }),
          expect.objectContaining({ designation: "PS1", kind: "reference" }),
        ],
      },
    });
  }
  expect(JSON.stringify(ir)).toBe(before);
}, 120000);
