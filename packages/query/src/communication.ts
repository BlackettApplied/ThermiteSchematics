import type {
  ElectricalIr,
  IrDeviceType,
  IrProjectRelation,
} from "@thermite/compiler";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export interface CommunicationInventory {
  readonly format: "communication-inventory/0.1";
  readonly ports: readonly {
    readonly deviceUid: string;
    readonly designation: string;
    readonly location: string;
    readonly key: string;
    readonly definition: NonNullable<IrDeviceType["ports"]>[string];
    readonly linkUid: string | null;
  }[];
  readonly links: readonly (IrProjectRelation & {
    readonly connection: NonNullable<IrProjectRelation["connection"]>;
  })[];
}
/** Authored physical links only. This does not imply electrical continuity or protocol compatibility. */
export function buildCommunicationInventory(
  ir: Readonly<ElectricalIr>,
): CommunicationInventory {
  const links = ir.relations
    .filter(
      (r): r is CommunicationInventory["links"][number] =>
        r.connection !== undefined,
    )
    .sort((a, b) => compare(a.designation ?? a.uid, b.designation ?? b.uid));
  const occupied = new Map<string, string>();
  for (const link of links) {
    occupied.set(
      JSON.stringify([link.fromDeviceUid, link.connection.fromPort]),
      link.uid,
    );
    occupied.set(
      JSON.stringify([link.toDeviceUid, link.connection.toPort]),
      link.uid,
    );
  }
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  return {
    format: "communication-inventory/0.1",
    links: structuredClone(links),
    ports: [...ir.devices]
      .sort((a, b) => compare(a.designation, b.designation))
      .flatMap((d) =>
        Object.entries(types.get(d.typeId)!.ports ?? {})
          .sort(([a], [b]) => compare(a, b))
          .map(([key, definition]) => ({
            deviceUid: d.uid,
            designation: d.designation,
            location: d.location ?? "Unspecified",
            key,
            definition: structuredClone(definition),
            linkUid: occupied.get(JSON.stringify([d.uid, key])) ?? null,
          })),
      ),
  };
}
