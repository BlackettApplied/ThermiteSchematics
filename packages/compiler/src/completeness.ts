import type { IrDevice, IrDeviceType } from "./expansion.js";
import type { ElectricalIr } from "./ir.js";
import type { SourceRef, TerminalId } from "./resolution.js";

type Review = NonNullable<
  NonNullable<IrDevice["connectionReview"]>["terminals"]
>[string];
export interface ConnectionInventoryEntry {
  kind: "terminal" | "port" | "connector-port";
  key: string;
  required: boolean;
  role?: string;
  description?: string;
  connection: "connected" | "dangling" | "unconnected";
  connections: string[];
  pinMapping?: "unresolved" | "not-applicable";
  review?: Review;
  source: SourceRef;
}
export interface CompletenessFinding {
  code: "W903" | "W904" | "W905" | "I001" | "I002" | "I003";
  severity: "warning" | "info";
  deviceUid: string;
  designation: string;
  location?: string;
  kind: "terminal" | "port" | "connector-port" | "model";
  key?: string;
  message: string;
  source: SourceRef;
  definitionSource: SourceRef;
}
export interface CompletenessReport {
  format: "electrical-completeness/0.1";
  project: string;
  scope: { device?: string; location?: string };
  counts: {
    devices: number;
    terminals: number;
    ports: number;
    unconnected: number;
    dangling: number;
    requiredMissing: number;
    warnings: number;
    information: number;
    partialModels: number;
    unreviewedModels: number;
  };
  devices: {
    uid: string;
    designation: string;
    typeId: string;
    location?: string;
    coverage:
      | NonNullable<IrDeviceType["connectionCoverage"]>
      | { status: "unreviewed"; notes: string };
    source: SourceRef;
    definitionSource: SourceRef;
    connections: ConnectionInventoryEntry[];
  }[];
  findings: CompletenessFinding[];
  limitations: string[];
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const terminalId = (id: TerminalId) =>
  JSON.stringify([id.deviceUid, id.terminalKey]);
const reviewAt = (entries: Record<string, Review> | undefined, key: string) =>
  entries && Object.hasOwn(entries, key) ? entries[key] : undefined;
const portId = (uid: string, key: string) => JSON.stringify([uid, key]);

/** Analyze compiler IR without changing connectivity or assuming that a wired device is powered. */
export function analyzeCompleteness(
  ir: ElectricalIr,
  scope: { device?: string; location?: string } = {},
): CompletenessReport {
  if (
    scope.device !== undefined &&
    !ir.devices.some((d) => d.designation === scope.device)
  )
    throw new Error(`Unknown device ${JSON.stringify(scope.device)}.`);
  if (
    scope.location !== undefined &&
    !ir.devices.some((d) => d.location === scope.location)
  )
    throw new Error(`Unknown location ${JSON.stringify(scope.location)}.`);
  const selected = ir.devices
    .filter(
      (d) =>
        (scope.device === undefined || d.designation === scope.device) &&
        (scope.location === undefined || d.location === scope.location),
    )
    .sort(
      (a, b) => compare(a.designation, b.designation) || compare(a.uid, b.uid),
    );
  if (
    (scope.device !== undefined || scope.location !== undefined) &&
    !selected.length
  )
    throw new Error("No devices match the requested completeness scope.");
  const attached = new Map<string, string[]>(),
    connected = new Set<string>();
  const attach = (id: TerminalId, label: string, complete: boolean) => {
    const key = terminalId(id);
    attached.set(key, [...(attached.get(key) ?? []), label]);
    if (complete) connected.add(key);
  };
  for (const edge of [...ir.wires, ...ir.jumpers])
    for (const end of edge.endpoints)
      attach(end.terminal, edge.designation ?? edge.uid, true);
  for (const cable of ir.cables) {
    // Authored assignments include single-ended spare cores, which are absent from the conductive graph.
    if (cable.assignments !== undefined) {
      for (const core of cable.assignments)
        for (const end of core.endpoints)
          if (end)
            attach(
              end.terminal,
              `${cable.designation}/${core.id}`,
              core.endpoints.every((e) => e !== null),
            );
    } else {
      for (const core of ir.cableConductors.filter(
        (c) => c.cableUid === cable.uid,
      ))
        for (const end of core.endpoints)
          attach(
            end.terminal,
            `${cable.designation}/${core.id.conductorId}`,
            true,
          );
    }
  }
  const links = new Map<string, string[]>();
  for (const link of ir.relations) {
    const portLink = link.connection ?? link.assembly;
    if (!portLink) continue;
    for (const [uid, key] of [
      [link.fromDeviceUid, portLink.fromPort],
      [link.toDeviceUid, portLink.toPort],
    ]) {
      const id = portId(uid!, key!);
      links.set(id, [...(links.get(id) ?? []), link.designation ?? link.uid]);
    }
  }
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const findings: CompletenessFinding[] = [];
  const devices: CompletenessReport["devices"] = selected.map((device) => {
    const type = types.get(device.typeId)!;
    const coverage = structuredClone(
      type.connectionCoverage ?? {
        status: "unreviewed" as const,
        notes:
          "Library connection coverage has not been declared; missing physical terminals cannot be detected.",
      },
    );
    const add = (
      code: CompletenessFinding["code"],
      message: string,
      entry?: ConnectionInventoryEntry,
    ) => {
      findings.push({
        code,
        severity: code.startsWith("W") ? "warning" : "info",
        deviceUid: device.uid,
        designation: device.designation,
        ...(device.location === undefined ? {} : { location: device.location }),
        kind: entry?.kind ?? "model",
        ...(entry ? { key: entry.key } : {}),
        message,
        source: structuredClone(device.source),
        definitionSource: structuredClone(entry?.source ?? type.source),
      });
    };
    if (coverage.status === "partial")
      add("W904", `Incomplete connection model: ${coverage.notes}`);
    if (coverage.status === "unreviewed") add("I003", coverage.notes);
    const entries: ConnectionInventoryEntry[] = ir.terminals
      .filter((t) => t.id.deviceUid === device.uid)
      .sort((a, b) => compare(a.id.terminalKey, b.id.terminalKey))
      .map((t) => {
        const id = terminalId(t.id),
          review = reviewAt(
            device.connectionReview?.terminals,
            t.id.terminalKey,
          );
        return {
          kind: "terminal",
          key: t.id.terminalKey,
          required: t.required === true || review?.status === "required",
          ...(t.role === undefined ? {} : { role: t.role }),
          ...(t.description === undefined
            ? {}
            : { description: t.description }),
          connection: connected.has(id)
            ? "connected"
            : attached.has(id)
              ? "dangling"
              : "unconnected",
          connections: [...(attached.get(id) ?? [])].sort(compare),
          ...(review ? { review: structuredClone(review) } : {}),
          source: structuredClone(t.source),
        };
      });
    for (const [key, port] of Object.entries(type.ports ?? {}).sort(
      ([a], [b]) => compare(a, b),
    )) {
      const review = reviewAt(device.connectionReview?.ports, key);
      const connections = [...(links.get(portId(device.uid, key)) ?? [])].sort(
        compare,
      );
      entries.push({
        kind: "port",
        key,
        required: port.required === true || review?.status === "required",
        ...(port.description === undefined
          ? {}
          : { description: port.description }),
        connection: connections.length ? "connected" : "unconnected",
        connections,
        ...(review ? { review: structuredClone(review) } : {}),
        source: structuredClone(type.source),
      });
    }
    for (const [key, port] of Object.entries(type.connectorPorts ?? {}).sort(
      ([a], [b]) => compare(a, b),
    )) {
      const review = reviewAt(device.connectionReview?.connectorPorts, key);
      const connections = [...(links.get(portId(device.uid, key)) ?? [])].sort(
        compare,
      );
      const assembly = ir.relations.find(
        (r) =>
          r.assembly &&
          ((r.fromDeviceUid === device.uid && r.assembly.fromPort === key) ||
            (r.toDeviceUid === device.uid && r.assembly.toPort === key)),
      )?.assembly;
      entries.push({
        kind: "connector-port",
        key,
        required: port.required === true || review?.status === "required",
        ...(port.description === undefined
          ? {}
          : { description: port.description }),
        connection: connections.length ? "connected" : "unconnected",
        connections,
        ...(assembly ? { pinMapping: assembly.pinMapping.status } : {}),
        ...(review ? { review: structuredClone(review) } : {}),
        source: structuredClone(type.source),
      });
    }
    for (const entry of entries) {
      const name = `${device.designation}.${entry.key}`,
        review = entry.review;
      if (entry.required && entry.connection !== "connected")
        add(
          "W903",
          `Required ${entry.kind} ${name} ${entry.connection === "dangling" ? "has only a cable core with an unfinished far end" : "has no connection"}.${review ? ` Review: ${review.status}: ${review.reason}` : ""}`,
          entry,
        );
      if (review?.status === "deferred")
        add("W905", `${name} has deferred work: ${review.reason}`, entry);
      else if (review?.status === "intentionally-unused") {
        if (entry.required || entry.connection !== "unconnected")
          add(
            "W905",
            `${name} is marked intentionally unused but ${entry.required ? "is required" : "has an attached connection"}. Review: ${review.reason}`,
            entry,
          );
        else
          add(
            "I002",
            `${name} is intentionally unused: ${review.reason}`,
            entry,
          );
      } else if (!entry.required && entry.connection !== "connected")
        add(
          "I001",
          `${name} ${entry.connection === "dangling" ? "has an unfinished cable core" : "has no connection"}; no requirement or unused disposition is declared.`,
          entry,
        );
    }
    return {
      uid: device.uid,
      designation: device.designation,
      typeId: device.typeId,
      ...(device.location === undefined ? {} : { location: device.location }),
      coverage,
      source: structuredClone(device.source),
      definitionSource: structuredClone(type.source),
      connections: entries,
    };
  });
  const entries = devices.flatMap((d) => d.connections);
  return {
    format: "electrical-completeness/0.1",
    project: ir.project.name,
    scope: { ...scope },
    counts: {
      devices: devices.length,
      terminals: entries.filter((e) => e.kind === "terminal").length,
      ports: entries.filter(
        (e) => e.kind === "port" || e.kind === "connector-port",
      ).length,
      unconnected: entries.filter((e) => e.connection === "unconnected").length,
      dangling: entries.filter((e) => e.connection === "dangling").length,
      requiredMissing: entries.filter(
        (e) => e.required && e.connection !== "connected",
      ).length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      information: findings.filter((f) => f.severity === "info").length,
      partialModels: devices.filter((d) => d.coverage.status === "partial")
        .length,
      unreviewedModels: devices.filter(
        (d) => d.coverage.status === "unreviewed",
      ).length,
    },
    devices,
    findings,
    limitations: [
      "Connected means a modeled connection exists, not that supply, return, protective bonding, voltage, protection or operation is adequate.",
      "Communication links describe port topology; they do not prove that a physical network cable is scheduled.",
      "Connector-port occupancy is an assembly reservation only. Unresolved pin mapping never satisfies required electrical terminals or proves device power.",
      "Only declared terminals and ports can be checked. Complete coverage is an author declaration, not manufacturer certification.",
    ],
  };
}
