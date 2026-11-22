import { reportSourceIndex } from "./report-source-index.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import {
  buildCableSchedule,
  relationPrintIdentity,
  type DocumentationTable,
} from "@thermite/query";

type Row = DocumentationTable["rows"][number];
type Source = keyof typeof sources;
type Policy = readonly [column: number, header: string, source: Source];
export type ReportIdentifiers = ReadonlyMap<string, readonly string[][]>;

// Zero-based columns. Only this registry selects identifier fields; punctuation
// and apparent catalog-number syntax never select a field.
export const REPORT_IDENTIFIER_COLUMNS = {
  bom: [
    [1, "Designations", "bom"],
    [4, "Order number", "cell"],
  ],
  wires: [
    [0, "Conductor / label", "conductor"],
    [1, "End A / first endpoint", "wireEnd"],
    [2, "End B / second endpoint", "wireEnd"],
    [5, "From sheet.zone", "cell"],
    [6, "To sheet.zone", "cell"],
  ],
  cables: [[0, "Cable", "cell"]],
  terminals: [
    [0, "Device", "cell"],
    [2, "Terminal", "cell"],
    [4, "Same location connections", "terminalEnds"],
    [5, "Other / unspecified location connections", "terminalEnds"],
  ],
  io: [
    [0, "Device", "cell"],
    [1, "Channel", "channelIdentity"],
    [3, "Address space", "cell"],
    [4, "Address", "cell"],
    [6, "Terminals", "channelEnds"],
    [7, "Connected net endpoints", "channelEnds"],
  ],
  "io-ports": [
    [0, "Module / location", "module"],
    [1, "Port / connector", "port"],
    [3, "Address space / address", "addresses"],
    [5, "Assembly / peer connector", "peer"],
  ],
  assemblies: [
    [0, "Assembly / cable", "link"],
    [2, "End A / location", "linkEnd"],
    [3, "End B / location", "linkEnd"],
  ],
  network: [
    [0, "Link", "link"],
    [2, "End A / location", "linkEnd"],
    [3, "End B / location", "linkEnd"],
  ],
  index: [
    [0, "Sheet", "cell"],
    [2, "Devices", "devices"],
  ],
  references: [
    [0, "Device", "cell"],
    [2, "Sheet / zone", "references"],
  ],
} as const satisfies Record<DocumentationTable["kind"], readonly Policy[]>;

function rowParts(row: Row): string[] {
  try {
    const key: unknown = JSON.parse(row.key);
    return Array.isArray(key) && key.every((v) => typeof v === "string")
      ? key
      : [];
  } catch {
    return [];
  }
}
function deviceName(
  devices: ReadonlyMap<string, { designation: string }>,
  uid: string,
) {
  const device = devices.get(uid);
  if (!device)
    throw Error(
      `Report identifier refers to missing device ${JSON.stringify(uid)}.`,
    );
  return device.designation;
}

function terminalConnections(ir: Readonly<ElectricalIr>) {
  const peers = new Map<string, TerminalId[]>();
  const add = (a: TerminalId | null, b: TerminalId | null) => {
    if (!a || !b) return;
    const key = JSON.stringify([a.deviceUid, a.terminalKey]);
    const entries = peers.get(key) ?? [];
    entries.push(b);
    peers.set(key, entries);
  };
  const connect = (a: TerminalId | null, b: TerminalId | null) => {
    add(a, b);
    add(b, a);
  };
  for (const wire of [...ir.wires, ...ir.jumpers])
    connect(wire.endpoints[0].terminal, wire.endpoints[1].terminal);
  for (const cable of ir.cables)
    for (const core of buildCableSchedule(ir, cable.uid).cores)
      connect(
        core.endpoints[0]?.terminal ?? null,
        core.endpoints[1]?.terminal ?? null,
      );
  return peers;
}

function sourceContext(
  ir: Readonly<ElectricalIr>,
  row: Row,
  connections?: ReadonlyMap<string, TerminalId[]>,
  kind?: DocumentationTable["kind"],
  index = reportSourceIndex(ir),
) {
  const { devices } = index;
  const [uid, key] = rowParts(row);
  const device = devices.get(uid ?? "");
  const relation = index.relations.get(row.key);
  const wire = index.wires.get(row.key);
  const cable = index.cables.get((kind === "bom" ? row.key : uid) ?? "");
  const endpoint = (t: TerminalId) =>
    `${deviceName(devices, t.deviceUid)}.${t.terminalKey}`;
  return {
    ir,
    row,
    kind,
    devices,
    uid,
    key,
    device,
    relation,
    wire,
    cable,
    endpoint,
    connections,
  };
}
type Context = ReturnType<typeof sourceContext>;
type Extractor = (context: Context, column: number) => (string | undefined)[];

function channelEnds(c: Context, column: number): string[] {
  const fn = c.ir.functions.find(
    (f) => f.id.deviceUid === c.uid && f.id.functionKey === c.key,
  );
  if (!fn) return [];
  if (column === 6) return fn.terminals.map(c.endpoint);
  const nets = new Set(
    c.ir.indexes.netIdByTerminal
      .filter((n) =>
        fn.terminals.some(
          (t) =>
            t.deviceUid === n.key.deviceUid &&
            t.terminalKey === n.key.terminalKey,
        ),
      )
      .map((n) => n.value),
  );
  return [
    ...new Set(
      c.ir.nets
        .filter((n) => nets.has(n.id))
        .flatMap((n) => n.terminalIds)
        .filter((t) => t.deviceUid !== c.uid)
        .map(c.endpoint),
    ),
  ];
}
function terminalEnds(c: Context, column: number): string[] {
  const location = c.device?.location;
  return (c.connections?.get(c.row.key) ?? [])
    .filter((peer) => {
      const local =
        location !== undefined &&
        c.devices.get(peer.deviceUid)?.location === location;
      return column === 4 ? local : !local;
    })
    .map(c.endpoint);
}
function peer(c: Context): string[] {
  return c.ir.relations.flatMap((r) => {
    const a = r.assembly;
    if (!a) return [];
    const from = r.fromDeviceUid === c.uid && a.fromPort === c.key;
    if (!from && !(r.toDeviceUid === c.uid && a.toPort === c.key)) return [];
    return [
      ...relationPrintIdentity(r, c.devices).identifiers,
      `${deviceName(c.devices, from ? r.toDeviceUid : r.fromDeviceUid)}.${from ? a.toPort : a.fromPort}`,
    ];
  });
}
function channelIdentity(c: Context): string[] {
  const fn = c.ir.functions.find(
    (f) => f.id.deviceUid === c.uid && f.id.functionKey === c.key,
  );
  if (!fn) return [];
  const channels = c.device?.io?.channels;
  const assignment =
    channels && c.key && Object.hasOwn(channels, c.key)
      ? channels[c.key]
      : undefined;
  return assignment?.address !== undefined
    ? [assignment.address]
    : fn.terminals.map((t) => t.terminalKey);
}
function linkEnd(c: Context, column: number): string[] {
  const r = c.relation,
    connection = r?.assembly ?? r?.connection;
  if (r && connection)
    return [
      r.connection
        ? `${deviceName(c.devices, column === 2 ? r.fromDeviceUid : r.toDeviceUid)}: ${column === 2 ? connection.fromPort : connection.toPort}`
        : `${deviceName(c.devices, column === 2 ? r.fromDeviceUid : r.toDeviceUid)}.${column === 2 ? connection.fromPort : connection.toPort}`,
    ];
  return column === 2 && c.device && c.key
    ? [
        c.kind === "network"
          ? `${c.device.designation}: ${c.key}`
          : `${c.device.designation}.${c.key}`,
      ]
    : [];
}
const sources = {
  cell: (c, i) => [c.row.cells[i]],
  bom: (c, i) => {
    if (c.relation)
      return relationPrintIdentity(c.relation, c.devices).identifiers;
    if (c.cable) return [c.cable.designation];
    const names = c.row.deviceUids.map(
      (uid) => c.devices.get(uid)?.designation,
    );
    // A private, caller-built table can supply a single designation directly.
    return names.length ? names : [c.row.cells[i]];
  },
  conductor: (c) =>
    c.wire
      ? [c.wire.designation]
      : c.cable && c.key
        ? [`${c.cable.designation}/${c.key}`]
        : [],
  wireEnd: (c, i) => {
    if (c.wire) {
      const end = c.wire.endpoints[i - 1];
      return end ? [c.endpoint(end.terminal)] : [];
    }
    const end =
      c.cable &&
      buildCableSchedule(c.ir, c.cable.uid).cores.find((k) => k.id === c.key)
        ?.endpoints[i - 1];
    return end ? [end.display] : [];
  },
  channelEnds,
  channelIdentity,
  terminalEnds,
  module: (c) => [c.device?.designation],
  port: (c) => [c.key],
  addresses: (c) => [
    c.device?.connectorIo?.addressSpace,
    c.key ? c.device?.connectorIo?.ports[c.key]?.address : undefined,
  ],
  peer,
  link: (c) =>
    c.relation ? relationPrintIdentity(c.relation, c.devices).identifiers : [],
  linkEnd,
  devices: (c) =>
    c.row.deviceUids.map((uid) => c.devices.get(uid)?.designation),
  // This field is engine-generated sheet/zone entries, never authored prose.
  references: (c, i) => (c.row.cells[i] ?? "").split("; "),
} satisfies Record<string, Extractor>;

/** Exact source units for each explicitly registered column of each row. */
export function reportIdentifiers(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
): ReportIdentifiers {
  const policy: readonly Policy[] | undefined =
    REPORT_IDENTIFIER_COLUMNS[table.kind];
  if (!policy)
    throw Error(
      `Report ${JSON.stringify(table.kind)} has no identifier policy.`,
    );
  const connections =
    table.kind === "terminals" ? terminalConnections(ir) : undefined;
  const sourceIndex = reportSourceIndex(ir);
  return new Map(
    table.rows.map((row, index) => {
      const context = sourceContext(
        ir,
        row,
        connections,
        table.kind,
        sourceIndex,
      );
      const columns = table.columns.map(() => [] as string[]);
      for (const [column, header, source] of policy) {
        if (table.columns[column] !== header) continue;
        columns[column] = [
          ...new Set(
            sources[source](context, column).flatMap((value) => {
              if (!value?.trim()) return [];
              if (/[\r\n\u2028\u2029]/u.test(value))
                throw Error(
                  `Report ${JSON.stringify(table.title)} (${table.kind}), row ${index + 1} (${JSON.stringify(row.key)}), column ${column + 1} ${JSON.stringify(header)}: identifier ${JSON.stringify(value)} contains a line separator. Correct the authored identifier; it must occupy one line.`,
                );
              return [value.normalize("NFC").trim()];
            }),
          ),
        ];
      }
      return [row.key, columns];
    }),
  );
}

/** Literal source matching locates units; it never decides which fields are IDs. */
export function identifierSpans(value: string, identifiers: readonly string[]) {
  return identifiers.flatMap((identifier) => {
    const spans: { start: number; end: number }[] = [];
    let start = value.indexOf(identifier);
    while (start >= 0) {
      spans.push({ start, end: start + identifier.length });
      start = value.indexOf(identifier, start + identifier.length);
    }
    return spans;
  });
}
