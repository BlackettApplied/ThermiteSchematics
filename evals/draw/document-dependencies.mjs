import { nativeRelationReference } from "./relation-reference.mjs";
import { m3Delivery } from "./m3-delivery.mjs";
import { zoneAt } from "./checks.mjs";
import { createHash } from "node:crypto";
import { finding, painted, groupBy } from "./review-geometry.mjs";
import { authoredCircuitShapes } from "./issued-circuit-coverage.mjs";
import { matchesNativeEmptyState } from "./native-empty-state.mjs";
const compact = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/\s/gu, "");
const tid = (t) =>
  t ? JSON.stringify([t.deviceUid, t.terminalKey]) : "unterminated";
const device = (ir, uid) => ir.devices?.find((d) => d.uid === uid);
const endpoint = (ir, t) =>
  t
    ? `${device(ir, t.deviceUid)?.designation}.${t.terminalKey}`
    : "Unterminated";
function physical(ir) {
  return [...(ir.wires ?? []), ...(ir.jumpers ?? [])]
    .map((w) => ({
      key: w.uid,
      kind: "wires",
      exactColumns: [1, 2],
      endpoints: w.endpoints.map((e) => e.terminal),
      name: w.designation ?? "Jumper",
    }))
    .concat(
      (ir.cableConductors ?? []).map((c) => ({
        key: JSON.stringify([c.id.cableUid, c.id.conductorId]),
        kind: "wires",
        exactColumns: [1, 2],
        endpoints: (
          ir.cables
            ?.find((b) => b.uid === c.id.cableUid)
            ?.assignments?.find((a) => a.id === c.id.conductorId)?.endpoints ??
          c.endpoints
        ).map((e) => e?.terminal),
        name: `${ir.cables?.find((b) => b.uid === c.id.cableUid)?.designation}/${c.id.conductorId}`,
      })),
    );
}
export function visibleDocumentRows(packet, geometries) {
  return packet.sheets.flatMap((sheet, i) => {
    const g = geometries[i];
    return [
      ...groupBy(
        (g?.texts ?? []).filter((t) => t.row && painted(t)),
        (t) => t.row,
      ),
    ].map(([key, texts]) => ({
      kind: sheet.view.kind,
      key,
      sheet: sheet.number,
      cells: Object.fromEntries(
        [...groupBy(texts, (t) => t.columnIndex)].map(([column, ts]) => [
          column,
          ts
            .sort(
              (a, b) =>
                (a.anchor?.y ?? a.bbox.y) - (b.anchor?.y ?? b.bbox.y) ||
                a.bbox.x - b.bbox.x,
            )
            .map((t) => t.text)
            .join(" "),
        ]),
      ),
      texts,
    }));
  });
}
function terminalFact(ir, t) {
  const id = t.id,
    incidences = physical(ir).filter((w) =>
      w.endpoints.some((e) => tid(e) === tid(id)),
    );
  return {
    kind: "terminals",
    key: tid(id),
    required: {
      0: [device(ir, id.deviceUid)?.designation],
      2: [id.terminalKey],
      6: [incidences.length ? "Terminated" : "Unconnected"],
    },
    exactColumns: [0, 2, 6],
    connections: incidences.map((w) => ({
      name: w.name,
      peers: w.endpoints
        .filter((e) => tid(e) !== tid(id))
        .map((e) => endpoint(ir, e)),
    })),
  };
}
function portFacts(ir, uids) {
  const links = (ir.relations ?? []).filter(
    (r) =>
      r.connection && (uids.has(r.fromDeviceUid) || uids.has(r.toDeviceUid)),
  );
  const result = links.map((r) => ({
    kind: "network",
    key: r.uid,
    exactColumns: [0, 4],
    ports: [
      {
        column: 2,
        designation: device(ir, r.fromDeviceUid)?.designation,
        key: r.connection.fromPort,
      },
      {
        column: 3,
        designation: device(ir, r.toDeviceUid)?.designation,
        key: r.connection.toPort,
      },
    ],
    required: {
      0: [nativeRelationReference(ir, r).text],
      1: [r.connection.protocol].filter(Boolean),

      4: [r.connection.status ?? "Unspecified"],
    },
  }));
  for (const d of (ir.devices ?? []).filter((d) => uids.has(d.uid))) {
    const ports = ir.deviceTypes?.find((t) => t.id === d.typeId)?.ports ?? {};
    for (const [key, p] of Object.entries(ports)) {
      if (p.kind && !/communication/.test(p.kind)) continue;
      if (
        (ir.relations ?? []).some(
          (r) =>
            r.connection &&
            ((r.fromDeviceUid === d.uid && r.connection.fromPort === key) ||
              (r.toDeviceUid === d.uid && r.connection.toPort === key)),
        )
      )
        continue;
      result.push({
        kind: "network",
        key: JSON.stringify([d.uid, key]),
        exactColumns: [3],
        ports: [{ column: 2, designation: d.designation, key }],
        required: { 3: ["Unconnected"] },
      });
    }
  }
  return result;
}
function coreFacts(ir, uids) {
  const facts = [];
  for (const cable of ir.cables ?? []) {
    const physicalCores = (ir.cableConductors ?? []).filter(
      (c) => c.id.cableUid === cable.uid,
    );
    const selected =
      (cable.assignments ?? []).some((a) =>
        a.endpoints?.some((e) => e?.terminal && uids.has(e.terminal.deviceUid)),
      ) ||
      physicalCores.some((c) =>
        c.endpoints.some((e) => uids.has(e.terminal.deviceUid)),
      );
    if (!selected) continue;
    const definitions =
      ir.cableTypes?.find((t) => t.id === cable.typeId)?.conductors ??
      physicalCores.map((c) => ({ id: c.id.conductorId }));
    for (const def of definitions) {
      const assignment = cable.assignments?.find((a) => a.id === def.id),
        connected = physicalCores.find((c) => c.id.conductorId === def.id),
        ends = assignment?.endpoints ?? connected?.endpoints;
      const count = ends?.filter((e) => e?.terminal).length ?? 0,
        usage = assignment?.usage ?? (ends ? "unspecified" : "unassigned"),
        status = !ends
          ? "unassigned"
          : count === 2
            ? "connected"
            : count === 1
              ? "partially-terminated"
              : "unterminated";
      facts.push({
        kind: "wires",
        key: JSON.stringify([cable.uid, def.id]),
        exactColumns: [0, 1, 2, 4],
        required: {
          0: [`${cable.designation}/${def.id}`],
          1: [endpoint(ir, ends?.[0]?.terminal)],
          2: [endpoint(ir, ends?.[1]?.terminal)],
          4: [`${usage}; ${status}`],
        },
      });
    }
  }
  return facts;
}
export function logicalPointerNotes(texts) {
  const result = [];
  for (const t of texts.filter((t) => painted(t) && !t.row)) {
    const last = result.at(-1),
      a = last?.anchor ?? last?.bbox,
      b = t.anchor ?? t.bbox;
    const pitch =
      Math.max(t.fontSize ?? t.bbox.h, last?.fontSize ?? last?.bbox.h ?? 0) *
      1.7;
    if (
      last &&
      last.deviceUid === t.deviceUid &&
      last.appearanceScope === t.appearanceScope &&
      last.textContainer === t.textContainer &&
      last.role === t.role &&
      Math.abs((last.fontSize ?? 0) - (t.fontSize ?? 0)) < 0.03 &&
      !/[.!?]\s*$/u.test(last.text) &&
      b.y > a.y + 0.17 &&
      b.y - a.y <= pitch &&
      Math.abs(b.x - a.x) <= 0.17
    ) {
      const right = Math.max(last.bbox.x + last.bbox.w, t.bbox.x + t.bbox.w),
        bottom = Math.max(last.bbox.y + last.bbox.h, t.bbox.y + t.bbox.h);
      last.text = last.text.trimEnd() + " " + t.text.trimStart();
      last.bbox = {
        ...last.bbox,
        w: right - last.bbox.x,
        h: bottom - last.bbox.y,
      };
      last.anchor = t.anchor; // Next row continues from the last measured baseline.
    } else result.push({ ...t, bbox: { ...t.bbox } });
  }
  return result;
}
export function pointerDependencies(sheet, g, ir) {
  const notes = logicalPointerNotes(g.texts ?? []),
    result = [];
  const uids = new Set(
    [
      ...(g.devices ?? []).map((d) => d.deviceUid),
      ...(g.terminals ?? []).map((t) => t.deviceUid),
    ].filter(Boolean),
  );
  const add = (need, note, facts, extra = {}) =>
    result.push({
      id: JSON.stringify([sheet.number, need, note.element]),
      need,
      note,
      facts,
      ...extra,
    });
  const first = (pattern) => notes.find((t) => pattern.test(t.text));
  const wire = first(/see wire schedule/i);
  if (wire) {
    const terminals = new Set(
      (g.terminals ?? []).map((t) =>
        tid({ deviceUid: t.deviceUid, terminalKey: t.terminal }),
      ),
    );
    const selected = new Set(
      g.shapes
        .filter((s) => s.conductor || s.loopConductor)
        .map((s) => s.wire ?? s.loopConductor),
    );
    const hidden = physical(ir).filter(
      (w) =>
        w.endpoints.some((e) => terminals.has(tid(e))) && !selected.has(w.key),
    );
    if (hidden.length)
      add(
        "conductor-incidence",
        wire,
        hidden.map((w) => ({
          ...w,
          required: {
            0: [w.name],
            1: [endpoint(ir, w.endpoints[0])],
            2: [endpoint(ir, w.endpoints[1])],
          },
          connections: [],
        })),
      );
  }
  for (const note of notes.filter((t) =>
    /\d+ other terminals:?\s*schedule/i.test(t.text),
  )) {
    const drawn = new Set(
      (g.terminals ?? [])
        .filter((t) => t.deviceUid === note.deviceUid)
        .map((t) => t.terminal),
    );
    const omitted = (ir.terminals ?? []).filter(
      (t) => t.id.deviceUid === note.deviceUid && !drawn.has(t.id.terminalKey),
    );
    add(
      "terminal-inventory",
      note,
      omitted.map((t) => terminalFact(ir, t)),
      { unresolved: !note.deviceUid || !omitted.length },
    );
  }
  const network = first(/see (?:communication|link) schedule/i);
  if (network) add("port-link-status", network, portFacts(ir, uids));
  const cores = first(/core details remain in the conductor view/i);
  if (cores) {
    // This sentence promises core/pin-map detail, not unrelated wire facts on
    // other functions of the visible device. Its native scope is the cable
    // core inventory or relation-based assembly inventory only.
    const facts = coreFacts(ir, uids);
    for (const r of (ir.relations ?? []).filter(
      (r) =>
        r.assembly && (uids.has(r.fromDeviceUid) || uids.has(r.toDeviceUid)),
    ))
      facts.push({
        kind: "assemblies",
        key: r.uid,
        exactColumns: [0, 4],
        ports: [
          {
            column: 2,
            designation: device(ir, r.fromDeviceUid)?.designation,
            key: r.assembly.fromPort,
          },
          {
            column: 3,
            designation: device(ir, r.toDeviceUid)?.designation,
            key: r.assembly.toPort,
          },
        ],
        required: {
          0: [nativeRelationReference(ir, r).text],
          4: [
            `${r.assembly.status ?? "Unspecified"}\nPin mapping: ${r.assembly.pinMapping?.status}\n${r.assembly.pinMapping?.reason}`,
          ],
        },
      });
    add("core-inventory", cores, facts, { unresolved: !facts.length });
  }
  const coverage = first(/see circuit views or packet coverage/i);
  if (coverage) add("coverage", coverage, [], { uids: [...uids] });
  return result;
}
function containsFact(value, source) {
  if (source === undefined) return false;
  const escape = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escaped = Array.from(compact(source)).map(escape).join("\\s*");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_.-])${escaped}(?:$|[^\\p{L}\\p{N}_.-])`,
    "u",
  ).test(String(value ?? "").normalize("NFC"));
}
export function sufficient(row, fact) {
  if (fact.sourceGap) return false;
  if (row.kind !== fact.kind || row.key !== fact.key) return false;
  for (const [column, values] of Object.entries(fact.required)) {
    const value = compact(row.cells[column]);
    if (
      !values.every((s) =>
        s?.nativeEmptyState
          ? matchesNativeEmptyState(row.cells[column], s)
          : fact.exactColumns?.includes(Number(column))
            ? value === compact(s)
            : containsFact(row.cells[column], s),
      )
    )
      return false;
  }
  if (
    !(fact.ports ?? []).every((p) =>
      [".", ":"].some((separator) =>
        containsFact(
          row.cells[p.column],
          `${p.designation}${separator}${p.key}`,
        ),
      ),
    )
  )
    return false;
  const connections = [row.cells[4], row.cells[5]].join(" ");
  return (fact.connections ?? []).every(
    (c) =>
      containsFact(connections, c.name) &&
      c.peers.every((p) => containsFact(connections, p)),
  );
}
export function legacyDependencyFindings(
  sheet,
  packet,
  g,
  geometries,
  ir,
  request,
) {
  const dependencies = pointerDependencies(sheet, g, ir),
    issued = visibleDocumentRows(packet, geometries),
    findings = [],
    targetFindings = [];
  // A (printed promises) is source-reconstructed even without B (new inventory).
  // C contains only rows with actual painted cells, never JSON/table kind alone.
  const inventory =
    packet.navigation?.dependencies ?? packet.documentDependencies;
  const digest = createHash("sha256").update(JSON.stringify(ir)).digest("hex");
  for (const dep of dependencies) {
    if (inventory) {
      const records = inventory.filter(
        (d) =>
          d.id === dep.id ||
          (d.owner?.noteId === dep.note.element && d.need === dep.need),
      );
      const facts = dep.facts.map((f) => f.key).sort();
      if (
        records.length !== 1 ||
        records[0].snapshotDigest !== digest ||
        JSON.stringify(records[0].requiredFacts?.slice().sort()) !==
          JSON.stringify(facts)
      )
        findings.push(
          finding("document-dependency-inventory-mismatch", dep.note, {
            dependency: dep.id,
            need: dep.need,
            expectedFacts: facts,
          }),
        );
    }
    if (dep.need === "coverage") {
      const circuit = packet.sheets.flatMap((s, i) =>
        authoredCircuitShapes(s, geometries[i], ir, request),
      );
      const requiredFunctions = (ir.functions ?? []).filter((f) =>
        dep.uids.includes(f.id.deviceUid),
      );
      const missingFunctions = requiredFunctions.filter(
        (f) =>
          !circuit.some(
            (s) =>
              s.deviceUid === f.id.deviceUid &&
              s.functionKey === f.id.functionKey,
          ),
      );
      const missing = [...new Set(missingFunctions.map((f) => f.id.deviceUid))];
      if (missing.length || !dep.uids.length || !circuit.length)
        findings.push(
          finding("printed-document-target-insufficient", dep.note, {
            need: dep.need,
            missingDeviceUids: missing,
            missingFunctions: missingFunctions.map((f) => f.id),
            reason: "no-sufficient-issued-circuit-view",
          }),
        );
      continue;
    }
    const matching = dep.facts.map((f) =>
      issued.filter((row) => sufficient(row, f)),
    );
    const missing = dep.facts.filter((f, i) => !matching[i].length);
    if (!missing.length && dep.facts.length) {
      const locations = [
        ...new Set(
          matching.map((rows) => {
            const row = rows[0],
              t = row.texts[0],
              target =
                geometries[
                  packet.sheets.findIndex((s) => s.number === row.sheet)
                ];
            const zone = zoneAt(target, {
              x: t.bbox.x + t.bbox.w / 2,
              y: t.bbox.y + t.bbox.h / 2,
            });
            return zone ? `${row.sheet}.${zone}` : `${row.sheet}.unmeasured`;
          }),
        ),
      ].sort();
      const printed = dep.note.text;
      const unresolved = locations.filter(
        (loc) =>
          !new RegExp(
            `(?:^|[^0-9])0?${loc.replace(".", "\\.")}(?:$|[^0-9A-Z])`,
          ).test(printed),
      );
      if (unresolved.length)
        targetFindings.push(
          finding("printed-document-target-location-missing", dep.note, {
            need: dep.need,
            requiredLocations: locations,
            unresolvedLocations: unresolved,
          }),
        );
    }
    if (missing.length || dep.unresolved)
      findings.push(
        finding("printed-document-target-insufficient", dep.note, {
          need: dep.need,
          requiredRows: dep.facts.length,
          missingRows: missing.map((f) => ({
            kind: f.kind,
            key: f.key,
            required: f.required,
          })),
          reason: dep.unresolved
            ? "native-scope-unresolved"
            : "missing-or-insufficient-visible-issued-rows",
        }),
      );
  }
  for (const record of inventory ?? [])
    if (
      record.owner?.sheet === sheet.number &&
      !dependencies.some((d) => d.id === record.id)
    )
      findings.push(
        finding(
          "document-dependency-without-visible-pointer",
          {},
          { dependency: record.id, need: record.need },
        ),
      );
  return {
    findings,
    targetFindings,
    measurement: {
      printedDependencies: dependencies.length,
      requiredRows: dependencies.reduce((n, d) => n + d.facts.length, 0),
      issuedVisibleRows: issued.length,
      inventory: inventory ? "reconciled" : "legacy-native-reconstruction",
    },
  };
}

export function dependencyFindings(
  sheet,
  packet,
  g,
  geometries,
  ir,
  request,
  context,
) {
  return request || packet.navigation?.documentFormat
    ? m3Delivery(sheet, packet, g, geometries, ir, request, context)
    : legacyDependencyFindings(sheet, packet, g, geometries, ir, request);
}
