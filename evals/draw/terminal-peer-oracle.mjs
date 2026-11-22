import { measuredZone } from "./repeat-appearances.mjs";
import { pinListAppearances } from "./wire-locators.mjs";
import { cableEndBindings } from "./cable-end-identities.mjs";
import { extent, painted } from "./review-geometry.mjs";
import { elementKey } from "./tranche4-source.mjs";
import {
  conductorInk,
  continuationInk,
  paintedToBothEnds,
} from "./peer-owner-ink.mjs";

const terminalKey = (t) => t && JSON.stringify([t.deviceUid, t.terminalKey]);
const functionKey = (f) => JSON.stringify([f.deviceUid, f.functionKey]);
const loc = (s, zone) => `${String(s).padStart(2, "0")}.${zone}`;
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function observedTerminals(ir, g, cableOwners) {
  const real = new Set(ir.terminals.map((t) => terminalKey(t.id)));
  const markers = (g.tranche4?.markers ?? [])
    .filter((m) => m.painted || m.filled)
    .map((m) => ({
      key: JSON.stringify([m.deviceUid, m.terminal]),
      p: m.point,
      bbox: m.bbox,
    }));
  const wire = (g.wireTerminals ?? []).flatMap((m) => {
    const binding = m.cableUid ? cableOwners.get(m) : m.terminal;
    return binding
      ? [{ key: JSON.stringify(binding), p: m.point, bbox: m.bbox }]
      : [];
  });
  const pins = pinListAppearances(g, ir).map((p) => ({
    key: JSON.stringify(p.terminal),
    p: center(p.bbox),
    bbox: p.bbox,
  }));
  const result = new Map();
  for (const { key, p, bbox } of [...markers, ...wire, ...pins]) {
    if (!real.has(key) || !p) continue;
    const zone = measuredZone(g, p);
    if (!zone) continue;
    if (!result.has(key)) result.set(key, { zones: new Set(), boxes: [] });
    const region = result.get(key);
    region.zones.add(zone);
    region.boxes.push(bbox ?? { ...p, w: 0, h: 0 });
  }
  return result;
}

function conductorName(ir, row) {
  const id = row.element;
  if (id.kind === "cable_conductor")
    return `${ir.cables.find((c) => c.uid === id.cableUid)?.designation}.${id.conductorId}`;
  return id.kind === "jumper"
    ? (ir.jumpers.find((j) => j.uid === id.uid)?.designation ?? "Jumper")
    : row.name;
}

function conductorNote(src, dest, wire, a, b, label, name, card) {
  const marks = src.terminals.get(terminalKey(a)).boxes;
  const opposite = src.terminals.get(terminalKey(b))?.boxes;
  const ink = conductorInk(src.geometry, wire.element);
  if (paintedToBothEnds(ink, marks, opposite)) return;
  const { runs } = ink;
  const { zones } = dest.terminals.get(terminalKey(b));
  return {
    sheet: src.sheet.number,
    kind: "conductor-peer",
    source: [a, wire.element, b],
    ownerLabel: name(a),
    owners: card ? [card] : marks,
    supports: [
      ...runs.map(extent),
      ...continuationInk(src.sheet, src.geometry, wire.element, runs),
    ],
    values: [...zones].map(
      (z) => `${label} · ${name(a)} → ${name(b)} ${loc(dest.sheet.number, z)}`,
    ),
    compactValues: [...zones].map(
      (z) => `→ ${name(b)} ${loc(dest.sheet.number, z)}`,
    ),
  };
}

function cardObligations(ir, parts, wires, name) {
  const native = new Map(wires.map((r) => [elementKey(r.element), r]));
  const records = [];
  for (const p of parts)
    for (const card of p.geometry.tranche4?.cards ?? []) {
      const owner = card.terminalId;
      const returned = p.terminals.get(terminalKey(owner));
      if (!returned || !card.bbox) continue;
      const text = card.texts
        .filter((t) => painted(t) && !card.headingElements.includes(t.element))
        .map((t) => t.text)
        .join(" ")
        .replace(/\s+/gu, " ");
      for (const id of card.conductors ?? []) {
        const wire = native.get(elementKey(id));
        const mate = wire?.ends.find(
          (t) => terminalKey(t) !== terminalKey(owner),
        );
        if (
          !mate ||
          !wire.ends.some((t) => terminalKey(t) === terminalKey(owner))
        )
          continue;
        const label = conductorName(ir, wire);
        if (!text.includes(`${label} → ${name(mate)}`)) continue;
        const destination = parts.find(
          (s) => s !== p && s.terminals.has(terminalKey(mate)),
        );
        if (!destination) continue;
        const origin = conductorNote(
          p,
          destination,
          wire,
          owner,
          mate,
          label,
          name,
          card.bbox,
        );
        const reverse = conductorNote(
          destination,
          p,
          wire,
          mate,
          owner,
          label,
          name,
        );
        if (origin) records.push(origin);
        if (reverse) records.push(reverse);
      }
    }
  const unique = new Map();
  for (const r of records) {
    const key = JSON.stringify([r.sheet, r.source, r.values]);
    const previous = unique.get(key);
    if (previous) {
      previous.owners.push(...r.owners);
      previous.supports.push(...r.supports);
    } else unique.set(key, r);
  }
  return [...unique.values()];
}

function functionTerminals(ir, parts, fn) {
  const ambiguous = new Set(
    ir.functions
      .filter(
        (f) =>
          f !== fn && f.kind === fn.kind && f.id.deviceUid === fn.id.deviceUid,
      )
      .flatMap((f) => f.terminals.map(terminalKey)),
  );
  return parts.flatMap((part) => {
    const terminal = fn.terminals.find(
      (t) =>
        !ambiguous.has(terminalKey(t)) && part.terminals.has(terminalKey(t)),
    );
    return terminal ? [{ part, terminal, kind: fn.kind }] : [];
  });
}

function interfaceObligations(ir, parts, names) {
  const wiring = parts.filter((p) => p.sheet.view.kind === "wiring");
  const functions = new Map(ir.functions.map((f) => [functionKey(f.id), f]));
  return ir.internalRelations.flatMap((r) => {
    const coil = functions.get(functionKey(r.from)),
      contact = functions.get(functionKey(r.to));
    if (
      r.verb !== "actuates" ||
      coil?.kind !== "coil" ||
      contact?.kind !== "contact"
    )
      return [];
    const a = functionTerminals(ir, wiring, coil),
      b = functionTerminals(ir, wiring, contact);
    return [
      [a, b],
      [b, a],
    ].flatMap(([here, there]) =>
      here.flatMap((p) => {
        const q = there.find((target) => target.part !== p.part);
        if (!q) return [];
        const { zones } = q.part.terminals.get(terminalKey(q.terminal));
        return [
          {
            sheet: p.part.sheet.number,
            kind: "terminal-interface",
            source: [p.terminal, q.terminal],
            ownerLabel: `${names.get(r.deviceUid)} ${p.terminal.terminalKey}`,
            owners: p.part.terminals.get(terminalKey(p.terminal)).boxes,
            values: [...zones].map(
              (z) =>
                `${names.get(r.deviceUid)} · ${p.kind} terminal ${p.terminal.terminalKey} → ${q.kind} terminal ${q.terminal.terminalKey} ${loc(q.part.sheet.number, z)}`,
            ),
            compactValues: [...zones].map(
              (z) =>
                `→ ${names.get(r.deviceUid)} ${q.kind} terminal ${q.terminal.terminalKey} ${loc(q.part.sheet.number, z)}`,
            ),
          },
        ];
      }),
    );
  });
}

export function terminalPeerObligations(packet, geometries, ir, sources) {
  if (
    !geometries.some(
      (g, i) =>
        g.tranche4?.cards?.length || packet.sheets[i].view.kind === "wiring",
    )
  )
    return [];
  const wires = sources.filter((r) => r.kind === "wires");
  const { owners } = cableEndBindings(packet, geometries, ir, wires);
  const parts = packet.sheets.flatMap((sheet, index) => {
    if (
      [
        "terminals",
        "terminal-strip",
        "wires",
        "assemblies",
        "references",
      ].includes(sheet.view.kind)
    )
      return [];
    const geometry = geometries[index];
    return [
      { sheet, geometry, terminals: observedTerminals(ir, geometry, owners) },
    ];
  });
  const names = new Map(ir.devices.map((d) => [d.uid, d.designation]));
  return [
    ...cardObligations(
      ir,
      parts,
      wires,
      (t) => `${names.get(t.deviceUid)}.${t.terminalKey}`,
    ),
    ...interfaceObligations(ir, parts, names),
  ];
}
