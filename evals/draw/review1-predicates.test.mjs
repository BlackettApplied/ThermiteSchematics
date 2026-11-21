import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { polarityFindings, markFindings } from "./symbol-fidelity.mjs";
import {
  loopRouteFindings,
  attachmentAudit,
  strokesIncludingAttachments,
} from "./routing-hygiene.mjs";
import { continuationTypography } from "./continuation-typography.mjs";
import { dependencyFindings } from "./document-dependencies.mjs";
import { conductorLabelCoverage } from "./conductor-label-coverage.mjs";
import { classifyTextGeometry } from "./text-classification.mjs";
import { printedZones } from "./printed-zones.mjs";
const bbox = { x: 0, y: 0, w: 20, h: 20 };
const line = (element, a, b, extra = {}) => ({
  element,
  bbox,
  points: [a, b],
  inkSegments: [[a, b]],
  stroke: 0.32,
  fill: "none",
  dash: "none",
  cls: "",
  ...extra,
});
const p = (x, y) => ({ x, y });
const text = (text, extra = {}) => ({
  element: "text",
  text,
  bbox,
  anchor: p(0, 0),
  ...extra,
});
const geometry = (extra) => ({
  width: 100,
  height: 100,
  texts: [],
  shapes: [],
  terminals: [],
  devices: [],
  ...extra,
});
const terminal = (key, role) => ({
  id: { deviceUid: "d", terminalKey: key },
  role,
});
const ir = {
  devices: [{ uid: "d", designation: "D", typeId: "type" }],
  deviceTypes: [
    { id: "type", symbol: "thermite:level-switch", ports: { P: {} } },
  ],
  terminals: [
    terminal("+", "dc_positive_output"),
    terminal("-", "dc_return_output"),
  ],
  functions: [],
  wires: [],
  nets: [],
};
const port = (terminal, x, y) => ({
  element: terminal,
  deviceUid: "d",
  terminal,
  symbolPortId: terminal,
  symbolGroup: "symbol",
  point: p(x, y),
});
const qualifier = (polarity, a, b, portId) =>
  line(polarity, a, b, {
    deviceUid: "d",
    symbolGroup: "symbol",
    symbol: "power-source-dc",
    qualifier: "polarity",
    polarity,
    symbolPortId: portId,
  });
function polarity() {
  return geometry({
    terminals: [port("+", 0, 0), port("-", 0, 20)],
    shapes: [
      qualifier("positive", p(4, 3), p(6, 3), "+"),
      qualifier("positive", p(5, 2), p(5, 4), "+"),
      qualifier("negative", p(4, 17), p(6, 17), "-"),
    ],
  });
}
function mark(role, a, b) {
  return line(role, a, b, {
    markGroup: "mark",
    mark: "level-nc",
    deviceUid: "d",
    functionKey: "contact",
    circuitFunctions: [{ deviceUid: "d", functionKey: "contact" }],
    primitiveRole: role,
  });
}
const contactIr = {
  ...ir,
  functions: [
    {
      id: { deviceUid: "d", functionKey: "contact" },
      kind: "contact",
      normal_state: "closed",
      terminals: [
        { deviceUid: "d", terminalKey: "1" },
        { deviceUid: "d", terminalKey: "2" },
      ],
    },
  ],
};
function contact() {
  return geometry({
    shapes: [
      mark("contact-moving", p(4, 3), p(4, 9)),
      mark("contact-fixed", p(8, 3), p(8, 9)),
      mark("contact-state", p(2, 10), p(10, 2)),
      mark("operating-link", p(4, -4), p(4, 2)),
    ].map((s) =>
      s.primitiveRole === "operating-link"
        ? {
            ...s,
            inkSegments: [
              [p(4, -4), p(4, -2.5)],
              [p(4, -1.5), p(4, 0)],
            ],
          }
        : s,
    ),
  });
}
describe("M6 independent emitted-geometry comparisons", () => {
  it("polarity orientation kills rotated qualifier and stripped role", () => {
    expect(polarityFindings(polarity(), ir)).toEqual([]);
    const bad = polarity();
    bad.shapes[2] = qualifier("negative", p(5, 16), p(5, 18), "-");
    expect(
      polarityFindings(bad, ir).some(
        (f) => f.kind === "polarity-primitive-not-upright",
      ),
    ).toBe(true);
    bad.shapes[2].qualifier = undefined;
    expect(
      polarityFindings(bad, ir).some(
        (f) => f.kind === "polarity-primitive-not-upright",
      ),
    ).toBe(true);
  });
  it("polarity adjacency kills swapped and forged port identities", () => {
    const bad = polarity();
    bad.shapes[2] = qualifier("negative", p(4, 2), p(6, 2), "-");
    expect(
      polarityFindings(bad, ir).some(
        (f) => f.kind === "polarity-not-adjacent-own-port",
      ),
    ).toBe(true);
    bad.shapes[2] = qualifier("negative", p(4, 17), p(6, 17), "+");
    expect(
      polarityFindings(bad, ir).some(
        (f) => f.kind === "polarity-not-adjacent-own-port",
      ),
    ).toBe(true);
  });
  it("polarity own-lead overlap is independent of upright marker", () => {
    const bad = polarity();
    bad.shapes.push(
      line("lead", p(2, 17), p(8, 17), { symbolGroup: "symbol" }),
    );
    expect(
      polarityFindings(bad, ir).some(
        (f) => f.kind === "polarity-ink-merged-with-lead",
      ),
    ).toBe(true);
  });
  it("operating dashes merge collinear ink, reject solid duplicate and missing marker", () => {
    expect(markFindings(contact(), contactIr)).toEqual([]);
    const bad = contact();
    bad.shapes.push(mark("operator", p(4, -4), p(4, 2)));
    expect(
      markFindings(bad, contactIr).some(
        (f) => f.kind === "operating-link-without-visible-dashes",
      ),
    ).toBe(true);
    expect(
      markFindings(
        {
          ...contact(),
          shapes: contact().shapes.filter(
            (s) => s.primitiveRole !== "operating-link",
          ),
        },
        contactIr,
      ).some((f) => f.kind === "operating-link-without-visible-dashes"),
    ).toBe(true);
  });
  it("closed slash must cross both bars; NO has no slash obligation", () => {
    const bad = contact();
    bad.shapes[2] = mark("contact-state", p(2, 8), p(6, 4));
    expect(
      markFindings(bad, contactIr).some(
        (f) => f.kind === "closed-contact-slash-misses-bars",
      ),
    ).toBe(true);
    expect(
      markFindings(bad, {
        ...contactIr,
        functions: contactIr.functions.map((f) => ({
          ...f,
          normal_state: "open",
        })),
      }),
    ).toEqual([]);
  });
  it("earth widths descend below stem in sheet coordinates", () => {
    const shapes = [
      line("a", p(1, 4), p(9, 4)),
      line("b", p(2, 6), p(8, 6)),
      line("c", p(3, 8), p(7, 8)),
    ].map((s) => ({
      ...s,
      markGroup: "earth",
      mark: "earth",
      primitiveRole: "earth-bar",
    }));
    expect(markFindings(geometry({ shapes }), ir)).toEqual([]);
    shapes[0] = {
      ...shapes[0],
      points: [p(4, 1), p(4, 9)],
      inkSegments: [[p(4, 1), p(4, 9)]],
    };
    expect(
      markFindings(geometry({ shapes }), ir).some(
        (f) => f.kind === "earth-primitive-not-upright",
      ),
    ).toBe(true);
  });
});
const route = (length = 3) =>
  line("route", p(0, 0), p(10, 10), {
    loopConductor: "w",
    wire: "w",
    points: [p(0, 0), p(5, 0), p(5, length), p(10, length)],
  });
const wire = {
  uid: "w",
  designation: "W",
  endpoints: [
    { terminal: { deviceUid: "d", terminalKey: "+" } },
    { terminal: { deviceUid: "d", terminalKey: "-" } },
  ],
};
const wireIr = { ...ir, wires: [wire] };
describe("M7 route and incident attachment comparisons", () => {
  it("loop route population kills 1.857 mm and preserves numeric 3 mm tolerance", () => {
    expect(loopRouteFindings(geometry({ shapes: [route()] }), wireIr)).toEqual(
      [],
    );
    for (const length of [2.99, 1.857, 0.8])
      expect(
        loopRouteFindings(geometry({ shapes: [route(length)] }), wireIr).some(
          (f) => f.kind === "jog-under-3mm",
        ),
      ).toBe(true);
    expect(
      loopRouteFindings(geometry({ shapes: [route(2.99999998)] }), wireIr),
    ).toEqual([]);
    expect(
      loopRouteFindings(
        geometry({ shapes: [{ ...route(1), loopConductor: "fake" }] }),
        wireIr,
      ).some((f) => f.kind === "loop-conductor-source-unresolved"),
    ).toBe(true);
    expect(
      loopRouteFindings(
        geometry({ shapes: [line("assembly", p(0, 0), p(5, 0))] }),
        wireIr,
      ),
    ).toEqual([]);
  });
  it("loop detour uses exact route and clipped fragments", () => {
    const bad = route();
    bad.points = [p(10, 10), p(90, 10), p(90, 20), p(10, 20)];
    expect(
      loopRouteFindings(geometry({ shapes: [bad] }), wireIr).some(
        (f) => f.kind === "route-detour",
      ),
    ).toBe(true);
    expect(
      loopRouteFindings(
        geometry({
          shapes: [{ ...bad, viewport: { x: 0, y: 0, w: 5, h: 5 } }],
        }),
        wireIr,
      ),
    ).toEqual([]);
  });
  const ray = () =>
    line("ray", p(0, 0), p(5, 0), {
      appearanceScope: "a",
      attachment: '["d","+"]',
      stroke: 0.32,
    });
  const incident = () =>
    line("wire", p(0, 0), p(0, 10), {
      appearanceScope: "a",
      conductor: true,
      wire: "w",
      ownedLandings: [
        {
          deviceUid: "d",
          terminal: "+",
          appearanceScope: "a",
          endpoint: p(0, 0),
        },
      ],
    });
  it("attachment weight uses incident native conductor including tag-lane extension", () => {
    expect(
      attachmentAudit(geometry({ shapes: [ray(), incident()] }), ir).findings,
    ).toEqual([]);
    expect(
      attachmentAudit(
        geometry({ shapes: [{ ...ray(), stroke: 0.35 }, incident()] }),
        ir,
      ).findings[0]?.kind,
    ).toBe("attachment-heavier-than-incident-conductor");
    expect(
      attachmentAudit(
        geometry({
          shapes: [
            { ...ray(), stroke: 0.35 },
            { ...incident(), stroke: 0.55 },
          ],
        }),
        ir,
      ).findings,
    ).toEqual([]);
    expect(
      attachmentAudit(geometry({ shapes: [ray()] }), ir).unassessed,
    ).toHaveLength(1);
    expect(
      attachmentAudit(
        geometry({
          shapes: [{ ...ray(), attachment: '["foreign","+"]' }, incident()],
        }),
        ir,
      ).findings[0]?.kind,
    ).toBe("attachment-owner-unresolved");
  });
  it("incident ray count includes terminal attachments", () => {
    const dot = line("dot", p(0, 0), p(0, 0), {
      bbox: { x: -0.1, y: -0.1, w: 0.2, h: 0.2 },
      cls: "junction-dot",
    });
    const rays = [
      incident(),
      { ...incident(), element: "other", points: [p(-5, 0), p(0, 0)] },
      ray(),
    ];
    expect(
      strokesIncludingAttachments(geometry({ shapes: [dot, ...rays] })),
    ).toEqual([]);
    expect(
      strokesIncludingAttachments(
        geometry({ shapes: [dot, ...rays.slice(0, 2)] }),
      )[0]?.incidentRays,
    ).toBe(2);
  });
});
const c = { id: "C001", toSheet: 2, conductor: "W" },
  sheet = {
    number: 1,
    view: { kind: "power", title: "one" },
    continuations: [c],
  },
  peer = { ...sheet, number: 2, continuations: [{ ...c, toSheet: 1 }] };
const packet = { sheets: [sheet, peer] };
const connector = {
  element: "connector",
  id: "C001",
  toSheet: 2,
  anchor: p(0, 0),
};
const labels = () => [
  text("C001 / 02.A1", { continuationLink: "connector" }),
  text("W", {
    element: "body",
    continuationLink: "connector",
    anchor: p(0, 5),
  }),
];
it("M4 measures complete zone strips beyond D/6, including AA and multi-digit columns", () => {
  const zoneText = (value, x, y) =>
    text(value, {
      element: `zone-${value}`,
      sheetText: true,
      bbox: { x, y, w: 2, h: 2 },
      anchor: p(x, y + 2),
    });
  const numbers = Array.from({ length: 12 }, (_, i) =>
    zoneText(String(i + 1), 20 + i * 10, 10),
  );
  const letters = Array.from({ length: 27 }, (_, i) =>
    zoneText(i === 26 ? "AA" : String.fromCharCode(65 + i), 2, 30 + i * 5),
  );
  const fake = zoneText("AB", 2, 165);
  fake.row = "a-report-row";
  const g = geometry({
    width: 200,
    height: 200,
    frame: { x: 0, y: 0, w: 200, h: 200 },
    headerRule: { x: 0, y: 5, w: 200, h: 0 },
    texts: [...numbers, ...letters, fake],
  });
  classifyTextGeometry(g);
  expect(printedZones(g)).toEqual({ numbers, letters });
  expect([...numbers, ...letters].every((t) => t.furniture)).toBe(true);
  expect(fake.furniture).toBe(false);
  for (const target of [letters[4], letters[26], numbers[9]]) {
    const near = labels().map((t) => ({
      ...t,
      bbox: { ...target.bbox, x: target.bbox.x + 3 },
    }));
    const result = continuationTypography(
      sheet,
      { ...g, connectors: [connector], texts: [...g.texts, ...near] },
      wireIr,
    );
    expect(result.findings).toEqual([]);
    expect(
      result.zoneClearances.find((m) => m.zoneText === target.text)?.gapMm,
    ).toBe(1);
  }
  // Partial strips and owned labels do not manufacture zone evidence.
  const incomplete = {
    ...g,
    texts: [...numbers.filter((t) => t.text !== "7"), ...letters, fake],
  };
  expect(printedZones(incomplete)).toEqual({ numbers: [], letters: [] });
});
describe("M4 continuation line units and #230 label-free fragments", () => {
  it("one native identifier line, not merely concatenated bytes", () => {
    const g = geometry({ connectors: [connector], texts: labels() });
    expect(continuationTypography(sheet, g, wireIr).findings).toEqual([]);
    const longIr = {
        ...wireIr,
        wires: [{ ...wire, designation: "PLC1-DO0-STOP" }],
      },
      longSheet = {
        ...sheet,
        continuations: [{ ...c, conductor: "PLC1-DO0-STOP" }],
      };
    g.texts = [
      labels()[0],
      text("PLC1-DO0-", { continuationLink: "connector", anchor: p(0, 5) }),
      text("STOP", { continuationLink: "connector", anchor: p(0, 9) }),
    ];
    expect(continuationTypography(longSheet, g, longIr).findings[0]?.kind).toBe(
      "continuation-identifier-split",
    );
    g.texts[2].anchor.y = 5;
    expect(continuationTypography(longSheet, g, longIr).findings).toEqual([]);
    g.texts[2].continuationLink = "foreign";
    expect(continuationTypography(longSheet, g, longIr).findings[0]?.kind).toBe(
      "continuation-typography-owner-or-identity",
    );
  });
  it("continuation-only sheet is measured; hidden/foreign/cross-view labels fail", () => {
    const g = geometry({
      connectors: [connector],
      texts: labels(),
      shapes: [
        {
          ...route(),
          loopConductor: undefined,
          conductor: true,
          edgeOwnerKey: ["wire", "w"],
        },
      ],
    });
    expect(
      conductorLabelCoverage(sheet, packet, g, [g, geometry({})], wireIr)
        .findings,
    ).toEqual([]);
    g.texts = [];
    expect(
      conductorLabelCoverage(sheet, packet, g, [g, geometry({})], wireIr)
        .findings[0]?.kind,
    ).toBe("conductor-fragment-without-visible-identity");
    const other = geometry({
      texts: [text("W", { wire: "w" })],
      shapes: [{ ...route(), conductor: true }],
    });
    expect(
      conductorLabelCoverage(
        sheet,
        {
          sheets: [sheet, { ...peer, view: { kind: "power", title: "other" } }],
        },
        g,
        [g, other],
        wireIr,
      ).findings,
    ).toHaveLength(1);
  });
});
describe("M3 printed notes / native dependencies / issued visible rows", () => {
  const source = geometry({
      devices: [{ deviceUid: "d" }],
      terminals: [{ deviceUid: "d", terminal: "+" }],
      texts: [text("see wire schedule")],
    }),
    report = { number: 2, view: { kind: "wires" } },
    first = { number: 1, view: { kind: "wiring" } };
  const pk = { sheets: [first, report] };
  const rows = () =>
    geometry({
      texts: [
        text("W", { row: "w", columnIndex: 0 }),
        text("D.+", { row: "w", columnIndex: 1 }),
        text("D.-", { row: "w", columnIndex: 2 }),
      ],
    });
  it("sufficient visible exact scope passes; absent, filtered, hidden and forged rows fail", () => {
    expect(
      dependencyFindings(first, pk, source, [source, rows()], wireIr).findings,
    ).toEqual([]);
    for (const broken of [
      geometry({}),
      {
        ...rows(),
        texts: rows().texts.map((t) => ({ ...t, reviewPainted: false })),
      },
      { ...rows(), texts: rows().texts.map((t) => ({ ...t, row: "foreign" })) },
      {
        ...rows(),
        texts: rows().texts.map((t) => ({ ...t, text: "FOREIGN" })),
      },
    ])
      expect(
        dependencyFindings(first, pk, source, [source, broken], wireIr)
          .findings[0]?.kind,
      ).toBe("printed-document-target-insufficient");
  });
  it("inventory is reconciled, cannot forge scope/snapshot or invent invisible promise", () => {
    const dep = {
      id: JSON.stringify([1, "conductor-incidence", "text"]),
      owner: { sheet: 1, noteId: "text" },
      need: "conductor-incidence",
      snapshotDigest: createHash("sha256")
        .update(JSON.stringify(wireIr))
        .digest("hex"),
      requiredFacts: ["w"],
    };
    expect(
      dependencyFindings(
        first,
        { ...pk, documentDependencies: [dep] },
        source,
        [source, rows()],
        wireIr,
      ).findings,
    ).toEqual([]);
    for (const forged of [
      { ...dep, requiredFacts: [] },
      { ...dep, snapshotDigest: "stale" },
    ])
      expect(
        dependencyFindings(
          first,
          { ...pk, documentDependencies: [forged] },
          source,
          [source, rows()],
          wireIr,
        ).findings[0]?.kind,
      ).toBe("document-dependency-inventory-mismatch");
    expect(
      dependencyFindings(
        first,
        { ...pk, documentDependencies: [dep] },
        geometry({}),
        [geometry({}), rows()],
        wireIr,
      ).findings[0]?.kind,
    ).toBe("document-dependency-without-visible-pointer");
  });
  it("wrong-device terminal report fails and generic honest partial-view wording passes", () => {
    const g = geometry({
      texts: [text("1 other terminals: schedule", { deviceUid: "d" })],
      terminals: [{ deviceUid: "d", terminal: "+" }],
    });
    expect(
      dependencyFindings(first, pk, g, [g, rows()], wireIr).findings[0]?.need,
    ).toBe("terminal-inventory");
    const partial = geometry({
      texts: [
        text(
          "Selected path only; other authored connections may be outside this view.",
        ),
      ],
    });
    expect(
      dependencyFindings(first, pk, partial, [partial, rows()], wireIr)
        .findings,
    ).toEqual([]);
  });
});

it("M3 sufficient documents require a printed final target location", () => {
  const first = { number: 1, view: { kind: "wiring" } },
    report = { number: 2, view: { kind: "wires" } },
    pk = { sheets: [first, report] };
  const g = geometry({
    terminals: [{ deviceUid: "d", terminal: "+" }],
    texts: [text("see wire schedule")],
  });
  const q = geometry({
    texts: [
      text("W", { row: "w", columnIndex: 0 }),
      text("D.+", { row: "w", columnIndex: 1 }),
      text("D.-", { row: "w", columnIndex: 2 }),
    ],
  });
  expect(
    dependencyFindings(first, pk, g, [g, q], wireIr).targetFindings[0]?.kind,
  ).toBe("printed-document-target-location-missing");
});

it("M3 source-scoped issued rows with a measured printed destination pass", () => {
  const first = { number: 1, view: { kind: "wiring" } },
    report = { number: 2, view: { kind: "wires" } },
    pk = { sheets: [first, report] };
  const g = geometry({
    terminals: [{ deviceUid: "d", terminal: "+" }],
    texts: [text("see wire schedule 2.A1")],
  });
  const grid = [
    ...Array.from({ length: 6 }, (_, i) =>
      text(String(i + 1), {
        anchor: p(10 + i * 12, 3),
        bbox: { x: 10 + i * 12, y: 3, w: 1, h: 1 },
      }),
    ),
    ...Array.from("ABCD", (v, i) =>
      text(v, {
        anchor: p(3, 10 + i * 20),
        bbox: { x: 3, y: 10 + i * 20, w: 1, h: 1 },
      }),
    ),
  ];
  const q = geometry({
    texts: [
      text("W", { row: "w", columnIndex: 0 }),
      text("D.+", { row: "w", columnIndex: 1 }),
      text("D.-", { row: "w", columnIndex: 2 }),
      ...grid,
    ],
  });
  expect(
    dependencyFindings(first, pk, g, [g, q], wireIr).targetFindings,
  ).toEqual([]);
});
it("M3 native network scope checks exact ports, protocols and status", () => {
  const source = {
    devices: [
      { uid: "a", designation: "A", typeId: "a" },
      { uid: "b", designation: "B", typeId: "b" },
    ],
    deviceTypes: [
      {
        id: "a",
        ports: { P1: { medium: "ethernet" }, P2: { medium: "ethernet" } },
      },
      { id: "b", ports: { IN: { medium: "ethernet" } } },
    ],
    relations: [
      {
        uid: "link",
        designation: "NET1",
        fromDeviceUid: "a",
        toDeviceUid: "b",
        connection: {
          fromPort: "P1",
          toPort: "IN",
          protocol: "Ethernet",
          status: "planned",
        },
      },
    ],
  };
  const first = { number: 1, view: { kind: "communication" } },
    report = { number: 2, view: { kind: "network" } },
    pk = { sheets: [first, report] },
    g = geometry({
      devices: [{ deviceUid: "a" }, { deviceUid: "b" }],
      texts: [
        text("see communication schedule for status and unconnected ports"),
      ],
    });
  const cells = (row, values) =>
    values.map((value, columnIndex) => text(value, { row, columnIndex }));
  const q = geometry({
    texts: [
      ...cells("link", [
        "NET1",
        "Ethernet",
        "A: P1 — uplink",
        "B: IN",
        "planned",
      ]),
      ...cells('["a","P2"]', [
        "--",
        "ethernet",
        "A.P2",
        "Unconnected",
        "Unspecified",
      ]),
    ],
  });
  expect(dependencyFindings(first, pk, g, [g, q], source).findings).toEqual([]);
  for (const [columnIndex, value] of [
    [2, "A: P10"],
    [4, "plannedX"],
    [1, "Different protocol"],
  ]) {
    const bad = {
      ...q,
      texts: q.texts.map((t) =>
        t.row === "link" && t.columnIndex === columnIndex
          ? { ...t, text: value }
          : t,
      ),
    };
    expect(
      dependencyFindings(first, pk, g, [g, bad], source).findings[0]?.kind,
    ).toBe("printed-document-target-insufficient");
  }
});
it("M3 complete cable inventory preserves authored ends and unassigned core state", () => {
  const source = {
    ...wireIr,
    cables: [
      {
        uid: "cable",
        designation: "CBL",
        typeId: "ct",
        assignments: [
          {
            id: "1",
            usage: "spare",
            endpoints: [
              { terminal: { deviceUid: "d", terminalKey: "-" } },
              { terminal: { deviceUid: "d", terminalKey: "+" } },
            ],
          },
        ],
      },
    ],
    cableTypes: [{ id: "ct", conductors: [{ id: "1" }, { id: "2" }] }],
    cableConductors: [
      {
        id: { cableUid: "cable", conductorId: "1" },
        endpoints: wire.endpoints,
      },
    ],
  };
  const first = { number: 1, view: { kind: "signal-loop" } },
    report = { number: 2, view: { kind: "wires" } },
    pk = { sheets: [first, report] },
    g = geometry({
      devices: [{ deviceUid: "d" }],
      texts: [text("core details remain in the conductor view")],
    });
  const cells = (row, values) =>
    values.map((value, columnIndex) => text(value, { row, columnIndex }));
  const q = geometry({
    texts: [
      ...cells("w", ["W", "D.+", "D.-"]),
      ...cells('["cable","1"]', [
        "CBL/1",
        "D.-",
        "D.+",
        "",
        "spare; connected",
      ]),
      ...cells('["cable","2"]', [
        "CBL/2",
        "Unterminated",
        "Unterminated",
        "",
        "unassigned; unassigned",
      ]),
    ],
  });
  const coreOnly = { ...q, texts: q.texts.filter((t) => t.row !== "w") };
  expect(
    dependencyFindings(first, pk, g, [g, coreOnly], source).findings,
  ).toEqual([]);
  expect(dependencyFindings(first, pk, g, [g, q], source).findings).toEqual([]);
  for (const bad of [
    { ...q, texts: q.texts.filter((t) => t.row !== '["cable","2"]') },
    {
      ...q,
      texts: q.texts.map((t) =>
        t.row === '["cable","1"]' && t.columnIndex === 1
          ? { ...t, text: "D.+" }
          : t,
      ),
    },
  ])
    expect(
      dependencyFindings(first, pk, g, [g, bad], source).findings[0]?.kind,
    ).toBe("printed-document-target-insufficient");
});
it("M3 generic circuit promise requires every native function in scope", () => {
  const source = {
      ...wireIr,
      functions: [
        { id: { deviceUid: "d", functionKey: "one" } },
        { id: { deviceUid: "d", functionKey: "two" } },
      ],
    },
    first = { number: 1, view: { kind: "power" } },
    report = { number: 2, view: { kind: "circuit", title: "Functions" } },
    pk = { sheets: [first, report] },
    request = {
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Functions",
          groups: [
            {
              id: "main",
              functions: [
                { device: { by: "uid", value: "d" }, key: "one" },
                { device: { by: "designation", value: "D" }, key: "two" },
              ],
            },
          ],
        },
      ],
    };
  const g = geometry({
      devices: [{ deviceUid: "d" }],
      texts: [text("See circuit views or packet coverage.")],
    }),
    q = geometry({
      shapes: [
        { deviceUid: "d", functionKey: "one", circuitGroup: "main" },
        { deviceUid: "d", functionKey: "two", circuitGroup: "main" },
      ],
    });
  expect(
    dependencyFindings(first, pk, g, [g, q], source, request).findings,
  ).toEqual([]);
  expect(
    dependencyFindings(
      first,
      pk,
      g,
      [g, { ...q, shapes: q.shapes.slice(0, 1) }],
      source,
      request,
    ).findings[0]?.kind,
  ).toBe("printed-document-target-insufficient");
  // Kind is determined by the authored request; the planner cannot veto or
  // manufacture a circuit appearance by changing its kind field.
  expect(
    dependencyFindings(
      first,
      {
        sheets: [first, { ...report, view: { ...report.view, kind: "power" } }],
      },
      g,
      [g, q],
      source,
      request,
    ).findings,
  ).toEqual([]);
  for (const badRequest of [
    undefined,
    {
      views: [
        {
          ...request.views[0],
          format: "schematic-view/0.2",
          family: "power",
        },
      ],
    },
    { views: [{ ...request.views[0], title: "Another circuit" }] },
    {
      views: [
        {
          ...request.views[0],
          groups: [
            { id: "foreign", functions: request.views[0].groups[0].functions },
          ],
        },
      ],
    },
    {
      views: [
        {
          ...request.views[0],
          groups: [
            {
              id: "main",
              functions: request.views[0].groups[0].functions.slice(0, 1),
            },
          ],
        },
      ],
    },
  ])
    expect(
      dependencyFindings(first, pk, g, [g, q], source, badRequest).findings[0]
        ?.reason,
    ).toBe("no-sufficient-issued-circuit-view");
});
it.each(["power", "control"])(
  "M3 a complete rooted %s sheet cannot discharge a circuit promise, even with forged planner kind",
  (family) => {
    const source = {
      ...wireIr,
      functions: ["one", "two"].map((functionKey) => ({
        id: { deviceUid: "d", functionKey },
      })),
    };
    const g = geometry({
      devices: [{ deviceUid: "d" }],
      texts: [text("See circuit views or packet coverage.")],
      shapes: source.functions.map((f) => ({
        deviceUid: f.id.deviceUid,
        functionKey: f.id.functionKey,
      })),
    });
    const authored = {
      format: "schematic-view/0.2",
      family,
      title: "Rooted",
      root: { by: "uid", value: "d" },
    };
    for (const kind of [family, "circuit"]) {
      const sheet = {
        number: 1,
        view: { ...authored, root: { deviceUid: "d" }, kind },
      };
      const findings = dependencyFindings(
        sheet,
        { sheets: [sheet] },
        g,
        [g],
        source,
        { views: [authored] },
      ).findings;
      expect(findings[0]?.kind).toBe("printed-document-target-insufficient");
      expect(findings[0]).toMatchObject({
        need: "coverage",
        reason: "no-sufficient-issued-circuit-view",
        missingFunctions: source.functions.map((f) => f.id),
      });
      // Removing the planner root cannot make its forged kind authoritative.
      const forged = { ...sheet, view: { title: "Rooted", kind: "circuit" } };
      expect(
        dependencyFindings(forged, { sheets: [forged] }, g, [g], source, {
          views: [authored],
        }).findings[0]?.kind,
      ).toBe("printed-document-target-insufficient");
    }
  },
);
it("M3 assembly companion preserves unresolved pin maps rather than inventing cores", () => {
  const source = {
    devices: [
      { uid: "a", designation: "A" },
      { uid: "b", designation: "B" },
    ],
    relations: [
      {
        uid: "assembly",
        designation: "CA1",
        fromDeviceUid: "a",
        toDeviceUid: "b",
        assembly: {
          fromPort: "P1",
          toPort: "IN",
          status: "planned",
          pinMapping: { status: "unresolved", reason: "No pin map supplied" },
        },
      },
    ],
  };
  const first = { number: 1, view: { kind: "signal-loop" } },
    report = { number: 2, view: { kind: "assemblies" } },
    pk = { sheets: [first, report] },
    g = geometry({
      devices: [{ deviceUid: "a" }],
      texts: [text("core details remain in the conductor view")],
    });
  const q = geometry({
    texts: [
      "CA1",
      "",
      "A.P1",
      "B.IN",
      "planned\nPin mapping: unresolved\nNo pin map supplied",
    ].map((value, columnIndex) =>
      text(value, { row: "assembly", columnIndex }),
    ),
  });
  expect(dependencyFindings(first, pk, g, [g, q], source).findings).toEqual([]);
  const bad = {
    ...q,
    texts: q.texts.map((t) =>
      t.columnIndex === 4
        ? { ...t, text: "planned\nPin mapping: resolved" }
        : t,
    ),
  };
  expect(
    dependencyFindings(first, pk, g, [g, bad], source).findings[0]?.kind,
  ).toBe("printed-document-target-insufficient");
});
it("M3 paragraph wrapping cannot erase a concrete document promise", () => {
  const first = { number: 1, view: { kind: "signal-loop" } },
    pk = { sheets: [first] },
    g = geometry({
      devices: [{ deviceUid: "d" }],
      texts: [
        text("core details remain in the", {
          fontSize: 2.7,
          anchor: p(28, 40),
        }),
        text("conductor view.", { fontSize: 2.7, anchor: p(28, 43.5) }),
      ],
    });
  expect(dependencyFindings(first, pk, g, [g], wireIr).findings[0]?.need).toBe(
    "core-inventory",
  );
});
it("polarity adjacency rejects distant own-port Voronoi positions", () => {
  const g = polarity();
  g.shapes[2] = qualifier("negative", p(4, 70), p(6, 70), "-");
  expect(
    polarityFindings(g, ir).some(
      (f) => f.kind === "polarity-not-adjacent-own-port",
    ),
  ).toBe(true);
});
it("polarity native ownership fails closed on missing or forged terminal owners", () => {
  const g = polarity();
  expect(polarityFindings({ ...g, terminals: [] }, ir)[0]?.kind).toBe(
    "polarity-port-ownership-unavailable",
  );
  expect(
    polarityFindings(
      {
        ...g,
        terminals: g.terminals.map((t) => ({ ...t, deviceUid: "foreign" })),
      },
      ir,
    )[0]?.kind,
  ).toBe("polarity-port-ownership-unavailable");
});
it("native DC port pairs cannot leave the population when both glyph locators are stripped", () => {
  const g = polarity();
  for (const shapes of [
    g.shapes.map((s) => ({ ...s, qualifier: undefined, symbol: undefined })),
    [],
  ])
    expect(
      polarityFindings({ ...g, shapes }, ir).some(
        (f) => f.kind === "polarity-primitive-not-upright",
      ),
    ).toBe(true);
  const ac = {
    ...ir,
    terminals: ir.terminals.map((t) => ({ ...t, role: "ac_line" })),
  };
  expect(polarityFindings({ ...g, shapes: [] }, ac)).toEqual([]);
});
it("native load supply polarity requires its authored DC voltage class", () => {
  const source = {
    ...ir,
    terminals: ir.terminals.map((t) => ({
      ...t,
      role: t.role.includes("positive") ? "supply_positive" : "supply_return",
      rating: { voltage_type: "DC" },
    })),
  };
  expect(polarityFindings(polarity(), source)).toEqual([]);
  const ac = {
    ...source,
    terminals: source.terminals.map((t) => ({
      ...t,
      rating: { voltage_type: "AC" },
    })),
  };
  expect(polarityFindings(polarity(), ac)[0]?.kind).toBe(
    "polarity-port-ownership-unavailable",
  );
});
