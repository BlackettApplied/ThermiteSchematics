import { IdentifierMeasurementError } from "./identifier-errors.mjs";
import { nativeRelationReference } from "./relation-reference.mjs";
function communicationEndpoint(ir, uid, key, policy) {
  const d = ir.devices.find((d) => d.uid === uid);
  return policy.projection === "legacy"
    ? `${d.designation}.${key}`
    : `${d.designation}: ${key}`;
}
// Independent checker policy. Do not import renderer helpers or trust emitted
// identifier flags. Column identity is explicitly paired with its query header.
const scalar = (header, column) => ({ header, column, source: "cell" });
export const identifierColumns = {
  bom: [
    { header: "Designations", column: 1, source: "names" },
    scalar("Order number", 4),
  ],
  wires: [
    { header: "Conductor / label", column: 0, source: "conductor" },
    { header: "End A / first endpoint", column: 1, source: "wire-end" },
    { header: "End B / second endpoint", column: 2, source: "wire-end" },
    scalar("From sheet.zone", 5),
    scalar("To sheet.zone", 6),
  ],
  cables: [scalar("Cable", 0)],
  terminals: [
    scalar("Device", 0),
    scalar("Terminal", 2),
    { header: "Same location connections", column: 4, source: "terminal" },
    {
      header: "Other / unspecified location connections",
      column: 5,
      source: "terminal",
    },
  ],
  io: [
    scalar("Device", 0),
    { header: "Channel", column: 1, source: "channel-identity" },
    scalar("Address space", 3),
    scalar("Address", 4),
    { header: "Terminals", column: 6, source: "channel" },
    { header: "Connected net endpoints", column: 7, source: "channel" },
  ],
  "io-ports": [
    { header: "Module / location", column: 0, source: "port" },
    { header: "Port / connector", column: 1, source: "port" },
    { header: "Address space / address", column: 3, source: "port" },
    { header: "Assembly / peer connector", column: 5, source: "port" },
  ],
  assemblies: [
    { header: "Assembly / cable", column: 0, source: "relation" },
    { header: "End A / location", column: 2, source: "relation" },
    { header: "End B / location", column: 3, source: "relation" },
  ],
  network: [
    { header: "Link", column: 0, source: "relation" },
    { header: "End A / location", column: 2, source: "relation" },
    { header: "End B / location", column: 3, source: "relation" },
  ],
  index: [
    scalar("Sheet", 0),
    { header: "Devices", column: 2, source: "names" },
  ],
  references: [
    scalar("Device", 0),
    { header: "Sheet / zone", column: 2, source: "references" },
  ],
};

function keyParts(key) {
  try {
    const parts = JSON.parse(key);
    return Array.isArray(parts) ? parts : [];
  } catch {
    return [];
  }
}
function portUnits(ir, row, column, policy) {
  const [uid, port] = keyParts(row.key),
    device = ir.devices.find((d) => d.uid === uid);
  if (!device)
    throw new IdentifierMeasurementError(
      `Identifier measurement: unknown connector row ${row.key}`,
    );
  if (column === 0) return [device.designation];
  if (column === 1) return [port];
  if (column === 3)
    return [
      device.connectorIo?.addressSpace,
      device.connectorIo?.ports[port]?.address,
    ];
  return ir.relations.flatMap((r) => {
    const a = r.assembly;
    if (!a) return [];
    const isFrom = r.fromDeviceUid === uid && a.fromPort === port;
    if (!isFrom && !(r.toDeviceUid === uid && a.toPort === port)) return [];
    const peer = ir.devices.find(
      (d) => d.uid === (isFrom ? r.toDeviceUid : r.fromDeviceUid),
    );
    return [
      ...nativeRelationReference(ir, r, policy).units,
      `${peer.designation}.${isFrom ? a.toPort : a.fromPort}`,
    ];
  });
}
function relationUnits(ir, row, column, kind, policy) {
  const r = ir.relations.find((r) => r.uid === row.key);
  if (!r) {
    const [uid, port] = keyParts(row.key),
      d = ir.devices.find((d) => d.uid === uid);
    return column === 2 && d
      ? [
          kind === "network"
            ? communicationEndpoint(ir, uid, port, policy)
            : `${d.designation}.${port}`,
        ]
      : [];
  }
  if (column === 0) return nativeRelationReference(ir, r, policy).units;
  const connection = r.assembly ?? r.connection;
  const d = ir.devices.find(
    (d) => d.uid === (column === 2 ? r.fromDeviceUid : r.toDeviceUid),
  );
  return [
    r.connection
      ? communicationEndpoint(
          ir,
          d.uid,
          column === 2 ? connection.fromPort : connection.toPort,
          policy,
        )
      : `${d.designation}.${column === 2 ? connection.fromPort : connection.toPort}`,
  ];
}
function channelIdentity(ir, row, policy) {
  const [uid, key] = keyParts(row.key),
    d = ir.devices.find((d) => d.uid === uid);
  const fn = ir.functions.find(
    (f) => f.id.deviceUid === uid && f.id.functionKey === key,
  );
  if (!fn)
    throw new IdentifierMeasurementError(
      `Identifier measurement: unknown channel ${row.key}`,
    );
  if (policy.projection === "legacy") return [key];
  const channels = d?.io?.channels;
  const assignment =
    channels && Object.hasOwn(channels, key) ? channels[key] : undefined;
  return assignment?.address !== undefined
    ? [assignment.address]
    : fn.terminals.map((t) => t.terminalKey);
}
function channelUnits(ir, row, column) {
  const [uid, channel] = keyParts(row.key);
  const f = ir.functions.find(
    (f) => f.id.deviceUid === uid && f.id.functionKey === channel,
  );
  if (!f)
    throw new IdentifierMeasurementError(
      `Identifier measurement: unknown channel row ${row.key}`,
    );
  let terminals = f.terminals;
  if (column === 7) {
    const netIds = new Set(
      ir.indexes.netIdByTerminal
        .filter(({ key }) =>
          terminals.some(
            (t) =>
              t.deviceUid === key.deviceUid &&
              t.terminalKey === key.terminalKey,
          ),
        )
        .map((n) => n.value),
    );
    terminals = ir.nets
      .filter((n) => netIds.has(n.id))
      .flatMap((n) => n.terminalIds)
      .filter((t) => t.deviceUid !== uid);
  }
  return terminals.map(
    (t) =>
      `${ir.devices.find((d) => d.uid === t.deviceUid).designation}.${t.terminalKey}`,
  );
}
function names(ir, row, policy) {
  const relation = ir.relations.find((r) => r.uid === row.key);
  if (relation) return nativeRelationReference(ir, relation, policy).units;
  const cable = ir.cables.find((c) => c.uid === row.key);
  return cable
    ? [cable.designation]
    : row.deviceUids.map(
        (uid) => ir.devices.find((d) => d.uid === uid)?.designation,
      );
}
function terminalUnits(ir, row, column) {
  const [uid, terminalKey] = keyParts(row.key);
  const owner = ir.devices.find((d) => d.uid === uid);
  if (!owner)
    throw new IdentifierMeasurementError(
      `Identifier measurement: unknown terminal owner ${row.key}`,
    );
  const ends = [...ir.wires, ...ir.jumpers].map((w) =>
    w.endpoints.map((e) => e.terminal),
  );
  for (const cable of ir.cables) {
    const type = ir.cableTypes.find((t) => t.id === cable.typeId);
    if (!type)
      throw new IdentifierMeasurementError(
        `Identifier measurement: missing cable type ${cable.typeId}`,
      );
    for (const definition of type.conductors) {
      const authored = cable.assignments?.find((a) => a.id === definition.id);
      const connected = ir.cableConductors.find(
        (c) => c.cableUid === cable.uid && c.id.conductorId === definition.id,
      );
      ends.push(
        (authored?.endpoints ?? connected?.endpoints ?? [null, null]).map(
          (e) => e?.terminal ?? null,
        ),
      );
    }
  }
  return ends.flatMap((pair) =>
    pair.flatMap((end, index) => {
      const peer = pair[1 - index];
      if (
        !end ||
        !peer ||
        end.deviceUid !== uid ||
        end.terminalKey !== terminalKey
      )
        return [];
      const device = ir.devices.find((d) => d.uid === peer.deviceUid);
      if (!device)
        throw new IdentifierMeasurementError(
          `Identifier measurement: terminal peer missing for ${row.key}`,
        );
      const local =
        owner.location !== undefined && device.location === owner.location;
      return (column === 4 ? local : !local)
        ? [`${device.designation}.${peer.terminalKey}`]
        : [];
    }),
  );
}
function wireUnits(ir, row, column) {
  const wire = [...ir.wires, ...ir.jumpers].find((w) => w.uid === row.key);
  if (column === 0 && wire) return [wire.designation];
  const [uid, core] = keyParts(row.key),
    cable = ir.cables.find((c) => c.uid === uid);
  if (column === 0) {
    if (!cable)
      throw new IdentifierMeasurementError(
        `Identifier measurement: unknown conductor row ${row.key}`,
      );
    return [`${cable.designation}/${core}`];
  }
  const assignment = cable?.assignments?.find((a) => a.id === core);
  const physical = ir.cableConductors?.find(
    (c) => c.cableUid === uid && c.id.conductorId === core,
  );
  const terminal = (wire?.endpoints ??
    assignment?.endpoints ??
    physical?.endpoints)?.[column - 1]?.terminal;
  if (!terminal) return [];
  const device = ir.devices.find((d) => d.uid === terminal.deviceUid);
  if (!device)
    throw new IdentifierMeasurementError(
      `Identifier measurement: endpoint device missing for ${row.key}`,
    );
  return [`${device.designation}.${terminal.terminalKey}`];
}
function units(source, ir, row, column, kind, policy) {
  if (source === "cell") return [row.cells[column]];
  if (source === "names") return names(ir, row, policy);
  if (source === "references") return row.cells[column].split("; "); // engine-generated entries
  if (source === "port") return portUnits(ir, row, column, policy);
  if (source === "relation")
    return relationUnits(ir, row, column, kind, policy);
  if (source === "channel") return channelUnits(ir, row, column);
  if (source === "channel-identity") return channelIdentity(ir, row, policy);
  if (source === "terminal") return terminalUnits(ir, row, column);
  return wireUnits(ir, row, column);
}

export function expectedIdentifierCells(ir, table, enginePolicy = {}) {
  const policy = identifierColumns[table.kind];
  if (!policy)
    throw new IdentifierMeasurementError(
      `Identifier measurement: report ${table.kind} has no column policy`,
    );
  return table.rows.flatMap((row) =>
    policy.flatMap(({ column, header, source }) => {
      if (table.columns[column] !== header) return [];
      const identifiers = [
        ...new Set(
          units(source, ir, row, column, table.kind, enginePolicy)
            .filter((s) => s?.trim())
            .map((s) => s.normalize("NFC").trim()),
        ),
      ];
      return identifiers.length
        ? [
            {
              row: row.key,
              column,
              header,
              identifiers,
              text: row.cells[column].normalize("NFC").trim(),
            },
          ]
        : [];
    }),
  );
}
