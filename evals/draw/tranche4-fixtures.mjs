import { viewBindings } from "./tranche4-views.mjs";
import { nativeRows } from "./m3-native.mjs";
export const box = (x = 30, y = 35, w = 8, h = 4) => ({ x, y, w, h });
export const text = (value, extra = {}) => ({
  element: "text",
  text: value,
  bbox: box(),
  painted: true,
  reviewPainted: true,
  fontSize: 3,
  order: 1,
  ...extra,
});
export const end = (deviceUid, terminalKey = "T") => ({
  deviceUid,
  terminalKey,
});
export function ir4() {
  return {
    devices: [
      { uid: "D", designation: "K1", typeId: "type" },
      { uid: "E", designation: "K2", typeId: "type" },
    ],
    deviceTypes: [
      {
        id: "type",
        ports: { P: { kind: "communication", medium: "ethernet" } },
        connectorPorts: { X: { connector: "M12" }, Y: { connector: "M12" } },
      },
    ],
    functions: [],
    terminals: [{ id: end("D") }, { id: end("E") }],
    wires: [],
    jumpers: [],
    cables: [],
    cableTypes: [],
    cableConductors: [],
    relations: [],
  };
}
export function wire4(uid = "A", label = "101", ends = [end("D"), end("E")]) {
  return {
    uid,
    designation: `W-${uid}`,
    aliases: [],
    properties: { label },
    endpoints: ends.map((terminal) => ({ terminal })),
  };
}
export function grid4() {
  return [..."123456"]
    .map((s, i) =>
      text(s, {
        sheetText: true,
        anchor: { x: 30 + 20 * i, y: 10 },
        bbox: box(30 + 20 * i, 10, 2, 3),
      }),
    )
    .concat(
      [..."ABCD"].map((s, i) =>
        text(s, {
          sheetText: true,
          anchor: { x: 10, y: 35 + 20 * i },
          bbox: box(10, 35 + 20 * i, 2, 3),
        }),
      ),
    );
}
export function geometry4() {
  return {
    texts: grid4(),
    shapes: [],
    terminals: [],
    devices: [],
    connectors: [],
    reportCells: [],
    reportRows: [],
    navigationViews: [],
    tranche3: { routeInk: {} },
    tranche4: {
      cards: [],
      partRefs: [],
      circuitParts: [],
      ports: [],
      assemblies: [],
      communicationLinks: [],
      markers: [],
    },
  };
}
export function identityFixture() {
  const ir = ir4(),
    g = geometry4(),
    w = wire4();
  ir.wires.push(w, wire4("B", "102"));
  g.shapes = [
    {
      element: "route",
      conductor: true,
      wire: "A",
      endpoints: w.endpoints.map((e) => e.terminal),
      stroke: 0.4,
    },
  ];
  g.tranche3.routeInk.route = [
    [
      { x: 20, y: 40 },
      { x: 60, y: 40 },
    ],
  ];
  g.texts.push(
    text("101", { wire: "A", element: "label", wireBlock: "label" }),
  );
  g.tranche4.cards = [
    {
      element: "card",
      bbox: box(),
      terminalId: end("D"),
      conductors: [{ kind: "wire", uid: "A" }],
      headingElements: [],
      texts: [text("101 → K2.T")],
    },
  ];
  const rows = [
    {
      sheet: 1,
      kind: "wires",
      key: "A",
      visible: true,
      cells: { 0: "101" },
      texts: [text("101")],
    },
  ];
  return { ir, g, rows, sheet: { number: 1, continuations: [] } };
}
export function indexFixture({ references = true, indexPages = 1 } = {}) {
  const packet = {
      sheets: [{ number: 1, view: { kind: "circuit", title: "Duplicate" } }],
    },
    geometries = [geometry4()];
  for (let i = 0; i < indexPages; i++) {
    packet.sheets.push({
      number: packet.sheets.length + 1,
      view: { kind: "index", title: "Drawing index" },
    });
    geometries.push(geometry4());
  }
  if (references) {
    packet.sheets.push({
      number: packet.sheets.length + 1,
      view: { kind: "references", title: "References" },
    });
    geometries.push(geometry4());
  }
  for (const s of packet.sheets)
    addRow(
      geometries[1],
      String(s.number),
      [
        String(s.number),
        packet.sheets.filter((p) => p.view.title === s.view.title).length > 1
          ? `${s.view.title} (sheet ${String(s.number).padStart(2, "0")})`
          : s.view.title,
      ],
      "index",
    );
  return {
    packet,
    geometries,
    request: { index: true, references, views: [] },
  };
}
export function addRow(g, key, values, doc = "doc") {
  for (const [columnIndex, value] of values.entries()) {
    const bbox = box(30 + columnIndex * 10, 35, 10, 5);
    const owner = {
      row: key,
      documentId: doc,
      reportRowScope: doc,
      columnIndex,
    };
    g.texts.push(
      text(value, { ...owner, bbox, element: `${doc}-${key}-${columnIndex}` }),
    );
    g.reportCells.push({ ...owner, bbox, regionVisible: true });
  }
}
function partInk(g, t, kind, i, bound, ir) {
  if (kind === "circuit") {
    g.tranche4.circuitParts = [
      {
        part: i,
        total: 2,
        groups: ["G"],
        terminals: [t],
        routeElements: i === 1 ? ["route"] : [],
      },
    ];
    if (i === 1) {
      g.shapes = [
        {
          element: "route",
          conductor: true,
          wire: "A",
          endpoints: ir.wires[0].endpoints.map((e) => e.terminal),
          navigationView: bound,
          circuitGroup: "G",
        },
      ];
      g.tranche3.routeInk.route = [
        [
          { x: 20, y: 40 },
          { x: 40, y: 40 },
        ],
      ];
    }
  } else {
    g.texts.push(text(`Part ${i}/2`));
    g.tranche4.ports = [
      { ...t, kind: "communication", key: "P", radius: 1 },
      {
        ...t,
        deviceUid: i === 1 ? "E" : "F",
        kind: "communication",
        key: "P",
        point: { x: 20, y: 40 },
        radius: 1,
      },
    ];
    const r = ir.relations[i - 1];
    g.tranche4.communicationLinks = [
      {
        uid: r.uid,
        ends: [
          { deviceUid: r.fromDeviceUid, portKey: "P" },
          { deviceUid: r.toDeviceUid, portKey: "P" },
        ],
        ink: [
          [
            { x: 20, y: 40 },
            { x: 40, y: 40 },
          ],
        ],
      },
    ];
  }
}
function partTerminal(bound) {
  return {
    element: "terminal",
    deviceUid: "D",
    terminal: "T",
    point: { x: 40, y: 40 },
    bbox: box(39.5, 39.5, 1, 1),
    painted: true,
    circuitGroup: "G",
    navigationView: bound,
  };
}
export function partFixture(kind = "circuit") {
  const ir = ir4(),
    format =
      kind === "circuit"
        ? "circuit-view-request/0.1"
        : "communication-view-request/0.1";
  const view =
    kind === "circuit"
      ? { format, groups: [{ id: "G", conductors: ["W-A"], functions: [] }] }
      : { format, medium: "ethernet" };
  const request = { views: [view] },
    packet = { sheets: [] },
    geometries = [];
  if (kind === "circuit") ir.wires.push(wire4());
  else
    for (const [uid, a, b] of [
      ["L1", "E", "D"],
      ["L2", "D", "F"],
    ])
      ir.relations.push({
        uid,
        fromDeviceUid: a,
        toDeviceUid: b,
        connection: { medium: "ethernet", fromPort: "P", toPort: "P" },
      });
  ir.devices.push({ uid: "F", designation: "K3", typeId: "type" });
  // Resolve view identity after native selections exist.
  const bound = viewBindings(request, ir)[0];
  for (let i = 1; i <= 2; i++) {
    packet.sheets.push({ number: i, view: { kind } });
    const g = geometry4();
    g.navigationViews = [bound];
    const t = partTerminal(bound);
    g.terminals = [t];
    g.devices = [{ deviceUid: "D", bbox: box(35, 30, 30, 30) }];
    partInk(g, t, kind, i, bound, ir);
    for (const a of g.tranche4.communicationLinks)
      a.paths = [
        {
          ends: [
            { x: 20, y: 40 },
            { x: 40, y: 40 },
          ],
        },
      ];
    g.tranche4.partRefs = [
      {
        element: "reference",
        bbox: box(),
        kind,
        group: "G",
        part: i,
        uid: "D",
        view: 1,
        terminalId: ["D", "T"],
        targetParts: [3 - i],
        targetSheets: [3 - i],
        texts: [
          text(
            `${kind === "circuit" ? "K1.T" : "K1"} -> P${3 - i}/S0${3 - i}.B2`,
          ),
        ],
      },
    ];
    geometries.push(g);
  }
  return { ir, packet, geometries, request };
}
function capRelation() {
  return {
    uid: "R",
    designation: "CAP",
    fromDeviceUid: "D",
    toDeviceUid: "E",
    assembly: {
      kind: "cap",
      fromPort: "X",
      toPort: "X",
      status: "documented",
      pinMapping: {
        status: "not-applicable",
        reason: "Protective cap, no electrical pins.",
      },
    },
  };
}
export function assemblyFixture() {
  const ir = ir4(),
    r = capRelation();
  ir.relations = [r];
  const request = {
    views: [
      { format: "connector-assembly-view-request/0.1", assemblies: ["CAP"] },
    ],
  };
  const g = geometry4(),
    report = geometry4();
  g.navigationViews = viewBindings(request, ir);
  g.devices = [{ deviceUid: "D" }, { deviceUid: "E" }];
  for (const uid of ["D", "E"])
    for (const key of ["X", "Y"])
      g.tranche4.ports.push({
        kind: "assembly",
        deviceUid: uid,
        key,
        point: { x: uid === "D" ? 30 : 50, y: 40 },
        radius: 1,
        texts: [text(key)],
      });
  g.tranche4.assemblies = [
    {
      uid: "R",
      ends: [
        { deviceUid: "D", portKey: "X" },
        { deviceUid: "E", portKey: "X" },
      ],
      ink: [
        [
          { x: 30, y: 40 },
          { x: 50, y: 40 },
        ],
      ],
    },
  ];
  g.tranche4.assemblies[0].paths = [
    {
      ends: [
        { x: 30, y: 40 },
        { x: 50, y: 40 },
      ],
    },
  ];
  g.texts.push(text("1 authored assembly. See assembly schedule 02.A3."));
  const fact = nativeRows(ir).find(
    (n) => n.kind === "assemblies" && n.key === "R",
  );
  addRow(
    report,
    "R",
    Object.values(fact.required).map((v) => v.join(" ")),
  );
  return {
    ir,
    request,
    packet: {
      sheets: [
        { number: 1, view: { kind: "connector-assembly" } },
        { number: 2, view: { kind: "assemblies" } },
      ],
    },
    geometries: [g, report],
  };
}
