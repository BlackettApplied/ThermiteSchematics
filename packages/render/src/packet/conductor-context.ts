import type { ElectricalIr, ConductiveElementId } from "@thermite/compiler";
import type { InvalidSheetError } from "../errors.js";

export function continuationErrorContext(
  ir: Readonly<ElectricalIr>,
  error: InvalidSheetError,
): InvalidSheetError {
  const ids = (error.details?.conductorIds ?? []) as readonly (
    ConductiveElementId | undefined
  )[];
  const identity = error.details?.continuationIdentity;
  const tuples = ids.filter((id): id is ConductiveElementId => !!id);
  if (typeof identity === "string") {
    try {
      const tuple: unknown = JSON.parse(identity);
      if (Array.isArray(tuple) && typeof tuple[1] === "string") {
        if (tuple[0] === "wire" || tuple[0] === "jumper")
          tuples.push({ kind: tuple[0], uid: tuple[1] });
        if (tuple[0] === "cable_conductor" && typeof tuple[2] === "string")
          tuples.push({
            kind: "cable_conductor",
            cableUid: tuple[1],
            conductorId: tuple[2],
          });
      }
    } catch {
      /* Other structural edge IDs have no authored conductor identity. */
    }
  }
  const conductors = tuples.flatMap((id) => {
    const conductor =
      id.kind === "wire"
        ? ir.wires.find((c) => c.uid === id.uid)
        : id.kind === "jumper"
          ? ir.jumpers.find((c) => c.uid === id.uid)
          : ir.cableConductors.find(
              (c) =>
                c.cableUid === id.cableUid &&
                c.id.conductorId === id.conductorId,
            );
    if (!conductor) return [];
    return [
      {
        id,
        terminals: conductor.endpoints.map((e) => {
          const device = ir.devices.find((d) => d.uid === e.terminal.deviceUid);
          return {
            ...e.terminal,
            ...(device ? { designation: device.designation } : {}),
          };
        }),
      },
    ];
  });
  return conductors.length
    ? { ...error, details: { ...error.details, conductors } }
    : error;
}
