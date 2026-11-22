import type { ElectricalIr } from "@thermite/compiler";
import { pinMapPair } from "../signal-loop/pin-map.js";
import type { DrawingEdge, Conductor, LoopUtilities } from "./direct-types.js";
export function directLoopAssemblies(
  ir: Readonly<ElectricalIr>,
  request: {
    readonly cableAssemblies?: readonly {
      readonly cable: string;
      readonly connector: string;
      readonly description: string;
    }[];
  },
  physicalEdges: Conductor[],
  { compare, width, wrap }: LoopUtilities,
) {
  const assemblies: DrawingEdge[] = [];
  const assembledCables = new Set<string>();
  for (const spec of request.cableAssemblies ?? []) {
    const matching = ir.cables.filter(
      (c) => c.uid === spec.cable || c.designation === spec.cable,
    );
    if (matching.length !== 1)
      throw new Error(
        `Cable ${JSON.stringify(spec.cable)} does not resolve uniquely.`,
      );
    const cable = matching[0]!,
      members = physicalEdges
        .filter((e) => e.cable === cable.uid)
        .sort((a, b) => compare(a.id, b.id));
    if (!members.length || assembledCables.has(cable.uid))
      throw new Error(
        "Cable assembly must identify a unique cable in the selected loop.",
      );
    if (
      members.some((m) =>
        m.ends.some((t, i) => t.deviceUid !== members[0]!.ends[i]!.deviceUid),
      )
    )
      throw new Error(
        "A cable assembly must terminate on the same pair of devices for every core.",
      );
    if (width(spec.connector) > 15)
      throw new Error("Connector label is too wide.");
    const mapping = members.map((m) => pinMapPair(m));
    assemblies.push({
      id: `assembly:${cable.uid}`,
      cable: cable.uid,
      ends: members[0]!.ends,
      spare: false,
      assembly: { connector: spec.connector, members },
      label: [
        cable.designation,
        ...wrap(spec.description, 55),
        `${members.length} cores / pin map:`,
        ...wrap(mapping.join(", "), 55),
      ],
    });
    assembledCables.add(cable.uid);
  }

  return { assemblies, assembledCables };
}
