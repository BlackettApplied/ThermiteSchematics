import { assemblySelection, portsOf, portId } from "./assembly-note-source.mjs";
import { assemblyAppearances } from "./assembly-appearances.mjs";
import { connectorPortFact } from "./m3-connector-facts.mjs";
import { viewBindings, inView } from "./tranche4-views.mjs";
function sourceScope(sheet, g, ir, request, scope) {
  const authored = scope?.request ?? request;
  const views = authored?.views ?? [],
    keys = viewBindings(authored, ir);
  const matches = views.flatMap((v, i) =>
    v.format === "connector-assembly-view-request/0.1" && inView(g, keys[i])
      ? [{ view: v, key: keys[i] }]
      : [],
  );
  let owner = matches.length === 1 ? matches[0] : undefined;
  if (
    !owner &&
    matches.length === 0 &&
    request?.views?.length === 1 &&
    request.views[0].format === "connector-assembly-view-request/0.1"
  ) {
    const index =
      request.m3AuthoredViewIndex ?? views.indexOf(request.views[0]);
    owner = { view: request.views[0], key: keys[index] };
  }
  if (!owner)
    throw Error("Native connector-assembly selection is not uniquely scoped");
  const packet = scope?.packet ?? { sheets: [sheet] },
    geometries = scope?.geometries ?? [g];
  const issued = packet.sheets.map((s, i) => ({
    sheet: s,
    g: geometries[i] ?? {},
  }));
  const parts = issued.filter(
    (p) =>
      p.sheet.view?.kind === "connector-assembly" && inView(p.g, owner.key),
  );
  return {
    ...owner,
    packet,
    geometries,
    parts: parts.length ? parts : [{ sheet, g }],
    gap: !inView(g, owner.key),
  };
}
function relationNeeds(sheet, ir, selection, source) {
  const drawn = assemblyAppearances(
    { sheets: source.parts.map((p) => p.sheet) },
    source.parts.map((p) => p.g),
    ir,
  );
  const anchor = source.parts[0].sheet.number;
  const own = selection.links.filter(
    (r) =>
      drawn.links.get(r.uid)?.some((p) => p.sheet === sheet.number) ||
      (!drawn.links.has(r.uid) && sheet.number === anchor),
  );
  return own.length
    ? [
        {
          need: "assembly-pin-map",
          noteId: "assembly-reasons",
          facts: own.map((r) => ({
            kind: "assembly-pin-map",
            relationUid: r.uid,
          })),
        },
      ]
    : [];
}
function statusNeeds(sheet, g, ir, selection, source) {
  const drawn = assemblyAppearances(source.packet, source.geometries, ir),
    needs = [];
  for (const uid of selection.included) {
    const hasBody = (p) => p.g.devices?.some((d) => d.deviceUid === uid);
    if (
      !(g.devices ?? []).some((d) => d.deviceUid === uid) &&
      (source.parts.some(hasBody) ||
        sheet.number !== source.parts[0].sheet.number)
    )
      continue;
    for (const key of Object.keys(portsOf(ir, uid) ?? {})) {
      if (drawn.ports.has(portId(uid, key))) continue;
      const owner = ir.devices.find((d) => d.uid === uid)?.designation;
      needs.push({
        need: "connector-port-status",
        noteId: `connector-port-status/${portId(uid, key)}`,
        facts: [connectorPortFact(uid, key)],
        subject: `${owner}.${key}`,
      });
    }
  }
  return needs;
}
export function assemblyNativeNeeds(sheet, g, ir, request, scope) {
  try {
    const source = sourceScope(sheet, g, ir, request, scope),
      selection = assemblySelection(source.view, ir);
    return [
      ...relationNeeds(sheet, ir, selection, source),
      ...statusNeeds(sheet, g, ir, selection, source),
    ].map((n) => ({
      ...n,
      ...(source.gap
        ? { sourceGap: "Native assembly view locator is unavailable" }
        : {}),
    }));
  } catch (error) {
    return [
      {
        need: "assembly-pin-map",
        noteId: "assembly-reasons",
        facts: [],
        sourceGap: error.message,
      },
    ];
  }
}
