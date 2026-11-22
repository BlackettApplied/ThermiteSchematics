import { printedConductor } from "./continuation-labels.mjs";
const compact = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s/gu, "");
export function nativeLabelIdentity(texts, ir) {
  const id = texts[0].wire;
  let sourceElement;
  const wire = [...(ir.wires ?? []), ...(ir.jumpers ?? [])].find(
    (w) => w.uid === id,
  );
  if (wire)
    sourceElement = {
      kind: (ir.wires ?? []).includes(wire) ? "wire" : "jumper",
      uid: id,
    };
  else {
    try {
      const [cableUid, conductorId] = JSON.parse(id);
      sourceElement = { kind: "core", cableUid, conductorId };
    } catch {
      return false;
    }
  }
  const native = printedConductor({ sourceElement }, ir);
  if (!native) return false;
  const names = [
    ...(native.names ?? []),
    native.text,
    ...(native.undesignated ? ["Jumper", "jumper"] : []),
  ]
    .filter(Boolean)
    .map(compact);
  if (native.kind === "core") {
    const cable = ir.cables.find((c) => c.uid === native.cableUid);
    if (cable?.designation)
      names.push(compact(cable.designation + "/" + native.conductorId));
  }
  let prefix = "";
  for (const t of texts) {
    prefix += compact(t.text);
    if (names.includes(prefix)) return true;
  }
  return false;
}
