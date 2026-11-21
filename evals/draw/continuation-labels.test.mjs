import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  continuations,
  legibility,
  pdfGeometryTexts,
  zoneAt,
} from "./checks.mjs";
import {
  labelRows,
  printedConductor,
  identityMatches,
  continuationMediaIssues,
  continuationPdfRows,
} from "./continuation-labels.mjs";
const box = (x, y, w = 10, h = 2.5) => ({ x, y, w, h });
const row = (text, y = 40, extra = {}) => ({
  element: "t" + y,
  text,
  renderedString: text,
  continuationLink: "link",
  font: "test",
  fontSize: 2.5,
  painted: true,
  bbox: box(30, y - 2),
  emBbox: box(30, y - 2.5),
  anchor: { x: 30, y },
  ...extra,
});
const ir = {
  wires: [{ uid: "w", designation: "W1", properties: { label: "PE-SRC" } }],
};
const c = { id: "C001", toSheet: 1, conductor: "PE-SRC", netId: "net" };
const grid = [
  ...Array.from({ length: 6 }, (_, i) => ({
    text: String(i + 1),
    anchor: { x: 30 + 40 * i, y: 20 },
    bbox: box(30 + 40 * i, 20, 0, 0),
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    text: "ABCD"[i],
    anchor: { x: 10, y: 40 + 40 * i },
    bbox: box(10, 40 + 40 * i, 0, 0),
  })),
];
function fixture(texts = [row("C001 / 01.D6"), row("PE-SRC", 43.5)]) {
  const sheet = { number: 1, continuations: [{ ...c }, { ...c }] },
    packet = { sheets: [sheet] },
    g = {
      texts: [
        ...grid,
        ...texts,
        row("C001 / 01.A1", 160, { continuationLink: "peer" }),
        row("PE-SRC", 163.5, { continuationLink: "peer" }),
      ],
      connectors: [
        { id: c.id, toSheet: 1, element: "link", anchor: { x: 30, y: 40 } },
        { id: c.id, toSheet: 1, element: "peer", anchor: { x: 230, y: 160 } },
      ],
    };
  return {
    sheet,
    packet,
    g,
    issues: () => continuations(sheet, packet, g, [g], ir),
  };
}
it("reads multiline identities through the connector and resolves its other same-sheet end", () => {
  expect(fixture().issues()).toEqual([]);
});
it.each([
  ["wrong zone", [row("C001 / 01.A1"), row("PE-SRC", 43.5)]],
  ["wrong ID", [row("C099 / 01.D6"), row("PE-SRC", 43.5)]],
  ["wrong page", [row("C001 / 99.D6"), row("PE-SRC", 43.5)]],
  ["missing body", [row("C001 / 01.D6")]],
  [
    "hidden body",
    [row("C001 / 01.D6"), row("PE-SRC", 43.5, { painted: false })],
  ],
  ["substring identity", [row("C001 / 01.D6"), row("PE-SRC-extra", 43.5)]],
  [
    "unowned body",
    [row("C001 / 01.D6"), row("PE-SRC", 43.5, { continuationLink: undefined })],
  ],
])("refuses %s", (name, texts) =>
  expect(fixture(texts).issues().length).toBeGreaterThan(0),
);
it("does not use exported toZone as the zone answer", () => {
  const f = fixture();
  f.sheet.continuations.forEach((c) => (c.toZone = "A1"));
  expect(f.issues()).toEqual([]);
});
it("refuses a lone endpoint, ambiguous peer, or missing printed grid", () => {
  const f = fixture();
  f.sheet.continuations.splice(1);
  f.g.connectors.splice(1);
  expect(f.issues()[0].missing).toContain("reciprocal peer");
  const a = fixture();
  a.g.connectors.push({ ...a.g.connectors[1] });
  expect(a.issues()[0].missing).toContain("printed destination zone");
  const b = fixture();
  b.g.texts = b.g.texts.filter((t) => t.continuationLink);
  expect(b.issues()[0].missing).toContain("printed destination zone");
});
it("wire number overrides designation independently of continuation display metadata", () => {
  expect(printedConductor({ conductor: "W1" }, ir).text).toBe("PE-SRC");
  expect(
    identityMatches(
      [row("C001 / 02.A1"), row("PE-SRC", 44)],
      c,
      printedConductor(c, ir),
    ),
  ).toBe(true);
  expect(
    identityMatches(
      [row("C001 / 02.A1"), row("W1", 44)],
      c,
      printedConductor(c, ir),
    ),
  ).toBe(false);
  expect(
    printedConductor(
      { conductor: "W2" },
      { wires: [{ uid: "two", designation: "W2" }] },
    ).text,
  ).toBe("W2");
  expect(printedConductor({ conductor: "net:hash" }, ir)).toBeNull();
  expect(
    printedConductor(
      { conductor: "W1" },
      { wires: [...ir.wires, ...ir.wires] },
    ),
  ).toBeNull();
  expect(
    printedConductor(
      { conductor: "W1" },
      { wires: [{ uid: "w", designation: "W1", properties: { label: "" } }] },
    ),
  ).toBeNull();
});
it("uses IR provenance and refuses foreign, unknown or synthetic elements", () => {
  expect(
    printedConductor(
      { conductor: "invented", sourceElement: { kind: "wire", uid: "w" } },
      ir,
    ).text,
  ).toBe("PE-SRC");
  expect(
    printedConductor(
      { conductor: "PE-SRC", sourceElement: { kind: "wire", uid: "wrong" } },
      ir,
    ),
  ).toBeNull();
  expect(
    printedConductor(
      { conductor: "net", sourceElement: { kind: "boundary", uid: "w" } },
      ir,
    ),
  ).toBeNull();
});
it("reads cable designation and full core ID without display colour/size", () => {
  const r = {
    cables: [{ uid: "c", designation: "CBL1" }],
    cableConductors: [{ id: { cableUid: "c", conductorId: "1+" } }],
  };
  expect(printedConductor({ conductor: "CBL1.1+" }, r).text).toBe("CBL1.1+");
  expect(printedConductor({ conductor: "black / 18AWG" }, r)).toBeNull();
  expect(
    printedConductor({ conductor: "CBL1.1+" }, { ...r, cables: [] }),
  ).toBeNull();
});
it("uses jumper designation or JUMPER, with the UID kept in provenance", () => {
  const uid = "0ec3cac2-1423-4d4c-9e50-e1ca2c489ced",
    r = { jumpers: [{ uid, designation: "JP1" }] };
  expect(printedConductor({ conductor: "JP1" }, r).text).toBe("JP1");
  const un = { jumpers: [{ uid }] },
    expected = printedConductor({ conductor: "jumper:" + uid }, un);
  expect(
    identityMatches([row("C001 / 02.A1"), row("JUMPER", 44)], c, expected),
  ).toBe(true);
  expect(
    identityMatches(
      [row("C001 / 02.A1"), row("jumper:" + uid, 44)],
      c,
      expected,
    ),
  ).toBe(false);
  expect(
    identityMatches(
      [row("C001 / 02.A1"), row("JUMPER" + uid.slice(0, 8), 44)],
      c,
      expected,
    ),
  ).toBe(false);
  expect(
    printedConductor({ conductor: "jumper:undefined" }, { jumpers: [{}] }),
  ).toBeNull();
});
it("preserves opaque spaces and full wrapped character streams", () => {
  const expected = { text: "WIRE  A-Ωe\u0301Z" };
  expect(
    identityMatches(
      [row("C001 / 02.A1"), row("WIRE  A-", 44), row("Ωe\u0301Z", 48)],
      c,
      expected,
    ),
  ).toBe(true);
  expect(
    identityMatches([row("C001 / 02.A1"), row("WIRE A-ΩéZ", 44)], c, expected),
  ).toBe(false);
});
it("measures every actual PDF font run, never borrowing SVG size", () => {
  const svg = [row("C001 / 02.A1"), row("PE-SRC", 43.5)];
  const pdf = [
    { text: "C001", font: "test", fontSize: 2.5, bbox: box(30, 37.5, 5) },
    { text: " / 02.A1", font: "test", fontSize: 2.5, bbox: box(35, 37.5, 8) },
    {
      text: "PE-SRC",
      font: "test",
      fontSize: 2.1,
      bbox: box(30, 41.4, 10, 2.1),
    },
  ];
  const actual = pdfGeometryTexts(svg, pdf);
  expect(actual).toHaveLength(3);
  expect(legibility({ texts: actual })[0].fontSizeMm).toBe(2.1);
  expect(continuationMediaIssues(svg, actual, "pdf")).toEqual([]);
  expect(() => pdfGeometryTexts(svg, pdf.slice(0, 2))).toThrow(
    /missing or unassociated row/,
  );
  const wrong = pdfGeometryTexts(
    svg,
    pdf.map((p, i) => (i === 2 ? { ...p, text: "WRONG" } : p)),
  );
  expect(continuationMediaIssues(svg, wrong, "pdf")).toHaveLength(1);
  expect(() => pdfGeometryTexts([row("one legacy row")], [])).toThrow(
    /missing or unassociated row/,
  );
});
it("refuses missing or changed HTML rows even when the other rows match", () => {
  const svg = [row("C001 / 02.A1"), row("PE-SRC", 43.5)];
  expect(continuationMediaIssues(svg, svg, "html")).toEqual([]);
  expect(continuationMediaIssues(svg, svg.slice(0, 1), "html")).toHaveLength(1);
  expect(
    continuationMediaIssues(
      svg,
      [svg[0], { ...svg[1], text: "WRONG", renderedString: "WRONG" }],
      "html",
    ),
  ).toHaveLength(1);
});
const witnesses = JSON.parse(
  readFileSync(
    new URL("./fixtures/continuation-same-sheet.json", import.meta.url),
  ),
);
it.each(
  witnesses.pairs.map((p) => [p.case + " " + p.sheet + " " + p.ends[0].id, p]),
)("measures both independent same-sheet zones: %s", (name, p) => {
  const sheet = { number: p.sheet, continuations: p.continuations },
    packet = { sheets: [sheet] },
    ir = witnesses.irs[p.case];
  const texts = [
      ...witnesses.grids[p.case + "/" + p.sheet].texts,
      ...p.ends.flatMap((end, i) => [
        row(
          end.id +
            " / " +
            String(p.sheet).padStart(2, "0") +
            "." +
            p.ends[1 - i].zone,
          40 + 20 * i,
          { continuationLink: "end" + i },
        ),
        row(printedConductor(p.continuations[i], ir).text, 43.5 + 20 * i, {
          continuationLink: "end" + i,
        }),
      ]),
    ],
    g = {
      texts,
      connectors: p.ends.map((e, i) => ({ ...e, element: "end" + i })),
    };
  expect(continuations(sheet, packet, g, [g], ir)).toEqual([]);
  for (let i = 0; i < 2; i++) {
    expect(zoneAt(g, p.ends[i].anchor)).toBe(p.ends[i].zone);
    const bad = structuredClone(g);
    bad.texts[10 + 2 * i].text =
      p.ends[i].id +
      " / " +
      String(p.sheet).padStart(2, "0") +
      "." +
      p.ends[i].zone;
    bad.texts[10 + 2 * i].renderedString = bad.texts[10 + 2 * i].text;
    expect(
      continuations(sheet, packet, bad, [bad], ir).some((f) =>
        f.missing.includes("printed destination zone"),
      ),
    ).toBe(true);
  }
});

it("keeps physical rows separate and refuses off-sheet PDF substitutions", () => {
  expect(labelRows([row("C001 / 02.A1"), row("PE-SRC", 43.5)])).toHaveLength(2);
  expect(() =>
    pdfGeometryTexts(
      [row("C001 / 02.A1")],
      [{ text: "C001 / 02.A1", fontSize: 2.5, bbox: box(1000, 1000) }],
    ),
  ).toThrow(/missing or unassociated row/);
});
it("never reads numeric/alphabetic continuation rows as the printed grid", () => {
  const f = fixture();
  f.g.texts.push(
    row("1", 20, { bbox: box(50, 18) }),
    row("A", 60, { bbox: box(14, 58), anchor: { x: 14, y: 60 } }),
  );
  expect(zoneAt(f.g, f.g.connectors[1].anchor)).toBe("D6");
});
it("requires every associated PDF run to have its own finite font size", () => {
  const svg = [row("C001 / 02.A1"), row("PE-SRC", 43.5)],
    p = [
      { text: "C001 / 02.A1", fontSize: 2.5, bbox: box(30, 37.5) },
      { text: "PE-SRC", bbox: box(30, 41) },
    ];
  expect(() => pdfGeometryTexts(svg, p)).toThrow(/actual font size/);
  for (const size of [undefined, NaN, Infinity, 0])
    expect(() =>
      pdfGeometryTexts(
        [svg[0]],
        [{ text: svg[0].text, fontSize: size, bbox: box(30, 37.5) }],
      ),
    ).toThrow(/actual font size/);
});
it("accepts an undesignated jumper identity on one inline row", () => {
  const uid = "0ec3cac2-1423-4d4c-9e50-e1ca2c489ced",
    expected = printedConductor(
      { conductor: "jumper:" + uid },
      { jumpers: [{ uid }] },
    );
  expect(identityMatches([row("C001 / 02.A1 / JUMPER")], c, expected)).toBe(
    true,
  );
});

it.each([
  ["identity above", [row("PE-SRC"), row("C001 / 01.D6", 43.5)]],
  ["identity below", [row("C001 / 01.D6"), row("PE-SRC", 43.5)]],
  ["split above", [row("PE-", 33), row("SRC", 36.5), row("C001 / 01.D6")]],
  ["split below", [row("C001 / 01.D6"), row("PE-", 43.5), row("SRC", 47)]],
  [
    "split either side",
    [row("PE-", 36.5), row("C001 / 01.D6"), row("SRC", 43.5)],
  ],
  ["inline", [row("C001 / 01.D6 / PE-SRC")]],
])("reads a unique reference anywhere: %s", (name, texts) => {
  expect(fixture(texts).issues()).toEqual([]);
});
it.each([
  [row("01.D6"), row("PE-SRC", 43.5)],
  [row("C001 / 01.D6"), row("C001 / 01.D6", 43.5), row("PE-SRC", 47)],
])("refuses missing or duplicate reference rows", (...texts) => {
  expect(fixture(texts).issues()[0].missing).toContain(
    "printed connector reference",
  );
});
it.each([
  "JUMPERUID ",
  "JUMPER UID ",
  "JUMPER (no designation)UID ",
  "JUMPER (no designation) UID ",
  "JUMPER",
  "JUMPER ",
])("refuses non-contract or abbreviated jumper text %s", (prefix) => {
  const uid = "0ec3cac2-1423-4d4c-9e50-e1ca2c489ced";
  const body = prefix === "JUMPER " ? prefix + uid.slice(0, 8) : prefix + uid;
  expect(
    identityMatches([row("C001 / 02.A1"), row(body, 44)], c, {
      text: "JUMPER",
    }),
  ).toBe(false);
});
it("limits extra PDF rows to the owned text envelope", () => {
  const rows = [row("C001 / 01.D6"), row("PE-SRC", 50)],
    pdf = rows.map((t) => ({ text: t.text, fontSize: 2.5, bbox: t.emBbox }));
  expect(
    continuationPdfRows(rows, [
      ...pdf,
      { text: "NEAR STROKE", fontSize: 2.5, bbox: box(21, 40) },
    ]),
  ).toHaveLength(2);
  expect(() =>
    continuationPdfRows(rows, [
      ...pdf,
      { text: "EXTRA", fontSize: 2.5, bbox: box(30, 44) },
    ]),
  ).toThrow(/unassociated extra row/);
});
it("never borrows a destination zone from the inline identity", () => {
  const f = fixture([row("C001 / 01 / 01.D6")]),
    source = {
      wires: [
        { uid: "w", designation: "PE-SRC", properties: { label: "01.D6" } },
      ],
    };
  expect(
    continuations(f.sheet, f.packet, f.g, [f.g], source)[0].missing,
  ).toContain("printed sheet.zone");
});
