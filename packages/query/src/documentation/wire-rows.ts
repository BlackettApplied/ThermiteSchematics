import type { ElectricalIr } from "@thermite/compiler";
import { type EndpointSheetZones } from "../cable-schedule.js";
import type { DocumentationContext } from "./context.js";
export function appendWireRow<T>(
  w:
    | DocumentationContext<T>["ir"]["wires"][number]
    | DocumentationContext<T>["ir"]["jumpers"][number],
  zones: EndpointSheetZones[],
  context: DocumentationContext<T>,
) {
  const { references, rows, label } = context;
  zones.push(references?.conductors?.get(w.uid) ?? [null, null]);
  const properties = (
    "properties" in w ? w.properties : undefined
  ) as ElectricalIr["wires"][number]["properties"];
  rows.push({
    key: w.uid,
    cells: [
      [
        w.designation ?? "Jumper",
        properties?.label && properties.label !== w.designation
          ? properties.label
          : null,
      ]
        .filter(Boolean)
        .join(" / "),
      label(w.endpoints[0].terminal),
      label(w.endpoints[1].terminal),
      [properties?.color, properties?.size].filter(Boolean).join(" / "),
      "Connected",
    ],
    deviceUids: w.endpoints.map((e) => e.terminal.deviceUid),
  });
}
export function appendCoreRow<T>(
  c: DocumentationContext<T>["cables"][number],
  core: DocumentationContext<T>["cables"][number]["cores"][number],
  zones: EndpointSheetZones[],
  context: DocumentationContext<T>,
) {
  const { rows } = context;
  zones.push([core.endpoints[0]?.sheetZone, core.endpoints[1]?.sheetZone]);
  rows.push({
    key: JSON.stringify([c.cableUid, core.id]),
    cells: [
      `${c.designation}/${core.id}`,
      core.endpoints[0]?.display ?? "Unterminated",
      core.endpoints[1]?.display ?? "Unterminated",
      [core.color, core.size].filter(Boolean).join(" / "),
      `${core.usage}; ${core.status}`,
    ],
    deviceUids: core.endpoints.flatMap((e) =>
      e ? [e.terminal.deviceUid] : [],
    ),
  });
}
