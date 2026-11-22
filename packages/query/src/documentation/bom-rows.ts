import type { DocumentationContext } from "./context.js";
import { relationPrintIdentity } from "../print-projection.js";
export function appendDeviceBom<T>(
  key: string,
  group: DocumentationContext<T>["orderedDevices"],
  context: DocumentationContext<T>,
) {
  const { types, rows, typeDescription, reportDescription } = context;
  const d = group[0]!,
    t = types.get(d.typeId)!;
  rows.push({
    key,
    cells: [
      String(group.length),
      group.map((d) => d.designation).join(", "),
      d.location ?? "",
      t.catalog?.manufacturer ?? "",
      t.catalog?.orderNumber ?? "",
      typeDescription(t.description, t.id),
      [
        reportDescription(d.description),
        ...(d.nonProcurement
          ? [`Not purchased: ${d.nonProcurement.reason}`]
          : []),
      ]
        .filter(Boolean)
        .join("\n"),
    ],
    deviceUids: group.map((d) => d.uid),
  });
}
export function appendCableBom<T>(
  cable: DocumentationContext<T>["ir"]["cables"][number],
  context: DocumentationContext<T>,
) {
  const { rows, typeDescription, cables, selection, reportDescription } =
    context;
  rows.push({
    key: cable.uid,
    cells: [
      "1",
      cable.designation,
      [cable.fromLocation, cable.toLocation].filter(Boolean).join(" to "),
      "",
      "",
      typeDescription(
        cables.find((c) => c.cableUid === cable.uid)!.description,
        cable.typeId,
      ),
      reportDescription(cable.description) ?? "",
    ],
    deviceUids: selection
      ? cables
          .find((c) => c.cableUid === cable.uid)!
          .cores.flatMap((k) =>
            k.endpoints.flatMap((e) => (e ? [e.terminal.deviceUid] : [])),
          )
      : [],
  });
}
export function appendAssemblyBom<T>(
  relation: DocumentationContext<T>["ir"]["relations"][number],
  context: DocumentationContext<T>,
) {
  const { devices, rows, reportDescription } = context;
  const cable = relation.assembly!.cable!;
  rows.push({
    key: relation.uid,
    deviceUids: [relation.fromDeviceUid, relation.toDeviceUid],
    cells: [
      "1",
      relationPrintIdentity(relation, devices).text,
      [
        devices.get(relation.fromDeviceUid)!.location,
        devices.get(relation.toDeviceUid)!.location,
      ]
        .filter(Boolean)
        .join(" to "),
      cable.manufacturer ?? "",
      cable.orderNumber ?? "",
      [
        cable.specification,
        cable.lengthM === undefined ? undefined : `${cable.lengthM} m`,
        "Assembly only; pin mapping unresolved",
      ]
        .filter(Boolean)
        .join("\n"),
      reportDescription(relation.description) ?? "",
    ],
  });
}
