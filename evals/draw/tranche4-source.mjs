import { wireRecord, coreRecords } from "./tranche4-conductors.mjs";
import { conductorIdentity } from "./tranche3-identities.mjs";
export const compact = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s/gu, "");
export const terminalId = (t) => JSON.stringify([t?.deviceUid, t?.terminalKey]);
export const device = (ir, uid) => ir.devices?.find((d) => d.uid === uid);
export const terminalName = (ir, t) =>
  t
    ? `${device(ir, t.deviceUid)?.designation}.${t.terminalKey}`
    : "Unterminated";
export function nativeConductors4(ir) {
  if (
    !["wires", "jumpers", "cables", "cableConductors"].every((k) =>
      Array.isArray(ir?.[k]),
    )
  )
    throw Error("Native conductor arrays unavailable");
  const list = [
    ...ir.wires.map((w) => wireRecord(w, "wire")),
    ...ir.jumpers.map((w) => wireRecord(w, "jumper")),
    ...coreRecords(ir),
  ];
  if (list.some((w) => !w.key || !w.primary || w.ends?.length !== 2))
    throw Error("Native conductor identity/end data unavailable");
  return new Map(list.map((w) => [w.key, w]));
}
export function elementKey(e) {
  if (!e) return undefined;
  if (e.kind === "wire" || e.kind === "jumper") return e.uid;
  if (["core", "cable_conductor", "cable-conductor"].includes(e.kind))
    return JSON.stringify([e.cableUid, e.conductorId]);
}
export const sameEnds = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  JSON.stringify(a.map(terminalId).sort()) ===
    JSON.stringify(b.map(terminalId).sort());
export const routeKey = (s) => conductorIdentity(s.wire ?? s.loopConductor);
export function identityValue(value, w) {
  const v = compact(value),
    p = compact(w.primary),
    d = compact(w.designation);
  if ([w.primary, ...w.aliases].some((n) => compact(n) === v)) return true;
  if (!d || d === p) return false;
  return [
    d + p,
    p + d,
    `${d}(${p})`,
    `${p}(${d})`,
    `${d}—${p}`,
    `${d}–${p}`,
    `${d}/${p}`,
    `${p}/${d}`,
  ].includes(v);
}
