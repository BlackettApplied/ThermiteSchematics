import { expect, it } from "vitest";
import {
  footerReferenceFindings,
  peerReferenceFindings,
  stripInventoryFindings,
} from "./issued-reference-audit.mjs";

const reference = {
  peerReference: "attachment",
  peerSource: JSON.stringify(["R1", "X2", "CAP"]),
  text: "R1.X2 · CAP-X2 → 02.B4",
  painted: true,
};

it.each([
  ["wrong port", { ...reference, text: "R1.X4 · CAP-X2 → 02.B4" }],
  ["wrong zone", { ...reference, text: "R1.X2 · CAP-X2 → 02.B5" }],
  ["generic inventory", { ...reference, text: "See assembly schedule 02.B4" }],
  ["hidden pointer", { ...reference, painted: false }],
  ["erased reverse pointer", undefined],
])("rejects %s for a source-bound attachment", (_, mutation) => {
  const expected = [
    {
      kind: "attachment",
      source: ["R1", "X2", "CAP"],
      values: [reference.text],
    },
  ];
  expect(peerReferenceFindings(1, { texts: [reference] }, expected)).toEqual(
    [],
  );
  expect(
    peerReferenceFindings(1, { texts: mutation ? [mutation] : [] }, expected),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "issued-peer-reference-missing" }),
    ]),
  );
});

it("distinguishes the exact assembly inventory row from a drawn attachment", () => {
  const row = {
    ...reference,
    peerReference: "assembly-inventory",
    text: "R1.X09 · CBL1 inventory → 04.B3",
    peerSource: JSON.stringify(["R1", "X09", "CBL1"]),
  };
  const expected = [
    {
      kind: row.peerReference,
      source: ["R1", "X09", "CBL1"],
      values: [row.text],
    },
  ];
  expect(peerReferenceFindings(2, { texts: [row] }, expected)).toEqual([]);
  for (const changed of [
    { ...row, peerSource: JSON.stringify(["R1", "X09", "CBL2"]) },
    { ...row, text: row.text.replace("inventory ", "") },
    { ...row, text: row.text.replace("04.B3", "05.B3") },
  ])
    expect(
      peerReferenceFindings(2, { texts: [changed] }, expected),
    ).not.toEqual([]);
  // If the issued native row is hidden or omitted, a stale pointer is invalid.
  expect(peerReferenceFindings(2, { texts: [row] }, [])[0].kind).toBe(
    "issued-peer-reference-unbound",
  );
});

it("rejects missing, duplicate, hidden and wrong inventory targets", () => {
  const packet = {
    sheets: [
      { number: 2, view: { kind: "terminals" } },
      { number: 3, view: { kind: "terminal-strip" } },
    ],
  };
  const target = { key: '["T","17"]', ref: "T1/R17" };
  const inventory = {
    terminalStripInk: {
      viewKeys: ["view"],
      references: [{ key: target.key, text: target.ref }],
    },
  };
  const strip = {
    terminalStripInk: {
      viewKeys: ["view"],
      terminals: [
        {
          ...target,
          rect: { x: 100, y: 50, w: 16, h: 8 },
          texts: [{ text: "S02", painted: true }],
        },
      ],
    },
  };
  const row = { key: target.key, kind: "terminals", visible: true, sheet: 2 };
  expect(stripInventoryFindings(packet, [inventory, strip], [row], 1)).toEqual(
    [],
  );
  for (const mutated of [
    [],
    [{ ...row, visible: false }],
    [row, row],
    [{ ...row, key: "wrong" }],
  ])
    expect(
      stripInventoryFindings(packet, [inventory, strip], mutated, 1)[0].kind,
    ).toBe("strip-inventory-sheet-disagrees");
  strip.terminalStripInk.terminals[0].texts[0].text = "S01";
  expect(
    stripInventoryFindings(packet, [inventory, strip], [row], 1)[0].kind,
  ).toBe("strip-inventory-sheet-disagrees");
});

it("rejects a dangling, stale or erased circuit footer", () => {
  const sheet = { number: 1, view: { kind: "circuit" } };
  const foot = (text) => ({
    height: 200,
    texts: text
      ? [
          {
            text,
            painted: true,
            sheetText: true,
            bbox: { x: 20, y: 186, w: 90, h: 3 },
          },
        ]
      : [],
  });
  expect(footerReferenceFindings(sheet, foot(""), undefined)).toEqual([]);
  expect(
    footerReferenceFindings(
      sheet,
      foot("Device and function references S05"),
      5,
    ),
  ).toEqual([]);
  for (const [printed, target] of [
    ["device/function references in index", undefined],
    ["Device and function references S05", undefined],
    ["Device and function references S04", 5],
    ["", 5],
  ])
    expect(footerReferenceFindings(sheet, foot(printed), target)[0].kind).toBe(
      "circuit-footer-reference-disagrees",
    );
});

const shortReference = {
  kind: reference.peerReference,
  source: ["R1", "X2", "CAP"],
  values: [reference.text],
  compactValues: ["→ CAP-X2 02.B4"],
};
const marker = (text) => ({ ...reference, text, fontSize: 2.5 });

it("accepts a named compact peer and rejects a subjectless locator", () => {
  expect(
    peerReferenceFindings(1, { texts: [marker("→ CAP-X2 02.B4")] }, [
      shortReference,
    ]),
  ).toEqual([]);
  expect(
    peerReferenceFindings(1, { texts: [marker("→ 02.B4")] }, [
      shortReference,
    ])[0].kind,
  ).toBe("issued-peer-reference-subjectless");
});

it.each([
  [
    "wrong peer",
    marker("→ CAP-X4 02.B4"),
    [shortReference],
    "issued-peer-reference-unbound",
  ],
  [
    "wrong zone subjectless",
    marker("→ 02.B5"),
    [shortReference],
    "issued-peer-reference-subjectless",
  ],
  [
    "undersized locator",
    { ...marker("→ 02.B4"), fontSize: 2.49 },
    [shortReference],
    "issued-peer-reference-unbound",
  ],
  [
    "subjectless locator",
    marker("→ 02.B4"),
    [
      shortReference,
      {
        ...shortReference,
        source: ["R1", "X4", "DIFFERENT"],
      },
    ],
    "issued-peer-reference-subjectless",
  ],
])("rejects a %s from measured short ink", (_, text, expected, kind) => {
  expect(peerReferenceFindings(1, { texts: [text] }, expected)[0].kind).toBe(
    kind,
  );
});

it("requires the visible, aligned, complete two-line form", () => {
  const lines = [
    {
      ...marker("R1.X2 · CAP-X2"),
      peerGroup: "g1",
      anchor: { x: 12, y: 15 },
      bbox: { x: 12, y: 13, w: 22, h: 2 },
    },
    {
      ...marker("→ 02.B4"),
      peerGroup: "g1",
      anchor: { x: 12, y: 18.5 },
      bbox: { x: 12, y: 16.5, w: 12, h: 2 },
    },
  ];
  const audit = (texts) =>
    peerReferenceFindings(1, { texts }, [shortReference]);
  expect(audit(lines)).toEqual([]);
  for (const mutation of [
    [lines[1]],
    [lines[0], { ...lines[1], painted: false }],
    [lines[0], { ...lines[1], text: "→ 02.B5" }],
    [lines[0], { ...lines[1], anchor: { x: 13, y: 18.5 } }],
    [lines[0], { ...lines[1], anchor: { x: 12, y: 15.3 } }],
  ])
    expect(audit(mutation)[0].kind).toBe("issued-peer-reference-unbound");
});

// Chromium measurements from 8b9c63b, conveyor Letter portrait, LTR, sheet 1.
it.each([
  [
    "CB1.3/L2",
    "→ SRC1.L2 04.A4",
    [99.785, 194.063, 1, 1],
    [57.672, 216.95, 18.997, 1.848],
  ],
  [
    "SRC1.PE",
    "→ M2.PE 05.C3",
    [138.995, 110.688, 31.007, 8.337],
    [165.722, 174.426, 16.812, 1.848],
  ],
  [
    "SRC1.L3",
    "→ CB2.5/L3 04.D3",
    [94.226, 109.188, 34.769, 8.337],
    [56.387, 141.573, 20.19, 1.848],
  ],
])(
  "rejects the reviewed displacement from %s",
  (ownerLabel, compact, owner, old) => {
    const box = ([x, y, w, h]) => ({ x, y, w, h });
    const obligation = {
      ...shortReference,
      ownerLabel,
      owners: [box(owner)],
      values: [`W-901 · ${ownerLabel} ${compact}`],
      compactValues: [compact],
    };
    const legal = [owner[0], owner[1] + owner[3] + 1.7, old[2], old[3]];
    const audit = (bbox) =>
      peerReferenceFindings(
        1,
        { texts: [{ ...marker(compact), bbox: box(bbox) }] },
        [obligation],
      );
    expect(audit(legal)).toEqual([]);
    expect(audit(old)).toEqual([
      expect.objectContaining({
        kind: "issued-peer-reference-owner-distance",
        gapMm: expect.any(Number),
      }),
    ]);
  },
);

it("requires a source name outside the directly adjacent band", () => {
  const obligation = {
    ...shortReference,
    ownerLabel: "R1.X2",
    owners: [{ x: 10, y: 10, w: 20, h: 8 }],
  };
  const bbox = { x: 10, y: 22, w: 20, h: 2 };
  const audit = (text) =>
    peerReferenceFindings(1, { texts: [{ ...marker(text), bbox }] }, [
      obligation,
    ]);
  for (const note of ["R1.X2 → 02.B4", "R1.X2 → CAP-X2 02.B4"])
    expect(audit(note)).toEqual([]);
  expect(audit("→ 02.B4")[0].kind).toBe("issued-peer-reference-subjectless");
  expect(audit("→ CAP-X2 02.B4")[0].kind).toBe(
    "issued-peer-reference-owner-distance",
  );
  expect(audit("R1.X4 → 02.B4")[0].kind).toBe("issued-peer-reference-unbound");
});

it("5.40 rejects card+free-note duplicate and outside drawing bounds", () => {
  const cardObligation = {
    kind: "conductor-peer",
    source: [
      { deviceUid: "TB1", terminalKey: "4" },
      { kind: "wire", uid: "W-CTL-004" },
      { deviceUid: "PS1", terminalKey: "-" },
    ],
    label: "W-CTL-004",
    peerName: "PS1.-",
    destinations: [
      { sheet: 3, zones: ["C5"] },
      { sheet: 4, zones: ["B2"] },
    ],
    values: ["W-CTL-004 · TB1.4 → PS1.- 03.C5 (also shown 04.B2)"],
    card: {
      element: "card-1",
      bbox: { x: 40, y: 100, w: 45, h: 10 },
      text: "W-CTL-004 → PS1.- 03.C5 (also shown 04.B2)",
    },
  };
  expect(peerReferenceFindings(7, { texts: [] }, [cardObligation])).toEqual([]);
  const dupFree = {
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(cardObligation.source),
    text: "W-CTL-004 · TB1.4 → PS1.- 03.C5",
    painted: true,
    fontSize: 2.5,
    bbox: { x: 15.99, y: 112, w: 30, h: 2 },
  };
  const zoneHeader = {
    frame: { x: 10, y: 10, w: 259, h: 196 },
    headerRule: { y: 12 },
    texts: [
      {
        sheetText: true,
        painted: true,
        text: "1",
        anchor: { x: 42, y: 15 },
        bbox: { x: 41, y: 13, w: 2, h: 2 },
      },
      {
        sheetText: true,
        painted: true,
        text: "2",
        anchor: { x: 84, y: 15 },
        bbox: { x: 83, y: 13, w: 2, h: 2 },
      },
      dupFree,
    ],
  };
  expect(
    peerReferenceFindings(7, zoneHeader, [cardObligation]).map((f) => f.kind),
  ).toEqual(
    expect.arrayContaining([
      "issued-peer-reference-duplicate-card-note",
      "issued-peer-reference-outside-drawing-bounds",
    ]),
  );
});

it("5.40 enforces 1.5 mm stack gap (#450) and nearest-owner tie-break (#507)", () => {
  const mkPeer = (key, y) => ({
    kind: "conductor-peer",
    source: ["S", key, "T"],
    ownerLabel: `R1.${key}`,
    owners: [{ x: 40, y, w: 4, h: 2 }],
    values: [`W${key} · R1.${key} → S2.${key} 01.A3`],
    compactValues: [`→ S2.${key} 01.A3`],
  });
  const mkNote = (key, y) => ({
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(["S", key, "T"]),
    text: `W${key} · R1.${key} → S2.${key} 01.A3`,
    painted: true,
    fontSize: 2.5,
    bbox: { x: 46, y, w: 28, h: 2 },
  });
  expect(
    peerReferenceFindings(5, { texts: [mkNote("1", 50), mkNote("2", 53.6)] }, [
      mkPeer("1", 50),
      mkPeer("2", 53.6),
    ]),
  ).toEqual([]);
  expect(
    peerReferenceFindings(5, { texts: [mkNote("1", 50), mkNote("2", 53.0)] }, [
      mkPeer("1", 50),
      mkPeer("2", 53.0),
    ]).map((f) => f.kind),
  ).toContain("issued-peer-reference-stack-gap");

  const w37Obligation = {
    kind: "conductor-peer",
    source: ["R1.14", "W37", "S2.14"],
    ownerLabel: "R1.14",
    owners: [{ x: 100, y: 185, w: 3, h: 3 }],
    foreignOwners: [{ x: 100, y: 175, w: 3, h: 3 }],
    values: ["W37 · R1.14 → S2.14 01.A3 (also shown 02.A3)"],
    compactValues: ["→ S2.14 01.A3 (also shown 02.A3)"],
  };
  const w37Note = (y) => ({
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(w37Obligation.source),
    text: w37Obligation.values[0],
    painted: true,
    fontSize: 2.5,
    bbox: { x: 105, y, w: 34, h: 2 },
  });
  expect(
    peerReferenceFindings(5, { texts: [w37Note(185)] }, [w37Obligation]),
  ).toEqual([]);
  expect(
    peerReferenceFindings(5, { texts: [w37Note(175)] }, [w37Obligation]).map(
      (f) => f.kind,
    ),
  ).toContain("issued-peer-reference-foreign-owner");
});

const relayInterfaceFixture = () => {
  const mkInterface = (tag, target) => ({
    kind: "terminal-interface",
    source: [tag, "14", "A1"],
    ownerLabel: `${tag} 14`,
    owners: [{ x: 230, y: tag === "K-R" ? 75 : 130, w: 3, h: 3 }],
    values: [`${tag} · contact terminal 14 → coil terminal A1 ${target}`],
    compactValues: [`→ ${tag} coil terminal A1 ${target}`],
  });
  return {
    obligations: [mkInterface("K-R", "05.B4"), mkInterface("K-Y", "05.C4")],
    krFull: {
      peerReference: "terminal-interface",
      peerSource: JSON.stringify(["K-R", "14", "A1"]),
      text: "K-R · contact terminal 14 → coil terminal A1 05.B4",
      painted: true,
      fontSize: 2.5,
      bbox: { x: 235, y: 75, w: 60, h: 2 },
    },
    kyFullWrapped: [
      {
        peerReference: "terminal-interface",
        peerSource: JSON.stringify(["K-Y", "14", "A1"]),
        peerGroup: "ky",
        text: "K-Y · contact terminal 14",
        painted: true,
        fontSize: 2.5,
        anchor: { x: 235, y: 129 },
        bbox: { x: 235, y: 127, w: 30, h: 2 },
      },
      {
        peerReference: "terminal-interface",
        peerSource: JSON.stringify(["K-Y", "14", "A1"]),
        peerGroup: "ky",
        text: "→ coil terminal A1 05.C4",
        painted: true,
        fontSize: 2.5,
        anchor: { x: 235, y: 132.5 },
        bbox: { x: 235, y: 130.5, w: 30, h: 2 },
      },
    ],
  };
};

it("5.40 rejects mixed peer-reference wording forms on a sheet (#483)", () => {
  const { obligations, krFull, kyFullWrapped } = relayInterfaceFixture();
  const kyCompactOld = {
    peerReference: "terminal-interface",
    peerSource: JSON.stringify(["K-Y", "14", "A1"]),
    text: "K-Y 14 → K-Y coil terminal A1 05.C4",
    painted: true,
    fontSize: 2.5,
    bbox: { x: 235, y: 130, w: 48, h: 2 },
  };
  expect(
    peerReferenceFindings(
      7,
      { texts: [krFull, kyCompactOld] },
      obligations,
    ).map((f) => f.kind),
  ).toContain("issued-peer-reference-mixed-form");
  expect(
    peerReferenceFindings(
      7,
      { texts: [krFull, ...kyFullWrapped] },
      obligations,
    ),
  ).toEqual([]);
});

it("5.40 rejects split arrows across wrapped peer-note lines (#409)", () => {
  const { obligations, krFull, kyFullWrapped } = relayInterfaceFixture();
  const kySplitArrow = [
    { ...kyFullWrapped[0], text: "K-Y · contact terminal 14 →" },
    { ...kyFullWrapped[1], text: "coil terminal A1 05.C4" },
  ];
  expect(
    peerReferenceFindings(
      7,
      { texts: [krFull, ...kySplitArrow] },
      obligations,
    ).map((f) => f.kind),
  ).toContain("issued-peer-reference-arrow-split");
});

it("5.40 rejects invented card alternates and unsupported sheet.zone tokens", () => {
  const mkCardObl = (cardText) => ({
    kind: "conductor-peer",
    source: [
      { deviceUid: "SRC1", terminalKey: "L3" },
      { kind: "wire", uid: "W-PWR-003-M2" },
      { deviceUid: "CB2", terminalKey: "5/L3" },
    ],
    label: "W-PWR-003-M2",
    peerName: "CB2.5/L3",
    ownerLabel: "SRC1.L3",
    destinations: [{ sheet: 2, zones: ["A4"] }],
    values: ["W-PWR-003-M2 · SRC1.L3 → CB2.5/L3 02.A4"],
    card: {
      element: "card-src1-l3",
      bbox: { x: 30, y: 40, w: 48, h: 10 },
      text: cardText,
      rowPrefixes: ["W-PWR-003-M2 → CB2.5/L3"],
      rowIndex: 0,
    },
  });
  const mkGeom = (cardText) => ({
    texts: [],
    tranche4: {
      cards: [
        {
          element: "card-src1-l3",
          headingElements: [],
          texts: [{ element: "row-1", painted: true, text: cardText }],
        },
      ],
    },
  });
  const valid = "W-PWR-003-M2 → CB2.5/L3 02.A4";
  expect(peerReferenceFindings(1, mkGeom(valid), [mkCardObl(valid)])).toEqual(
    [],
  );
  const invented = "W-PWR-003-M2 → CB2.5/L3 02.A4 (also shown 99.D6)";
  expect(
    peerReferenceFindings(1, mkGeom(invented), [mkCardObl(invented)]).map(
      (f) => f.kind,
    ),
  ).toEqual(
    expect.arrayContaining([
      "issued-peer-reference-missing",
      "issued-peer-reference-unsupported-destination",
    ]),
  );
  // Unsupported destination on a card with no peer obligation must also fail.
  expect(
    peerReferenceFindings(1, mkGeom("W-X → Y.1 99.D6"), []).map((f) => f.kind),
  ).toContain("issued-peer-reference-unsupported-destination");
});

it("5.40 ignores sheet.zone-shaped conductor designations on cards while still rejecting invented destinations", () => {
  const mkCardObl = (cardText) => ({
    kind: "conductor-peer",
    source: [
      { deviceUid: "SRC1", terminalKey: "L3" },
      { kind: "wire", uid: "W-PWR-003-M2" },
      { deviceUid: "CB2", terminalKey: "5/L3" },
    ],
    label: "77.A2",
    peerName: "CB2.5/L3",
    ownerLabel: "SRC1.L3",
    destinations: [{ sheet: 2, zones: ["A4"] }],
    values: ["77.A2 · SRC1.L3 → CB2.5/L3 02.A4"],
    card: {
      element: "card-src1-l3",
      bbox: { x: 30, y: 40, w: 48, h: 10 },
      text: cardText,
      rowPrefixes: ["77.A2 → CB2.5/L3"],
      rowIndex: 0,
    },
  });
  const mkGeom = (cardText) => ({
    texts: [],
    tranche4: {
      cards: [
        {
          element: "card-src1-l3",
          headingElements: [],
          texts: [{ element: "row-1", painted: true, text: cardText }],
        },
      ],
    },
  });
  // Passing control: 77.A2 is the conductor designation, 02.A4 is the supported destination.
  const valid = "77.A2 → CB2.5/L3 02.A4";
  expect(peerReferenceFindings(1, mkGeom(valid), [mkCardObl(valid)])).toEqual(
    [],
  );
  // Passing control with no peer obligation: 77.A2 designation alone is not a destination.
  expect(peerReferenceFindings(1, mkGeom("77.A2 → CB2.5/L3"), [])).toEqual([]);
  // Failing witnesses: an invented destination in the destination slot still fails.
  const invented = "77.A2 → CB2.5/L3 02.A4 (also shown 99.D6)";
  expect(
    peerReferenceFindings(1, mkGeom(invented), [mkCardObl(invented)]).map(
      (f) => f.kind,
    ),
  ).toEqual(
    expect.arrayContaining([
      "issued-peer-reference-missing",
      "issued-peer-reference-unsupported-destination",
    ]),
  );
  expect(
    peerReferenceFindings(1, mkGeom("77.A2 → CB2.5/L3 99.D6"), []).map(
      (f) => f.kind,
    ),
  ).toContain("issued-peer-reference-unsupported-destination");
});

it("5.40 fails a 1.40 mm peer stack gap and passes 1.50 mm (#450)", () => {
  const mkPeer = (key, y) => ({
    kind: "conductor-peer",
    source: ["S", key, "T"],
    ownerLabel: `R1.${key}`,
    owners: [{ x: 40, y, w: 4, h: 2 }],
    values: [`W${key} · R1.${key} → S2.${key} 01.A3`],
    compactValues: [`→ S2.${key} 01.A3`],
  });
  const mkNote = (key, y) => ({
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(["S", key, "T"]),
    text: `W${key} · R1.${key} → S2.${key} 01.A3`,
    painted: true,
    fontSize: 2.5,
    bbox: { x: 46, y, w: 28, h: 2 },
  });
  expect(
    peerReferenceFindings(5, { texts: [mkNote("1", 50), mkNote("2", 53.4)] }, [
      mkPeer("1", 50),
      mkPeer("2", 53.4),
    ]).map((f) => f.kind),
  ).toContain("issued-peer-reference-stack-gap");
  expect(
    peerReferenceFindings(5, { texts: [mkNote("1", 50), mkNote("2", 53.5)] }, [
      mkPeer("1", 50),
      mkPeer("2", 53.5),
    ]),
  ).toEqual([]);
});

it("5.40 fails peer notes above or below the measured drawing field", () => {
  const fieldSheet = (noteY) => ({
    frame: { x: 10, y: 10, w: 259, h: 196 },
    headerRule: { y: 12 },
    texts: [
      {
        sheetText: true,
        painted: true,
        text: "1",
        anchor: { x: 42, y: 15 },
        bbox: { x: 41, y: 13, w: 2, h: 2 },
      },
      {
        sheetText: true,
        painted: true,
        text: "2",
        anchor: { x: 84, y: 15 },
        bbox: { x: 83, y: 13, w: 2, h: 2 },
      },
      {
        sheetText: true,
        painted: true,
        text: "A",
        anchor: { x: 13, y: 40 },
        bbox: { x: 12, y: 38, w: 2, h: 2 },
      },
      {
        sheetText: true,
        painted: true,
        text: "B",
        anchor: { x: 13, y: 80 },
        bbox: { x: 12, y: 78, w: 2, h: 2 },
      },
      { ...marker(reference.text), bbox: { x: 40, y: noteY, w: 30, h: 2 } },
    ],
  });
  // Vertical drawing field spans [20, 100] from A@40, B@80 (rowH=40).
  expect(peerReferenceFindings(1, fieldSheet(50), [shortReference])).toEqual(
    [],
  );
  expect(
    peerReferenceFindings(1, fieldSheet(102), [shortReference]).map(
      (f) => f.kind,
    ),
  ).toContain("issued-peer-reference-outside-drawing-bounds");
  expect(
    peerReferenceFindings(1, fieldSheet(17), [shortReference]).map(
      (f) => f.kind,
    ),
  ).toContain("issued-peer-reference-outside-drawing-bounds");
});

it("5.40 accepts valid owner-bound two-line compact wrap and rejects displaced or misaligned wraps", () => {
  const compactObl = {
    ...shortReference,
    ownerLabel: "R1.X2",
    owners: [{ x: 40, y: 40, w: 3, h: 3 }],
  };
  const twoLineCompact = (x, y, line2OffsetY = 3.5) => [
    {
      ...marker("→ CAP-X2"),
      peerGroup: "cw1",
      anchor: { x, y: y + 2 },
      bbox: { x, y, w: 18, h: 2 },
    },
    {
      ...marker("02.B4"),
      peerGroup: "cw1",
      anchor: { x, y: y + 2 + line2OffsetY },
      bbox: { x, y: y + line2OffsetY, w: 10, h: 2 },
    },
  ];
  expect(
    peerReferenceFindings(1, { texts: twoLineCompact(44, 40) }, [compactObl]),
  ).toEqual([]);
  expect(
    peerReferenceFindings(1, { texts: twoLineCompact(48, 40) }, [
      compactObl,
    ]).map((f) => f.kind),
  ).toContain("issued-peer-reference-owner-distance");
  expect(
    peerReferenceFindings(1, { texts: twoLineCompact(44, 40, 5.0) }, [
      compactObl,
    ]).map((f) => f.kind),
  ).toContain("issued-peer-reference-unbound");
});

it("5.40 validates multi-sheet destination sets in linear time without exponential expansion", () => {
  const destinations = Array.from({ length: 30 }, (_, i) => ({
    sheet: i + 2,
    zones: ["A1", "A2", "B1", "B2"],
  }));
  const printedDest = `${String(destinations[0].sheet).padStart(2, "0")}.B2 (also shown ${destinations
    .slice(1)
    .map((d) => `${String(d.sheet).padStart(2, "0")}.A2`)
    .join(", ")})`;
  const obl = {
    kind: "conductor-peer",
    source: ["SRC", "W1", "DST"],
    label: "W1",
    ownerLabel: "SRC.1",
    peerName: "DST.1",
    destinations,
    values: [`W1 · SRC.1 → DST.1 ${printedDest}`],
  };
  const validNote = {
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(obl.source),
    text: `W1 · SRC.1 → DST.1 ${printedDest}`,
    painted: true,
    fontSize: 2.5,
  };
  expect(peerReferenceFindings(1, { texts: [validNote] }, [obl])).toEqual([]);
  const badNote = {
    ...validNote,
    text: validNote.text.replace("31.A2", "31.D6"),
  };
  expect(
    peerReferenceFindings(1, { texts: [badNote] }, [obl]).map((f) => f.kind),
  ).toContain("issued-peer-reference-unbound");
});

it("5.44 flags a conductor peer note sitting nearer a foreign conductor segment than its owner", () => {
  const obl = {
    kind: "conductor-peer",
    source: ["PS1.+", "W-CTL-012", "S2.11"],
    ownerLabel: "PS1.+",
    owners: [{ x: 53.35, y: 95.35, w: 1.3, h: 1.3 }],
    supports: [{ x: 72, y: 96, w: 31, h: 0 }],
    foreignOwners: [{ x: 102.35, y: 95.35, w: 1.3, h: 1.3 }],
    foreignConductors: [{ x: 75, y: 65, w: 0, h: 31 }],
    values: ["W-CTL-012 · PS1.+ → S2.11 07.B2"],
    compactValues: ["→ S2.11 07.B2"],
  };
  const note = (bbox) => ({
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(obl.source),
    text: obl.values[0],
    painted: true,
    fontSize: 2.5,
    bbox,
  });
  // Nearer foreign vertical run (1.7 mm) than own horizontal run (4.2 mm).
  expect(
    peerReferenceFindings(
      7,
      { texts: [note({ x: 76.7, y: 89.8, w: 20, h: 2 })] },
      [obl],
    ).map((f) => f.kind),
  ).toContain("issued-peer-reference-foreign-owner");
  // Nearer own terminal/run (2.9 mm) than foreign conductor (3.4 mm).
  expect(
    peerReferenceFindings(
      7,
      { texts: [note({ x: 55.6, y: 99.4, w: 30, h: 2 })] },
      [obl],
    ),
  ).toEqual([]);
});

it("5.44 excludes coincident shared-stem foreign runs while flagging distinct nearer runs", () => {
  const base = {
    kind: "conductor-peer",
    source: ["PS1.+", "W-CTL-012", "S2.11"],
    ownerLabel: "PS1.+",
    owners: [{ x: 70, y: 95.35, w: 1.3, h: 1.3 }],
    supports: [{ x: 72, y: 96, w: 31, h: 0 }],
    foreignConductors: [
      { x: 72, y: 96, w: 5, h: 0 },
      { x: 77, y: 65, w: 0, h: 31 },
    ],
    values: ["W-CTL-012 · PS1.+ → S2.11 07.B2"],
    compactValues: ["→ S2.11 07.B2"],
  };
  const compact = (bbox) => ({
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(base.source),
    text: base.compactValues[0],
    painted: true,
    fontSize: 2.5,
    bbox,
  });
  // Bare-compact note 1.74 mm from owner terminal and 1.0 mm from the shared stem [72, 77]:
  // shared stem is excluded, while distinct vertical run at x=77 is 2.69 mm away (>= 0.5 mm margin) -> passes.
  expect(
    peerReferenceFindings(
      7,
      { texts: [compact({ x: 73.0, y: 97.0, w: 1.5, h: 1.8 })] },
      [base],
    ),
  ).toEqual([]);
  // Moving beside the distinct foreign vertical run (0.5 mm away) still flags foreign owner.
  expect(
    peerReferenceFindings(
      7,
      { texts: [compact({ x: 77.5, y: 94.0, w: 4.0, h: 1.8 })] },
      [base],
    ).map((f) => f.kind),
  ).toContain("issued-peer-reference-foreign-owner");
});
