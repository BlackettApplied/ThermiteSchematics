import {
  printedPortEndpoint,
  relationPrintIdentity,
} from "../print-projection.js";
import { buildCommunicationInventory } from "../communication.js";
import type { DocumentationContext } from "./context.js";
export function appendNetworkLink<T>(
  link: ReturnType<typeof buildCommunicationInventory>["links"][number],
  context: DocumentationContext<T>,
) {
  const { ir, devices, options, rows } = context;
  const c = link.connection,
    a = devices.get(link.fromDeviceUid)!,
    b = devices.get(link.toDeviceUid)!;
  rows.push({
    key: link.uid,
    cells: [
      relationPrintIdentity(link, devices, options?.output).text,
      [
        c.protocol,
        c.cable?.specification,
        c.cable?.lengthM === undefined ? undefined : `${c.cable.lengthM} m`,
        c.cable?.route,
      ]
        .filter(Boolean)
        .join("\n"),
      [
        options?.output === "csv"
          ? `${a.designation}.${c.fromPort}`
          : printedPortEndpoint(ir, a.uid, c.fromPort),
        a.location,
      ]
        .filter(Boolean)
        .join("\n"),
      [
        options?.output === "csv"
          ? `${b.designation}.${c.toPort}`
          : printedPortEndpoint(ir, b.uid, c.toPort),
        b.location,
      ]
        .filter(Boolean)
        .join("\n"),
      c.status ?? "Status not specified",
    ],
    deviceUids: [a.uid, b.uid],
  });
}
export function documentationNetwork<T>(context: DocumentationContext<T>) {
  const { ir, incident, rows, options, devices, table } = context;
  const inventory = buildCommunicationInventory(ir);
  for (const link of inventory.links) {
    if (!incident([link.fromDeviceUid, link.toDeviceUid])) continue;
    appendNetworkLink(link, context);
  }
  for (const port of inventory.ports.filter(
    (p) => p.linkUid === null && incident([p.deviceUid]),
  ))
    rows.push({
      key: JSON.stringify([port.deviceUid, port.key]),
      cells: [
        "--",
        port.definition.medium ?? "Protocol / medium not specified",
        [
          options?.output === "csv"
            ? `${port.designation}.${port.key}`
            : printedPortEndpoint(ir, port.deviceUid, port.key),
          devices.get(port.deviceUid)!.location,
        ]
          .filter(Boolean)
          .join("\n"),
        "Unconnected",
        "Status not specified",
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
      ...(rows.some((r) => !r.cells[0]?.trim())
        ? ["Blank link references need review against the source."]
        : []),
    ],
  );
}
