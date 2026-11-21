import { electricalLoopRoutes } from "./routing-hygiene.mjs";
export function conductorIdentity(raw) {
  if (!raw) return undefined;
  if (typeof raw === "object")
    return raw.cableUid && raw.conductorId
      ? JSON.stringify([raw.cableUid, raw.conductorId])
      : undefined;
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value))
      return conductorIdentity(value);
  } catch {}
  return raw;
}
function semanticIdentity(key) {
  if (!key) return undefined;
  if (["wire", "jumper"].includes(key[0])) return conductorIdentity(key[1]);
  if (key[0] === "cable-conductor") return JSON.stringify(key.slice(1));
}
export function physicalOracleGeometry(g, ir) {
  const loops = electricalLoopRoutes(g, ir);
  const byElement = new Map(loops.map((s) => [s.element, s]));
  const shapes = g.shapes.map((s) => {
    const route = byElement.get(s.element) ?? s;
    if (!route.conductor) return s;
    const declared = conductorIdentity(route.wire ?? route.loopConductor),
      semantic = semanticIdentity(route.edgeOwnerKey);
    return {
      ...route,
      wire:
        declared ??
        semantic ??
        conductorIdentity(
          byElement.get(s.element)?.native?.uid ??
            byElement.get(s.element)?.native?.id,
        ),
      endpoints: route.endpoints ?? route.terminalEnds,
      identityConflict: !!(declared && semantic && declared !== semantic),
    };
  });
  const texts = g.texts.map((t) => {
    const declared = conductorIdentity(t.wire),
      semantic =
        t.labelOwnerKind === "edge"
          ? semanticIdentity(t.labelOwnerKey)
          : undefined;
    return {
      ...t,
      wire: declared ?? semantic,
      identityConflict: !!(declared && semantic && declared !== semantic),
    };
  });
  return { ...g, shapes, texts };
}
