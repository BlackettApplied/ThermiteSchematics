import type { buildConnectorAssemblyInventory } from "@thermite/query";
import type { DocumentNeedSeed } from "../packet/document-types.js";

type Inventory = ReturnType<typeof buildConnectorAssemblyInventory>;
/** Native inventory identities only; packet-wide S1 removes drawn port needs. */
export function assemblyDocumentNeeds(
  inventory: Inventory,
  links: readonly Inventory["assemblies"][number][],
  devices: readonly string[],
  ports: readonly { deviceUid: string; portKey: string }[],
): DocumentNeedSeed[] {
  const result: DocumentNeedSeed[] = [];
  if (links.length)
    result.push({
      noteId: "assembly-reasons",
      need: "assembly-pin-map",
      requiredFacts: links.map((r) => ({
        kind: "assembly-pin-map",
        relationUid: r.uid,
      })),
      requiredColumns: ["identity", "endpoints", "status", "pin-map"],
      subject: `${links.length} authored assembl${links.length === 1 ? "y" : "ies"}`,
    });
  const drawn = new Set(
    ports.map((p) => JSON.stringify([p.deviceUid, p.portKey])),
  );
  for (const p of inventory.ports) {
    const id = JSON.stringify([p.deviceUid, p.key]);
    if (!devices.includes(p.deviceUid) || drawn.has(id)) continue;
    result.push({
      noteId: `connector-port-status/${id}`,
      need: "connector-port-status",
      requiredFacts: [
        {
          kind: "connector-port-status",
          deviceUid: p.deviceUid,
          portKey: p.key,
        },
      ],
      requiredColumns: ["identity", "endpoints", "status"],
      subject: `${p.designation}.${p.key} → connector port status`,
    });
  }
  return result;
}
