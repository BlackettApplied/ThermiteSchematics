import { symbolProfile } from "@thermite/schema";
import { buildCommunicationInventory } from "./communication.js";
import { buildConnectorAssemblyInventory } from "./connector-assemblies.js";
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
// Explicit locale keeps segmentation independent of the host's default locale.
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const words = new Intl.Segmenter("en", { granularity: "word" });
const TYPE_TEXT_LIMIT = 160;
// Bound only print text; a fitting single line, including its qualifiers, is exact.
const printedTypeDescription = (text: string) => {
  const first =
    text.split(/[\n\u2028\u2029]/u).find((line) => line.trim()) ?? "";
  if (
    first.trim() === text.trim() &&
    [...first.trim()].length <= TYPE_TEXT_LIMIT
  )
    return first.trim();
  const omit = (prefix: string) =>
    `${prefix.trimEnd().replace(/[.…]+$/u, "")}…`;
  if ([...first].length < TYPE_TEXT_LIMIT) return omit(first);
  let end = 0,
    count = 0;
  const boundaries = new Set([0]);
  for (const part of graphemes.segment(first)) {
    count += [...part.segment].length;
    if (count >= TYPE_TEXT_LIMIT) break;
    end = part.index + part.segment.length;
    boundaries.add(end);
  }
  let sentenceEnd = 0;
  for (const part of first.matchAll(/[.!?](?=\s|$)/gu)) {
    const candidate = part.index + part[0].length;
    if (candidate > end) break;
    if (boundaries.has(candidate)) sentenceEnd = candidate;
  }
  if (sentenceEnd) return omit(first.slice(0, sentenceEnd));
  let wordEnd = 0;
  for (const part of words.segment(first)) {
    const candidate = part.index + part.segment.length;
    if (candidate > end) break;
    if (part.isWordLike && boundaries.has(candidate)) wordEnd = candidate;
  }
  // A single overlong word/symbol sequence has no usable word boundary.
  return omit(first.slice(0, wordEnd || end));
};
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
    add(a!, b!, w.designation ?? `Jumper ${w.uid}`);
    add(b!, a!, w.designation ?? `Jumper ${w.uid}`);
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
  let shortenedType = false,
    missingType = false;
  const typeDescription = (value: string | undefined, fallback: string) => {
    const authored = reportDescription(value);
    if (authored === undefined) {
      missingType = true;
      return fallback;
    }
    const text = reportText(authored);
    if (options?.output === "csv") return text;
    const preview = printedTypeDescription(text);
    shortenedType ||= preview.trim() !== text.trim();
    return preview;
  };
  const typeNote = () =>
    [
      ...(shortenedType
        ? [
            "Type description shortened; full text: thermite inspect <designation> --type-description.",
          ]
        : []),
      ...(missingType ? ["No type description: type ID shown."] : []),
    ].join(" ");
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
  if (request.kind === "io-ports") {
    const inventory = buildConnectorAssemblyInventory(ir);
    const assemblies = new Map(inventory.assemblies.map((a) => [a.uid, a]));
    const included = new Set(
      selected.filter((d) => d.connectorIo !== undefined).map((d) => d.uid),
    );
    for (const port of inventory.ports.filter((p) =>
      included.has(p.deviceUid),
    )) {
      const device = devices.get(port.deviceUid)!;
      const assignment = Object.hasOwn(device.connectorIo!.ports, port.key)
        ? device.connectorIo!.ports[port.key]
        : undefined;
      const relation =
        port.assemblyUid === null
          ? undefined
          : assemblies.get(port.assemblyUid);
      const assembly = relation?.assembly;
      const peerUid =
        relation &&
        (relation.fromDeviceUid === device.uid
          ? relation.toDeviceUid
          : relation.fromDeviceUid);
      const peerPort =
        relation &&
        (relation.fromDeviceUid === device.uid
          ? assembly!.toPort
          : assembly!.fromPort);
      const reviews = device.connectionReview?.connectorPorts;
      const review =
        reviews !== undefined && Object.hasOwn(reviews, port.key)
          ? reviews[port.key]
          : undefined;
      rows.push({
        key: JSON.stringify([device.uid, port.key]),
        deviceUids: [device.uid, ...(peerUid ? [peerUid] : [])],
        cells: [
          [device.designation, device.location].filter(Boolean).join("\n"),
          [
            port.key,
            port.definition.connector,
            reportDescription(port.definition.description),
          ]
            .filter(Boolean)
            .join("\n"),
          assignment?.direction ?? "",
          [device.connectorIo!.addressSpace, assignment?.address]
            .filter(Boolean)
            .join("\n"),
          [assignment?.signal, `Usage: ${assignment?.usage ?? "Unspecified"}`]
            .filter(Boolean)
            .join("\n"),
          relation
            ? `${relation.designation ?? relation.uid} (${assembly!.kind}; ${assembly!.status ?? "Unspecified"})\n${devices.get(peerUid!)!.designation}.${peerPort}`
            : "Unoccupied",
          assembly
            ? `${assembly.pinMapping.status}\n${assembly.pinMapping.reason}`
            : "No assembly; mapping unspecified",
          review
            ? `${review.status === "intentionally-unused" ? "Intentionally unused" : review.status}\n${review.reason}`
            : "Unspecified",
        ],
      });
    }
    return table(
      request.device
        ? `${selected[0]!.designation} connector I/O plan`
        : "Connector I/O schedule",
      [
        "Module / location",
        "Port / connector",
        "Direction",
        "Address space / address",
        "Signal / usage",
        "Assembly / peer connector",
        "Pin mapping",
        "Connection review",
      ],
      [0.08, 0.12, 0.11, 0.11, 0.14, 0.16, 0.16, 0.12],
      [
        "Lists every socket on devices marked as connector I/O. Omitted assignments remain unspecified.",
        "Caps and unoccupied sockets do not imply spare usage. Addresses and directions are authored labels.",
        "Rows describe sockets, not PLC channels or pins. Peers are immediate assembly endpoints.",
        "Splitter branches are separate assemblies. Pin tables do not resolve cordset wiring or join nets.",
        "Terminal channels remain in the io schedule. Channel-to-socket mapping is not inferred.",
      ],
    );
  }
  if (request.kind === "assemblies") {
    const inventory = buildConnectorAssemblyInventory(ir);
    for (const relation of inventory.assemblies) {
      if (!incident([relation.fromDeviceUid, relation.toDeviceUid])) continue;
      const a = relation.assembly,
        from = devices.get(relation.fromDeviceUid)!,
        to = devices.get(relation.toDeviceUid)!;
      rows.push({
        key: relation.uid,
        deviceUids: [from.uid, to.uid],
        cells: [
          relation.designation ?? relation.uid,
          [
            a.kind,
            a.cable?.specification,
            a.cable?.manufacturer,
            a.cable?.orderNumber,
            a.cable?.lengthM === undefined ? undefined : `${a.cable.lengthM} m`,
            a.cable?.route,
            reportDescription(relation.description),
          ]
            .filter(Boolean)
            .join("\n"),
          [`${from.designation}.${a.fromPort}`, from.location]
            .filter(Boolean)
            .join("\n"),
          [`${to.designation}.${a.toPort}`, to.location]
            .filter(Boolean)
            .join("\n"),
          `${a.status ?? "Unspecified"}\nPin mapping: ${a.pinMapping.status}\n${a.pinMapping.reason}`,
        ],
      });
    }
    for (const p of inventory.ports.filter(
      (p) => p.assemblyUid === null && incident([p.deviceUid]),
    ))
      rows.push({
        key: JSON.stringify([p.deviceUid, p.key]),
        deviceUids: [p.deviceUid],
        cells: [
          "--",
          p.definition.connector,
          [`${p.designation}.${p.key}`, devices.get(p.deviceUid)!.location]
            .filter(Boolean)
            .join("\n"),
          "Unoccupied",
          "No assembly declared",
        ],
      });
    return table(
      "Connector assemblies and unoccupied ports",
      [
        "Assembly / cable",
        "Specification / description",
        "End A / location",
        "End B / location",
        "Status / pin mapping",
      ],
      [13, 25, 19, 19, 24],
      [
        "Assembly links reserve connector ports only; they do not create physical conductors or join electrical nets.",
        "Library pin descriptions do not supply a cable's missing pin mapping. Connector compatibility and installation remain engineering review items.",
      ],
    );
  }
  if (request.kind === "network") {
    const inventory = buildCommunicationInventory(ir);
    for (const link of inventory.links) {
      if (!incident([link.fromDeviceUid, link.toDeviceUid])) continue;
      const c = link.connection,
        a = devices.get(link.fromDeviceUid)!,
        b = devices.get(link.toDeviceUid)!;
      rows.push({
        key: link.uid,
        cells: [
          link.designation ?? link.uid,
          [
            c.protocol,
            c.cable?.specification,
            c.cable?.lengthM === undefined ? undefined : `${c.cable.lengthM} m`,
            c.cable?.route,
          ]
            .filter(Boolean)
            .join("\n"),
          [`${a.designation}.${c.fromPort}`, a.location]
            .filter(Boolean)
            .join("\n"),
          [`${b.designation}.${c.toPort}`, b.location]
            .filter(Boolean)
            .join("\n"),
          c.status ?? "Unspecified",
        ],
        deviceUids: [a.uid, b.uid],
      });
    }
    for (const port of inventory.ports.filter(
      (p) => p.linkUid === null && incident([p.deviceUid]),
    ))
      rows.push({
        key: JSON.stringify([port.deviceUid, port.key]),
        cells: [
          "--",
          port.definition.medium,
          [
            `${port.designation}.${port.key}`,
            devices.get(port.deviceUid)!.location,
          ]
            .filter(Boolean)
            .join("\n"),
          "Unconnected",
          "Unspecified",
        ],
        deviceUids: [port.deviceUid],
      });
    return table(
      "Communication links and unconnected ports",
      [
        "Link",
        "Protocol / medium",
        "End A / location",
        "End B / location",
        "Status",
      ],
      [14, 18, 27, 27, 14],
      [
        "Port-level connections only; no pin wiring, electrical nets, or automatic protocol compatibility.",
        "Unconnected ports are not inferred spare. Planned links require commissioning verification.",
      ],
    );
  }
  if (request.kind === "bom") {
    const groups = new Map<string, typeof orderedDevices>();
    for (const device of selected) {
      const key = JSON.stringify([
        device.typeId,
        device.location ?? null,
        reportDescription(device.description) ?? null,
        device.nonProcurement?.reason ?? null,
      ]);
      const group = groups.get(key) ?? [];
      group.push(device);
      groups.set(key, group);
    }
    for (const group of groups.values())
      group.sort((a, b) => compareDesignation(a.designation, b.designation));
    for (const [key, group] of [...groups].sort(
      ([ak, a], [bk, b]) =>
        compare(
          JSON.stringify([a[0]!.typeId, a[0]!.location ?? null]),
          JSON.stringify([b[0]!.typeId, b[0]!.location ?? null]),
        ) ||
        compareDesignation(a[0]!.designation, b[0]!.designation) ||
        compare(ak, bk),
    )) {
      const d = group[0]!,
        t = types.get(d.typeId)!;
      rows.push({
        key,
        cells: [
          String(group.length),
          group.map((d) => d.designation).join(", "),
          d.location ?? "",
          t.catalog?.manufacturer ?? "",
          t.catalog?.orderNumber ?? "",
          typeDescription(t.description, t.id),
          [
            reportDescription(d.description),
            ...(d.nonProcurement
              ? [`Not purchased: ${d.nonProcurement.reason}`]
              : []),
          ]
            .filter(Boolean)
            .join("\n"),
        ],
        deviceUids: group.map((d) => d.uid),
      });
    }
    for (const cable of ir.cables.filter((c) =>
      cables.some((s) => s.cableUid === c.uid),
    ))
      rows.push({
        key: cable.uid,
        cells: [
          "1",
          cable.designation,
          [cable.fromLocation, cable.toLocation].filter(Boolean).join(" to "),
          "",
          "",
          typeDescription(
            cables.find((c) => c.cableUid === cable.uid)!.description,
            cable.typeId,
          ),
          reportDescription(cable.description) ?? "",
        ],
        deviceUids: selection
          ? cables
              .find((c) => c.cableUid === cable.uid)!
              .cores.flatMap((k) =>
                k.endpoints.flatMap((e) => (e ? [e.terminal.deviceUid] : [])),
              )
          : [],
      });
    for (const relation of ir.relations.filter(
      (r) => r.assembly?.kind === "cable",
    )) {
      if (!incident([relation.fromDeviceUid, relation.toDeviceUid])) continue;
      const cable = relation.assembly!.cable!;
      rows.push({
        key: relation.uid,
        deviceUids: [relation.fromDeviceUid, relation.toDeviceUid],
        cells: [
          "1",
          relation.designation ?? relation.uid,
          [
            devices.get(relation.fromDeviceUid)!.location,
            devices.get(relation.toDeviceUid)!.location,
          ]
            .filter(Boolean)
            .join(" to "),
          cable.manufacturer ?? "",
          cable.orderNumber ?? "",
          [
            cable.specification,
            cable.lengthM === undefined ? undefined : `${cable.lengthM} m`,
            "Assembly only; pin mapping unresolved",
          ]
            .filter(Boolean)
            .join("\n"),
          reportDescription(relation.description) ?? "",
        ],
      });
    }
    // Measured with 1–80 five-character designations on letter/A4 landscape:
    // widen before the one-name-per-line gap; 23% also preserves the base's
    // printable upper range. Ordinary rows retain their description space.
    const longDesignations = rows.some((row) => row.cells[1]!.length > 100);
    return table(
      "Bill of materials",
      [
        "Qty",
        "Designations",
        "Location",
        options?.output === "csv" ? "Manufacturer" : "Mfr.",
        "Order number",
        "Description / type",
        "Instance description / requirements",
      ],
      longDesignations
        ? [0.05, 0.23, 0.13, 0.08, 0.09, 0.21, 0.21]
        : [0.05, 0.1, 0.13, 0.08, 0.09, 0.25, 0.3],
      [
        [
          "Qty counts instances, not purchasable totals. No length/accessory estimates.",
          ...(rows.some((r) => r.cells[4] === "")
            ? ["Blank order numbers need selection."]
            : []),
        ].join(" "),
        ...(typeNote() ? [typeNote()] : []),
      ],
    );
  }
  if (request.kind === "wires") {
    const zones: EndpointSheetZones[] = [];
    for (const w of [...ir.wires, ...ir.jumpers].sort((a, b) =>
      compare(a.designation ?? a.uid, b.designation ?? b.uid),
    )) {
      if (!incident(w.endpoints.map((e) => e.terminal.deviceUid))) continue;
      zones.push(references?.conductors?.get(w.uid) ?? [null, null]);
      const properties = (
        "properties" in w ? w.properties : undefined
      ) as ElectricalIr["wires"][number]["properties"];
      rows.push({
        key: w.uid,
        cells: [
          [
            w.designation ?? "Jumper",
            properties?.label && properties.label !== w.designation
              ? properties.label
              : null,
          ]
            .filter(Boolean)
            .join(" / "),
          label(w.endpoints[0].terminal),
          label(w.endpoints[1].terminal),
          [properties?.color, properties?.size].filter(Boolean).join(" / "),
          "Connected",
        ],
        deviceUids: w.endpoints.map((e) => e.terminal.deviceUid),
      });
    }
    for (const c of cables)
      for (const core of c.cores) {
        zones.push([
          core.endpoints[0]?.sheetZone,
          core.endpoints[1]?.sheetZone,
        ]);
        rows.push({
          key: JSON.stringify([c.cableUid, core.id]),
          cells: [
            `${c.designation}/${core.id}`,
            core.endpoints[0]?.display ?? "Unterminated",
            core.endpoints[1]?.display ?? "Unterminated",
            [core.color, core.size].filter(Boolean).join(" / "),
            `${core.usage}; ${core.status}`,
          ],
          deviceUids: core.endpoints.flatMap((e) =>
            e ? [e.terminal.deviceUid] : [],
          ),
        });
      }
    const hasZones = zones.some((ends) => ends.some(Boolean));
    if (hasZones)
      rows.forEach((row, i) =>
        row.cells.push(...zones[i]!.map((z) => z ?? "")),
      );
    return table(
      "Wire and core schedule",
      [
        "Conductor / label",
        "End A / first endpoint",
        "End B / second endpoint",
        "Color / size",
        "Assignment",
        ...(hasZones ? ["From sheet.zone", "To sheet.zone"] : []),
      ],
      hasZones
        ? [0.12, 0.18, 0.18, 0.14, 0.16, 0.11, 0.11]
        : [0.15, 0.24, 0.24, 0.18, 0.19],
      [
        "Wire endpoints are canonical, not a routing or installation order. Cable end order follows the source where annotated.",
        "Unterminated and unassigned cores do not imply a de-energized circuit.",
      ],
    );
  }
  if (request.kind === "cables") {
    for (const c of cables)
      rows.push({
        key: c.cableUid,
        cells: [
          c.designation,
          typeDescription(c.description, c.typeId),
          c.fromLocation ?? "",
          c.toLocation ?? "",
          String(c.cores.length),
          String(c.counts.connected),
          String(c.counts.spare),
          String(c.counts.unassigned),
          c.shield === true
            ? "Shielded; bonds not modeled"
            : c.shield === false
              ? "Unshielded"
              : "",
        ],
        deviceUids: c.cores.flatMap((k) =>
          k.endpoints.flatMap((e) => (e ? [e.terminal.deviceUid] : [])),
        ),
      });
    return table(
      "Cable schedule",
      [
        "Cable",
        "Description / type",
        "End A location",
        "End B location",
        "Cores",
        "Connected",
        "Spare",
        "Unassigned",
        "Shield construction",
      ],
      [0.1, 0.18, 0.15, 0.15, 0.06, 0.08, 0.07, 0.08, 0.13],
      [
        "Connected and spare counts may overlap: a spare may be terminated. Construction does not specify shield bonding.",
        ...(typeNote() ? [typeNote()] : []),
      ],
    );
  }
  if (request.kind === "terminals") {
    for (const d of selected) {
      const type = types.get(d.typeId)!;
      // Explicit selector supports any device. Automatic terminal plans use declared categories or resolved strip profiles.
      if (
        !request.device &&
        !request.filter?.devices &&
        type.category !== "terminal-strip" &&
        symbolProfile(type) !== "thermite:terminal-strip"
      )
        continue;
      const keys = type.terminalOrder ?? type.terminals.map((t) => t.key);
      for (const key of keys) {
        const terminal = { deviceUid: d.uid, terminalKey: key },
          peers = connections.get(tid(terminal)) ?? [];
        const display = (items: typeof peers) =>
          items
            .map(
              (p) =>
                `${p.conductor} -> ${p.peer ? label(p.peer) : "Unterminated"}`,
            )
            .sort(compare)
            .join("; ") || "None";
        const local = peers.filter(
          (p) =>
            p.peer &&
            d.location !== undefined &&
            devices.get(p.peer.deviceUid)?.location === d.location,
        );
        const remote = peers.filter((p) => !local.includes(p));
        rows.push({
          key: tid(terminal),
          cells: [
            d.designation,
            d.location ?? "",
            key,
            reportDescription(
              type.terminals.find((t) => t.key === key)?.description,
            ) ?? "",
            display(local),
            display(remote),
            peers.length ? "Terminated" : "Unconnected",
          ],
          deviceUids: [
            d.uid,
            ...peers.flatMap((p) => (p.peer ? [p.peer.deviceUid] : [])),
          ],
        });
      }
    }
    return table(
      request.device
        ? `${selected[0]!.designation} terminal plan`
        : "Terminal plans",
      [
        "Device",
        "Location",
        "Terminal",
        "Description",
        "Same location connections",
        "Other / unspecified location connections",
        "State",
      ],
      [0.1, 0.13, 0.09, 0.14, 0.23, 0.23, 0.08],
      [
        "Lists every terminal, including unconnected terminals and explicit jumpers. Internal continuity is never inferred.",
        "Rows follow the authored terminalOrder when present. Location groups do not assert installation sides.",
      ],
    );
  }
  for (const d of selected)
    for (const f of ir.functions
      .filter((f) => f.id.deviceUid === d.uid && f.kind === "channel")
      .sort((a, b) => compare(a.id.functionKey, b.id.functionKey))) {
      const assignment =
        d.io !== undefined && Object.hasOwn(d.io.channels, f.id.functionKey)
          ? d.io.channels[f.id.functionKey]
          : undefined;
      const members = new Map<string, TerminalId>();
      for (const t of f.terminals)
        for (const member of netMembers.get(nets.get(tid(t)) ?? "") ?? [])
          if (member.deviceUid !== d.uid) members.set(tid(member), member);
      const peers = [...members.values()].sort((a, b) =>
        compare(label(a), label(b)),
      );
      rows.push({
        key: JSON.stringify([d.uid, f.id.functionKey]),
        cells: [
          d.designation,
          f.id.functionKey,
          f.kind === "channel" ? f.direction : "",
          d.io?.addressSpace ?? "",
          assignment?.address ?? "",
          assignment?.signal ?? "",
          f.terminals.map(label).join(", "),
          peers.map(label).join("; ") || "None",
          `${assignment?.usage ?? "Unspecified"}; ${f.terminals.some((t) => (connections.get(tid(t)) ?? []).length) ? "terminated" : "unconnected"}`,
        ],
        deviceUids: [d.uid, ...peers.map((t) => t.deviceUid)],
      });
    }
  return table(
    request.device ? `${selected[0]!.designation} I/O plan` : "I/O schedule",
    [
      "Device",
      "Channel",
      "Direction",
      "Address space",
      "Address",
      "Signal",
      "Terminals",
      "Connected net endpoints",
      "Assignment / state",
    ],
    [0.09, 0.08, 0.07, 0.09, 0.08, 0.16, 0.1, 0.21, 0.12],
    [
      "Every declared channel is listed. Missing assignments remain unspecified; unconnected does not automatically mean spare.",
      "Net endpoints show physical continuity only. Addresses are authored labels, not PLC configuration or a live PLC readback.",
    ],
  );
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
