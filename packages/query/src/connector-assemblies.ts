import type {
  ElectricalIr,
  IrDeviceType,
  IrProjectRelation,
} from "@thermite/compiler";

export interface ConnectorAssemblyInventory {
  readonly format: "connector-assembly-inventory/0.1";
  readonly assemblies: readonly (IrProjectRelation & {
    assembly: NonNullable<IrProjectRelation["assembly"]>;
  })[];
  readonly ports: readonly {
    deviceUid: string;
    designation: string;
    location: string;
    key: string;
    definition: NonNullable<IrDeviceType["connectorPorts"]>[string];
    assemblyUid: string | null;
  }[];
}
/** Physical assembly identity and occupancy; no implied pin mapping or electrical continuity. */
export function buildConnectorAssemblyInventory(
  ir: Readonly<ElectricalIr>,
): ConnectorAssemblyInventory {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const assemblies = ir.relations
    .filter(
      (r): r is ConnectorAssemblyInventory["assemblies"][number] =>
        r.assembly !== undefined,
    )
    .sort((a, b) => compare(a.designation ?? a.uid, b.designation ?? b.uid));
  const occupied = new Map<string, string>();
  for (const a of assemblies) {
    occupied.set(JSON.stringify([a.fromDeviceUid, a.assembly.fromPort]), a.uid);
    occupied.set(JSON.stringify([a.toDeviceUid, a.assembly.toPort]), a.uid);
  }
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  return {
    format: "connector-assembly-inventory/0.1",
    assemblies: structuredClone(assemblies),
    ports: [...ir.devices]
      .sort((a, b) => compare(a.designation, b.designation))
      .flatMap((d) =>
        Object.entries(types.get(d.typeId)!.connectorPorts ?? {})
          .sort(([a], [b]) => compare(a, b))
          .map(([key, definition]) => ({
            deviceUid: d.uid,
            designation: d.designation,
            location: d.location ?? "Unspecified",
            key,
            definition: structuredClone(definition),
            assemblyUid: occupied.get(JSON.stringify([d.uid, key])) ?? null,
          })),
      ),
  };
}
