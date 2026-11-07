import type { ElectricalIr } from "@thermite/compiler";
import {
  buildCommunicationInventory,
  buildConnectorAssemblyInventory,
} from "@thermite/query";

export interface PortIdentity {
  readonly deviceUid: string;
  readonly portKey: string;
}
export interface TopologyDrawingCoverage {
  readonly kind: "connector-assembly" | "communication";
  readonly relationIds: readonly string[];
  readonly deviceUids: readonly string[];
  /** Individually drawn ports only; summary captions do not represent ports. */
  readonly ports: readonly PortIdentity[];
}
export interface TopologyAppearance {
  readonly sheet: number;
  readonly view: string;
  readonly kind: TopologyDrawingCoverage["kind"];
}
export interface TopologyRelationEntry {
  readonly id: string;
  readonly designation: string;
  readonly endpoints: readonly PortIdentity[];
  readonly appearances: readonly TopologyAppearance[];
}
export interface TopologyPortEntry extends PortIdentity {
  readonly id: string;
  readonly designation: string;
  readonly connector: string;
  readonly relationUid: string | null;
  readonly appearances: readonly (TopologyAppearance & {
    readonly state: "represented-link" | "outside-view" | "unoccupied";
  })[];
}
export interface TopologyCoverage {
  readonly format: "schematic-topology-coverage/0.1";
  readonly scope: "connector-assemblies-and-communications";
  readonly counts: Readonly<
    Record<
      | "assemblies"
      | "communicationLinks"
      | "connectorPorts"
      | "communicationPorts"
      | "devices",
      {
        readonly total: number;
        readonly represented: number;
        readonly outsideAuditedViews: number;
      }
    >
  >;
  readonly assemblies: readonly (TopologyRelationEntry & {
    readonly assembly: NonNullable<
      ElectricalIr["relations"][number]["assembly"]
    >;
  })[];
  readonly communicationLinks: readonly (TopologyRelationEntry & {
    readonly connection: NonNullable<
      ElectricalIr["relations"][number]["connection"]
    >;
  })[];
  readonly connectorPorts: readonly TopologyPortEntry[];
  readonly communicationPorts: readonly TopologyPortEntry[];
  readonly devices: readonly {
    readonly id: string;
    readonly designation: string;
    readonly appearances: readonly TopologyAppearance[];
  }[];
  readonly unauditedSheets: readonly number[];
  readonly limitations: readonly string[];
}
export interface TopologySheet {
  readonly sheet: number;
  readonly view: string;
  readonly topologyDrawings?: readonly TopologyDrawingCoverage[];
}
const portId = (p: PortIdentity) => JSON.stringify([p.deviceUid, p.portKey]);
const compare = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Source identity conservation, independent of electrical nets and schedule appearances. */
export function buildTopologyCoverage(
  ir: Readonly<ElectricalIr>,
  sheets: readonly TopologySheet[],
): TopologyCoverage {
  const a = buildConnectorAssemblyInventory(ir),
    c = buildCommunicationInventory(ir);
  const assemblies = a.assemblies.map((r) => ({
    id: r.uid,
    designation: r.designation ?? r.uid,
    endpoints: [
      { deviceUid: r.fromDeviceUid, portKey: r.assembly.fromPort },
      { deviceUid: r.toDeviceUid, portKey: r.assembly.toPort },
    ],
    assembly: structuredClone(r.assembly),
    appearances: [] as TopologyAppearance[],
  }));
  const communicationLinks = c.links.map((r) => ({
    id: r.uid,
    designation: r.designation ?? r.uid,
    endpoints: [
      { deviceUid: r.fromDeviceUid, portKey: r.connection.fromPort },
      { deviceUid: r.toDeviceUid, portKey: r.connection.toPort },
    ],
    connection: structuredClone(r.connection),
    appearances: [] as TopologyAppearance[],
  }));
  const ports = (items: typeof a.ports | typeof c.ports) =>
    items.map((p) => ({
      id: portId({ deviceUid: p.deviceUid, portKey: p.key }),
      deviceUid: p.deviceUid,
      portKey: p.key,
      designation: `${p.designation}.${p.key}`,
      connector: p.definition.connector,
      relationUid: "assemblyUid" in p ? p.assemblyUid : p.linkUid,
      appearances: [] as (TopologyAppearance & {
        state: "represented-link" | "outside-view" | "unoccupied";
      })[],
    }));
  const connectorPorts = ports(a.ports),
    communicationPorts = ports(c.ports);
  const deviceIds = new Set(
    [...connectorPorts, ...communicationPorts].map((p) => p.deviceUid),
  );
  const devices = ir.devices
    .filter((d) => deviceIds.has(d.uid))
    .map((d) => ({
      id: d.uid,
      designation: d.designation,
      appearances: [] as TopologyAppearance[],
    }));
  const deviceMap = new Map(devices.map((d) => [d.id, d]));
  for (const sheet of sheets)
    for (const drawing of sheet.topologyDrawings ?? []) {
      const relations =
        drawing.kind === "connector-assembly" ? assemblies : communicationLinks;
      const visiblePorts =
        drawing.kind === "connector-assembly"
          ? connectorPorts
          : communicationPorts;
      const relationMap = new Map(relations.map((r) => [r.id, r]));
      const portMap = new Map(visiblePorts.map((p) => [p.id, p]));
      const selectedRelations = new Set(drawing.relationIds),
        selectedDevices = new Set(drawing.deviceUids),
        selectedPorts = new Set(drawing.ports.map(portId));
      if (
        selectedRelations.size !== drawing.relationIds.length ||
        selectedDevices.size !== drawing.deviceUids.length ||
        selectedPorts.size !== drawing.ports.length
      )
        throw new Error(
          "Topology coverage repeats a source identity within one drawing.",
        );
      const appearance = {
        sheet: sheet.sheet,
        view: sheet.view,
        kind: drawing.kind,
      };
      for (const id of selectedDevices) {
        const d = deviceMap.get(id);
        if (!d)
          throw new Error(
            `Topology coverage references an unknown device: ${id}.`,
          );
        d.appearances.push({ ...appearance });
      }
      for (const id of selectedRelations) {
        const r = relationMap.get(id);
        if (!r)
          throw new Error(
            `Topology coverage references an unknown ${drawing.kind} relation: ${id}.`,
          );
        if (
          !r.endpoints.every(
            (p) =>
              selectedDevices.has(p.deviceUid) && selectedPorts.has(portId(p)),
          )
        )
          throw new Error(
            `Topology coverage omits a drawn endpoint for ${id}.`,
          );
        r.appearances.push({ ...appearance });
      }
      for (const id of selectedPorts) {
        const p = portMap.get(id);
        if (!p)
          throw new Error(
            `Topology coverage references an unknown ${drawing.kind} port: ${id}.`,
          );
        if (!selectedDevices.has(p.deviceUid))
          throw new Error(`Topology coverage omits the device for port ${id}.`);
        p.appearances.push({
          ...appearance,
          state:
            p.relationUid === null
              ? "unoccupied"
              : selectedRelations.has(p.relationUid)
                ? "represented-link"
                : "outside-view",
        });
      }
    }
  const count = (entries: readonly { appearances: readonly unknown[] }[]) => {
    const represented = entries.filter((e) => e.appearances.length).length;
    return {
      total: entries.length,
      represented,
      outsideAuditedViews: entries.length - represented,
    };
  };
  return {
    format: "schematic-topology-coverage/0.1",
    scope: "connector-assemblies-and-communications",
    counts: {
      assemblies: count(assemblies),
      communicationLinks: count(communicationLinks),
      connectorPorts: count(connectorPorts),
      communicationPorts: count(communicationPorts),
      devices: count(devices),
    },
    assemblies: assemblies.sort(compare),
    communicationLinks: communicationLinks.sort(compare),
    connectorPorts: connectorPorts.sort(compare),
    communicationPorts: communicationPorts.sort(compare),
    devices: devices.sort(compare),
    unauditedSheets: sheets
      .filter((s) => !s.topologyDrawings?.length)
      .map((s) => s.sheet),
    limitations: [
      "Only connector assembly and communication drawings are audited here. Schedules, indexes and circuit/wiring views do not count as topology appearances.",
      "Ports summarized by a count or omitted from a drawing remain outside audited views. A device appearance does not imply that all of its ports are drawn.",
      "Assembly mapping status and communication metadata are authored facts. Coverage does not resolve pin wiring, join electrical nets or verify protocol compatibility or live configuration.",
      "Repeated source appearances count once as represented. An outside-audited-view identity is not proof of omission from the entire packet or upstream source.",
    ],
  };
}
