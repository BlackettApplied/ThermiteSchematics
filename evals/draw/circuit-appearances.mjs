import { routePoints } from "./checks.mjs";
// A circuit selection is a native logical placement. Whole-wire partitioning can
// repeat its complete glyph as boundary context. Reconstruct the stable source
// endpoint unit from authored conductors and physically landed native routes;
// never use navigation roles, fragment flags, seeds or planner output as truth.
export function fullCircuitAppearances(appearances, geometries, ir, request) {
  const native = [...(ir.wires ?? []), ...(ir.jumpers ?? [])]
    .map((w) => ({
      id: w.uid,
      names: [w.uid, w.designation],
      ends: w.endpoints?.map((e) => e.terminal) ?? [],
    }))
    .concat(
      (ir.cableConductors ?? []).map((c) => ({
        id: JSON.stringify(c.id),
        names: [
          JSON.stringify(c.id),
          `${c.id.cableUid}/${c.id.conductorId}`,
          `${ir.cables?.find((b) => b.uid === c.id.cableUid)?.designation}/${c.id.conductorId}`,
          `${ir.cables?.find((b) => b.uid === c.id.cableUid)?.designation}.${c.id.conductorId}`,
        ],
        ends: c.endpoints?.map((e) => e?.terminal) ?? [],
      })),
    );
  const views = request?.views ?? (request ? [request] : []);
  const key = (t) => JSON.stringify([t?.deviceUid, t?.terminalKey]);
  return appearances.filter((a) => {
    const v = views[a.view],
      group =
        v?.format === "circuit-view-request/0.1" &&
        v.groups?.find((g) => g.id === a.circuitGroup);
    if (!group) return true;
    const selections = (group.functions ?? []).filter(
      (s) =>
        s.key === a.functionKey &&
        (s.device?.by === "uid"
          ? s.device.value === a.uid
          : (ir.devices ?? []).filter((d) => d.designation === s.device?.value)
              .length === 1 &&
            ir.devices.find((d) => d.uid === a.uid)?.designation ===
              s.device?.value),
    );
    if (selections.length !== 1) return true;
    const copies = appearances.filter(
      (b) =>
        b.uid === a.uid &&
        b.functionKey === a.functionKey &&
        b.view === a.view &&
        b.circuitGroup === a.circuitGroup,
    );
    if (copies.length < 2) return true;
    const fn = ir.functions.find(
      (f) => f.id.deviceUid === a.uid && f.id.functionKey === a.functionKey,
    );
    const selected = native.filter((w) =>
      (group.conductors ?? []).some((s) => w.names.includes(s)),
    );
    if (!selected.length) return true;
    const own = (w) =>
      w.ends.flatMap((t, i) =>
        t?.deviceUid === a.uid &&
        fn.terminals.some((p) => p.terminalKey === t.terminalKey)
          ? [JSON.stringify([w.id, i, t.terminalKey])]
          : [],
      );
    const endpoints = selected.flatMap(own).sort();
    const primary =
      endpoints[0] ?? JSON.stringify([selected.map((w) => w.id).sort()[0]]);
    const units = (appearance) => {
      const g = geometries.find((_, i) => i === appearance.geometryIndex);
      return (g?.shapes ?? [])
        .filter((s) => s.conductor && s.circuitGroup === a.circuitGroup)
        .flatMap((s) => {
          const w = selected.find((w) => w.id === s.wire),
            points = routePoints(s);
          if (
            !w ||
            !points?.length ||
            s.endpoints?.length !== w.ends.length ||
            !w.ends.every((t, i) => key(t) === key(s.endpoints[i]))
          )
            return [];
          // The route must actually land on a visible native function terminal;
          // a forged source ID on an unrelated stroke cannot certify context.
          const touches = w.ends.some(
            (t) =>
              t?.deviceUid === a.uid &&
              fn.terminals.some((p) => p.terminalKey === t.terminalKey) &&
              appearance.ports.some(
                (p) =>
                  p.terminal === t.terminalKey &&
                  [points[0], points.at(-1)].some(
                    (q) => Math.hypot(p.point.x - q.x, p.point.y - q.y) <= 0.17,
                  ),
              ),
          );
          return touches
            ? endpoints.length
              ? own(w)
              : [JSON.stringify([w.id])]
            : [];
        });
    };
    const here = units(a);
    // Incomplete/forged provenance stays a full obligation and is reconciled,
    // rather than disappearing. Only a native landed sibling explains a copy.
    return (
      !here.length ||
      here.includes(primary) ||
      !copies.some((b) => b !== a && units(b).includes(primary))
    );
  });
}
