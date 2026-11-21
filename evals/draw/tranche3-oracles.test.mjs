import { expect, it } from "vitest";
import { physicalLandingAudit } from "./physical-landings.mjs";
import { wireLabelSupportAudit } from "./wire-label-support.mjs";
import {
  contactCaptionAudit,
  nativeContactRole,
} from "./contact-role-oracle.mjs";
import { conversionQualifierAudit } from "./qualifier-oracle.mjs";
import { inventoryScopeAudit } from "./inventory-scope.mjs";
import { pdfOracleTexts } from "./tranche3-media.mjs";
import { wirePlacement } from "./checks.mjs";
import { segments } from "./tranche3-geometry.mjs";
import { contactCaptionMediaAudit } from "./contact-role-media.mjs";
import { inventoryMediaObservations } from "./inventory-scope-media.mjs";
import { observation } from "./evaluate.mjs";
import { isRoleReferenceCaption } from "./contact-role-vocabulary.mjs";
import { terminalSet, functionCaption } from "./printed-vocabulary.mjs";
import {
  end,
  wire,
  landingFixture,
  labelFixture,
  contactFixture,
  qualifierFixture,
  inventoryFixture,
} from "./tranche3-fixtures.mjs";
const kinds = (a) => a.findings.map((f) => f.kind);
it.each(["NC", "NO"])(
  "N5 mutation killed: protection role cannot carry a parenthesized %s suffix",
  (state) => {
    const { g, ir } = contactFixture();
    g.texts = g.texts.slice(0, 1);
    g.texts[0].text = `Overload element 1–2 (${state})`;
    expect(kinds(contactCaptionAudit(g, ir))).toContain(
      "contact-caption-contradicts-native-role",
    );
    expect(
      isRoleReferenceCaption(
        ir,
        g.texts[0].row,
        g.texts[0].text,
        functionCaption,
        terminalSet,
      ),
    ).toBe(false);
  },
);
it.each(["Overload pole", "Protection element", "Thermal element"])(
  "N5 vocabulary mutation killed: unapproved or inferred role %s",
  (prefix) => {
    const { g, ir } = contactFixture();
    expect(
      isRoleReferenceCaption(
        ir,
        g.texts[0].row,
        `${prefix} 1–2`,
        functionCaption,
        terminalSet,
      ),
    ).toBe(false);
  },
);
it("N12 positive and mutations: complete companion states all native rows, never partial", () => {
  const x = inventoryFixture({ qualified: true }),
    g = x.geometries[0];
  g.texts[0].text = "Supplementary wire inventory — all 2 rows";
  expect(inventory(x).findings).toEqual([]);
  for (const text of [
    "Partial wire inventory — all 2 rows",
    "Supplementary wire inventory",
    "Supplementary wire inventory — all 3 rows",
  ]) {
    g.texts[0].text = text;
    expect(inventory(x).findings.length).toBeGreaterThan(0);
  }
});
it("N5 positive: mixed protection and auxiliary captions preserve per-function state", () => {
  const { g, ir } = contactFixture();
  g.texts = [
    {
      ...g.texts[0],
      row: JSON.stringify(["D", ["power", "aux"]]),
      text: "Overload element 1–2, NC contact 95–96",
    },
  ];
  expect(contactCaptionAudit(g, ir).findings).toEqual([]);
  expect(
    isRoleReferenceCaption(
      ir,
      g.texts[0].row,
      g.texts[0].text,
      functionCaption,
      terminalSet,
    ),
  ).toBe(true);
  expect(
    isRoleReferenceCaption(
      ir,
      g.texts[0].row,
      "Overload element 1–2, NO contact 95–96",
      functionCaption,
      terminalSet,
    ),
  ).toBe(false);
});
it("N3 positive: independent native landing approaches", () => {
  const { g, ir } = landingFixture();
  expect(physicalLandingAudit(g, ir).findings).toEqual([]);
});
it.each([
  ["shared trunk", () => {}],
  [
    "dot erased",
    (g) => (g.shapes = g.shapes.filter((s) => !s.cls.includes("junction-dot"))),
  ],
  ["forged success flag", (g) => (g.landingsIndependent = true)],
  ["missing painted geometry", (g) => delete g.tranche3],
  ["native wire erased", (_g, ir) => (ir.wires = [])],
  [
    "same-net wrong conductor owner",
    (g) => (g.shapes[0].endpoints = [end("Y"), end("D")]),
  ],
])("N3 mutation killed: %s", (_name, mutate) => {
  const { g, ir } = landingFixture(true);
  mutate(g, ir);
  expect(physicalLandingAudit(g, ir).findings.length).toBeGreaterThan(0);
});
it("N3 positive: a real native >=3-way terminal node permits its filled dot", () => {
  const { g, ir } = landingFixture();
  ir.wires.push(wire("C", end("X", "C"), end("D")));
  g.shapes.push({
    element: "dot",
    cls: "junction-dot",
    bbox: { x: 19.5, y: -0.5, w: 1, h: 1 },
  });
  expect(physicalLandingAudit(g, ir).findings).toEqual([]);
});
it("N3 mutation killed: free-air tee dot needs a native node, even without overlaps", () => {
  const { g, ir } = landingFixture();
  g.shapes.push({
    element: "dot",
    cls: "junction-dot",
    bbox: { x: 9.5, y: 4.5, w: 1, h: 1 },
  });
  expect(kinds(physicalLandingAudit(g, ir))).toContain(
    "junction-dot-without-native-node",
  );
});
it("N4 positive: own supporting segment is nearest", () => {
  const { g, ir } = labelFixture();
  expect(wireLabelSupportAudit(g, ir).findings).toEqual([]);
});
it("N4 mutation killed: own corner touches but the block follows a competing segment", () => {
  const { g, ir } = labelFixture(true);
  expect(wirePlacement(g)).toEqual([]);
  expect(wireLabelSupportAudit(g, ir).reviewCandidates).toHaveLength(1);
});
it.each([
  ["exchanged identity", (g) => (g.texts[0].wire = "B")],
  ["erased conductor", (g) => g.shapes.shift()],
  ["erased ink", (g) => delete g.tranche3],
  [
    "forged same-net path owner",
    (g) => (g.shapes[0].endpoints = g.shapes[1].endpoints),
  ],
  ["erased label owner", (g) => delete g.texts[0].wire],
])("N4 mutation killed: %s", (_name, mutate) => {
  const { g, ir } = labelFixture();
  mutate(g);
  expect(wireLabelSupportAudit(g, ir).findings.length).toBeGreaterThan(0);
});
it("N4 positive: an explicit measured leader can support an offset label", () => {
  const { g, ir } = labelFixture(true);
  g.tranche3.leaders = [
    {
      wire: "A",
      segments: [
        [
          { x: 10, y: 9 },
          { x: 20, y: 9 },
        ],
      ],
    },
  ];
  expect(wireLabelSupportAudit(g, ir).findings).toEqual([]);
  g.tranche3.leaders[0].segments[0][1] = { x: 10, y: 20 };
  expect(wireLabelSupportAudit(g, ir).reviewCandidates.length).toBeGreaterThan(
    0,
  );
});
it("N4 positive: valid inline plates retain the continuous owning route", () => {
  const { g, ir } = labelFixture();
  g.texts[0].bbox = { x: 8, y: 9, w: 10, h: 2 };
  g.texts[0].plate = { bbox: { x: 7, y: 8, w: 12, h: 4 } };
  const clip = { x: 0, y: 0, w: 40, h: 40 };
  g.shapes[0].stroke = 0.35;
  g.shapes[0].bbox = { x: 0, y: 10, w: 30, h: 0 };
  g.shapes[1].bbox = { x: 0, y: 30, w: 30, h: 0 };
  g.tranche3.wirePlatePaint = {
    plates: [
      {
        text: "label",
        bbox: g.texts[0].plate.bbox,
        clip,
        order: 2,
        heightMm: 4,
      },
    ],
    strokes: { A: { clip, painted: true, order: 1 } },
    markers: [],
  };
  g.tranche3.routeInk.A = [
    [
      { x: 0, y: 10 },
      { x: 7, y: 10 },
    ],
    [
      { x: 19, y: 10 },
      { x: 30, y: 10 },
    ],
  ];
  expect(wireLabelSupportAudit(g, ir).findings).toEqual([]);
});
it("N5 positive/negative: closed auxiliary remains NC; overload power is not NC contact", () => {
  const { g, ir } = contactFixture();
  const result = contactCaptionAudit(g, ir);
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0].functions[0].functionKey).toBe("power");
  g.texts.shift();
  expect(contactCaptionAudit(g, ir).findings).toEqual([]);
});
it.each([
  [
    "wrong state",
    (g) => {
      g.texts = g.texts.slice(1);
      g.texts[0].text = "NO contact 95–96";
    },
  ],
  ["missing native role", (_g, ir) => (ir.deviceTypes[0].terminals = [])],
  ["missing native function", (_g, ir) => (ir.functions = [])],
  [
    "forged caption owner",
    (g) => (g.texts[0].row = JSON.stringify(["unknown", ["power"]])),
  ],
])("N5 mutation killed: %s", (_name, mutate) => {
  const { g, ir } = contactFixture();
  mutate(g, ir);
  expect(contactCaptionAudit(g, ir).findings.length).toBeGreaterThan(0);
});
it("N5 positive: arbitrary keys/descriptions cannot imply construction or change role", () => {
  const { ir } = contactFixture(),
    fn = ir.functions[0];
  fn.id.functionKey = "unrelated";
  ir.deviceTypes[0].description = "Electronic thermal device";
  expect(nativeContactRole(ir, fn)).toEqual({ role: "overload" });
  const { g, ir: source } = contactFixture();
  g.texts[0].text = "Function role unspecified";
  expect(contactCaptionAudit(g, source).findings).toEqual([]);
});
it("N5 PDF mutation killed: spatial field projection retains changed NC/NO text", () => {
  const { g } = contactFixture();
  g.reportCells = [{ ...g.texts[0] }];
  g.pdfTexts = [{ text: "NO contact 1–2", bbox: { x: 1, y: 0, w: 20, h: 3 } }];
  const projected = pdfOracleTexts(g, (t) => t.row === g.texts[0].row);
  expect(projected.texts[0].text).toBe("NO contact 1–2");
  g.pdfTexts = [];
  expect(projected.missing).toEqual([]);
  expect(pdfOracleTexts(g, () => true).missing.length).toBeGreaterThan(0);
});
it.each(["ac-input", "dc-output"])("N6 positive: upright %s", (kind) => {
  const { g, ir, sheet } = qualifierFixture(kind);
  expect(conversionQualifierAudit(g, ir, sheet).findings).toEqual([]);
});
it.each(["ac-input", "dc-output"])(
  "N6 mutation killed: rotated %s ink despite upright=true",
  (kind) => {
    const { g, ir, sheet } = qualifierFixture(kind);
    for (const s of g.shapes.filter((s) => s.mark && s.shapeTag !== "rect")) {
      s.points = s.points.map((p) => ({ x: 12 + p.y - 15, y: 15 + p.x - 12 }));
      s.inkSegments = segments(s.points);
      s.upright = true;
    }
    expect(kinds(conversionQualifierAudit(g, ir, sheet))).toContain(
      "conversion-qualifier-not-upright",
    );
  },
);
it.each([
  [
    "omitted glyph",
    (g) =>
      (g.shapes = g.shapes.filter(
        (s) => !["line", "polyline"].includes(s.shapeTag),
      )),
  ],
  [
    "missing mark identity",
    (g) => {
      for (const s of g.shapes) delete s.mark;
    },
  ],
  ["omitted owned port", (g) => (g.terminals = [])],
  [
    "displaced attachment",
    (g) => {
      for (const s of g.shapes.filter((s) => s.mark)) {
        s.points = s.points.map((p) => ({ x: p.x + 100, y: p.y }));
        s.bbox.x += 100;
        s.inkSegments = segments(s.points);
      }
    },
  ],
  [
    "double body rotation",
    (g) => {
      for (const s of g.shapes.filter((s) => s.mark && s.shapeTag !== "rect")) {
        s.points = s.points.map((p) => ({ x: 24 - p.x, y: 30 - p.y }));
        s.inkSegments = segments(s.points);
      }
    },
  ],
])("N6 mutation killed: %s", (_name, mutate) => {
  const { g, ir, sheet } = qualifierFixture(
    _name === "double body rotation" ? "dc-output" : "ac-input",
  );
  mutate(g);
  expect(
    conversionQualifierAudit(g, ir, sheet).findings.length,
  ).toBeGreaterThan(0);
});
const inventory = (x) =>
  inventoryScopeAudit(x.packet.sheets[0], x.packet, x.geometries, x.ir);
it("N12 positive: an unqualified complete inventory", () => {
  expect(inventory(inventoryFixture()).findings).toEqual([]);
});
it("N12 positive: minimal companions remain partial with explicit scope", () => {
  expect(
    inventory(inventoryFixture({ partial: true, qualified: true })).findings,
  ).toEqual([]);
});
it("N12 positive: scope uses the full paginated document", () => {
  expect(inventory(inventoryFixture({ paginated: true })).findings).toEqual([]);
});
it.each([
  ["unqualified partial", () => {}],
  [
    "generic completeness disclaimer",
    (x) =>
      x.geometries[0].texts.push({
        documentId: "doc",
        reportNote: "1",
        text: "Companion inventory describes source facts only; it does not assess safety or completeness.",
      }),
  ],
  ["forged complete flag", (x) => (x.geometries[0].inventoryComplete = true)],
  ["missing title geometry", (x) => x.geometries[0].texts.shift()],
  ["missing cells", (x) => (x.geometries[0].reportCells = [])],
  [
    "unknown native row",
    (x) => {
      for (const t of x.geometries[0].texts.filter((t) => t.row))
        t.row = "missing";
    },
  ],
  [
    "wrong visible conductor",
    (x) => (x.geometries[0].texts.find((t) => t.columnIndex === 0).text = "B"),
  ],
])("N12 mutation killed: %s", (_name, mutate) => {
  const x = inventoryFixture({ partial: true });
  mutate(x);
  expect(inventory(x).findings.length).toBeGreaterThan(0);
});
it("N12 mutation killed: duplicate title on another document cannot donate scope or rows", () => {
  const x = inventoryFixture({ partial: true }),
    other = inventoryFixture({ qualified: true }).geometries[0];
  for (const t of [...other.texts, ...other.reportCells])
    t.documentId = "another";
  x.packet.sheets.push({ number: 2, view: { kind: "wires" } });
  x.geometries.push(other);
  expect(kinds(inventory(x))).toContain("partial-wire-inventory-without-scope");
});

it("N3/N4 positive: native core object and tuple IDs are equivalent", () => {
  const { g, ir } = labelFixture();
  const native = ir.wires.shift();
  ir.cables = [{ uid: "C", designation: "C" }];
  g.texts[0].text = "C.1";
  ir.cableConductors = [
    { id: { cableUid: "C", conductorId: "1" }, endpoints: native.endpoints },
  ];
  g.shapes[0].wire = JSON.stringify({ cableUid: "C", conductorId: "1" });
  g.texts[0].wire = JSON.stringify(["C", "1"]);
  g.shapes[0].edgeOwnerKey = ["wire", g.shapes[0].wire];
  expect(physicalLandingAudit(g, ir).findings).toEqual([]);
  expect(wireLabelSupportAudit(g, ir).findings).toEqual([]);
});
it("N3/N4 positive: signal-loop routes bind by verified native endpoints", () => {
  const { g, ir } = labelFixture();
  const route = g.shapes[0];
  route.conductor = false;
  route.loopConductor = route.wire;
  route.terminalEnds = route.endpoints;
  delete route.wire;
  delete route.endpoints;
  expect(physicalLandingAudit(g, ir).findings).toEqual([]);
  expect(wireLabelSupportAudit(g, ir).findings).toEqual([]);
});
it("N4 witness mutation detected: a disconnected leader cannot authorize an offset label", () => {
  const { g, ir } = labelFixture(true);
  g.tranche3.leaders = [
    {
      wire: "A",
      segments: [
        [
          { x: 10, y: 9 },
          { x: 11, y: 9 },
        ],
        [
          { x: 19, y: 9 },
          { x: 20, y: 9 },
        ],
      ],
    },
  ];
  expect(wireLabelSupportAudit(g, ir).reviewCandidates.length).toBeGreaterThan(
    0,
  );
});
it("N5 media mutation killed: a neutral SVG caption cannot hide a PDF/HTML state claim", () => {
  const { g, ir } = contactFixture();
  g.texts = g.texts.slice(0, 1);
  const source = { ...g.texts[0] };
  g.texts[0].text = "Overload element 1–2";
  g.reportCells = [{ ...source }];
  g.htmlTexts = [source];
  g.pdfTexts = [{ text: source.text, bbox: { x: 0, y: 0, w: 30, h: 3 } }];
  g.tranche3 = {
    pdfTexts: g.pdfTexts,
    htmlGeometry: { texts: g.htmlTexts, reportCells: g.reportCells },
  };
  const result = contactCaptionMediaAudit(g, ir);
  expect(
    result.findings.some(
      (f) =>
        f.medium === "pdf" &&
        f.kind === "contact-caption-contradicts-native-role",
    ),
  ).toBe(true);
  expect(
    result.findings.some(
      (f) =>
        f.medium === "html" &&
        f.kind === "contact-caption-contradicts-native-role",
    ),
  ).toBe(true);
});
it("N6 mutation killed: native source data cannot disappear behind a success flag", () => {
  const { g, ir, sheet } = qualifierFixture();
  ir.functions = [];
  g.upright = true;
  expect(
    conversionQualifierAudit(g, ir, sheet).findings.length,
  ).toBeGreaterThan(0);
});
it("N12 media mutation killed: qualification must also be printed in HTML/PDF", () => {
  const x = inventoryFixture({ partial: true, qualified: true }),
    g = x.geometries[0];
  g.htmlTexts = g.texts.map((t) => ({
    ...t,
    text: t.element === "title" ? "wire inventory" : t.text,
  }));
  g.pdfTexts = g.texts.map((t) => ({
    bbox: t.bbox,
    text: t.element === "title" ? "wire inventory" : t.text,
  }));
  g.tranche3 = {
    pdfTexts: g.pdfTexts,
    htmlGeometry: { texts: g.htmlTexts, reportCells: g.reportCells },
  };
  const rows = inventoryMediaObservations(
    { id: "case" },
    x.packet,
    x.geometries,
    x.ir,
    observation,
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.status === "fail")).toBe(true);
});
it("N12 positive: a native empty inventory has an explicit measured empty state", () => {
  const x = inventoryFixture(),
    g = x.geometries[0];
  x.ir.wires = [];
  g.texts = g.texts.slice(0, 1);
  g.texts.push({
    documentId: "doc",
    text: "No matching records",
    bbox: { x: 0, y: 10, w: 30, h: 4 },
  });
  g.reportCells = [];
  expect(inventory(x).findings).toEqual([]);
});

it("N3 mutation killed: anonymous physical routes are not a net-level exemption", () => {
  const { g, ir } = landingFixture();
  delete g.shapes[0].wire;
  expect(physicalLandingAudit(g, ir).findings.length).toBeGreaterThan(0);
});

it("N3 mutation killed: a different appearance cannot donate a native node", () => {
  const { g, ir } = landingFixture();
  ir.wires.push(wire("C", end("X", "C"), end("D")));
  g.shapes.push({
    element: "dot",
    appearanceScope: "foreign",
    cls: "junction-dot",
    bbox: { x: 19.5, y: -0.5, w: 1, h: 1 },
  });
  expect(kinds(physicalLandingAudit(g, ir))).toContain(
    "junction-dot-without-native-node",
  );
});

it("N4 calibrated counterexample: a short vertical label stays manual, not a false failure", () => {
  const { g, ir } = labelFixture(true);
  g.texts[0].text = "103";
  ir.wires[0].designation = "103";
  g.texts[0].bbox = { x: 13.75, y: 11.36, w: 5, h: 2 };
  const a = wireLabelSupportAudit(g, ir);
  expect(a.findings).toEqual([]);
  expect(a.manual).toBe(true);
  expect(a.reviewCandidates).toHaveLength(1);
});

it("N4 positive: native net names are not physical wire identities", () => {
  const { g, ir } = labelFixture();
  g.texts.push({
    ...g.texts[0],
    element: "potential",
    labelRole: "net",
    text: "+24VDC",
  });
  expect(wireLabelSupportAudit(g, ir).findings).toEqual([]);
});

it("N12 count-unit controls distinguish wires, jumpers, conductors and endpoints", () => {
  const x = inventoryFixture({ partial: true, qualified: true }),
    g = x.geometries[0];
  g.texts[0].text = "Supplementary inventory: 1 conductor, 1 wire, 2 endpoints";
  expect(inventory(x).findings).toEqual([]);
  g.texts[0].text = "Supplementary inventory: 2 wires";
  expect(kinds(inventory(x))).toContain("wire-inventory-scope-count-disagrees");
});
it("N12 mutation killed: forged denominators and cable-only scope do not exempt omissions", () => {
  const x = inventoryFixture({ partial: true, qualified: true }),
    g = x.geometries[0];
  g.texts[0].text = "Supplementary inventory: 1 of 1 wires";
  expect(kinds(inventory(x))).toContain("wire-inventory-scope-count-disagrees");
  g.texts[0].text = "Supplementary cable-core inventory";
  expect(inventory(x).findings.length).toBeGreaterThan(0);
});

it("N12 positive: a complete inventory reconciles independent HTML/PDF regions", () => {
  const x = inventoryFixture(),
    g = x.geometries[0];
  g.htmlTexts = g.texts.map((t) => ({ ...t }));
  g.tranche3 = {
    htmlGeometry: { texts: g.htmlTexts, reportCells: g.reportCells },
    pdfTexts: g.texts.map((t) => ({ bbox: t.bbox, text: t.text })),
  };
  const rows = inventoryMediaObservations(
    { id: "case" },
    x.packet,
    x.geometries,
    x.ir,
    observation,
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.status === "pass")).toBe(true);
});

it("N12 mutation killed: a mixed wire/jumper inventory cannot count both as wires", () => {
  const x = inventoryFixture(),
    g = x.geometries[0];
  x.ir.jumpers.push(x.ir.wires.pop());
  g.texts[0].text =
    "Supplementary inventory: all 2 conductors, 1 wire, 1 jumper, 4 endpoints";
  expect(inventory(x).findings).toEqual([]);
  g.texts[0].text = "Supplementary inventory: 2 wires";
  expect(kinds(inventory(x))).toContain("wire-inventory-scope-count-disagrees");
});

it.each(["ac-input", "dc-output"])(
  "N6 positive: reversing stroke traversal preserves painted %s geometry",
  (kind) => {
    const { g, ir, sheet } = qualifierFixture(kind);
    for (const p of g.shapes.filter((p) => p.mark && p.shapeTag !== "rect")) {
      p.points.reverse();
      p.inkSegments = segments(p.points);
    }
    expect(conversionQualifierAudit(g, ir, sheet).findings).toEqual([]);
  },
);
it("N6 mutation killed: a flat line is not the native AC waveform", () => {
  const { g, ir, sheet } = qualifierFixture();
  const p = g.shapes.find((p) => p.shapeTag === "polyline");
  p.points = [
    { x: 10, y: 15 },
    { x: 14, y: 15 },
  ];
  p.inkSegments = segments(p.points);
  expect(
    conversionQualifierAudit(g, ir, sheet).findings.length,
  ).toBeGreaterThan(0);
});
it("N6 mutation killed: touching dash elements cannot stand in for painted gaps", () => {
  const { g, ir, sheet } = qualifierFixture("dc-output"),
    p = g.shapes.filter((p) => p.shapeTag === "line");
  p[2].points[0].x = p[1].points[1].x;
  p[2].inkSegments = segments(p[2].points);
  expect(
    conversionQualifierAudit(g, ir, sheet).findings.length,
  ).toBeGreaterThan(0);
});
