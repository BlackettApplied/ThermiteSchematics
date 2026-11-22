import type { ElectricalIr } from "@thermite/compiler";
import type { DeviceTagPlan } from "../device-tags.js";
import type { Rect } from "./geometry.js";

export interface LegendTag extends DeviceTagPlan {
  /** Exact qualified identity painted by a separate, owned local annotation. */
  readonly referenceKey?: string;
  readonly referenceBlock?: string;
}
export interface LegendReference {
  key: string;
  terminalKey: string;
  box: Rect;
}
export function legendReference(
  text: string,
  terminal: string | undefined,
  owner: string | undefined,
  box: Rect,
): LegendReference | undefined {
  if (!terminal || !owner) return;
  const id = JSON.parse(terminal);
  if (id.deviceUid !== owner || typeof id.terminalKey !== "string") return;
  return {
    key: text.startsWith("Off-view at ") ? text.slice(12) : text,
    terminalKey: id.terminalKey,
    box,
  };
}
export function localReferenceKey(
  ir: Readonly<ElectricalIr>,
  uid: string,
  references: readonly LegendReference[],
) {
  const device = ir.devices.find((d) => d.uid === uid),
    type = ir.deviceTypes.find((t) => t.id === device?.typeId);
  return references.find(
    (r) =>
      r.key === `${device?.designation}.${r.terminalKey}` &&
      type?.terminals.some((t) => t.key === r.terminalKey),
  )?.key;
}
