import { assemblyAppearances } from "./assembly-appearances.mjs";
import {
  assemblyNotes,
  portNoteNeeds,
  assemblyDeliveryFindings,
  reasonNeed,
  needKey,
} from "./assembly-note-delivery.mjs";
import { measuredRows } from "./tranche4-data.mjs";
import { nativePortInk } from "./native-port-ink.mjs";
import {
  assemblySelection,
  assemblyPortNeeds,
  portsOf,
} from "./assembly-note-source.mjs";
import { nativeRows } from "./m3-native.mjs";
import { issuedRows } from "./m3-documents.mjs";
import { finding, painted } from "./review-geometry.mjs";
import { inView, viewBindings } from "./tranche4-views.mjs";
function notesForSheet(s, g, selection, ir, catalog, rows, drawn) {
  const omitted = assemblyPortNeeds(g, selection, ir, catalog, drawn),
    findings = [];
  const own = (g.tranche4?.assemblies ?? [])
    .map((a) => selection.links.find((r) => r.uid === a.uid))
    .filter(Boolean);
  const notes = assemblyNotes(g, omitted),
    used = new Set();
  const ownNeeds = own.map((r) =>
    reasonNeed(catalog.find((n) => n.kind === "assemblies" && n.key === r.uid)),
  );
  const named = new Set(
    notes.flatMap((n) => portNoteNeeds(n, omitted).map(needKey)),
  );
  for (const note of notes) {
    const portNeed = portNoteNeeds(note, omitted),
      portNote =
        /\bother ports\b/iu.test(note.text) ||
        (!/\bother parts\b/iu.test(note.text) && portNeed.length > 0);
    const fallback = /\bother parts\b/iu.test(note.text)
      ? omitted.filter((n) => !named.has(needKey(n)) || portNeed.includes(n))
      : [];
    const needs = portNote
      ? portNeed
      : [
          ...new Map(
            [...ownNeeds, ...fallback].map((n) => [needKey(n), n]),
          ).values(),
        ];
    const count = note.text.match(/\b(\d+)\s+other ports\b/iu)?.[1];
    const nativeCount = new Set(
      omitted.filter((n) => n.uid === note.deviceUid).map((n) => n.key),
    ).size;
    if (!needs.length && portNote)
      findings.push({
        ...finding("assembly-note-without-native-need", note),
        sheet: s.number,
      });
    if (count !== undefined && Number(count) !== nativeCount)
      findings.push({
        ...finding("assembly-note-omitted-port-count-disagrees", note, {
          actual: Number(count),
          expected: nativeCount,
        }),
        sheet: s.number,
      });
    for (const need of needs) used.add(needKey(need));
    findings.push(...assemblyDeliveryFindings(note, needs, rows, s.number));
  }
  const required = [...omitted, ...ownNeeds];
  for (const need of required)
    if (!used.has(needKey(need)))
      findings.push({
        ...finding(
          "assembly-native-need-without-note",
          {},
          {
            nativeRow: need.row?.key ?? null,
            nativePort: need.kind === "drawn-port" ? need.identity : undefined,
          },
        ),
        sheet: s.number,
      });
  return { findings, eligible: notes.length + required.length };
}
function nativeInkFindings(s, g, selection, ir, seen) {
  const findings = [];
  if (!g.tranche4)
    return [
      { ...finding("assembly-measurement-unavailable"), sheet: s.number },
    ];
  for (const p of g.tranche4.ports.filter((p) => p.kind === "assembly"))
    if (
      !portsOf(ir, p.deviceUid)?.[p.key] ||
      !p.point ||
      !p.texts.some((t) => painted(t) && t.text.trim() === p.key)
    )
      findings.push({
        ...finding("assembly-port-native-geometry-disagrees", p),
        sheet: s.number,
      });
  for (const a of g.tranche4.assemblies) {
    const r = selection.links.find((r) => r.uid === a.uid),
      ends = r && [
        { deviceUid: r.fromDeviceUid, portKey: r.assembly.fromPort },
        { deviceUid: r.toDeviceUid, portKey: r.assembly.toPort },
      ];
    if (
      !r ||
      JSON.stringify(a.ends) !== JSON.stringify(ends) ||
      !nativePortInk(a, g.tranche4.ports, "assembly")
    )
      findings.push({
        ...finding("assembly-native-link-geometry-disagrees", a),
        sheet: s.number,
      });
    seen.set(a.uid, (seen.get(a.uid) ?? 0) + 1);
  }
  return findings;
}
function conservedSelection(selection, issued, seen, sheet, view) {
  const findings = [];
  for (const uid of selection.included)
    if (!issued.has(uid))
      findings.push({
        ...finding(
          "assembly-selected-device-not-issued",
          {},
          { deviceUid: uid, view },
        ),
        sheet,
      });
  for (const r of selection.links)
    if (seen.get(r.uid) !== 1)
      findings.push({
        ...finding(
          "assembly-selected-link-not-once",
          {},
          {
            relation: r.uid,
            appearances: seen.get(r.uid) ?? 0,
          },
        ),
        sheet,
      });
  return findings;
}
export function assemblyNoteAudit(packet, geometries, ir, request) {
  if (!measuredRows(geometries))
    return {
      eligible: 1,
      findings: [
        {
          ...finding("assembly-measurement-unavailable"),
          sheet: packet.sheets[0]?.number,
        },
      ],
    };
  const findings = [],
    catalog = nativeRows(ir),
    rows = issuedRows(packet, geometries);
  let eligible = 0;
  if (!Array.isArray(request?.views) || !Array.isArray(ir?.relations))
    return {
      eligible: 1,
      findings: [
        {
          ...finding("assembly-source-unavailable"),
          sheet: packet.sheets[0]?.number,
        },
      ],
    };
  const keys = viewBindings(request, ir),
    drawn = assemblyAppearances(packet, geometries, ir);
  for (const [view, v] of request.views.entries()) {
    if (v.format !== "connector-assembly-view-request/0.1") continue;
    let selection;
    try {
      selection = assemblySelection(v, ir);
    } catch (e) {
      findings.push({
        ...finding(
          "assembly-source-selection-unavailable",
          {},
          { reason: e.message },
        ),
        sheet: packet.sheets[0]?.number,
      });
      continue;
    }
    const seen = new Map(),
      issued = new Set();
    eligible++;
    for (const [i, s] of packet.sheets.entries()) {
      const g = geometries[i];
      if (s.view.kind !== "connector-assembly" || !inView(g, keys[view]))
        continue;
      for (const d of g.devices ?? []) issued.add(d.deviceUid);
      const a = notesForSheet(s, g, selection, ir, catalog, rows, drawn);
      eligible += a.eligible;
      findings.push(
        ...nativeInkFindings(s, g, selection, ir, seen),
        ...a.findings,
      );
    }
    findings.push(
      ...conservedSelection(
        selection,
        issued,
        seen,
        packet.sheets[0]?.number,
        view,
      ),
    );
  }
  return { findings, eligible };
}
