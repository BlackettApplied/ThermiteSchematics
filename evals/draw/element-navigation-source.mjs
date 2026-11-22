import { fullFunctionAppearances } from "./repeat-appearances.mjs";
import { finding, painted } from "./review-geometry.mjs";
import { nativeContactRole } from "./contact-role-oracle.mjs";
import { rootedElementGaps } from "./element-navigation-rooted.mjs";
const same = (a, b) =>
  a.deviceUid === b.deviceUid && a.functionKey === b.functionKey;
export function elementPopulation(packet, geometries, ir, request) {
  const failures = [];
  const fail = (kind, extra = {}) =>
    failures.push({
      ...finding(kind, {}, extra),
      sheet: packet?.sheets?.[0]?.number,
    });
  if (
    !Array.isArray(ir?.functions) ||
    !Array.isArray(ir?.devices) ||
    !Array.isArray(ir?.internalRelations) ||
    !Array.isArray(request?.views) ||
    !Array.isArray(packet?.sheets) ||
    geometries.length !== packet.sheets.length ||
    geometries.some(
      (g) =>
        !g ||
        !Array.isArray(g.shapes) ||
        !Array.isArray(g.terminals) ||
        !Array.isArray(g.texts),
    )
  ) {
    fail("element-navigation-source-or-geometry-unavailable");
    return { appearances: [], failures };
  }
  const appearances = fullFunctionAppearances(packet, geometries, ir, request);
  selectedGaps(request, ir, appearances, fail);
  bodyGaps(packet, geometries, ir, failures);
  const rooted = rootedElementGaps(
    packet,
    geometries,
    ir,
    request,
    appearances,
  );
  failures.push(...rooted.failures);
  return { appearances, failures, findings: rooted.findings };
}
function selectedGaps(request, ir, appearances, fail) {
  for (const [view, v] of request.views.entries())
    for (const selected of (v.groups ?? []).flatMap((g) => g.functions ?? [])) {
      const ds = ir.devices.filter((d) =>
        selected.device?.by === "uid"
          ? d.uid === selected.device.value
          : d.designation === selected.device?.value,
      );
      const fn =
        ds.length === 1 &&
        ir.functions.find(
          (f) =>
            f.id.deviceUid === ds[0].uid && f.id.functionKey === selected.key,
        );
      if (
        !fn ||
        (fn.terminals?.length &&
          !appearances.some(
            (a) =>
              a.uid === fn.id.deviceUid &&
              a.functionKey === fn.id.functionKey &&
              a.view === view,
          ))
      )
        fail("element-navigation-selected-appearance-unavailable", {
          view,
          selected,
        });
    }
}
function bodyGaps(packet, geometries, ir, failures) {
  // A complete native terminal population with a missing/clipped body is a
  // measurement gap, not evidence that an authored function was never drawn.
  // A circuit may deliberately carry complete terminal context without a full
  // function. Its authored function selections are checked by selectedGaps.
  // Rooted power/control views select full protection functions; interface-only
  // wiring/communication views never enter this population.
  for (const [i, g] of geometries.entries())
    for (const fn of ir.functions.filter(
      (f) =>
        packet.sheets[i].view?.family &&
        f.terminals?.length &&
        detachedDevice(ir, f.id.deviceUid),
    )) {
      const ports = g.terminals.filter(
        (t) =>
          painted(t) &&
          t.deviceUid === fn.id.deviceUid &&
          fn.terminals.some((n) => n.terminalKey === t.terminal),
      );
      const scopes = [
        ...new Set(
          ports
            .map((t) => t.nativeFunctionScope ?? t.functionScope)
            .filter(Boolean),
        ),
      ];
      for (const scope of scopes)
        if (
          fn.terminals.every((n) =>
            ports.some(
              (t) =>
                (t.nativeFunctionScope ?? t.functionScope) === scope &&
                t.terminal === n.terminalKey,
            ),
          ) &&
          !g.shapes.some(
            (s) =>
              (s.nativeFunctionScope ?? s.functionScope) === scope &&
              s.deviceUid === fn.id.deviceUid &&
              !s.terminal &&
              (s.symbol ||
                s.glyphBody ||
                s.circuitFunctions?.length ||
                s.functionKey) &&
              (s.inkSegments?.length ||
                s.stroke > 0 ||
                !["none", "white", "rgb(255, 255, 255)"].includes(
                  s.fill ?? "none",
                )) &&
              s.nativeBodyPainted !== false,
          )
        )
          failures.push({
            ...finding("element-navigation-body-unavailable", ports[0], {
              source: fn.id,
            }),
            sheet: packet.sheets[i].number,
          });
    }
}
function detachedDevice(ir, uid) {
  const roles = ir.functions
    .filter((f) => f.id.deviceUid === uid)
    .map((f) => nativeContactRole(ir, f).role);
  return (
    roles.includes("contact") &&
    roles.some((r) => ["overload", "breaker", "fuse"].includes(r))
  );
}
export function existingActuationPair(a, b, ir) {
  const relations = ir.internalRelations.filter(
    (r) =>
      r.verb === "actuates" &&
      r.deviceUid === a.uid &&
      ir.functions.some((f) => f.kind === "coil" && same(f.id, r.from)) &&
      ir.functions.some((f) => f.kind === "contact" && same(f.id, r.to)),
  );
  const act = (key) =>
    relations
      .filter((r) => r.to.functionKey === key)
      .map((r) => r.from.functionKey);
  return (
    relations.some(
      (r) =>
        (same(r.from, { deviceUid: a.uid, functionKey: a.functionKey }) &&
          same(r.to, { deviceUid: b.uid, functionKey: b.functionKey })) ||
        (same(r.to, { deviceUid: a.uid, functionKey: a.functionKey }) &&
          same(r.from, { deviceUid: b.uid, functionKey: b.functionKey })),
    ) || act(a.functionKey).some((key) => act(b.functionKey).includes(key))
  );
}
