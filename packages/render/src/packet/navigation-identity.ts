import { renderCache } from "./render-cache.js";
import { createHash } from "node:crypto";
import { serializeIr, type ElectricalIr } from "@thermite/compiler";
export const navigationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** The source IR is unchanged throughout a render; never reuse its digest across calls. */
export function navigationSnapshotDigest(ir: Readonly<ElectricalIr>): string {
  const cache = renderCache.getStore()?.snapshots;
  const prior = cache?.get(ir);
  if (prior !== undefined) return prior;
  const digest = navigationHash(serializeIr(ir));
  cache?.set(ir, digest);
  return digest;
}
/** UID-resolve selections; presentation wording and layout are deliberately absent. */
export function navigationViewKey(
  ir: Readonly<ElectricalIr>,
  selection: unknown,
  duplicateOrdinal: number,
): string {
  const clean = (v: unknown, field = ""): unknown => {
    if (typeof v === "string" && field === "conductors")
      return conductorSelectionId(ir, v);
    if (typeof v === "string" && field === "cable")
      return (
        ir.cables.find((c) => c.uid === v || c.designation === v)?.uid ?? v
      );
    if (typeof v === "string" && ["device", "devices"].includes(field))
      return (
        ir.devices.find((d) => d.uid === v || d.designation === v)?.uid ?? v
      );
    if (Array.isArray(v)) return v.map((value) => clean(value, field));
    if (!v || typeof v !== "object") return v;
    if ("by" in v && "value" in v) {
      const selector = v as { by: unknown; value: unknown };
      return { by: "uid", value: clean(selector.value, "device") };
    }
    return Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) =>
            ![
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
            ].includes(k),
        )
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, value]) => [k, clean(value, k)]),
    );
  };
  return `view/1/${navigationHash([clean(selection), duplicateOrdinal])}`;
}

function conductorSelectionId(
  ir: Readonly<ElectricalIr>,
  value: string,
): string {
  const wire = [...ir.wires, ...ir.jumpers].find(
    (w) => w.uid === value || w.designation === value,
  );
  if (wire) return wire.uid;
  const core = ir.cableConductors.find(
    (c) =>
      JSON.stringify(c.id) === value ||
      `${ir.cables.find((cable) => cable.uid === c.cableUid)?.designation}/${c.id.conductorId}` ===
        value,
  );
  return core
    ? JSON.stringify({
        cableUid: core.cableUid,
        conductorId: core.id.conductorId,
      })
    : value;
}
