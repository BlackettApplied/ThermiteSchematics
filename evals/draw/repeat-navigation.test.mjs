import { expect, it } from "vitest";
import { repeatNavigation } from "./repeat-navigation.mjs";
import { measuredZone, quantize } from "./repeat-appearances.mjs";
const bbox = (x, y, w = 20, h = 2) => ({ x, y, w, h });
const text = (text, x, y, extra = {}) => ({
  text,
  element: text,
  bbox: bbox(x, y),
  anchor: { x, y },
  painted: true,
  ...extra,
});
function fixture(count = 2) {
  const ir = {
    devices: [{ uid: "d", designation: "D" }],
    functions: Array.from({ length: count }, (_, i) => ({
      id: { deviceUid: "d", functionKey: "f" + i },
      kind: "coil",
      terminals: [
        { deviceUid: "d", terminalKey: String(i * 2 + 1) },
        { deviceUid: "d", terminalKey: String(i * 2 + 2) },
      ],
    })),
  };
  const request = { views: [{ title: "One" }, { title: "Two" }] };
  const sheets = [1, 2].map((number) => ({
    number,
    view: { title: number === 1 ? "One" : "Two" },
  }));
  const geometries = sheets.map((s, i) => ({
    texts: [
      ...[1, 2, 3, 4, 5, 6].map((n) =>
        text(String(n), 30 * n, 20, { sheetText: true }),
      ),
      ...["A", "B", "C", "D"].map((n, j) =>
        text(n, 10, 40 * (j + 1), { sheetText: true }),
      ),
      text(
        `D: ${i ? "Repeat of 01.A1 (same " + (count === 1 ? "function" : "functions") + ")" : "Also shown 02.A1"}`,
        30,
        70,
        { navigationAnnotation: "a" + i, textContainer: "a" + i },
      ),
    ],
    shapes: [
      {
        element: "frame",
        deviceUid: "d",
        outline: true,
        bbox: bbox(20, 30, 30, 25),
        stroke: 0.2,
        inkSegments: [],
      },
      ...ir.functions.map((fn, j) => ({
        element: "body" + j,
        deviceUid: "d",
        functionKey: fn.id.functionKey,
        symbol: "symbol",
        functionScope: "glyph" + j,
        navigationView: `view/${i + 1}/key`,
        bbox: bbox(30, 36 + j * 8, 10, 4),
        stroke: 0.2,
        inkSegments: [],
      })),
    ],
    terminals: ir.functions.flatMap((fn, j) =>
      fn.terminals.map((t, k) => ({
        element: t.terminalKey,
        terminal: t.terminalKey,
        deviceUid: "d",
        functionScope: "glyph" + j,
        point: { x: 30 + k * 10, y: 40 + j * 8 },
        bbox: bbox(30 + k * 10, 40 + j * 8, 1, 1),
      })),
    ),
  }));
  const packet = {
    sheets,
    navigation: {
      annotations: [0, 1].map((i) => ({
        id: "a" + i,
        ownerOccurrence: "o" + i,
      })),
      occurrences: [0, 1].map((i) => ({
        id: "o" + i,
        source: { deviceUid: "d", functionKey: "f0" },
        destination: { sheet: 99, zone: "D6" },
        provenance: { view: { authoredOrder: i } },
      })),
    },
  };
  return { packet, geometries, ir, request };
}
const audit = (f) => repeatNavigation(f.packet, f.geometries, f.ir, f.request);
const kinds = (f) => audit(f).findings.map((f) => f.kind);
it("M5 groups distinct glyphs by native device/view/sheet and measures targets independently of forged claimed zones", () => {
  const f = fixture();
  expect(audit(f)).toMatchObject({
    findings: [],
    appearanceCount: 2,
    repeatCount: 2,
  });
  // Both glyphs form one appearance; repeated functions share one target token.
  expect(audit(f).measurements[0].functions).toEqual(["f0", "f1"]);
  expect(audit(fixture(1)).findings).toEqual([]);
});
it.each(["stripped", "zone", "duplicate", "glyph", "distant"])(
  "M5 forged export/control %s fails",
  (kind) => {
    const f = fixture(),
      g = f.geometries[1],
      label = g.texts.at(-1);
    if (kind === "stripped") {
      delete label.navigationAnnotation;
      f.packet.navigation.annotations = [];
    }
    if (kind === "zone") label.text = label.text.replace("01.A1", "01.D6");
    if (kind === "duplicate")
      g.texts.push({
        ...label,
        element: "duplicate",
        navigationAnnotation: "extra",
        textContainer: "extra",
      });
    if (kind === "glyph") {
      label.text = "D: Repeat of 01.A1 (same function)";
      g.texts.push({
        ...label,
        element: "second-glyph",
        navigationAnnotation: "second-glyph",
      });
    }
    if (kind === "distant") label.bbox = bbox(150, 150);
    expect(kinds(f)).toContain(
      {
        stripped: "repeat-label-locator-mismatch",
        zone: "repeat-targets",
        duplicate: "repeat-label-count",
        glyph: "repeat-label-count",
        distant: "repeat-locality",
      }[kind],
    );
  },
);
it("M5 missing labels and a deleted seed retain native obligations", () => {
  const f = fixture();
  f.packet.navigation.occurrences = [];
  f.geometries[1].texts.pop();
  expect(kinds(f)).toContain("repeat-label-count");
});
it("M5 qualifier matches functions on its own Repeat line, not the entire device", () => {
  const f = fixture();
  f.geometries[1].texts.at(-1).text = "D: Repeat of 01.A1 (same function)";
  expect(kinds(f)).toContain("repeat-qualifier");
});
it("M5 validates the self-location prefix and nearest frame independently of exported locality flags", () => {
  const f = fixture(),
    g = f.geometries[1],
    label = g.texts.at(-1);
  label.bbox = bbox(150, 150);
  label.text = "D (02.A1): Repeat of 01.A1 (same functions)";
  expect(audit(f).findings).toEqual([]);
  label.text = label.text.replace("02.A1", "02.D6");
  expect(kinds(f)).toContain("repeat-locality");
  label.bbox = bbox(30, 70);
  label.text = "D: Repeat of 01.A1 (same functions)";
  g.shapes.push({
    outline: true,
    deviceUid: "foreign",
    bbox: bbox(30, 68, 25, 8),
    inkSegments: [],
  });
  expect(kinds(f)).toContain("repeat-locality");
});
it("M5 measures 4 mm line-band clearance and 1.5 mm non-text ink clearance", () => {
  const f = fixture(),
    g = f.geometries[1];
  g.texts.push(text("header", 54, 70));
  expect(audit(f).findings).toEqual([]);
  g.texts.at(-1).bbox.x = 53.8;
  expect(kinds(f)).toContain("repeat-text-clearance");
  g.texts.pop();
  g.shapes.push({
    element: "ink",
    stroke: 0,
    bbox: bbox(51.5, 70, 1, 1),
    inkSegments: [
      [
        { x: 51.5, y: 69 },
        { x: 51.5, y: 73 },
      ],
    ],
  });
  expect(audit(f).findings).toEqual([]);
  g.shapes.at(-1).inkSegments = [
    [
      { x: 51.3, y: 69 },
      { x: 51.3, y: 73 },
    ],
  ];
  expect(kinds(f)).toContain("repeat-ink-clearance");
});
it("M5 a native function needs its complete visible terminal set and body; boundary contexts cannot certify it", () => {
  const f = fixture(1);
  f.geometries[1].terminals.pop();
  f.geometries[1].texts.pop();
  expect(audit(f).repeatCount).toBe(0);
  f.geometries[0].texts.pop();
  expect(audit(f).findings).toEqual([]);
});
it("M5 distinct selected views on one sheet stay separate", () => {
  const f = fixture(1);
  f.packet.sheets[1].number = 1;
  f.geometries[0].texts.at(-1).text = "D: Also shown 01.A1";
  // Both independent view slots remain appearance units, even on one sheet.
  expect(audit(f).appearanceCount).toBe(2);
  expect(audit(f).repeatCount).toBe(2);
});
it("M5 Q and half-open zones are measured, including exact decimal half ties", () => {
  expect(quantize(1.005)).toBe(1.01);
  const g = fixture().geometries[0];
  expect(measuredZone(g, { x: 44.994, y: 40 })).toBe("A1");
  expect(measuredZone(g, { x: 44.995, y: 40 })).toBe("A2");
});
it("M5 mixed-role label qualifies only the functions on its Repeat line", () => {
  const f = fixture(2),
    third = structuredClone(f.geometries[1]);
  f.request.views.push({ title: "Three" });
  f.packet.sheets.push({ number: 3, view: { title: "Three" } });
  f.geometries[0].shapes = f.geometries[0].shapes.filter(
    (s) => s.functionKey !== "f1",
  );
  f.geometries[0].terminals = f.geometries[0].terminals.filter((t) =>
    ["1", "2"].includes(t.terminal),
  );
  third.shapes = third.shapes
    .filter((s) => s.functionKey !== "f0")
    .map((s) => ({ ...s, navigationView: "view/1/third" }));
  third.terminals = third.terminals.filter((t) =>
    ["3", "4"].includes(t.terminal),
  );
  third.texts.at(-1).text = "D: Repeat of 02.A1 (same function)";
  third.texts.at(-1).navigationAnnotation = "a2";
  f.geometries.push(third);
  f.packet.navigation.annotations.push({ id: "a2", ownerOccurrence: "o2" });
  f.packet.navigation.occurrences.push({
    id: "o2",
    source: { deviceUid: "d", functionKey: "f1" },
    provenance: { view: { authoredOrder: 2 } },
  });
  const label = f.geometries[1].texts.at(-1);
  label.text = "D: Also shown 03.A1 Repeat of 01.A1 (same function)";
  expect(audit(f).findings).toEqual([]);
  label.text = label.text.replace("same function)", "same functions)");
  expect(kinds(f)).toContain("repeat-qualifier");
});
it("M5 canonical order ignores forged export authoredOrder claims", () => {
  const f = fixture();
  for (const o of f.packet.navigation.occurrences)
    o.provenance.view.authoredOrder = 1 - o.provenance.view.authoredOrder;
  expect(kinds(f)).not.toContain("repeat-targets");
  expect(kinds(f)).toContain("repeat-label-unresolved-owner");
});
it("M5 nearest-frame ownership uses ink-box gaps, so a wide label is not judged by its centre", () => {
  const f = fixture(),
    g = f.geometries[1],
    label = g.texts.at(-1);
  label.bbox.w = 160;
  const foreign = {
    element: "foreign-frame",
    outline: true,
    deviceUid: "foreign",
    bbox: bbox(150, 30, 20, 20),
    inkSegments: [],
  };
  g.shapes.push(foreign);
  // Ink-box gaps: own 15 mm, foreign 20 mm. The centre is nearer foreign.
  expect(audit(f).findings).toEqual([]);
  foreign.bbox.y = 40;
  // Now foreign is 10 mm away, while own remains 15 mm away.
  expect(kinds(f)).toContain("repeat-locality");
});
it("M5 excludes M2 mirror, return and notice ink even with forged M5 export roles", () => {
  const f = fixture();
  for (const [i, wording] of [
    "K1 NO 13–14 not drawn",
    "K1 /01.A1",
    "Contact tables list device data; contacts not drawn in this packet are marked.",
  ].entries()) {
    f.geometries[0].texts.push(
      text(wording, 150, 150, {
        navigationAnnotation: "m2-" + i,
        navigationRole: "canonical",
      }),
    );
    f.packet.navigation.annotations.push({
      id: "m2-" + i,
      role: "canonical",
      ownerOccurrence: "forged",
    });
  }
  expect(audit(f).findings).toEqual([]);
  f.geometries[0].texts.push(
    text("D: Also shown 99.D6", 150, 150, {
      navigationAnnotation: "bad-m5",
      navigationRole: "mirror",
    }),
  );
  expect(kinds(f)).toContain("repeat-label-count");
});
it("M5 single contact uses same contact and rejects same function", () => {
  const f = fixture(1);
  f.ir.functions[0].kind = "contact";
  const label = f.geometries[1].texts.at(-1);
  label.text = "D: Repeat of 01.A1 (same contact)";
  expect(audit(f).findings).toEqual([]);
  label.text = label.text.replace("same contact", "same function");
  expect(kinds(f)).toContain("repeat-qualifier");
});
it("M5 frameless owner uses native body, and foreign frame ties within 0.01 mm are ambiguous", () => {
  const f = fixture(1),
    g = f.geometries[1];
  g.shapes = g.shapes.filter((s) => !s.outline);
  expect(audit(f).findings).toEqual([]);
  const foreign = {
    outline: true,
    deviceUid: "foreign",
    bbox: bbox(30, 90.02, 20, 10),
  };
  g.shapes.push(foreign);
  // Body ends at 40, label starts at 70; this foreign is closer.
  expect(kinds(f)).toContain("repeat-locality");
  foreign.bbox.y = 102.02;
  expect(audit(f).findings).toEqual([]);
  foreign.bbox.y = 102.005;
  expect(kinds(f)).toContain("repeat-locality");
});
it("M5 non-text clearance includes the half stroke", () => {
  const f = fixture(),
    g = f.geometries[1];
  const ink = {
    element: "thick",
    stroke: 0.4,
    bbox: bbox(51.7, 69, 0, 4),
    inkSegments: [
      [
        { x: 51.7, y: 69 },
        { x: 51.7, y: 73 },
      ],
    ],
  };
  g.shapes.push(ink);
  expect(audit(f).findings).toEqual([]);
  ink.inkSegments = [
    [
      { x: 51.6, y: 69 },
      { x: 51.6, y: 73 },
    ],
  ];
  expect(kinds(f)).toContain("repeat-ink-clearance");
});
it("M5 wrapped annotation keeps its qualifier row while excluding M2 blocks", () => {
  const f = fixture(1),
    g = f.geometries[1],
    label = g.texts.at(-1);
  label.text = "D: Repeat of 01.A1";
  g.texts.push({
    ...label,
    text: "(same function)",
    bbox: bbox(30, 75),
    anchor: { x: 30, y: 75 },
  });
  expect(audit(f).findings).toEqual([]);
});
