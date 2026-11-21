import { namedPortNeeds } from "./assembly-port-pointers.mjs";
export const captionForms = {
  "conductor-incidence": ["physical connection", "physical connections"],
  "terminal-inventory": ["terminal", "terminals"],
  "port-link-status": ["port", "ports"],
  "connector-port-status": ["port", "ports"],
  "core-inventory": ["core", "cores"],
  "assembly-pin-map": ["assembly", "assemblies"],
};
export function pointerMatches(n, t) {
  if (t.nativeRequestNote || t.row) return false;
  if (n.need === "conductor-incidence")
    return (
      /other physical connections|see wire schedule/i.test(t.text) &&
      (!n.subject || !/inventory/i.test(t.text) || t.text.includes(n.subject))
    );
  if (n.need === "terminal-inventory")
    return (
      /other terminals|terminal inventory/i.test(t.text) &&
      (!n.subject || !/inventory/i.test(t.text) || t.text.includes(n.subject))
    );
  if (n.need === "port-link-status")
    return /see (communication|link) schedule|port protocol|network inventory/i.test(
      t.text,
    );
  if (n.need === "core-inventory")
    return /core details|wire inventory/i.test(t.text);
  if (n.need === "connector-port-status")
    return /connector port status|connector inventory|other ports/iu.test(
      t.text,
    );
  return /pin.map|assembly inventory/i.test(t.text);
}
export function ownerFor(f, row, ir) {
  if (f.kind === "conductor-incidence" || f.kind === "terminal-inventory")
    return { kind: "device", uid: f.terminal.deviceUid };
  if (["port-link-status", "connector-port-status"].includes(f.kind))
    return { kind: "device", uid: f.deviceUid };
  if (f.kind === "assembly-pin-map")
    return {
      kind: "device",
      uid: ir.relations.find((r) => r.uid === f.relationUid)?.fromDeviceUid,
    };
  const first = row.native.ends?.find(Boolean);
  return first
    ? { kind: "device", uid: first.deviceUid }
    : { kind: "cable", uid: f.cableUid };
}
export function checkConnectorSubject(need, note, ir, fail) {
  if (need.need !== "connector-port-status" || !/->|→/u.test(note.text)) return;
  const f = need.facts[0],
    owner = ir.devices.find((d) => d.uid === f?.deviceUid)?.designation;
  if (
    !f ||
    !namedPortNeeds(note, [{ uid: f.deviceUid, owner, key: f.portKey }]).length
  )
    fail("document-caption-connector-port-subject-mismatch");
}
