import { buildCommunicationInventory } from "./communication.js";
import { buildConnectorAssemblyInventory } from "./connector-assemblies.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { buildCableSchedule } from "./cable-schedule.js";

export const REPORT_KINDS = [
  "bom",
  "wires",
  "cables",
  "terminals",
  "io",
  "network",
  "assemblies",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export interface DocumentationRequest {
  readonly format: "documentation-view-request/0.1";
  readonly kind: ReportKind;
  readonly device?: string;
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
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const tid = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
/** These are physical connection reports. Device functions never imply continuity. */
export function buildDocumentation(
  ir: Readonly<ElectricalIr>,
  request: DocumentationRequest,
): DocumentationTable {
  if (
    !request ||
    request.format !== "documentation-view-request/0.1" ||
    !REPORT_KINDS.includes(request.kind) ||
    Object.keys(request).some(
      (k) => !["format", "kind", "device"].includes(k),
    ) ||
    (request.device !== undefined &&
      (typeof request.device !== "string" || !request.device.trim()))
  )
    throw new Error("Invalid documentation request.");
  if (
    request.device !== undefined &&
    !["terminals", "io"].includes(request.kind)
  )
    throw new Error("Only terminal and I/O reports accept a device selector.");
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
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
    .map((c) => buildCableSchedule(ir, c.uid));
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
      ? orderedDevices
      : orderedDevices.filter(
          (d) => d.uid === request.device || d.designation === request.device,
        );
  if (request.device !== undefined && selected.length !== 1)
    throw new Error(
      `Device ${JSON.stringify(request.device)} does not resolve uniquely.`,
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
    rows,
    notes,
  });
  if (request.kind === "assemblies") {
    const inventory = buildConnectorAssemblyInventory(ir);
    for (const relation of inventory.assemblies) {
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
            relation.description,
          ]
            .filter(Boolean)
            .join("\n"),
          `${from.designation}.${a.fromPort}\n${from.location ?? "Unspecified"}`,
          `${to.designation}.${a.toPort}\n${to.location ?? "Unspecified"}`,
          `${a.status ?? "Unspecified"}\nPin mapping: ${a.pinMapping.status}\n${a.pinMapping.reason}`,
        ],
      });
    }
    for (const p of inventory.ports.filter((p) => p.assemblyUid === null))
      rows.push({
        key: JSON.stringify([p.deviceUid, p.key]),
        deviceUids: [p.deviceUid],
        cells: [
          "--",
          p.definition.connector,
          `${p.designation}.${p.key}\n${p.location}`,
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
          `${a.designation}.${c.fromPort}\n${a.location ?? "Unspecified"}`,
          `${b.designation}.${c.toPort}\n${b.location ?? "Unspecified"}`,
          c.status ?? "Unspecified",
        ],
        deviceUids: [a.uid, b.uid],
      });
    }
    for (const port of inventory.ports.filter((p) => p.linkUid === null))
      rows.push({
        key: JSON.stringify([port.deviceUid, port.key]),
        cells: [
          "--",
          port.definition.medium,
          `${port.designation}.${port.key}\n${port.location}`,
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
    for (const device of orderedDevices) {
      const key = JSON.stringify([device.typeId, device.location ?? ""]);
      const group = groups.get(key) ?? [];
      group.push(device);
      groups.set(key, group);
    }
    for (const [key, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
      const d = group[0]!,
        t = types.get(d.typeId)!;
      rows.push({
        key,
        cells: [
          String(group.length),
          group.map((d) => d.designation).join(", "),
          d.location ?? "Unspecified",
          t.catalog?.manufacturer ?? "Unspecified",
          t.catalog?.orderNumber ?? "Unspecified",
          t.description ?? t.id,
        ],
        deviceUids: group.map((d) => d.uid),
      });
    }
    for (const cable of ir.cables)
      rows.push({
        key: cable.uid,
        cells: [
          "1",
          cable.designation,
          [cable.fromLocation, cable.toLocation].filter(Boolean).join(" to ") ||
            "Unspecified",
          "Unspecified",
          "Unspecified",
          cable.typeId,
        ],
        deviceUids: [],
      });
    for (const relation of ir.relations.filter(
      (r) => r.assembly?.kind === "cable",
    )) {
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
            .join(" to ") || "Unspecified",
          cable.manufacturer ?? "Unspecified",
          cable.orderNumber ?? "Unspecified",
          [
            cable.specification,
            cable.lengthM === undefined ? undefined : `${cable.lengthM} m`,
            "Assembly only; pin mapping unresolved",
          ]
            .filter(Boolean)
            .join("\n"),
        ],
      });
    }
    return table(
      "Bill of materials",
      [
        "Qty",
        "Designations",
        "Location",
        "Manufacturer",
        "Order number",
        "Description / type",
      ],
      [0.05, 0.17, 0.16, 0.12, 0.18, 0.32],
      [
        "Quantities count authored instances. Cable lengths and unmodeled accessories are not estimated.",
        "Unspecified order numbers require selection before procurement. Catalog modeling limits remain in the library.",
      ],
    );
  }
  if (request.kind === "wires") {
    for (const w of [...ir.wires, ...ir.jumpers].sort((a, b) =>
      compare(a.designation ?? a.uid, b.designation ?? b.uid),
    )) {
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
          [properties?.color, properties?.size].filter(Boolean).join(" / ") ||
            "Unspecified",
          "Connected",
        ],
        deviceUids: w.endpoints.map((e) => e.terminal.deviceUid),
      });
    }
    for (const c of cables)
      for (const core of c.cores)
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
    return table(
      "Wire and core schedule",
      [
        "Conductor / label",
        "End A / first endpoint",
        "End B / second endpoint",
        "Color / size",
        "Assignment",
      ],
      [0.15, 0.24, 0.24, 0.18, 0.19],
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
          c.typeId,
          c.fromLocation ?? "Unspecified",
          c.toLocation ?? "Unspecified",
          String(c.cores.length),
          String(c.counts.connected),
          String(c.counts.spare),
          String(c.counts.unassigned),
          c.shield === true
            ? "Shielded; bonds not modeled"
            : c.shield === false
              ? "Unshielded"
              : "Unspecified",
        ],
        deviceUids: c.cores.flatMap((k) =>
          k.endpoints.flatMap((e) => (e ? [e.terminal.deviceUid] : [])),
        ),
      });
    return table(
      "Cable schedule",
      [
        "Cable",
        "Type",
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
      ],
    );
  }
  if (request.kind === "terminals") {
    for (const d of selected) {
      const type = types.get(d.typeId)!;
      // Explicit selector supports any device. Automatic terminal plans use only declared strip types or legacy terminal symbols.
      if (
        !request.device &&
        type.category !== "terminal-strip" &&
        !["core:terminal-block-8", "core:junction-box-8"].includes(type.id)
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
            d.location ?? "Unspecified",
            key,
            type.terminals.find((t) => t.key === key)?.description ?? "",
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
      const assignment = d.io?.channels[f.id.functionKey];
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
          d.io?.addressSpace ?? "Unspecified",
          assignment?.address ?? "Unassigned",
          assignment?.signal ?? "Unspecified",
          f.terminals.map(label).join(", "),
          peers.map(label).join("; ") || "None",
          `${assignment?.usage ?? "Unspecified"}; ${f.terminals.some((t) => (connections.get(tid(t)) ?? []).length) ? "terminated" : "unconnected"}`,
        ],
        deviceUids: [d.uid, ...peers.map((t) => t.deviceUid)],
      });
    }
  return table(
    request.device
      ? `${selected[0]!.designation} I/O plan`
      : "PLC I/O schedule",
    [
      "Module",
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
