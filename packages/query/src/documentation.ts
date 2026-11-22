import { reportTypeProjection } from "./print-projection.js";
import "@thermite/schema";
import "./communication.js";
import "./connector-assemblies.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import {
  buildCableSchedule,
  type EndpointSheetZones,
} from "./cable-schedule.js";
import {
  resolveDeviceFilter,
  type DeviceFilter,
  type DeviceFilterSelection,
} from "./device-filter.js";
import { documentationIoPorts } from "./documentation/io-ports.js";
import { documentationAssemblies } from "./documentation/assemblies.js";
import { documentationNetwork } from "./documentation/network.js";
import { documentationBom } from "./documentation/bom.js";
import { documentationWires } from "./documentation/wires.js";
import { documentationCables } from "./documentation/cables.js";
import { documentationTerminals } from "./documentation/terminals.js";
import { documentationIo } from "./documentation/io.js";

export const REPORT_KINDS = [
  "bom",
  "wires",
  "cables",
  "terminals",
  "io",
  "io-ports",
  "network",
  "assemblies",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export interface DocumentationRequest {
  readonly format: "documentation-view-request/0.1";
  readonly kind: ReportKind;
  readonly device?: string;
  readonly filter?: DeviceFilter;
}
/** Optional packet-owned locations. Keys are wire/jumper UIDs or cable UID then core ID. */
export interface ScheduleReferences {
  readonly conductors?: ReadonlyMap<string, EndpointSheetZones>;
  readonly cableCores?: ReadonlyMap<
    string,
    ReadonlyMap<string, EndpointSheetZones>
  >;
}
/** CSV keeps unabridged type text/full headers; render callers default to print. */
export interface DocumentationOptions {
  readonly output?: "print" | "csv";
}
export interface DocumentationSelection extends DeviceFilterSelection {
  readonly format: "documentation-selection/0.1";
  readonly totalRows: number;
  readonly retainedRows: number;
  readonly omittedRowKeys: readonly string[];
  readonly boundaryDeviceUids: readonly string[];
  readonly unscopedRowKeys: readonly string[];
}
export interface DocumentationTable {
  readonly kind: ReportKind | "index" | "references";
  readonly title: string;
  readonly columns: readonly string[];
  readonly widths: readonly number[];
  readonly rows: readonly {
    readonly key: string;
    readonly cells: readonly string[];
    readonly deviceUids: readonly string[];
  }[];
  readonly notes: readonly string[];
  readonly selection?: DocumentationSelection;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
// Numeric-aware designation order using code points, independent of the host locale.
const compareDesignation = (left: string, right: string): number => {
  const a = left.match(/\d+|\D+/gu) ?? [];
  const b = right.match(/\d+|\D+/gu) ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!,
      y = b[i]!;
    if (x === y) continue;
    if (/^\d+$/u.test(x) && /^\d+$/u.test(y)) {
      const nx = x.replace(/^0+(?=\d)/u, ""),
        ny = y.replace(/^0+(?=\d)/u, "");
      if (nx.length !== ny.length) return nx.length - ny.length;
      if (nx !== ny) return compare(nx, ny);
    } else return compare(x, y);
  }
  return a.length - b.length || compare(left, right);
};
const tid = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
// Render-safe report text only. Keep authored source, IR and JSON query metadata intact.
const reportText = (value: string) =>
  value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, " ");
// Only absence is canonicalized; keep every character of a nonblank description.
const reportDescription = (value: string | undefined) =>
  value !== undefined && reportText(value).trim() ? value : undefined;
/** These are physical connection reports. Device functions never imply continuity. */
export function buildDocumentation(
  ir: Readonly<ElectricalIr>,
  request: DocumentationRequest,
  references?: ScheduleReferences,
  options?: DocumentationOptions,
): DocumentationTable {
  const full = buildDocumentationTable(
    ir,
    request,
    undefined,
    references,
    options,
  );
  if (request.filter === undefined) return full;
  if (request.device !== undefined)
    throw new Error(
      "Use either device or filter in a documentation request, not both.",
    );
  const selection = resolveDeviceFilter(ir, request.filter);
  const selected = new Set(selection.deviceUids);
  const filtered = buildDocumentationTable(
    ir,
    request,
    selected,
    references,
    options,
  );
  const keys = new Set(filtered.rows.map((r) => r.key));
  const metadata: DocumentationSelection = {
    ...selection,
    format: "documentation-selection/0.1",
    totalRows: full.rows.length,
    retainedRows: filtered.rows.length,
    omittedRowKeys: full.rows.filter((r) => !keys.has(r.key)).map((r) => r.key),
    boundaryDeviceUids: [
      ...new Set(
        filtered.rows
          .flatMap((r) => r.deviceUids)
          .filter((id) => !selected.has(id)),
      ),
    ].sort(),
    unscopedRowKeys: filtered.rows
      .filter((r) => !r.deviceUids.length)
      .map((r) => r.key),
  };
  return {
    ...filtered,
    title: `${filtered.title} (filtered)`,
    selection: metadata,
    notes: [
      ...filtered.notes,
      `Filtered report: ${selected.size} of ${ir.devices.length} devices selected; ${filtered.rows.length} of ${full.rows.length} source rows retained.`,
      "Device-owned rows follow the selection; complete connection and cable rows retain peer details. Records without device endpoints remain included.",
      ...(request.kind === "bom"
        ? [
            "Filtered BOM quantities count selected device instances; retained cables remain whole.",
          ]
        : []),
    ],
  };
}
function buildDocumentationTable(
  ir: Readonly<ElectricalIr>,
  request: DocumentationRequest,
  selection?: ReadonlySet<string>,
  references?: ScheduleReferences,
  options?: DocumentationOptions,
): DocumentationTable {
  if (
    !request ||
    request.format !== "documentation-view-request/0.1" ||
    !REPORT_KINDS.includes(request.kind) ||
    Object.keys(request).some(
      (k) => !["format", "kind", "device", "filter"].includes(k),
    ) ||
    (request.device !== undefined &&
      (typeof request.device !== "string" || !request.device.trim()))
  )
    throw new Error("Invalid documentation request.");
  if (
    request.device !== undefined &&
    !["terminals", "io", "io-ports"].includes(request.kind)
  )
    throw new Error("Only terminal and I/O reports accept a device selector.");
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const incident = (uids: readonly string[]) =>
    !selection || !uids.length || uids.some((uid) => selection.has(uid));
  const label = (t: TerminalId) =>
    `${devices.get(t.deviceUid)!.designation}.${t.terminalKey}`;
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const nets = new Map(
    ir.indexes.netIdByTerminal.map((e) => [tid(e.key), e.value]),
  );
  const netMembers = new Map(ir.nets.map((n) => [n.id, n.terminalIds]));
  const connections = new Map<
    string,
    { conductor: string; peer: TerminalId | null }[]
  >();
  const add = (
    terminal: TerminalId | null,
    peer: TerminalId | null,
    conductor: string,
  ) => {
    if (!terminal) return;
    const key = tid(terminal),
      entries = connections.get(key) ?? [];
    entries.push({ conductor, peer });
    connections.set(key, entries);
  };
  for (const w of [...ir.wires, ...ir.jumpers]) {
    const [a, b] = w.endpoints.map((e) => e.terminal);
    add(a!, b!, w.designation ?? "Jumper");
    add(b!, a!, w.designation ?? "Jumper");
  }
  const cables = [...ir.cables]
    .sort((a, b) => compare(a.designation, b.designation))
    .map((c) =>
      buildCableSchedule(ir, c.uid, references?.cableCores?.get(c.uid)),
    )
    .filter((c) =>
      incident(
        c.cores.flatMap((k) =>
          k.endpoints.flatMap((e) => (e ? [e.terminal.deviceUid] : [])),
        ),
      ),
    );
  for (const c of cables)
    for (const core of c.cores) {
      const [a, b] = core.endpoints.map((e) =>
        e === null
          ? null
          : {
              deviceUid: e.terminal.deviceUid,
              terminalKey: e.terminal.terminalKey,
            },
      );
      add(a!, b!, `${c.designation}/${core.id}`);
      add(b!, a!, `${c.designation}/${core.id}`);
    }
  const orderedDevices = [...ir.devices].sort((a, b) =>
    compare(a.designation, b.designation),
  );
  const selected =
    request.device === undefined
      ? orderedDevices.filter((d) => !selection || selection.has(d.uid))
      : orderedDevices.filter(
          (d) => d.uid === request.device || d.designation === request.device,
        );
  if (request.device !== undefined && selected.length !== 1)
    throw new Error(
      `Device ${JSON.stringify(request.device)} does not resolve uniquely.`,
    );
  const { describe: typeDescription, note: typeNote } = reportTypeProjection(
    options?.output,
  );
  const rows: { key: string; cells: string[]; deviceUids: string[] }[] = [];
  const table = (
    title: string,
    columns: string[],
    widths: number[],
    notes: string[],
  ): DocumentationTable => ({
    kind: request.kind,
    title,
    columns,
    widths,
    rows: rows.map((row) => ({ ...row, cells: row.cells.map(reportText) })),
    notes,
  });
  const context = {
    ir,
    request,
    selection,
    references,
    options,
    devices,
    incident,
    label,
    types,
    nets,
    netMembers,
    connections,
    cables,
    orderedDevices,
    selected,
    typeDescription,
    typeNote,
    rows,
    table,
    compare,
    compareDesignation,
    tid,
    reportText,
    reportDescription,
  };
  if (request.kind === "io-ports") return documentationIoPorts(context);
  if (request.kind === "assemblies") return documentationAssemblies(context);
  if (request.kind === "network") return documentationNetwork(context);
  if (request.kind === "bom") return documentationBom(context);
  if (request.kind === "wires") return documentationWires(context);
  if (request.kind === "cables") return documentationCables(context);
  if (request.kind === "terminals") return documentationTerminals(context);
  return documentationIo(context);
}

/** Quote every field and neutralize spreadsheet formula prefixes in human-facing CSV. */
export function documentationCsv(table: DocumentationTable): string {
  const cell = (value: string) =>
    `"${(/^[\s]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return (
    [table.columns, ...table.rows.map((r) => r.cells)]
      .map((row) => row.map(cell).join(","))
      .join("\r\n") + "\r\n"
  );
}
