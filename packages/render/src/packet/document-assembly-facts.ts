import type { ElectricalIr } from "@thermite/compiler";
import type { DocumentFact, SemanticColumn } from "./document-types.js";

export interface AssemblyRowFacts {
  facts: DocumentFact[];
  columns: SemanticColumn[];
}
export function assemblyFactRows(ir: Readonly<ElectricalIr>) {
  const rows = new Map<string, AssemblyRowFacts>();
  const occupied = new Set<string>();
  for (const r of ir.relations) {
    if (!r.assembly) continue;
    const ends = [
      { deviceUid: r.fromDeviceUid, portKey: r.assembly.fromPort },
      { deviceUid: r.toDeviceUid, portKey: r.assembly.toPort },
    ];
    const facts: DocumentFact[] = [
      { kind: "assembly-pin-map", relationUid: r.uid },
    ];
    for (const end of ends) {
      const key = JSON.stringify([end.deviceUid, end.portKey]);
      if (
        !facts.some(
          (f) =>
            f.kind === "connector-port-status" &&
            f.deviceUid === end.deviceUid &&
            f.portKey === end.portKey,
        )
      )
        facts.push({ kind: "connector-port-status", ...end });
      occupied.add(key);
    }
    rows.set(r.uid, {
      facts,
      columns: ["identity", "endpoints", "status", "pin-map"],
    });
  }
  for (const device of ir.devices) {
    const type = ir.deviceTypes.find((t) => t.id === device.typeId);
    for (const portKey of Object.keys(type?.connectorPorts ?? {})) {
      const key = JSON.stringify([device.uid, portKey]);
      if (!occupied.has(key))
        rows.set(key, {
          facts: [
            { kind: "connector-port-status", deviceUid: device.uid, portKey },
          ],
          columns: ["identity", "endpoints", "status"],
        });
    }
  }
  return rows;
}
