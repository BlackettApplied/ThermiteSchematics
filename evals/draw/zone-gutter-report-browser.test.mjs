import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileProject } from "../../packages/compiler/dist/index.js";
import { renderSchematicPacket } from "../../packages/render/dist/sheets.js";
import { tableDrafts } from "../../packages/render/dist/packet/reports.js";
import {
  frame,
  normalizePaperPage,
} from "../../packages/render/dist/packet/page.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { textBounds, textInZoneGutter } from "./checks.mjs";

let browser, context, page;
let baseIr;

beforeAll(async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  baseIr = compiled.ir;
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
});

/** Derive a minimal witness IR from motor-starter where End A of CBL1 is
 * JB1.X1.* and the cable type description and fromLocation start with 'J'. */
function jPrefixedCableIr() {
  const ir = structuredClone(baseIr);
  const cable = ir.cables.find((c) => c.designation === "CBL1");
  const cableType = ir.cableTypes.find((t) => t.id === cable.typeId);
  cable.description = "Junction field cable; conductor 2- is spare";
  if (cableType) cableType.description = "Jacketed 2-pair shielded field cable";
  cable.fromLocation = "JB1 FIELD";
  cable.toLocation = "MAIN-PANEL";
  for (const cond of ir.cableConductors.filter((k) => k.cableUid === cable.uid))
    cond.endpoints = [cond.endpoints[1], cond.endpoints[0]];
  return ir;
}

const tabloidLandscape = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 10,
};

async function measureSheet(svg) {
  return openSheet(page, embedPrintableFont(svg));
}

describe("DQ-02 zone-gutter inset for cable and report/document views (#551)", () => {
  it("keeps cable conductors view text (JB1.X1.*, J description, JB1 location) out of the zone gutter on tabloid landscape", async () => {
    const ir = jPrefixedCableIr();
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      index: false,
      page: tabloidLandscape,
      views: [
        {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "CBL1" },
          intent: { kind: "conductors" },
          flow: "left-to-right",
        },
      ],
    });
    if (!packet.ok) throw Error(JSON.stringify(packet.error));
    const sheet = packet.value.sheets[0];
    const g = await measureSheet(sheet.svg);

    expect(textInZoneGutter(g)).toEqual([]);
    expect(textBounds(g)).toEqual([]);

    const jbLabels = g.texts.filter((t) => /^JB1\.X1\.[1-4]$/u.test(t.text));
    expect(jbLabels.length).toBe(4);
    for (const label of jbLabels)
      expect(label.bbox.x).toBeGreaterThanOrEqual(28.0);

    // Negative control: moving JB1.X1.1 back to x=28 (field left edge without inset)
    // must fail DQ-02 text-in-zone-gutter.
    const uninsetSvg = sheet.svg.replace(
      /(<text\b[^>]*\bx=")28\.5("[^>]*>JB1\.X1\.1<\/text>)/u,
      "$128$2",
    );
    expect(uninsetSvg).not.toBe(sheet.svg);
    const bad = await measureSheet(uninsetSvg);
    expect(textInZoneGutter(bad)).toContainEqual(
      expect.objectContaining({
        kind: "text-in-zone-gutter",
        text: "JB1.X1.1",
        reason: "non-continuation-in-gutter",
      }),
    );
  });

  it("keeps J-prefixed circuit headings/notes and wiring titles/notes out of the zone gutter", async () => {
    const ir = jPrefixedCableIr();
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      index: false,
      page: tabloidLandscape,
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "JB1 field circuits",
          flow: "left-to-right",
          notes: ["JB1 field terminal check before energization."],
          groups: [
            {
              id: "jb1-permissive",
              label: "JB1 permissive circuit",
              functions: [
                {
                  device: { by: "designation", value: "JB1" },
                  key: "terminal1",
                },
                {
                  device: { by: "designation", value: "LS1" },
                  key: "contact13",
                },
                {
                  device: { by: "designation", value: "JB1" },
                  key: "terminal2",
                },
              ],
              conductors: ["W-FLD-001", "W-FLD-002"],
            },
          ],
        },
        {
          format: "wiring-view-request/0.1",
          title: "JB1 field wiring",
          notes: ["JB1 field wiring check note."],
          conductors: ["W-FLD-001", "W-FLD-002"],
        },
      ],
    });
    if (!packet.ok) throw Error(JSON.stringify(packet.error));

    for (const sheet of packet.value.sheets) {
      const g = await measureSheet(sheet.svg);
      expect(
        textInZoneGutter(g),
        `sheet ${sheet.number} (${JSON.stringify(sheet.view)})`,
      ).toEqual([]);
      expect(
        textBounds(g),
        `sheet ${sheet.number} (${JSON.stringify(sheet.view)})`,
      ).toEqual([]);
    }
  });

  it("keeps J-prefixed documentation report titles and report notes out of the zone gutter", async () => {
    const ir = jPrefixedCableIr();
    const paper = normalizePaperPage(tabloidLandscape);
    if (!paper.ok) throw Error(JSON.stringify(paper.error));
    const report = tableDrafts(
      ir,
      {
        kind: "cables",
        title: "Junction box cable schedule",
        columns: ["Cable", "From", "To"],
        widths: [0.3, 0.35, 0.35],
        notes: ["JB1 field schedule note."],
        rows: [
          {
            key: "cbl1",
            cells: ["CBL1", "JB1.X1.1", "TB1.2"],
            deviceUids: [],
          },
        ],
      },
      undefined,
      paper.value,
    );
    if (!report.ok) throw Error(JSON.stringify(report.error));
    const reportSvg = frame(report.value[0], paper.value, 1, 1);
    const reportGeo = await measureSheet(reportSvg);
    expect(textInZoneGutter(reportGeo)).toEqual([]);
    expect(textBounds(reportGeo)).toEqual([]);
  });

  it("keeps paginated circuit continuation rows starting with J out of the zone gutter", async () => {
    const compiled = await compileProject("examples/circuit-pagination");
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const request = JSON.parse(
      await readFile("examples/circuit-pagination/packet.json", "utf8"),
    );
    const ir = structuredClone(compiled.ir);
    // Rename all contacts/terminals starting at C6..C18 to J-prefixed designations
    // (same 2-3 char width) so paginated split terminals in the continuation block start with 'J'.
    for (const d of ir.devices) {
      if (/^C\d+$/u.test(d.designation))
        d.designation = d.designation.replace(/^C/u, "J");
    }
    for (const fn of request.views[0].groups[0].functions) {
      if (/^C\d+$/u.test(fn.device.value))
        fn.device.value = fn.device.value.replace(/^C/u, "J");
    }
    request.index = false;
    request.views[0].title = "J-series paginated circuit";
    request.views[0].groups[0].label = "J-series contact chain";
    delete request.views[0].groups[0].lineReference;
    request.views[0].notes = ["J-series note: no contact joins physical nets."];

    const packet = await renderSchematicPacket(ir, request);
    if (!packet.ok) throw Error(JSON.stringify(packet.error));
    const contSheets = packet.value.sheets.filter(
      (s) => (s.circuitContinuations?.length ?? 0) > 0,
    );
    expect(contSheets.length).toBeGreaterThan(0);

    let sawJContinuation = false;
    for (const sheet of contSheets) {
      const g = await measureSheet(sheet.svg);
      if (g.texts.some((t) => /^J\d+\./u.test(t.text))) sawJContinuation = true;
      expect(textInZoneGutter(g), `sheet ${sheet.number}`).toEqual([]);
      expect(textBounds(g), `sheet ${sheet.number}`).toEqual([]);
    }
    expect(sawJContinuation).toBe(true);
  });
});
