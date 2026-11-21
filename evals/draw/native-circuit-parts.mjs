import { sameEnds, terminalId } from "./tranche4-source.mjs";
import { physicalOracleGeometry } from "./tranche3-identities.mjs";
import { finding } from "./review-geometry.mjs";
import { inView, viewBindings } from "./tranche4-views.mjs";
export function selectedCircuit(group, ir, catalog) {
  const wires = (group.conductors ?? []).map((key) => {
    const ws = [...catalog.values()].filter(
      (w) => w.names.includes(key) || w.key === key,
    );
    return ws.length === 1 && ws[0].physical !== false ? ws[0] : null;
  });
  const functions = (group.functions ?? []).map((r) => {
    const ds = ir.devices.filter((d) =>
      r.device?.by === "uid"
        ? d.uid === r.device.value
        : d.designation === r.device?.value,
    );
    return ds.length === 1
      ? ir.functions.find(
          (f) => f.id.deviceUid === ds[0].uid && f.id.functionKey === r.key,
        )
      : null;
  });
  return { wires, functions };
}
function circuitInk(routes, terminals, g, x, part, sheet) {
  const { selected, ir, findings, routeParts } = x;
  for (const r of routes) {
    const w = selected.wires.find((w) => w.key === r.wire);
    if (
      !w ||
      r.identityConflict ||
      !sameEnds(r.endpoints, w.ends) ||
      !g.tranche3?.routeInk?.[r.element]?.length
    )
      findings.push({
        ...finding("native-part-conductor-disagrees", r, { conductor: r.wire }),
        sheet,
      });
    if (!routeParts.has(r.wire)) routeParts.set(r.wire, new Set());
    routeParts.get(r.wire).add(JSON.stringify([sheet, part]));
  }
  for (const t of terminals)
    if (
      !ir.terminals?.some(
        (n) =>
          terminalId(n.id) ===
          terminalId({ deviceUid: t.deviceUid, terminalKey: t.terminal }),
      )
    )
      findings.push({
        ...finding("native-part-terminal-owner-unavailable", t),
        sheet,
      });
}
function circuitSheet(sheet, input, x) {
  const { view, key, group, findings } = x,
    g = physicalOracleGeometry(input, x.ir);
  if (!inView(g, key)) return [];
  const blocks = (g.tranche4?.circuitParts ?? []).filter((p) =>
    p.groups.includes(group.id),
  );
  const routes = g.shapes.filter(
    (s) =>
      s.conductor && s.circuitGroup === group.id && s.navigationView === key,
  );
  const terminals = g.terminals.filter(
    (t) => t.circuitGroup === group.id && t.painted !== false,
  );
  if (!routes.length && !terminals.length && !blocks.length) return [];
  const own = blocks.length
    ? blocks
    : [
        {
          part: 1,
          total: 1,
          terminals,
          routeElements: routes.map((s) => s.element),
        },
      ];
  return own.map((block) => {
    if (
      !Array.isArray(block.terminals) ||
      !Array.isArray(block.routeElements)
    ) {
      findings.push({
        ...finding("native-part-geometry-unavailable", block),
        sheet: sheet.number,
      });
      block = { ...block, terminals: [], routeElements: [] };
    }
    const { part, total } = block;
    if (
      !Number.isInteger(part) ||
      !Number.isInteger(total) ||
      part < 1 ||
      part > total
    )
      findings.push({
        ...finding("native-part-identity-unavailable", block),
        sheet: sheet.number,
      });
    const ink = routes.filter((r) => block.routeElements?.includes(r.element));
    circuitInk(ink, block.terminals, g, x, part, sheet.number);
    return {
      kind: "circuit",
      view,
      group: group.id,
      part,
      total,
      sheet: sheet.number,
      terminals: block.terminals,
      geometry: g,
    };
  });
}
function circuitConservation(parts, x, anchor) {
  const { selected, routeParts, findings, view, group } = x;
  for (const w of selected.wires)
    if (routeParts.get(w.key)?.size !== 1)
      findings.push({
        ...finding(
          "native-part-whole-conductor-not-once",
          {},
          {
            conductor: w.key,
            appearances: routeParts.get(w.key)?.size ?? 0,
            view,
            group: group.id,
          },
        ),
        sheet: parts[0]?.sheet ?? anchor,
      });
  for (const f of selected.functions)
    for (const t of f.terminals)
      if (
        !parts.some((p) =>
          p.terminals.some(
            (a) => a.deviceUid === t.deviceUid && a.terminal === t.terminalKey,
          ),
        )
      )
        findings.push({
          ...finding(
            "native-part-selected-terminal-missing",
            {},
            { terminal: t, view, group: group.id },
          ),
          sheet: anchor,
        });
}
export function circuitParts(
  packet,
  geometries,
  request,
  ir,
  catalog,
  findings,
) {
  const result = [],
    keys = viewBindings(request, ir);
  for (const [view, v] of request.views.entries()) {
    if (v.format !== "circuit-view-request/0.1") continue;
    for (const group of v.groups ?? []) {
      const selected = selectedCircuit(group, ir, catalog);
      if (
        selected.wires.some((w) => !w) ||
        selected.functions.some((f) => !f)
      ) {
        findings.push({
          ...finding("native-part-selection-unavailable"),
          sheet: packet.sheets[0].number,
        });
        continue;
      }
      const x = {
        view,
        key: keys[view],
        group,
        ir,
        selected,
        findings,
        routeParts: new Map(),
      };
      const parts = packet.sheets
        .flatMap((s, i) => circuitSheet(s, geometries[i], x))
        .filter(Boolean);
      circuitConservation(parts, x, packet.sheets[0].number);
      result.push(...parts);
    }
  }
  return result;
}
