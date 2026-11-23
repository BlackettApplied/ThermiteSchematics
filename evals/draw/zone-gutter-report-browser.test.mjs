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
      /(<text\b[^>]*\bx=")28\.\d+("[^>]*>JB1\.X1\.1<\/text>)/u,
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

    // Non-overhanging text keeps exact field.x (x="28"), unchanged from base.
    expect(sheet.svg).toMatch(/<text\b[^>]*\bx="28"[^>]*>CABLE CBL1<\/text>/u);
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

  it("keeps deep-overhang Thermite Math titles (𝒿 and bold faux-bold ∫) out of the zone gutter on tabloid", async () => {
    for (const title of ["𝒿 Field wiring", "∫ Field wiring"]) {
      const packet = await renderSchematicPacket(baseIr, {
        format: "schematic-packet-request/0.1",
        index: false,
        page: tabloidLandscape,
        views: [
          {
            format: "wiring-view-request/0.1",
            conductors: ["W-FLD-001", "W-FLD-002"],
            title,
          },
        ],
      });
      if (!packet.ok) throw Error(JSON.stringify(packet.error));
      const g = await measureSheet(packet.value.sheets[0].svg);
      expect(textInZoneGutter(g), title).toEqual([]);
      expect(textBounds(g), title).toEqual([]);
      const heading = g.texts.find((t) => t.text === title && t.anchor.y < 60);
      expect(heading, title).toBeDefined();
      expect(heading.bbox.x, title).toBeGreaterThanOrEqual(28.0);
    }
  });

  it("preserves letter-portrait cable End B fit width (MAIN PANEL FIELD WIRING) without avoidable R006", async () => {
    const ir = structuredClone(baseIr);
    const cable = ir.cables.find((c) => c.designation === "CBL1");
    cable.toLocation = "MAIN PANEL FIELD WIRING";
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      index: false,
      page: {
        size: "letter",
        orientation: "portrait",
        marginMm: 20.052857,
      },
      views: [
        {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "CBL1" },
          intent: { kind: "conductors" },
          flow: "left-to-right",
        },
      ],
    });
    expect(packet.ok, JSON.stringify(packet.ok ? null : packet.error)).toBe(
      true,
    );
    if (!packet.ok) return;
    expect(packet.value.sheets.length).toBe(2);
    const fieldRight = 215.9 - 20.052857 - 18;
    for (const sheet of packet.value.sheets) {
      const g = await measureSheet(sheet.svg);
      expect(textInZoneGutter(g), `sheet ${sheet.number}`).toEqual([]);
      expect(textBounds(g), `sheet ${sheet.number}`).toEqual([]);
      const endB = g.texts.find((t) => t.text === "MAIN PANEL FIELD WIRING");
      expect(endB, `sheet ${sheet.number}`).toBeDefined();
      expect(endB.bbox.x + endB.bbox.w).toBeLessThanOrEqual(fieldRight);
    }
  });

  it("measures and wraps wiring headings with bold painted ink so they never paint past fieldRight on A4", async () => {
    const title =
      "Field Terminal Connection Schedule for Main Panel and Junction Box 1 Wiring";
    for (const [marginMm, expectWrap] of [
      [10.045, false],
      [10.5, true],
    ]) {
      const fieldRight = 210 - marginMm - 18;
      const packet = await renderSchematicPacket(baseIr, {
        format: "schematic-packet-request/0.1",
        index: false,
        page: { size: "a4", orientation: "portrait", marginMm },
        views: [
          {
            format: "wiring-view-request/0.1",
            conductors: ["W-FLD-001", "W-FLD-002"],
            title,
          },
        ],
      });
      if (!packet.ok) throw Error(JSON.stringify(packet.error));
      const g = await measureSheet(packet.value.sheets[0].svg);
      expect(textInZoneGutter(g), `margin=${marginMm}`).toEqual([]);
      expect(textBounds(g), `margin=${marginMm}`).toEqual([]);
      const headingRows = g.texts
        .filter(
          (t) =>
            t.anchor.y >= 30 &&
            t.anchor.y <= 45 &&
            t.anchor.x >= 28 &&
            title.includes(t.text),
        )
        .sort((a, b) => a.anchor.y - b.anchor.y);
      expect(headingRows.length, `margin=${marginMm}`).toBeGreaterThanOrEqual(
        expectWrap ? 2 : 1,
      );
      expect(headingRows.map((t) => t.text).join(" ")).toBe(title);
      for (const row of headingRows)
        expect(
          row.bbox.x + row.bbox.w,
          `margin=${marginMm}`,
        ).toBeLessThanOrEqual(fieldRight);
    }
  });

  it("measures circuit headings with bold painted ink so they never paint past fieldRight on A4", async () => {
    const title =
      "Field Terminal Connection Schedule for Main Panel and Junction Box 1 Wiring Detail";
    for (const [marginMm, expectWrap] of [
      [14.0555, false],
      [14.2, true],
    ]) {
      const fieldRight = 210 - marginMm - 18;
      const packet = await renderSchematicPacket(baseIr, {
        format: "schematic-packet-request/0.1",
        index: false,
        page: { size: "a4", orientation: "portrait", marginMm },
        views: [
          {
            format: "circuit-view-request/0.1",
            title,
            flow: "top-to-bottom",
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
        ],
      });
      if (!packet.ok) throw Error(JSON.stringify(packet.error));
      const g = await measureSheet(packet.value.sheets[0].svg);
      expect(textInZoneGutter(g), `margin=${marginMm}`).toEqual([]);
      expect(textBounds(g), `margin=${marginMm}`).toEqual([]);
      const headingRows = g.texts
        .filter(
          (t) =>
            t.anchor.y >= 34 &&
            t.anchor.y <= 50 &&
            t.anchor.x >= 32 &&
            title.includes(t.text),
        )
        .sort((a, b) => a.anchor.y - b.anchor.y);
      expect(headingRows.length, `margin=${marginMm}`).toBeGreaterThanOrEqual(
        expectWrap ? 2 : 1,
      );
      expect(headingRows.map((t) => t.text).join(" ")).toBe(title);
      for (const row of headingRows)
        expect(
          row.bbox.x + row.bbox.w,
          `margin=${marginMm}`,
        ).toBeLessThanOrEqual(fieldRight);
    }
  });

  it("fits letter-landscape wiring title by painted ink without trailing-advance R006 refusal", async () => {
    const title =
      "Field Terminal Connection Schedule for the Main Panel and Junction Box 1 / Cabinet Local and Remote Field Panel";
    const marginMm = 8.7666;
    const fieldRight = 279.4 - marginMm - 18;
    const packet = await renderSchematicPacket(baseIr, {
      format: "schematic-packet-request/0.1",
      index: false,
      page: { size: "letter", orientation: "landscape", marginMm },
      views: [
        {
          format: "wiring-view-request/0.1",
          title,
          conductors: ["W-FLD-001", "W-FLD-002"],
          notes: [
            "Inspect the field panel and junction box terminal identification against the drawing. Inspect the field panel and junction box terminal identification against the drawing. Inspect the field panel and junction box terminal identification against the drawing.",
          ],
        },
      ],
    });
    expect(packet.ok, JSON.stringify(packet.ok ? null : packet.error)).toBe(
      true,
    );
    if (!packet.ok) return;
    expect(packet.value.sheets.length).toBe(5);
    const g = await measureSheet(packet.value.sheets[0].svg);
    expect(textInZoneGutter(g)).toEqual([]);
    expect(textBounds(g)).toEqual([]);
    const heading = g.texts.find((t) => t.text === title && t.anchor.y < 60);
    expect(heading).toBeDefined();
    expect(heading.bbox.x + heading.bbox.w).toBeLessThanOrEqual(fieldRight);
  });

  it("keeps graphical terminal-strip fragment headings starting with 𝒿 out of the zone gutter", async () => {
    const ir = structuredClone(baseIr);
    ir.devices.find((d) => d.designation === "JB1").designation = "𝒿B1";
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      index: false,
      page: tabloidLandscape,
      views: [
        {
          format: "documentation-view-request/0.1",
          kind: "terminals",
          device: "𝒿B1",
        },
      ],
    });
    if (!packet.ok) throw Error(JSON.stringify(packet.error));
    const stripSheet = packet.value.sheets.find(
      (s) => s.view.kind === "terminal-strip",
    );
    expect(stripSheet).toBeDefined();
    const g = await measureSheet(stripSheet.svg);
    expect(textInZoneGutter(g)).toEqual([]);
    expect(textBounds(g)).toEqual([]);
    const fragmentHeading = g.texts.find((t) => t.text.startsWith("𝒿B1 —"));
    expect(fragmentHeading).toBeDefined();
    expect(fragmentHeading.bbox.x).toBeGreaterThanOrEqual(28.0);
  });

  it("keeps paginated graphical terminal-strip order markers starting with 𝒿 out of the zone gutter", async () => {
    const longIr = structuredClone(baseIr);
    const stripDev = longIr.devices.find((d) => d.designation === "JB1");
    stripDev.designation = "𝒿B1";
    const stripType = longIr.deviceTypes.find((t) => t.id === stripDev.typeId);
    const baseTerm = longIr.terminals.find(
      (t) => t.id.deviceUid === stripDev.uid,
    );
    const baseTypeTerm = stripType?.terminals[0];
    const existing = new Set(
      longIr.terminals
        .filter((t) => t.id.deviceUid === stripDev.uid)
        .map((t) => t.id.terminalKey),
    );
    for (let n = 1; n <= 48; n++) {
      const key = `T${n}`;
      if (existing.has(key)) continue;
      const term = structuredClone(baseTerm);
      term.id.terminalKey = key;
      longIr.terminals.push(term);
      if (baseTypeTerm) {
        const tt = structuredClone(baseTypeTerm);
        tt.key = key;
        stripType.terminals.push(tt);
      }
    }
    const longPacket = await renderSchematicPacket(longIr, {
      format: "schematic-packet-request/0.1",
      index: false,
      page: { size: "letter", orientation: "portrait", marginMm: 10 },
      views: [
        {
          format: "documentation-view-request/0.1",
          kind: "terminals",
          device: "𝒿B1",
        },
      ],
    });
    if (!longPacket.ok) throw Error(JSON.stringify(longPacket.error));
    const longStrips = longPacket.value.sheets.filter(
      (s) => s.view.kind === "terminal-strip",
    );
    expect(longStrips.length).toBeGreaterThanOrEqual(2);
    let sawOrderMarker = false;
    for (const s of longStrips) {
      const mg = await measureSheet(s.svg);
      const markers = mg.texts.filter((t) =>
        /^𝒿B1 continued (?:on|from) sheet /u.test(t.text),
      );
      if (markers.length) {
        sawOrderMarker = true;
        for (const m of markers)
          expect(m.bbox.x, `strip sheet ${s.number}`).toBeGreaterThanOrEqual(
            28.0,
          );
      }
      expect(textInZoneGutter(mg), `strip sheet ${s.number}`).toEqual([]);
      expect(textBounds(mg), `strip sheet ${s.number}`).toEqual([]);
    }
    expect(sawOrderMarker).toBe(true);
  });
});
