import { createHash } from "node:crypto";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const omitted = new Set([
  "title",
  "notes",
  "description",
  "designation",
  "typeId",
  "layout",
  "page",
  "spacingProfile",
  "columns",
  "label",
]);
// Independently reconstruct the published locator grammar. This binds a candidate
// to authored selection; it never authorizes any painted fact or destination.
function selectionValue(value, field, ir) {
  if (typeof value === "string") {
    const pool =
      field === "conductors"
        ? [...ir.wires, ...ir.jumpers]
        : field === "cable"
          ? ir.cables
          : ["device", "devices"].includes(field)
            ? ir.devices
            : [];
    const match = pool.find((x) => x.uid === value || x.designation === value);
    if (field === "conductors" && !match) {
      const core = ir.cableConductors.find(
        (c) =>
          JSON.stringify(c.id) === value ||
          `${ir.cables.find((b) => b.uid === c.id.cableUid)?.designation}/${c.id.conductorId}` ===
            value,
      );
      if (core)
        return JSON.stringify({
          cableUid: core.id.cableUid,
          conductorId: core.id.conductorId,
        });
    }
    return match?.uid ?? value;
  }
  if (Array.isArray(value))
    return value.map((v) => selectionValue(v, field, ir));
  if (!value || typeof value !== "object") return value;
  if ("by" in value && "value" in value)
    return { by: "uid", value: selectionValue(value.value, "device", ir) };
  return Object.fromEntries(
    Object.keys(value)
      .filter((k) => !omitted.has(k))
      .sort()
      .map((k) => [k, selectionValue(value[k], k, ir)]),
  );
}
export function viewBindings(request, ir) {
  const counts = new Map();
  return (request?.views ?? []).map((v) => {
    const selection = selectionValue(v, "", ir),
      base = hash([selection, 0]),
      ordinal = counts.get(base) ?? 0;
    counts.set(base, ordinal + 1);
    return `view/1/${hash([selection, ordinal])}`;
  });
}
export const inView = (g, key) =>
  typeof key === "string" && g.navigationViews?.includes(key);
