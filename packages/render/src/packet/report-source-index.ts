import type { ElectricalIr } from "@thermite/compiler";
import { renderCache } from "./render-cache.js";

function firstByUid<T extends { uid: string }>(values: readonly T[]) {
  const result = new Map<string, T>();
  for (const value of values)
    if (!result.has(value.uid)) result.set(value.uid, value);
  return result;
}
function sourceIndex(ir: Readonly<ElectricalIr>) {
  return {
    devices: new Map(ir.devices.map((d) => [d.uid, d])),
    relations: firstByUid(ir.relations),
    wires: firstByUid([...ir.wires, ...ir.jumpers]),
    cables: firstByUid(ir.cables),
  };
}
const indexes = new WeakMap<
  NonNullable<ReturnType<typeof renderCache.getStore>>,
  WeakMap<Readonly<ElectricalIr>, ReturnType<typeof sourceIndex>>
>();

/** Source lookup only; report kind/header policy still selects protected fields. */
export function reportSourceIndex(ir: Readonly<ElectricalIr>) {
  const scope = renderCache.getStore();
  if (!scope) return sourceIndex(ir);
  let cache = indexes.get(scope);
  if (!cache) {
    cache = new WeakMap();
    indexes.set(scope, cache);
  }
  let index = cache.get(ir);
  if (!index) {
    index = sourceIndex(ir);
    cache.set(ir, index);
  }
  return index;
}
