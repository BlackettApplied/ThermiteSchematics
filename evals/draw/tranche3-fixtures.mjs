import { segments } from "./tranche3-geometry.mjs";
export const end = (deviceUid, terminalKey = "T") => ({
  deviceUid,
  terminalKey,
});
export const wire = (uid, a, b) => ({
  uid,
  designation: uid,
  endpoints: [{ terminal: a }, { terminal: b }],
});
export function nativeIr(wires = []) {
  return {
    devices: [
      { uid: "D", designation: "D", typeId: "type" },
      { uid: "X", designation: "X" },
      { uid: "Y", designation: "Y" },
    ],
    deviceTypes: [],
    functions: [],
    terminals: [],
    wires,
    jumpers: [],
    cables: [],
    cableTypes: [],
    cableConductors: [],
  };
}
export function route(uid, points, ends) {
  return {
    element: uid,
    wire: uid,
    conductor: true,
    stroke: 0.4,
    cls: "net-path",
    appearanceScope: "one",
    points,
    endpoints: ends,
    bbox: { x: 0, y: 0, w: 30, h: 30 },
  };
}
export function landingFixture(shared = false) {
  const ends = [end("X"), end("D")],
    other = [end("Y"), end("D")];
  const ir = nativeIr([wire("A", ...ends), wire("B", ...other)]);
  const a = route(
    "A",
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ],
    ends,
  );
  const b = route(
    "B",
    shared
      ? [
          { x: 0, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ]
      : [
          { x: 0, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 0 },
        ],
    other,
  );
  const g = {
    shapes: [a, b],
    texts: [],
    terminals: [
      {
        deviceUid: "D",
        terminal: "T",
        point: { x: 20, y: 0 },
        bbox: { x: 19.5, y: -0.5, w: 1, h: 1 },
      },
    ],
    tranche3: {
      routeInk: { A: segments(a.points), B: segments(b.points) },
      leaders: [],
    },
  };
  return { ir, g };
}
export function labelFixture(corner = false) {
  const { ir, g } = landingFixture();
  g.shapes[0].points = corner
    ? [
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ]
    : [
        { x: 0, y: 10 },
        { x: 30, y: 10 },
      ];
  g.shapes[1].points = corner
    ? [
        { x: 0, y: 9 },
        { x: 30, y: 9 },
      ]
    : [
        { x: 0, y: 30 },
        { x: 30, y: 30 },
      ];
  g.tranche3.routeInk = Object.fromEntries(
    g.shapes.map((s) => [s.element, segments(s.points)]),
  );
  g.tranche3.wirePlatePaint = { plates: [], strokes: {}, markers: [] };
  g.texts = [
    {
      element: "label",
      text: "A",
      wire: "A",
      labelRole: "conductor",
      bbox: corner ? { x: 0, y: 8, w: 20, h: 2 } : { x: 5, y: 7, w: 10, h: 2 },
    },
  ];
  return { ir, g };
}
export function contactFixture() {
  const ir = nativeIr();
  ir.devices[0].typeId = "type";
  ir.deviceTypes = [
    {
      id: "type",
      symbol: "iec:overload-relay",
      terminals: [
        { key: "1", role: "power_input" },
        { key: "2", role: "power_output" },
        { key: "95", role: "control_switch" },
        { key: "96", role: "control_switch" },
      ],
    },
  ];
  ir.functions = [
    ["power", ["1", "2"]],
    ["aux", ["95", "96"]],
  ].map(([key, keys]) => ({
    id: { deviceUid: "D", functionKey: key },
    kind: "contact",
    normal_state: "closed",
    terminals: keys.map((k) => end("D", k)),
  }));
  const text = (key, body) => ({
    element: key,
    reportRowScope: key,
    row: JSON.stringify(["D", [key]]),
    columnIndex: 1,
    text: body,
    bbox: { x: 0, y: 0, w: 40, h: 4 },
  });
  return {
    ir,
    g: {
      texts: [text("power", "NC contact 1–2"), text("aux", "NC contact 95–96")],
    },
  };
}
export function qualifierFixture(kind = "ac-input") {
  const ir = nativeIr(),
    fn = {
      id: { deviceUid: "D", functionKey: "f" },
      kind: "load",
      terminals: [end("D", "L"), end("D", "N")],
    };
  ir.functions = [fn];
  ir.deviceTypes = [{ id: "type", circuitSymbols: { f: kind } }];
  const base = {
    deviceUid: "D",
    functionKey: "f",
    mark: kind,
    markGroup: "glyph",
    circuitFunctions: [fn.id],
  };
  let serial = 0;
  const shape = (tag, points) => ({
    ...base,
    element: tag + serial++,
    shapeTag: tag,
    points,
    inkSegments: segments(points),
    bbox: { x: 8, y: 11, w: 8, h: 8 },
  });
  const rect = shape("rect", [
    { x: 8, y: 11 },
    { x: 16, y: 19 },
  ]);
  const marks =
    kind === "ac-input"
      ? [
          shape("polyline", [
            { x: 10, y: 15 },
            { x: 11, y: 14 },
            { x: 12, y: 16 },
            { x: 14, y: 15 },
          ]),
        ]
      : [
          [9, 15, 12],
          [9, 10, 16],
          [11, 12, 16],
          [13, 15, 16],
        ].map(([x, y, v]) =>
          shape("line", [
            { x, y: v },
            { x: y, y: v },
          ]),
        );
  const g = {
    shapes: [
      { deviceUid: "D", outline: true, bbox: { x: 0, y: 0, w: 50, h: 30 } },
      rect,
      ...marks,
    ],
    terminals: [
      { deviceUid: "D", terminal: "L", point: { x: 0, y: 0 } },
      { deviceUid: "D", terminal: "N", point: { x: 10, y: 0 } },
    ],
  };
  return {
    ir,
    g,
    sheet: {
      view: { kind: "circuit" },
      references: [{ deviceUid: "D", functions: ["f"] }],
    },
  };
}
export function inventoryFixture({
  partial = false,
  qualified = false,
  paginated = false,
} = {}) {
  const ir = nativeIr([
    wire("A", end("X"), end("Y")),
    wire("B", end("X"), end("Y")),
  ]);
  const rows = partial ? ["A"] : ["A", "B"],
    sheets = [{ number: 1, view: { kind: "wires" } }];
  if (paginated) sheets.push({ number: 2, view: { kind: "wires" } });
  const geometries = sheets.map((s, i) => {
    const keys = paginated ? [rows[i]] : rows;
    const texts = [
        {
          element: "title",
          primitiveIds: [`sheet-${s.number}-document-label`],
          documentId: "doc",
          text: qualified ? "Supplementary wire inventory" : "wire inventory",
          bbox: { x: 0, y: 0, w: 50, h: 4 },
        },
      ],
      reportCells = [];
    for (const [j, key] of keys.filter(Boolean).entries())
      for (const [col, text] of [
        [0, key],
        [1, "X.T"],
        [2, "Y.T"],
        [4, "Connected"],
      ]) {
        const metadata = {
          row: key,
          reportRowScope: key,
          documentId: "doc",
          columnIndex: col,
          bbox: { x: col * 20, y: 10 + j * 10, w: 20, h: 8 },
        };
        texts.push({ ...metadata, element: key + col, text });
        reportCells.push({ ...metadata, regionVisible: true });
      }
    return { texts, reportCells };
  });
  return { ir, packet: { sheets }, geometries };
}
