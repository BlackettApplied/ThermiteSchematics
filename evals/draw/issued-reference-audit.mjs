import { nativeRelationReference } from "./relation-reference.mjs";
import { assemblyAppearances } from "./assembly-appearances.mjs";
import { portId } from "./assembly-note-source.mjs";
import { issuedRows } from "./m3-documents.mjs";
import { nativeRows } from "./m3-native.mjs";
import { sufficient } from "./document-dependencies.mjs";
import { extent, finding, groupBy, painted } from "./review-geometry.mjs";
import { terminalPeerObligations } from "./terminal-peer-oracle.mjs";
import {
  CONDUCTOR_OWNER_MARGIN_MM,
  OWNER_MARGIN_MM,
  boxGap,
  excludeCoincidentBoxes,
  inOwnerReach,
  noteOwnerGap,
  notePaintedOwnerGap,
} from "./peer-owner-ink.mjs";
import { measuredZone } from "./repeat-appearances.mjs";
import { printedZones } from "./printed-zones.mjs";
import { INK_ACCURACY_MM } from "./checks.mjs";

const PEER_STACK_GAP_MM = 1.5;
const address = (n) => String(n).padStart(2, "0");
const at = (s, zone) => `${address(s)}.${zone}`;

function endpointZone(packet, geometries, row, name) {
  if (!row) return;
  const g = geometries[packet.sheets.findIndex((s) => s.number === row.sheet)];
  const endpoint = row.texts.find(
    (t) => [2, 3].includes(t.columnIndex) && painted(t) && t.text === name,
  );
  if (!endpoint) return;
  const cell = g.reportCells.find(
    (c) =>
      c.reportRowScope === endpoint.reportRowScope &&
      c.columnIndex === endpoint.columnIndex &&
      c.regionVisible !== false,
  );
  const b = cell?.bbox;
  return b && measuredZone(g, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
}

function assemblyEndpointObligation(
  r,
  uid,
  key,
  { ports, portsBySheet, links, rows, native, ir, packet, geometries },
) {
  const selfId = portId(uid, key);
  const landings = ports.get(selfId) ?? [];
  const drawn = new Set((links.get(r.uid) ?? []).map((a) => a.sheet));
  const expected = native.find(
    (n) => n.kind === "assemblies" && n.key === r.uid,
  );
  const row =
    expected &&
    rows.find(
      (candidate) =>
        candidate.visible && candidate.zone && sufficient(candidate, expected),
    );
  const assembly = nativeRelationReference(ir, r).text;
  const ownerLabel = `${ir.devices.find((d) => d.uid === uid)?.designation}.${key}`;
  const label = `${ownerLabel} · ${assembly}`;
  const rowZone = endpointZone(packet, geometries, row, ownerLabel);
  return landings.flatMap((src) => {
    const ownerBox = src.circleBox ?? src.bbox;
    const foreignOwners = (portsBySheet.get(src.sheet) ?? [])
      .filter((p) => p.id !== selfId)
      .map((p) => p.box);
    const target = landings.find(
      (a) => drawn.has(a.sheet) !== drawn.has(src.sheet) && a.zones.length,
    );
    if (target)
      return [
        {
          sheet: src.sheet,
          kind: "attachment",
          source: [uid, key, r.uid],
          ownerLabel,
          owners: [ownerBox],
          foreignOwners,
          values: target.zones.map((z) => `${label} → ${at(target.sheet, z)}`),
          compactValues: target.zones.map(
            (z) => `→ ${assembly} ${at(target.sheet, z)}`,
          ),
        },
      ];
    return !drawn.size && rowZone
      ? [
          {
            sheet: src.sheet,
            kind: "assembly-inventory",
            source: [uid, key, r.uid],
            ownerLabel,
            owners: [ownerBox],
            foreignOwners,
            values: [`${label} inventory → ${at(row.sheet, rowZone)}`],
            compactValues: [
              `→ ${assembly} inventory ${at(row.sheet, rowZone)}`,
            ],
          },
        ]
      : [];
  });
}

function assemblyObligations(packet, geometries, ir, rows, native) {
  const { ports, links } = assemblyAppearances(packet, geometries, ir);
  const portsBySheet = new Map();
  for (const [id, list] of ports)
    for (const p of list) {
      if (!portsBySheet.has(p.sheet)) portsBySheet.set(p.sheet, []);
      portsBySheet.get(p.sheet).push({ id, box: p.circleBox ?? p.bbox });
    }
  const ctx = {
    ports,
    portsBySheet,
    links,
    rows,
    native,
    ir,
    packet,
    geometries,
  };
  return ir.relations
    .filter((r) => r.assembly)
    .flatMap((r) =>
      [
        [r.fromDeviceUid, r.assembly.fromPort],
        [r.toDeviceUid, r.assembly.toPort],
      ].flatMap(([uid, key]) => assemblyEndpointObligation(r, uid, key, ctx)),
    );
}

const noteAddress = (value) =>
  / (\d+\.[A-D][1-6](?: \(also shown \d+\.[A-D][1-6](?:, \d+\.[A-D][1-6])*\))?)$/u.exec(
    value,
  )?.[1];

function measuredNote(lines) {
  if (lines.some((t) => !painted(t) || (t.fontSize ?? 2.5) < 2.499)) return;
  const [first, second] = lines;
  if (!first.peerGroup) return lines.length === 1 ? first.text : undefined;
  if (lines.length !== 2 || !first.anchor || !second.anchor) return;
  const [top, bottom] = [first, second].sort((a, b) => a.anchor.y - b.anchor.y);
  if (
    Math.abs(top.anchor.x - bottom.anchor.x) > 0.02 ||
    Math.abs(bottom.anchor.y - top.anchor.y - 3.5) > 0.02 ||
    !top.bbox ||
    !bottom.bbox ||
    top.bbox.y + top.bbox.h > bottom.bbox.y
  )
    return;
  return top.text + " " + bottom.text;
}

function parseSheetZoneToken(token) {
  const m = /^(\d{2,})\.([A-D][1-6])$/u.exec(token);
  return m ? { sheet: Number(m[1]), zone: m[2] } : null;
}

function matchesDestinationText(raw, destinations, allowCardWrap = false) {
  if (!destinations?.length) return false;
  const text = raw.trim();
  if (destinations.length === 1) {
    const parsed = parseSheetZoneToken(text);
    const [only] = destinations;
    return (
      parsed !== null &&
      parsed.sheet === only.sheet &&
      only.zones.includes(parsed.zone)
    );
  }
  const altPattern = allowCardWrap
    ? /^(\d{2,}\.[A-D][1-6])\s+(?:\(\s*)?also shown\s+((?:\d{2,}\.[A-D][1-6])(?:\s*,\s*\d{2,}\.[A-D][1-6])*)\s*\)?$/u
    : /^(\d{2,}\.[A-D][1-6]) \(also shown (\d{2,}\.[A-D][1-6](?:, \d{2,}\.[A-D][1-6])*)\)$/u;
  const match = altPattern.exec(text);
  if (!match) return false;
  const tokens = [
    match[1],
    ...match[2].split(/\s*,\s*/u).map((part) => part.trim()),
  ];
  if (tokens.length !== destinations.length) return false;
  return tokens.every((token, i) => {
    const parsed = parseSheetZoneToken(token);
    const expected = destinations[i];
    return (
      parsed !== null &&
      parsed.sheet === expected.sheet &&
      expected.zones.includes(parsed.zone)
    );
  });
}

function obligationMatchesAddress(obligation, addr) {
  if (obligation.destinations?.length)
    return matchesDestinationText(addr, obligation.destinations);
  return (obligation.values ?? []).some((v) => noteAddress(v) === addr);
}

function uniqueQualifiedOwnerAddress(obligations, ownerLabel, addr) {
  let matches = 0;
  for (const o of obligations) {
    if (o.ownerLabel === ownerLabel && obligationMatchesAddress(o, addr))
      matches++;
    if (matches > 1) return false;
  }
  return matches === 1;
}

function cardDestinationSlice(card, prefix) {
  const { text, rowPrefixes, rowIndex } = card;
  if (Array.isArray(rowPrefixes) && Number.isInteger(rowIndex)) {
    let cursor = 0;
    for (let i = 0; i <= rowIndex; i++) {
      const p = rowPrefixes[i];
      if (!p) return null;
      const at = text.indexOf(p, cursor);
      if (at < 0) return null;
      cursor = at + p.length;
    }
    const nextPrefix = rowPrefixes[rowIndex + 1];
    if (!nextPrefix) return text.slice(cursor);
    const nextAt = text.indexOf(nextPrefix, cursor);
    return nextAt < 0 ? text.slice(cursor) : text.slice(cursor, nextAt);
  }
  const idx = text.indexOf(prefix);
  if (idx < 0) return null;
  const after = text.slice(idx + prefix.length);
  const nextRow = /\s+\S+\s+(?:→|->)\s+/u.exec(after);
  return nextRow ? after.slice(0, nextRow.index) : after;
}

function cardCarriesDestination(obligation) {
  const { card, label, peerName, destinations = [] } = obligation;
  if (!card || !destinations.length) return false;
  const slice = cardDestinationSlice(card, `${label} → ${peerName}`);
  return slice !== null && matchesDestinationText(slice, destinations, true);
}

function stripCardRowEndpoint(segment) {
  const trimmed = segment.trimStart();
  if (/^unterminated\s+\(spare\)\b/u.test(trimmed))
    return trimmed.replace(/^unterminated\s+\(spare\)\b/u, "").trim();
  return trimmed.replace(/^\S+/u, "").trim();
}

function cardDestinationSlices(text, rowPrefixes) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];
  const arrows = [...normalized.matchAll(/(?:→|->)/gu)];
  if (
    Array.isArray(rowPrefixes) &&
    rowPrefixes.length > 0 &&
    rowPrefixes.length === arrows.length
  ) {
    const slices = [];
    let allMatched = true;
    for (let i = 0; i < rowPrefixes.length; i++) {
      const slice = cardDestinationSlice(
        { text: normalized, rowPrefixes, rowIndex: i },
        rowPrefixes[i],
      );
      if (slice === null) {
        allMatched = false;
        break;
      }
      slices.push(slice.trim());
    }
    if (allMatched) return slices;
  }
  if (!arrows.length) return [normalized];
  const parts = normalized.split(/\s*(?:→|->)\s*/u);
  const knownLabels = (rowPrefixes ?? [])
    .map((p) => p.split(/\s*(?:→|->)\s*/u)[0]?.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const slices = [];
  for (let i = 1; i < parts.length; i++) {
    let slice = stripCardRowEndpoint(parts[i]);
    if (i < parts.length - 1) {
      const matchedLabel = knownLabels.find(
        (label) => slice === label || slice.endsWith(` ${label}`),
      );
      slice = matchedLabel
        ? slice.slice(0, slice.length - matchedLabel.length).trim()
        : slice.replace(/(?:^|\s)\S+$/u, "").trim();
    }
    if (slice) slices.push(slice);
  }
  return slices;
}

function auditCardUnsupportedDestinations(sheet, g, expected, result) {
  const cards = g?.tranche4?.cards ?? [];
  if (!cards.length) return;
  const supportedByCard = new Map();
  const prefixesByCard = new Map();
  for (const o of expected) {
    if (!o.card?.element) continue;
    if (o.card.rowPrefixes?.length && !prefixesByCard.has(o.card.element))
      prefixesByCard.set(o.card.element, o.card.rowPrefixes);
    if (!o.destinations?.length) continue;
    const set = supportedByCard.get(o.card.element) ?? new Set();
    for (const d of o.destinations)
      for (const z of d.zones) set.add(at(d.sheet, z));
    supportedByCard.set(o.card.element, set);
  }
  for (const card of cards) {
    const supported = supportedByCard.get(card.element) ?? new Set();
    const text = (card.texts ?? [])
      .filter(
        (t) => painted(t) && !(card.headingElements ?? []).includes(t.element),
      )
      .map((t) => t.text)
      .join(" ");
    const slices = cardDestinationSlices(
      text,
      prefixesByCard.get(card.element),
    );
    const unsupported = slices.flatMap((slice) =>
      [...slice.matchAll(/\b(\d{2,}\.[A-Z]+\d+)\b/gu)]
        .map((m) => m[1])
        .filter((token) => !supported.has(token)),
    );
    if (unsupported.length)
      result.push(
        finding("issued-peer-reference-unsupported-destination", card, {
          sheet,
          unsupported,
          supported: [...supported].sort(),
          cardText: text,
        }),
      );
  }
}

function nameForm(obligation, note, value, allObligations) {
  if (
    !value ||
    obligation.kind !== note.peerReference ||
    JSON.stringify(obligation.source) !== note.peerSource
  )
    return;
  const {
    ownerLabel,
    values = [],
    compactValues = [],
    destinations,
  } = obligation;
  if (destinations?.length && obligation.label && obligation.peerName) {
    const fullPrefix = `${obligation.label} · ${ownerLabel} → ${obligation.peerName} `;
    if (
      value.startsWith(fullPrefix) &&
      matchesDestinationText(value.slice(fullPrefix.length), destinations)
    )
      return "full";
    const namedCompactPrefix = `${ownerLabel} → ${obligation.peerName} `;
    if (
      ownerLabel &&
      value.startsWith(namedCompactPrefix) &&
      matchesDestinationText(
        value.slice(namedCompactPrefix.length),
        destinations,
      )
    )
      return "named-compact";
    const bareCompactPrefix = `→ ${obligation.peerName} `;
    if (
      value.startsWith(bareCompactPrefix) &&
      matchesDestinationText(
        value.slice(bareCompactPrefix.length),
        destinations,
      )
    )
      return "bare-compact";
    const qualifiedPrefix = `${ownerLabel} → `;
    if (
      ownerLabel &&
      value.startsWith(qualifiedPrefix) &&
      matchesDestinationText(
        value.slice(qualifiedPrefix.length),
        destinations,
      ) &&
      uniqueQualifiedOwnerAddress(
        allObligations,
        ownerLabel,
        value.slice(qualifiedPrefix.length),
      )
    )
      return "qualified";
    return;
  }
  if (values.includes(value)) return "full";
  if (ownerLabel && compactValues.some((v) => value === `${ownerLabel} ${v}`))
    return "named-compact";
  if (compactValues.includes(value)) return "bare-compact";
  const addr = noteAddress(value);
  if (
    addr &&
    ownerLabel &&
    values.some((v) => noteAddress(v) === addr) &&
    uniqueQualifiedOwnerAddress(allObligations, ownerLabel, addr) &&
    value === `${ownerLabel} → ${addr}`
  )
    return "qualified";
}

function measuredFieldBounds(g) {
  if (!g?.frame || !g?.headerRule) return;
  const { numbers, letters } = printedZones(g);
  if (numbers.length < 2) return;
  const colW = numbers[1].anchor.x - numbers[0].anchor.x;
  if (!(colW > 0)) return;
  const bounds = {
    left: numbers[0].anchor.x - colW / 2,
    right: numbers.at(-1).anchor.x + colW / 2,
  };
  if (letters.length >= 2) {
    const rowH = letters[1].anchor.y - letters[0].anchor.y;
    if (rowH > 0) {
      bounds.top = letters[0].anchor.y - rowH / 2;
      bounds.bottom = letters.at(-1).anchor.y + rowH / 2;
    }
  }
  return bounds;
}

function noteRegion(lines) {
  return extent(
    lines.flatMap(({ bbox: b }) => [b, { x: b.x + b.w, y: b.y + b.h }]),
  );
}

function checkPeerStackGaps(sheet, regions, result) {
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i],
        b = regions[j];
      const horizontalOverlap =
        Math.min(a.box.x + a.box.w, b.box.x + b.box.w) -
          Math.max(a.box.x, b.box.x) >
        -INK_ACCURACY_MM;
      if (!horizontalOverlap) continue;
      const dy = Math.max(
        0,
        a.box.y - (b.box.y + b.box.h),
        b.box.y - (a.box.y + a.box.h),
      );
      if (dy < PEER_STACK_GAP_MM - 1e-6)
        result.push(
          finding("issued-peer-reference-stack-gap", a.first, {
            sheet,
            printed: a.text,
            otherText: b.text,
            gapMm: dy,
            minimumMm: PEER_STACK_GAP_MM,
          }),
        );
    }
}

function auditNoteGeometry(
  sheet,
  lines,
  printed,
  fieldBounds,
  paintedRegions,
  result,
) {
  const first = lines[0];
  if (lines.length > 1 && lines.every((t) => painted(t) && t.anchor)) {
    const sortedLines = lines.slice().sort((a, b) => a.anchor.y - b.anchor.y);
    if (sortedLines.slice(0, -1).some((l) => /(?:→|->)\s*$/u.test(l.text)))
      result.push(
        finding("issued-peer-reference-arrow-split", first, {
          sheet,
          printed,
          lines: sortedLines.map((l) => l.text),
        }),
      );
  }
  if (!lines.every((t) => painted(t) && t.bbox)) return;
  const box = noteRegion(lines);
  paintedRegions.push({ first, text: printed, box });
  if (
    fieldBounds &&
    (box.x < fieldBounds.left - INK_ACCURACY_MM ||
      box.x + box.w > fieldBounds.right + INK_ACCURACY_MM ||
      (fieldBounds.top !== undefined &&
        box.y < fieldBounds.top - INK_ACCURACY_MM) ||
      (fieldBounds.bottom !== undefined &&
        box.y + box.h > fieldBounds.bottom + INK_ACCURACY_MM))
  )
    result.push(
      finding("issued-peer-reference-outside-drawing-bounds", first, {
        sheet,
        printed,
        noteLeftMm: box.x,
        noteTopMm: box.y,
        noteBottomMm: box.y + box.h,
        fieldLeftMm: fieldBounds.left,
        fieldRightMm: fieldBounds.right,
        ...(fieldBounds.top !== undefined
          ? { fieldTopMm: fieldBounds.top, fieldBottomMm: fieldBounds.bottom }
          : {}),
      }),
    );
}

function auditMatchedOwnerProximity(
  sheet,
  lines,
  value,
  obligation,
  form,
  result,
) {
  if (!obligation.owners) return;
  const first = lines[0];
  const named = form !== "bare-compact";
  const reachGap = noteOwnerGap(lines, obligation, named);
  if (!inOwnerReach(reachGap, named))
    result.push(
      finding("issued-peer-reference-owner-distance", first, {
        sheet,
        printed: value,
        source: obligation.source,
        gapMm: reachGap,
        named,
      }),
    );
  const foreignOwners = obligation.foreignOwners ?? [];
  const foreignConductors = excludeCoincidentBoxes(
    obligation.foreignConductors ?? [],
    obligation.supports ?? [],
  );
  const siblings = obligation.siblingOwners ?? [];
  if (
    (!foreignOwners.length && !foreignConductors.length && !siblings.length) ||
    !lines.every((t) => t.bbox)
  )
    return;
  const ownerGap = notePaintedOwnerGap(lines, obligation, named);
  const box = noteRegion(lines);
  const checks = [
    [foreignOwners, OWNER_MARGIN_MM],
    [foreignConductors, CONDUCTOR_OWNER_MARGIN_MM],
    [siblings, 0],
  ]
    .filter(([boxes]) => boxes.length)
    .map(([boxes, minimumMarginMm]) => {
      const foreignGapMm = Math.min(...boxes.map((o) => boxGap(box, o)));
      return {
        foreignGapMm,
        minimumMarginMm,
        deficit: ownerGap + minimumMarginMm - foreignGapMm,
      };
    })
    .filter((c) => c.deficit > INK_ACCURACY_MM);
  if (!checks.length) return;
  const worst = checks.reduce((a, b) => (b.deficit > a.deficit ? b : a));
  result.push(
    finding("issued-peer-reference-foreign-owner", first, {
      sheet,
      printed: value,
      source: obligation.source,
      ownerGapMm: ownerGap,
      foreignGapMm: worst.foreignGapMm,
      minimumMarginMm: worst.minimumMarginMm,
    }),
  );
}

function auditFreePeerNote(sheet, lines, state, result) {
  const first = lines[0];
  const printed = lines.map((t) => t.text).join(" ");
  const value = measuredNote(lines);
  auditNoteGeometry(
    sheet,
    lines,
    printed,
    state.fieldBounds,
    state.paintedRegions,
    result,
  );
  if (
    first.peerReference === "conductor-peer" &&
    state.cardOwnedSources.has(first.peerSource)
  ) {
    result.push(
      finding("issued-peer-reference-duplicate-card-note", first, {
        sheet,
        printed,
        source: first.peerSource,
      }),
    );
    return;
  }
  if (value && /^→\s*\d+\.[A-D][1-6]$/u.test(value)) {
    result.push(
      finding("issued-peer-reference-subjectless", first, {
        sheet,
        printed: value,
      }),
    );
    return;
  }
  const sourceKey = JSON.stringify([first.peerReference, first.peerSource]);
  if (state.seenFreeSources.has(sourceKey)) {
    result.push(
      finding("issued-peer-reference-duplicate", first, {
        sheet,
        printed,
        source: first.peerSource,
      }),
    );
    return;
  }
  let form;
  const index = state.obligations.findIndex(
    (o) => (form = nameForm(o, first, value, state.allObligations)),
  );
  if (index === -1) {
    result.push(
      finding("issued-peer-reference-unbound", first, { sheet, printed }),
    );
    return;
  }
  state.seenFreeSources.add(sourceKey);
  const kindForms = state.formsByKind.get(first.peerReference) ?? [];
  kindForms.push({ form, first, text: value });
  state.formsByKind.set(first.peerReference, kindForms);
  const [obligation] = state.obligations.splice(index, 1);
  auditMatchedOwnerProximity(sheet, lines, value, obligation, form, result);
}

export function peerReferenceFindings(sheet, g, expected) {
  const result = [];
  const cardOwnedSources = new Set();
  const obligations = [];
  for (const o of expected) {
    if (o.card) {
      cardOwnedSources.add(JSON.stringify(o.source));
      if (!cardCarriesDestination(o))
        result.push({
          ...finding("issued-peer-reference-missing", o.card, {
            sheet,
            referenceKind: o.kind,
            source: o.source,
            expected: o.values,
            cardText: o.card.text,
          }),
          designation: o.values[0],
        });
    } else obligations.push(o);
  }
  auditCardUnsupportedDestinations(sheet, g, expected, result);
  const state = {
    cardOwnedSources,
    obligations,
    allObligations: [...obligations],
    fieldBounds: measuredFieldBounds(g),
    seenFreeSources: new Set(),
    formsByKind: new Map(),
    paintedRegions: [],
  };
  const notes = groupBy(
    (g.texts ?? []).filter((t) => t.peerReference),
    (t) => t.peerGroup ?? t,
  );
  for (const lines of notes.values())
    auditFreePeerNote(sheet, lines, state, result);
  for (const [kind, used] of state.formsByKind) {
    const distinct = [...new Set(used.map((u) => u.form))];
    if (distinct.length > 1)
      result.push(
        finding("issued-peer-reference-mixed-form", used[0].first, {
          sheet,
          referenceKind: kind,
          forms: distinct,
          notes: used.map((u) => u.text),
        }),
      );
  }
  checkPeerStackGaps(sheet, state.paintedRegions, result);
  return result.concat(
    obligations.map((o) => ({
      ...finding(
        "issued-peer-reference-missing",
        {},
        { sheet, referenceKind: o.kind, source: o.source, expected: o.values },
      ),
      designation: o.values[0],
    })),
  );
}

export function footerReferenceFindings(sheet, g, target) {
  if (sheet.view.kind !== "circuit") return [];
  const ink = g.texts
    .filter((t) => t.sheetText && painted(t) && t.bbox?.y >= g.height - 35)
    .map((t) => t.text)
    .join(" ");
  const measured = [...ink.matchAll(/Device and function references S(\d+)/gu)];
  if (
    /device\/function references in index/iu.test(ink) ||
    (target === undefined
      ? measured.length
      : measured.length !== 1 || Number(measured[0]?.[1]) !== target)
  )
    return [
      finding(
        "circuit-footer-reference-disagrees",
        {},
        { sheet: sheet.number, target, printed: ink },
      ),
    ];
  return [];
}

function inventorySheetMatches(sheet, geometry, scope, terminal, rows) {
  const ink = geometry.terminalStripInk;
  if (!ink || !ink.viewKeys.some((k) => scope.includes(k))) return false;
  const visible = rows.filter(
    (row) =>
      row.visible &&
      row.kind === "terminals" &&
      row.key === terminal.key &&
      row.sheet === sheet.number,
  );
  const keys = ink.references.filter(
    (r) => r.key === terminal.key && r.text === terminal.ref,
  );
  return visible.length === 1 && keys.length === 1;
}

export function stripInventoryFindings(packet, geometries, rows, i) {
  const sheet = packet.sheets[i],
    ink = geometries[i].terminalStripInk;
  if (sheet.view.kind !== "terminal-strip" || !ink) return [];
  return ink.terminals.flatMap((terminal) => {
    if (!terminal.rect) return [];
    const targets = packet.sheets.filter(
      (s, index) =>
        s.view.kind === "terminals" &&
        inventorySheetMatches(
          s,
          geometries[index],
          ink.viewKeys,
          terminal,
          rows,
        ),
    );
    const read = terminal.texts.filter(
      (t) => painted(t) && /^S\d+$/u.test(t.text),
    );
    if (
      targets.length === 1 &&
      read.length === 1 &&
      read[0].text === `S${address(targets[0].number)}`
    )
      return [];
    return [
      finding(
        "strip-inventory-sheet-disagrees",
        { bbox: terminal.rect, designation: terminal.ref },
        {
          sheet: sheet.number,
          terminal: terminal.key,
          read: read.map((t) => t.text),
          expectedSheets: targets.map((s) => s.number),
        },
      ),
    ];
  });
}

export function issuedReferenceAudit(packet, geometries, ir) {
  const rows = issuedRows(packet, geometries),
    sources = nativeRows(ir);
  const obligations = [
    ...assemblyObligations(packet, geometries, ir, rows, sources),
    ...terminalPeerObligations(packet, geometries, ir, sources),
  ];
  const target = packet.sheets.find(
    (s, i) =>
      s.view.kind === "references" &&
      geometries[i].texts.some(
        (t) => painted(t) && t.text === "Device and function references",
      ),
  )?.number;
  return packet.sheets.flatMap((sheet, i) => [
    ...peerReferenceFindings(
      sheet.number,
      geometries[i],
      obligations.filter((o) => o.sheet === sheet.number),
    ),
    ...footerReferenceFindings(sheet, geometries[i], target),
    ...stripInventoryFindings(packet, geometries, rows, i),
  ]);
}
