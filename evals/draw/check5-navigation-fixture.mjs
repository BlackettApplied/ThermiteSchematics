import { ir4, geometry4, box, text } from "./tranche4-fixtures.mjs";
import { viewBindings } from "./tranche4-views.mjs";
export function elementFixture(flow = "left-to-right") {
  const ir = ir4();
  ir.devices[0].designation = "OL1";
  ir.deviceTypes[0].circuitSymbols = {
    pole1: "overload",
    pole2: "overload",
    pole3: "overload",
    aux: "contact-nc",
  };
  const groups = [
    ["pole1", ["1/L1", "2/T1"]],
    ["pole2", ["3/L2", "4/T2"]],
    ["pole3", ["5/L3", "6/T3"]],
    ["aux", ["95", "96"]],
  ];
  ir.functions = groups.map(([functionKey, keys]) => ({
    id: { deviceUid: "D", functionKey },
    kind: "contact",
    normal_state: "closed",
    terminals: keys.map((terminalKey) => ({ deviceUid: "D", terminalKey })),
  }));
  ir.functions.push({
    id: { deviceUid: "D", functionKey: "trip" },
    kind: "mechanism",
    terminals: [],
  });
  ir.internalRelations = [
    {
      deviceUid: "D",
      verb: "trips",
      from: ir.functions[4].id,
      to: ir.functions[3].id,
    },
  ];
  const request = {
    views: [0, 1].map((i) => ({
      format: "circuit-view-request/0.1",
      title: i ? "Auxiliary" : "Power",
      flow,
      groups: [
        {
          id: "G",
          conductors: [],
          functions: ir.functions
            .filter((f) =>
              i
                ? f.id.functionKey === "aux"
                : f.id.functionKey.startsWith("pole"),
            )
            .map((f) => ({
              device: { by: "uid", value: "D" },
              key: f.id.functionKey,
            })),
        },
      ],
    })),
  };
  return elementSheets(ir, request);
}
function elementSheets(ir, request) {
  const bound = viewBindings(request, ir),
    packet = { sheets: [] },
    geometries = [];
  for (const [i, v] of request.views.entries()) {
    packet.sheets.push({
      number: i + 1,
      view: { kind: "circuit", title: v.title },
    });
    const g = geometry4();
    g.navigationViews = [bound[i]];
    g.shapes.push({
      element: "frame",
      deviceUid: "D",
      outline: true,
      bbox: box(20, 30, 100, 45),
      stroke: 0.2,
    });
    for (const [j, f] of ir.functions
      .filter((f) =>
        v.groups[0].functions.some((s) => s.key === f.id.functionKey),
      )
      .entries()) {
      const scope = f.id.functionKey,
        y = 35 + j * 10;
      g.shapes.push({
        element: scope,
        deviceUid: "D",
        functionKey: scope,
        functionScope: scope,
        symbol: "native",
        navigationView: bound[i],
        circuitGroup: "G",
        bbox: box(30, y, 8, 4),
        stroke: 0.2,
      });
      g.terminals.push(
        ...f.terminals.map((t, k) => ({
          element: t.terminalKey,
          deviceUid: "D",
          terminal: t.terminalKey,
          functionScope: scope,
          point: { x: 30 + k * 8, y: y + 2 },
          bbox: box(30 + k * 8, y + 2, 1, 1),
          painted: true,
          navigationView: bound[i],
          circuitGroup: "G",
        })),
      );
    }
    const targets = i ? ir.functions.slice(0, 3) : [ir.functions[3]];
    for (const f of targets) {
      const j = ir.functions.indexOf(f),
        zone = i ? (j === 0 ? "A1" : "B1") : "A1";
      g.texts.push(
        text(`OL1.${f.id.functionKey} → ${i ? "01" : "02"}.${zone}`, {
          element: "nav-" + f.id.functionKey,
          bbox: box(40, 60 + targets.indexOf(f) * 3, 35, 2),
        }),
      );
    }
    geometries.push(g);
  }
  return { ir, request, packet, geometries };
}
export function portFixture() {
  const ir = ir4();
  ir.devices = [{ uid: "N", designation: "N05", typeId: "type" }];
  const keys = ["B1", "B2", "B3", "IN", "OUT"],
    positions = [
      [30, 35],
      [30, 37],
      [30, 39],
      [70, 75],
      [110, 95],
    ],
    sheets = [1, 1, 1, 2, 3];
  ir.deviceTypes[0].ports = Object.fromEntries(
    [...keys, "P", "SPARE"].map((k) => [k, { medium: "ethernet" }]),
  );
  ir.internalRelations = [];
  const request = {
      views: [{ format: "communication-view-request/0.1", medium: "ethernet" }],
    },
    bound = viewBindings(request, ir)[0],
    packet = { sheets: [] },
    geometries = [];
  for (let i = 1; i <= 3; i++) {
    packet.sheets.push({ number: i, view: { kind: "communication" } });
    const g = geometry4();
    g.navigationViews = [bound];
    g.texts.push(text(`Part ${i}/3`));
    g.devices.push({ deviceUid: "N", bbox: box(20, 25, 110, 80) });
    geometries.push(g);
  }
  addPortLinks(ir, geometries, keys, positions, sheets);
  for (const [i, g] of geometries.entries())
    for (const [j, key] of keys.entries())
      if (sheets[j] !== i + 1)
        g.tranche4.partRefs.push({
          element: "ref-" + key,
          kind: "communication",
          uid: "N",
          view: 1,
          part: i + 1,
          bbox: box(),
          texts: [
            text(
              `N05.${key} → P${sheets[j]}/S0${sheets[j]}.${sheets[j] === 1 ? "A1" : sheets[j] === 2 ? "C3" : "D5"}`,
            ),
          ],
        });
  return { ir, request, packet, geometries };
}

function addPortLinks(ir, geometries, keys, positions, sheets) {
  for (const [i, key] of keys.entries()) {
    const uid = "E" + i;
    ir.devices.push({ uid, designation: uid, typeId: "type" });
    const relation = {
      uid: "L" + i,
      fromDeviceUid: "N",
      toDeviceUid: uid,
      connection: { medium: "ethernet", fromPort: key, toPort: "P" },
    };
    ir.relations.push(relation);
    const g = geometries[sheets[i] - 1],
      [x, y] = positions[i];
    const port = (deviceUid, key, px) => ({
      element: deviceUid + key,
      kind: "communication",
      deviceUid,
      key,
      point: { x: px, y },
      radius: 1,
      bbox: box(px - 1, y - 1, 2, 2),
      texts: [text(key)],
      painted: true,
    });
    g.tranche4.ports.push(port("N", key, x), port(uid, "P", x + 8));
    g.tranche4.communicationLinks.push({
      uid: relation.uid,
      ends: [
        { deviceUid: "N", portKey: key },
        { deviceUid: uid, portKey: "P" },
      ],
      ink: [
        [
          { x, y },
          { x: x + 8, y },
        ],
      ],
      paths: [
        {
          ends: [
            { x, y },
            { x: x + 8, y },
          ],
        },
      ],
    });
  }
}
