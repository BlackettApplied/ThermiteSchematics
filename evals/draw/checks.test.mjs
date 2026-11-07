import { describe, expect, it } from "vitest";
import * as c from "./checks.mjs";
import { straightPath } from "./path.mjs";
import { criteria } from "./criteria.mjs";
import { exitCode, summary } from "./assessment.mjs";
import { canonical, json } from "./support.mjs";
import { cases } from "./corpus.mjs";
import { fileURLToPath } from "node:url";
import { evaluateSheet, sweepResults } from "./evaluate.mjs";
const bbox = { x: 20, y: 30, w: 10, h: 3 };
const text = (text = "K1", extra = {}) => ({
  element: "text-1",
  text,
  bbox,
  font: "Noto Sans",
  fontSize: 2.6,
  role: "",
  ...extra,
});
const geometry = (extra = {}) => ({
  width: 432,
  height: 279,
  texts: [],
  terminals: [],
  devices: [],
  shapes: [],
  catalogs: [],
  reportRows: [],
  ...extra,
});
const primitive = (points, extra = {}) => ({
  element: "line-1",
  points,
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  stroke: 0.35,
  fill: "none",
  dash: "none",
  cls: "",
  ...extra,
});
const ir = { functions: [], devices: [], nets: [] };
// Every mandatory automation predicate has a clean control and a seeded defect.
// These tests use no browser, PDF renderer, engine build, or subprocess.
describe("mandatory DQ mutation kills", () => {
  it("DQ-01 kills missing raster ink even when extracted text is present", () => {
    const t = {
      ...text("OL1"),
      svgInk: 40,
      pdfInk: 42,
      backend: "PDFKit",
      extractedText: "OL1",
    };
    expect(c.labelParity([t])).toEqual([]);
    expect(c.labelParity([{ ...t, pdfInk: 0 }])[0].kind).toBe(
      "missing-raster-label",
    );
  });
  it("DQ-02 kills wide-label cell overflow and text collisions", () => {
    const t = text("WWWW", { cell: { x: 19, y: 29, w: 12, h: 6 } });
    expect(c.textBounds(geometry({ texts: [t] }))).toEqual([]);
    expect(
      c.textBounds(geometry({ texts: [{ ...t, bbox: { ...bbox, w: 76 } }] }))[0]
        .kind,
    ).toBe("text-outside-cell");
    expect(
      c
        .textBounds(
          geometry({ texts: [t, text("OL1", { element: "text-2" })] }),
        )
        .some((x) => x.kind === "text-text-overlap"),
    ).toBe(true);
  });
  it("DQ-03 kills a bar joining independent source ports and a solid spanning fill", () => {
    const symbol = {
      element: "source",
      designation: "SRC1",
      bbox,
      ports: [
        { terminal: "L1", net: "n1", point: { x: 0, y: 0 } },
        { terminal: "L2", net: "n2", point: { x: 0, y: 10 } },
      ],
      shapes: [
        primitive([
          { x: 0, y: 0 },
          { x: 3, y: 0 },
        ]),
        primitive([
          { x: 0, y: 10 },
          { x: 3, y: 10 },
        ]),
      ],
    };
    expect(c.symbolIsolation([symbol])).toEqual([]);
    expect(
      c.symbolIsolation([
        {
          ...symbol,
          shapes: [
            ...symbol.shapes,
            primitive([
              { x: 0, y: 0 },
              { x: 0, y: 10 },
            ]),
          ],
        },
      ]),
    ).toHaveLength(1);
    const fill = primitive(
      [
        { x: -1, y: -1 },
        { x: 2, y: -1 },
        { x: 2, y: 12 },
        { x: -1, y: 12 },
        { x: -1, y: -1 },
      ],
      { stroke: 0, fill: "rgb(0, 0, 0)" },
    );
    expect(c.symbolIsolation([{ ...symbol, shapes: [fill] }])).toHaveLength(1);
    expect(
      c.symbolIsolation([
        {
          ...symbol,
          ports: symbol.ports.map((p) => ({ ...p, net: "same-net" })),
          shapes: [fill],
        },
      ]),
    ).toEqual([]);
  });
  it("DQ-05 kills an internal caption while allowing derived coil/NO facts", () => {
    const data = {
      ...ir,
      functions: [
        { id: { functionKey: "pole1" } },
        { id: { functionKey: "coil" } },
      ],
    };
    expect(
      c.functionKeys(geometry({ texts: [text("NO"), text("coil")] }), data),
    ).toEqual([]);
    expect(
      c.functionKeys(geometry({ texts: [text("pole1 NC")] }), data)[0].key,
    ).toBe("pole1");
    expect(
      c.functionKeys(
        geometry({ texts: [text("buzzer", { deviceUid: "SL1" })] }),
        {
          ...ir,
          functions: [{ id: { functionKey: "buzzer" } }],
          terminals: [{ id: { deviceUid: "SL1", terminalKey: "buzzer" } }],
        },
      ),
    ).toEqual([]);
  });
  it("preserves wrapped authored descriptions that coincide with function keys", () => {
    const data = {
      ...ir,
      devices: [{ uid: "s", description: "Lamp with installed buzzer." }],
      functions: [{ id: { functionKey: "buzzer" } }],
    };
    expect(
      c.functionKeys(
        geometry({ texts: [text("buzzer", { deviceUid: "s" })] }),
        data,
      ),
    ).toEqual([]);
    expect(
      c.functionKeys(
        geometry({
          texts: [text("buzzer", { deviceUid: "s", role: "label-function" })],
        }),
        data,
      ),
    ).toHaveLength(1);
  });
  it("DQ-06 kills a lost authored description without inventing a rating", () => {
    const data = {
        ...ir,
        devices: [
          { uid: "d", designation: "K1", description: "Feed contactor" },
        ],
      },
      refs = [{ deviceUid: "d", xMm: 25, yMm: 30 }];
    expect(
      c.deviceTags(
        geometry({ texts: [text("K1"), text("Feed contactor")] }),
        data,
        refs,
        true,
      ),
    ).toEqual([]);
    expect(
      c.deviceTags(geometry({ texts: [text("K1")] }), data, refs, true)[0]
        .missing,
    ).toEqual(["authored description"]);
  });
  it("DQ-10 kills reversed phase order in both flows and rotated qualifiers", () => {
    const ports = ["L1", "L2", "L3", "PE"].map((terminal, i) => ({
      terminal,
      deviceUid: "src",
      point: { x: i * 5, y: i * 5 },
      bbox,
      element: terminal,
    }));
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      expect(c.phaseOrder(geometry({ terminals: ports }), flow)).toEqual([]);
      expect(
        c.phaseOrder(
          geometry({
            terminals: ports.map((p, i) => ({
              ...p,
              point: { x: 20 - i * 5, y: 20 - i * 5 },
            })),
          }),
          flow,
        ),
      ).toHaveLength(1);
    }
    expect(
      c.phaseOrder(
        geometry({ texts: [text("~", { angle: 90 })] }),
        "top-to-bottom",
      )[0].kind,
    ).toBe("rotated-qualifier");
  });
  it("DQ-13 kills reversed stroke hierarchy and a two-ray filled dot", () => {
    const wire = primitive(
        [
          { x: 0, y: 5 },
          { x: 10, y: 5 },
        ],
        { conductor: true, stroke: 0.4 },
      ),
      outline = primitive(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        { outline: true, stroke: 0.2 },
      );
    expect(c.strokesAndDots(geometry({ shapes: [wire, outline] }))).toEqual([]);
    expect(
      c.strokesAndDots(
        geometry({ shapes: [wire, { ...outline, stroke: 0.6 }] }),
      )[0].kind,
    ).toBe("outline-heavier-than-conductor");
    const dot = primitive([], {
      bbox: { x: 4.5, y: 4.5, w: 1, h: 1 },
      cls: "junction-dot",
      fill: "black",
    });
    expect(c.strokesAndDots(geometry({ shapes: [wire, dot] }))[0].kind).toBe(
      "filled-dot-without-three-way-junction",
    );
    expect(
      c.strokesAndDots(
        geometry({
          shapes: [
            wire,
            dot,
            primitive(
              [
                { x: 5, y: 5 },
                { x: 5, y: 10 },
              ],
              { conductor: true },
            ),
          ],
        }),
      ),
    ).toEqual([]);
  });
  it("DQ-17 kills duplicated and overlapping terminal labels", () => {
    const t = text("L1", { terminal: "L1", deviceUid: "s" });
    expect(c.terminalText(geometry({ texts: [t] }))).toEqual([]);
    expect(
      c.terminalText(
        geometry({
          texts: [
            t,
            {
              ...t,
              element: "net-label",
              role: "label-net",
              bbox: { ...bbox, x: bbox.x + 10 },
            },
          ],
        }),
      ),
    ).toHaveLength(1);
    expect(
      c.terminalText(geometry({ texts: [t, { ...t, element: "duplicate" }] })),
    ).toHaveLength(1);
    expect(
      c.terminalText(
        geometry({ texts: [text("PE PE", { terminal: "PE" })] }),
      )[0].kind,
    ).toBe("duplicate-terminal-caption");
  });
  it("DQ-18 kills a missing revision table", () => {
    const t = text(
      "DWG No 1 Drawn Checked Approved Customer REV A Revision history",
      { bbox: { x: 20, y: 245, w: 350, h: 3 } },
    );
    expect(c.titleFields(geometry({ texts: [t] }))).toEqual([]);
    expect(
      c.titleFields(
        geometry({
          texts: [{ ...t, text: t.text.replace("Revision history", "") }],
        }),
      )[0].missing,
    ).toEqual(["revisionHistory"]);
  });
  it("DQ-20 kills a second font or catalog in a packet", () => {
    const g = geometry({ texts: [text()], catalogs: ["circuit"] });
    expect(c.packetStyle([g, g])).toEqual([]);
    expect(
      c.packetStyle([
        g,
        geometry({ texts: [text("K2", { font: "monospace" })] }),
      ]),
    ).toHaveLength(1);
    expect(c.packetStyle([g, geometry({ catalogs: ["ais"] })])).toHaveLength(1);
  });
  it("DQ-21 kills a font advance substitution with synthetic PDF text positions", () => {
    const t = text("WWWW"),
      pdf = [{ text: "WWWW", bbox }];
    expect(c.fontMetrics([t], pdf)).toEqual([]);
    expect(
      c.fontMetrics([t], [{ ...pdf[0], bbox: { ...bbox, w: 15 } }])[0].deltaMm,
    ).toBe(5);
  });
});
describe("route geometry without sampling artefacts", () => {
  it("reads transformed orthogonal SVG vertices and rejects curved or disjoint paths", () => {
    expect(straightPath("M 0 0 H 10 V 10")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(straightPath("m 1 2 3 4 h -1 v 2")).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 6 },
      { x: 3, y: 6 },
      { x: 3, y: 8 },
    ]);
    expect(straightPath("M0 0 C 0 2 3 4 5 6")).toBeNull();
    expect(straightPath("M0 0 L2 0 M4 0 L6 0")).toBeNull();
    const shape = primitive(
      [
        { x: 0, y: 0 },
        { x: 9.9, y: 0 },
        { x: 10, y: 0.1 },
        { x: 10, y: 10 },
      ],
      {
        conductor: true,
        routePath: "M0 0 H10 V10",
        routeMatrix: [1, 0, 0, 1, 0, 0],
      },
    );
    expect(c.routeQuality(geometry({ shapes: [shape] }))).toEqual([]);
    expect(
      c
        .routeQuality(
          geometry({
            shapes: [{ ...shape, routePath: "M0 0 H10 V1 H20 V11" }],
          }),
        )
        .some((f) => f.kind === "jog-under-3mm"),
    ).toBe(true);
  });
  it("detects double landings from conductor identities and shared final strokes", () => {
    const terminal = {
      deviceUid: "d",
      terminal: "1",
      point: { x: 0, y: 0 },
      bbox,
      element: "terminal",
    };
    const wire = (id, points) =>
      primitive(points, {
        conductor: true,
        wire: id,
        endpoints: [{ deviceUid: "d", terminalKey: "1" }],
      });
    expect(
      c.doubleLandings(
        geometry({
          terminals: [terminal],
          shapes: [
            wire("w1", [
              { x: 0, y: 0 },
              { x: 5, y: 0 },
            ]),
            wire("w2", [
              { x: 0, y: 0 },
              { x: 0, y: 5 },
            ]),
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      c.doubleLandings(
        geometry({
          terminals: [terminal],
          shapes: [
            wire("w1", [
              { x: 0, y: 0 },
              { x: 5, y: 0 },
            ]),
            wire("w2", [
              { x: 0, y: 0 },
              { x: 8, y: 0 },
            ]),
          ],
        }),
      )[0].kind,
    ).toBe("merged-double-landing");
  });
});
it("reconciles report source row identities and multiplicities without guessing filter membership", () => {
  const table = { kind: "wires", rows: [{ key: "w1" }, { key: "w2" }] },
    packet = { sheets: [{ view: { kind: "wires" } }] };
  expect(
    c.reportInventory(table, packet, [geometry({ reportRows: ["w1", "w2"] })]),
  ).toEqual([]);
  expect(
    c.reportInventory(table, packet, [
      geometry({ reportRows: ["w1", "w1"] }),
    ])[0].differences,
  ).toEqual([
    { key: "w1", expected: 1, actual: 2 },
    { key: "w2", expected: 1, actual: 0 },
  ]);
});
it("checks both printed ends of a repeated same-sheet continuation ID", () => {
  const continuation = { id: "C001", toSheet: 1, conductor: "W1", netId: "n" },
    sheet = { number: 1, continuations: [continuation, continuation] },
    packet = { sheets: [] };
  packet.sheets = [sheet];
  const texts = [
    text("C001 / 01.A1 W1"),
    text("C001 / 01", { element: "other-end", bbox: { ...bbox, y: 100 } }),
  ];
  expect(c.continuations(sheet, packet, geometry({ texts }))).toHaveLength(1);
  expect(c.continuations(sheet, packet, geometry({ texts }))[0].element).toBe(
    "other-end",
  );
  expect(
    c.continuations(
      { ...sheet, continuations: [continuation] },
      packet,
      geometry({ texts: [text("C001 / 99.A1 W1")] }),
    )[0].missing,
  ).toContain("printed sheet.zone");
});
describe("corpus and sweep inventory", () => {
  it("validates only the manifest shape and case inventory, never live source bytes", async () => {
    const manifest = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(new URL("./corpus/manifest.json", import.meta.url), "utf8"),
    );
    expect(manifest.casesSha256).toBe(
      (await import("./support.mjs")).hash(json(cases())),
    );
    expect(
      Object.values(manifest.files).every((v) => /^[a-f0-9]{64}$/.test(v)),
    ).toBe(true);
  });
  it("has exactly 36 paired sweep cells plus frozen feature cases", () => {
    expect(cases().filter((c) => c.sweep)).toHaveLength(72);
    expect(new Set(cases().map((c) => c.id)).size).toBe(cases().length);
    expect(cases(true).some((c) => c.id.startsWith("ea-f3"))).toBe(true);
  });
  it("covers every DQ even when a check needs a missing export", () => {
    const spec = { id: "test", flow: "left-to-right" },
      sheet = {
        number: 1,
        view: { format: "documentation-view/0.1", kind: "wires" },
        references: [],
        continuations: [],
      };
    const rows = evaluateSheet(
      spec,
      sheet,
      { sheets: [sheet] },
      geometry(),
      ir,
      [],
      [],
      [],
    );
    const dqs = new Set(rows.map((r) => r.dq));
    expect(dqs.has("DQ-20")).toBe(false); // packet-level check
    expect(dqs.size).toBe(23);
    expect(Object.keys(summary(rows))).toHaveLength(24);
    expect(Object.keys(criteria)).toEqual(Object.keys(summary(rows)));
  });
  it("verifies rather than repeats an R006 remedy", () => {
    const spec = {
      id: "cell-top-to-bottom",
      flow: "top-to-bottom",
      sweep: { project: "motor" },
    };
    const results = [
      {
        case: "cell-left-to-right",
        ok: true,
        spec: { ...spec, flow: "left-to-right" },
      },
      { case: spec.id, ok: false, spec, error: { code: "R006" } },
    ];
    expect(sweepResults([spec], results)[0].status).toBe("fail");
    results.push({
      case: "executed-compact",
      ok: true,
      spec: { ...spec, sweep: { project: "motor", layout: "compact" } },
    });
    expect(sweepResults([spec], results)[0].status).toBe("pass");
    expect(
      sweepResults([spec], results)[0].evidence.verifiedRemedies,
    ).toContain("executed-compact");
  });
  it("sorts keys and rounds coordinates without a time-dependent report field", () => {
    expect(json({ b: 1, a: 1.234567 })).toBe(json({ a: 1.234567, b: 1 }));
    expect(canonical({ x: -0.00001 })).toEqual({ x: -0 });
  });
});

it("rejects missing report cell geometry instead of treating overflow as fixed", () => {
  expect(() =>
    c.requireReportCells(
      geometry({ texts: [text("W1", { row: "source-wire", cell: bbox })] }),
    ),
  ).not.toThrow();
  expect(() =>
    c.requireReportCells(
      geometry({ texts: [text("W1", { row: "source-wire" })] }),
    ),
  ).toThrow(/independently measured cell/);
});

it("checks null placeholders in the whole cell, including after wrapping", () => {
  const sheet = { view: { kind: "io-ports" } },
    packet = { sheets: [] };
  const wrapped = geometry({
    reportRows: ["R1/X3"],
    texts: [
      text("No assembly; mapping", { row: "R1/X3", cell: bbox }),
      text("unspecified", { element: "text-2", row: "R1/X3", cell: bbox }),
    ],
  });
  expect(c.reports(wrapped, sheet, packet)).toEqual([]);
  const missing = geometry({
    reportRows: ["R1/X3"],
    texts: [text("unspecified", { row: "R1/X3", cell: bbox })],
  });
  expect(c.reports(missing, sheet, packet)[0].kind).toBe(
    "report-null-placeholder",
  );
});

it("preserves query-defined null subfields without confusing visual line wraps", () => {
  const sheet = { view: { kind: "assemblies" } },
    packet = { sheets: [] };
  const table = { rows: [{ key: "R1/X3", cells: ["R1.X3\nUnspecified"] }] };
  const g = geometry({
    reportRows: ["R1/X3"],
    texts: [
      text("R1.X3", { row: "R1/X3", columnIndex: 0, cell: bbox }),
      text("Unspecified", {
        element: "text-2",
        row: "R1/X3",
        columnIndex: 0,
        cell: bbox,
      }),
    ],
  });
  expect(c.reports(g, sheet, packet, table)[0].kind).toBe(
    "report-null-placeholder",
  );
  const wrapped = {
    ...g,
    texts: [
      text("No assembly; mapping", {
        row: "R1/X3",
        columnIndex: 0,
        cell: bbox,
      }),
      text("unspecified", {
        element: "text-2",
        row: "R1/X3",
        columnIndex: 0,
        cell: bbox,
      }),
    ],
  };
  expect(
    c.reports(wrapped, sheet, packet, {
      rows: [{ key: "R1/X3", cells: ["No assembly; mapping unspecified"] }],
    }),
  ).toEqual([]);
  expect(
    c.reports({ ...g, texts: g.texts.slice(0, 1) }, sheet, packet, table),
  ).toEqual([]);
});
