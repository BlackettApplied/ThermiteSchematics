import { buildConnectorAssemblyInventory } from "../connector-assemblies.js";
import { relationPrintIdentity } from "../print-projection.js";
import type { DocumentationContext } from "./context.js";
export function appendConnectorPort<T>(
  port: ReturnType<typeof buildConnectorAssemblyInventory>["ports"][number],
  assemblies: Map<
    string,
    ReturnType<typeof buildConnectorAssemblyInventory>["assemblies"][number]
  >,
  context: DocumentationContext<T>,
) {
  const { devices, rows, reportDescription } = context;
  const device = devices.get(port.deviceUid)!;
  const assignment = Object.hasOwn(device.connectorIo!.ports, port.key)
    ? device.connectorIo!.ports[port.key]
    : undefined;
  const relation =
    port.assemblyUid === null ? undefined : assemblies.get(port.assemblyUid);
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
      [assignment?.signal, `Usage: ${assignment?.usage ?? "Not specified"}`]
        .filter(Boolean)
        .join("\n"),
      relation
        ? `${relationPrintIdentity(relation, devices).text || "Assembly reference needs review"} (${assembly!.kind}; ${assembly!.status ?? "Status not specified"})\n${devices.get(peerUid!)!.designation}.${peerPort}`
        : "Unoccupied",
      assembly
        ? `${assembly.pinMapping.status}\n${assembly.pinMapping.reason}`
        : "No assembly; mapping unspecified",
      review
        ? `${review.status === "intentionally-unused" ? "Intentionally unused" : review.status}\n${review.reason}`
        : "Status not specified",
    ],
  });
}
export function documentationIoPorts<T>(context: DocumentationContext<T>) {
  const { ir, selected, request, table } = context;
  const inventory = buildConnectorAssemblyInventory(ir);
  const assemblies = new Map(inventory.assemblies.map((a) => [a.uid, a]));
  const included = new Set(
    selected.filter((d) => d.connectorIo !== undefined).map((d) => d.uid),
  );
  for (const port of inventory.ports.filter((p) => included.has(p.deviceUid))) {
    appendConnectorPort(port, assemblies, context);
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
