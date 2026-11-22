// Connector ports are mechanical/native port states, never communication links.
import { nativeEmptyState } from "./native-empty-state.mjs";
export function assemblyStatus(c) {
  if (!c.pinMapping?.status || !c.pinMapping?.reason)
    return {
      sourceGap: "Native assembly pin mapping disposition/reason unavailable",
      requiredStatus: [],
    };
  const suffix = `\nPin mapping: ${c.pinMapping.status}\n${c.pinMapping.reason}`;
  return {
    requiredStatus: [
      c.status === undefined
        ? nativeEmptyState("unspecified-status", suffix)
        : `${c.status}${suffix}`,
    ],
  };
}
export const connectorPortFact = (deviceUid, portKey) => ({
  kind: "connector-port-status",
  deviceUid,
  portKey,
});
export function assemblyFacts(r) {
  const facts = [
    { kind: "assembly-pin-map", relationUid: r.uid },
    connectorPortFact(r.fromDeviceUid, r.assembly.fromPort),
    connectorPortFact(r.toDeviceUid, r.assembly.toPort),
  ];
  return [...new Map(facts.map((f) => [JSON.stringify(f), f])).values()];
}
export function appendUnoccupiedConnectors(ir, rows) {
  for (const d of ir.devices ?? [])
    for (const [key, definition] of Object.entries(
      ir.deviceTypes?.find((t) => t.id === d.typeId)?.connectorPorts ?? {},
    )) {
      if (
        (ir.relations ?? []).some(
          (r) =>
            r.assembly &&
            ((r.fromDeviceUid === d.uid && r.assembly.fromPort === key) ||
              (r.toDeviceUid === d.uid && r.assembly.toPort === key)),
        )
      )
        continue;
      rows.push({
        kind: "assemblies",
        key: JSON.stringify([d.uid, key]),
        name: `${d.designation} / ${key}`,
        facts: [connectorPortFact(d.uid, key)],
        columns: ["identity", "endpoints", "status"],
        required: {
          0: ["--"],
          1: [definition.connector],
          2: [
            [`${d.designation}.${key}`, d.location].filter(Boolean).join("\n"),
          ],
          3: ["Unoccupied"],
          4: ["No assembly declared"],
        },
        exactColumns: [0, 1, 2, 3, 4],
      });
    }
}
