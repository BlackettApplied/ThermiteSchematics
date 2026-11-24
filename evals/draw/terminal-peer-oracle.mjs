import { measuredZone } from "./repeat-appearances.mjs";
import { pinListAppearances } from "./wire-locators.mjs";
import { cableEndBindings } from "./cable-end-identities.mjs";
import { extent, painted } from "./review-geometry.mjs";
import { elementKey } from "./tranche4-source.mjs";
import {
  attachmentLeadEnds,
  conductorInk,
  continuationInk,
  foreignConductorBoxes,
  paintedToBothEnds,
} from "./peer-owner-ink.mjs";

const terminalKey = (t) => t && JSON.stringify([t.deviceUid, t.terminalKey]);
const functionKey = (f) => JSON.stringify([f.deviceUid, f.functionKey]);
const loc = (s, zone) => `${String(s).padStart(2, "0")}.${zone}`;
const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function paintedCircleBox(bbox, stroke) {
  if (!bbox || !(stroke > 0)) return bbox;
  return {
    x: bbox.x - stroke / 2,
    y: bbox.y - stroke / 2,
    w: bbox.w + stroke,
    h: bbox.h + stroke,
  };
}

function observedTerminals(ir, g, cableOwners) {
  const real = new Set(ir.terminals.map((t) => terminalKey(t.id)));
  const markers = (g.tranche4?.markers ?? [])
    .filter((m) => !m.junction && (m.painted || m.filled))
    .map((m) => ({
      key: JSON.stringify([m.deviceUid, m.terminal]),
      p: m.point,
      bbox: m.bbox,
      paintedBbox: paintedCircleBox(m.bbox, m.stroke),
    }));
  const wire = (g.wireTerminals ?? []).flatMap((m) => {
    const binding = m.cableUid ? cableOwners.get(m) : m.terminal;
    return binding
      ? [
          {
            key: JSON.stringify(binding),
            p: m.point,
            bbox: m.bbox,
            paintedBbox: paintedCircleBox(m.bbox, m.stroke),
          },
        ]
      : [];
  });
  const pins = pinListAppearances(g, ir).map((p) => ({
    key: JSON.stringify(p.terminal),
    p: center(p.bbox),
    bbox: p.bbox,
    paintedBbox: p.bbox,
  }));
  const result = new Map();
  for (const { key, p, bbox, paintedBbox } of [...markers, ...wire, ...pins]) {
    if (!real.has(key) || !p) continue;
    const zone = measuredZone(g, p);
    if (!zone) continue;
    if (!result.has(key))
      result.set(key, {
        zones: new Set(),
        boxes: [],
        paintedBoxes: [],
        routeBoxes: [],
      });
    const region = result.get(key);
    const box = bbox ?? { ...p, w: 0, h: 0 };
    region.zones.add(zone);
    region.boxes.push(box);
    region.paintedBoxes.push(paintedBbox ?? box);
    region.routeBoxes.push(box);
  }
  const physical = new Map(
    [...result.entries()].map(([k, r]) => [k, { boxes: [...r.routeBoxes] }]),
  );
  // Branch dots on sheets that also draw the physical terminal receive fanned-out
  // wire endpoints for connectivity checks without supplying zones or owners.
  for (const m of g.tranche4?.markers ?? []) {
    if (!m.junction || !(m.painted || m.filled) || !m.point) continue;
    const region = result.get(JSON.stringify([m.deviceUid, m.terminal]));
    if (region) region.routeBoxes.push(m.bbox ?? { ...m.point, w: 0, h: 0 });
  }
  for (const [key, ends] of attachmentLeadEnds(g, physical))
    result.get(key)?.routeBoxes.push(...ends);
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

function foreignTerminalBoxes(part, ownTerminal, sameFunction) {
  const ownKey = terminalKey(ownTerminal);
  const out = [];
  for (const [key, region] of part.terminals)
    if (key !== ownKey && !sameFunction?.has(key))
      out.push(...region.paintedBoxes);
  return out;
}

function canonicalDestination(destinations) {
  const [primary, ...alternates] = destinations.map((d) =>
    loc(d.sheet, d.zones[0]),
  );
  return alternates.length
    ? `${primary} (also shown ${alternates.join(", ")})`
    : primary;
}

function conductorNote(src, dest, wire, a, b, label, name, cardInfo) {
  const from = src.terminals.get(terminalKey(a));
  const to = src.terminals.get(terminalKey(b));
  const ink = conductorInk(src.geometry, wire.element);
  if (paintedToBothEnds(ink, from.routeBoxes, to?.routeBoxes)) return;
  const { runs, boxes } = ink;
  const { zones } = dest.terminals.get(terminalKey(b));
  const continuations = continuationInk(
    src.sheet,
    src.geometry,
    wire.element,
    runs,
  );
  return {
    sheet: src.sheet.number,
    kind: "conductor-peer",
    source: [a, wire.element, b],
    label,
    peerName: name(b),
    ownerLabel: name(a),
    owners: cardInfo ? [cardInfo.bbox] : [...from.boxes],
    paintedOwners: cardInfo ? [cardInfo.bbox] : [...from.paintedBoxes],
    foreignOwners: foreignTerminalBoxes(src, a),
    foreignConductors: foreignConductorBoxes(src.geometry, wire.element, runs),
    supports: [...runs.map(extent), ...continuations],
    paintedSupports: [...(boxes ?? runs.map(extent)), ...continuations],
    card: cardInfo,
    targets: new Map([[dest.sheet.number, new Set(zones)]]),
  };
}

function mergeCardRecords(records) {
  const unique = new Map();
  for (const r of records) {
    const key = JSON.stringify([r.sheet, r.source]);
    const previous = unique.get(key);
    if (previous) {
      if (r.card && !previous.card) previous.card = r.card;
      previous.owners.push(...r.owners);
      previous.paintedOwners.push(...r.paintedOwners);
      previous.supports.push(...r.supports);
      previous.paintedSupports.push(...r.paintedSupports);
      for (const [sheet, zones] of r.targets) {
        if (!previous.targets.has(sheet))
          previous.targets.set(sheet, new Set());
        for (const z of zones) previous.targets.get(sheet).add(z);
      }
    } else unique.set(key, r);
  }
  return [...unique.values()].map((r) => {
    const destinations = [...r.targets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sheet, zones]) => ({ sheet, zones: [...zones].sort() }));
    const representative = canonicalDestination(destinations);
    return {
      sheet: r.sheet,
      kind: r.kind,
      source: r.source,
      label: r.label,
      peerName: r.peerName,
      ownerLabel: r.ownerLabel,
      owners: r.owners,
      paintedOwners: r.paintedOwners,
      foreignOwners: r.foreignOwners,
      foreignConductors: r.foreignConductors,
      supports: r.supports,
      paintedSupports: r.paintedSupports,
      card: r.card,
      destinations,
      values: [
        `${r.label} · ${r.ownerLabel} → ${r.peerName} ${representative}`,
      ],
      compactValues: [`→ ${r.peerName} ${representative}`],
    };
  });
}

function recordCardRow(
  p,
  parts,
  owner,
  { wire, mate, label },
  cardInfo,
  name,
  records,
) {
  const destination = parts.find(
    (s) => s !== p && s.terminals.has(terminalKey(mate)),
  );
  if (!destination) return;
  const origin = conductorNote(
    p,
    destination,
    wire,
    owner,
    mate,
    label,
    name,
    cardInfo,
  );
  const reverse = conductorNote(destination, p, wire, mate, owner, label, name);
  if (origin) records.push(origin);
  if (reverse) records.push(reverse);
  if (destination.terminals.has(terminalKey(owner))) {
    const coTarget =
      parts.find(
        (s) => s !== destination && s.terminals.has(terminalKey(mate)),
      ) ?? destination;
    const coOwner = conductorNote(
      destination,
      coTarget,
      wire,
      owner,
      mate,
      label,
      name,
    );
    if (coOwner) records.push(coOwner);
  }
}

function cardObligations(ir, parts, wires, name) {
  const native = new Map(wires.map((r) => [elementKey(r.element), r]));
  const records = [];
  for (const p of parts)
    for (const card of p.geometry.tranche4?.cards ?? []) {
      const owner = card.terminalId;
      if (!p.terminals.get(terminalKey(owner)) || !card.bbox) continue;
      const text = card.texts
        .filter((t) => painted(t) && !card.headingElements.includes(t.element))
        .map((t) => t.text)
        .join(" ")
        .replace(/\s+/gu, " ");
      const rowEntries = (card.conductors ?? []).flatMap((id) => {
        const wire = native.get(elementKey(id));
        const mate = wire?.ends.find(
          (t) => terminalKey(t) !== terminalKey(owner),
        );
        if (
          !mate ||
          !wire.ends.some((t) => terminalKey(t) === terminalKey(owner))
        )
          return [];
        const label = conductorName(ir, wire);
        return [{ wire, mate, label, prefix: `${label} → ${name(mate)}` }];
      });
      const rowPrefixes = rowEntries.map((r) => r.prefix);
      for (const [rowIndex, entry] of rowEntries.entries()) {
        if (!text.includes(entry.prefix)) continue;
        recordCardRow(
          p,
          parts,
          owner,
          entry,
          {
            element: card.element,
            bbox: card.bbox,
            text,
            rowPrefixes,
            rowIndex,
          },
          name,
          records,
        );
      }
    }
  return mergeCardRecords(records);
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
  const shared = new Set(
    ir.functions
      .filter((f) => f !== fn && f.id.deviceUid === fn.id.deviceUid)
      .flatMap((f) => f.terminals.map(terminalKey)),
  );
  const ownKeys = new Set(
    fn.terminals.map(terminalKey).filter((k) => !shared.has(k)),
  );
  return parts.flatMap((part) => {
    const terminal = fn.terminals.find(
      (t) =>
        !ambiguous.has(terminalKey(t)) && part.terminals.has(terminalKey(t)),
    );
    return terminal ? [{ part, terminal, kind: fn.kind, ownKeys }] : [];
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
            paintedOwners: p.part.terminals.get(terminalKey(p.terminal))
              .paintedBoxes,
            foreignOwners: foreignTerminalBoxes(p.part, p.terminal, p.ownKeys),
            siblingOwners: [...p.part.terminals].flatMap(([key, region]) =>
              key !== terminalKey(p.terminal) && p.ownKeys.has(key)
                ? region.paintedBoxes
                : [],
            ),
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
