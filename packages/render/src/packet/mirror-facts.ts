import type { ElectricalIr, FunctionId } from "@thermite/compiler";
import type { PlacedOccurrence, MirrorRow } from "./navigation-types.js";
import { distinctDestinations } from "./navigation-labels.js";
import { required } from "../presentation/util.js";

export const sameFunction = (a: FunctionId, b: FunctionId) =>
  a.deviceUid === b.deviceUid && a.functionKey === b.functionKey;

/** Only direct, same-device coil → contact actuation. No graph traversal. */
export function coilRelations(ir: Readonly<ElectricalIr>) {
  return ir.internalRelations.filter(
    (r) =>
      r.verb === "actuates" &&
      r.deviceUid === r.from.deviceUid &&
      r.from.deviceUid === r.to.deviceUid &&
      ir.functions.some(
        (f) => sameFunction(f.id, r.from) && f.kind === "coil",
      ) &&
      ir.functions.some(
        (f) => sameFunction(f.id, r.to) && f.kind === "contact",
      ),
  );
}
export function fullTargets(
  source: FunctionId,
  all: readonly PlacedOccurrence[],
) {
  return all.filter(
    (o) => o.role === "full-function" && sameFunction(o.source, source),
  );
}
export function mirrorRows(
  ir: Readonly<ElectricalIr>,
  coil: FunctionId,
  all: readonly PlacedOccurrence[],
  id: string,
): MirrorRow[] {
  const relations = coilRelations(ir).filter((r) => sameFunction(r.from, coil));
  return ir.functions
    .filter((f) => relations.some((r) => sameFunction(r.to, f.id)))
    .sort(
      (a, b) =>
        a.source.line - b.source.line || a.source.column - b.source.column,
    )
    .map((f, index) => {
      if (f.kind !== "contact" || !["open", "closed"].includes(f.normal_state))
        throw Error("Mirror requires authored contact normal_state");
      const targets = fullTargets(f.id, all);
      return {
        source: f.id,
        state: f.normal_state === "open" ? "NO" : "NC",
        terminals: f.terminals.map((t) => t.terminalKey),
        targets: targets.map((o) => o.id),
        destinations: distinctDestinations(targets),
        sourceOrigins: relations
          .filter((r) => sameFunction(r.to, f.id))
          .flatMap((r) => r.sourceOrigins),
        primitiveId: `${id}/row/${index}`,
      };
    });
}
export function contactCoils(ir: Readonly<ElectricalIr>, contact: FunctionId) {
  return [
    ...new Map(
      coilRelations(ir)
        .filter((r) => sameFunction(r.to, contact))
        .map((r) => [JSON.stringify(r.from), r.from]),
    ).values(),
  ];
}
export function unspecifiedContact(
  ir: Readonly<ElectricalIr>,
  contact: FunctionId,
) {
  return (
    ir.functions.some(
      (f) => f.id.deviceUid === contact.deviceUid && f.kind === "coil",
    ) &&
    !ir.internalRelations.some(
      (r) =>
        ["actuates", "trips"].includes(r.verb) && sameFunction(r.to, contact),
    )
  );
}
export function mirrorTag(ir: Readonly<ElectricalIr>, source: FunctionId) {
  return required(
    ir.devices.find((d) => d.uid === source.deviceUid),
    "Missing mirror device",
  ).designation;
}
