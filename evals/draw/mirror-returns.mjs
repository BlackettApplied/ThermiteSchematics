import {
  fullFunctionAppearances,
  boxExtent,
  measuredZone,
} from "./repeat-appearances.mjs";
import { finding, painted, groupBy } from "./review-geometry.mjs";
import { terminalSet } from "./printed-vocabulary.mjs";
import {
  nearestOwner,
  anchorDistance,
  NAVIGATION_EPS_MM as EPS,
} from "./navigation-geometry.mjs";
const same = (a, b) =>
  a?.deviceUid === b?.deviceUid && a?.functionKey === b?.functionKey;
const source = (a) => ({ deviceUid: a.uid, functionKey: a.functionKey });
const token = (a) => `${String(a.sheet).padStart(2, "0")}.${a.zone}`;
const unique = (xs) => [...new Set(xs)].sort();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const read = (ts) =>
  ts
    .slice()
    .sort(
      (a, b) =>
        (a.anchor?.y ?? a.bbox.y) - (b.anchor?.y ?? b.bbox.y) ||
        a.bbox.x - b.bbox.x,
    )
    .map((t) => t.text)
    .join(" ");
const compact = (s) => s.replace(/\s+/gu, "");
// Compiled IR is the byte-locked source oracle. No navigation planner, renderer
// formatter, exported row facts, targets, states or locality mode is imported.
/** @returns {import("./navigation-contracts").MirrorReturnAudit} */
export function mirrorReturns(packet, geometries, ir, request) {
  const all = fullFunctionAppearances(packet, geometries, ir, request);
  const fn = (id) => ir.functions?.find((f) => same(f.id, id));
  const tag = (uid) => ir.devices?.find((d) => d.uid === uid)?.designation;
  const relations = (ir.internalRelations ?? []).filter(
    (r) =>
      r.verb === "actuates" &&
      r.deviceUid === r.from.deviceUid &&
      r.from.deviceUid === r.to.deviceUid &&
      fn(r.from)?.kind === "coil" &&
      fn(r.to)?.kind === "contact",
  );
  const coils = (id) =>
    (ir.functions ?? []).filter((f) =>
      relations.some((r) => same(r.to, id) && same(r.from, f.id)),
    );
  const contacts = (id) =>
    (ir.functions ?? []).filter((f) =>
      relations.some((r) => same(r.from, id) && same(r.to, f.id)),
    );
  const destinations = (id) =>
    unique(all.filter((a) => same(source(a), id)).map(token));
  const annotations = packet.navigation?.annotations ?? [],
    occurrences = packet.navigation?.occurrences ?? [];
  const matching = (o, a) =>
    same(o.source, source(a)) &&
    o.destination?.sheet === a.sheet &&
    (!a.primitiveIds?.length ||
      !o.primitiveIds?.length ||
      o.primitiveIds.some((id) => a.primitiveIds.includes(id))) &&
    (o.provenance?.view?.key
      ? o.provenance.view.key === a.viewKey
      : o.provenance?.view?.authoredOrder === a.view);
  const records = all
    .filter((a) => ["coil", "contact"].includes(a.kind))
    .map((a) => ({
      ...a,
      findings: [],
      measurements: [],
      assessment: "direct-actuation",
      blocks: [],
    }));
  const extra = [];
  const emit = (r, kind, item = r, detail = {}) =>
    r.findings.push({
      sheet: r.sheet,
      ...finding(kind, item, {
        deviceUid: r.uid,
        functionKey: r.functionKey,
        ...detail,
      }),
    });
  reconcileFullAppearances(
    records,
    packet,
    occurrences,
    matching,
    emit,
    fn,
    extra,
  );
  reconcileSelectedAppearances(request, ir, all, packet, extra);
  for (const [i, sheet] of packet.sheets.entries()) {
    const g = geometries[i];
    if (!g) continue;
    const local = records.filter((a) => a.sheet === sheet.number);
    const blocks = navigationBlocks(g, annotations);
    bindNavigationBlocks(
      blocks,
      occurrences,
      local,
      tag,
      matching,
      sheet,
      extra,
      emit,
      ir,
      g,
      coils,
    );
    for (const a of local) {
      const native = fn(source(a)),
        direct = a.kind === "coil" ? contacts(source(a)) : coils(source(a));
      const hasContacts = (ir.functions ?? []).some(
        (f) => f.id.deviceUid === a.uid && f.kind === "contact",
      );
      const unspecified =
        a.kind === "coil"
          ? hasContacts && !direct.length
          : (ir.functions ?? []).some(
              (f) => f.id.deviceUid === a.uid && f.kind === "coil",
            ) &&
            !direct.length &&
            !(ir.internalRelations ?? []).some(
              (r) =>
                ["actuates", "trips"].includes(r.verb) && same(r.to, source(a)),
            );
      const needed = direct.length > 0 || unspecified;
      if (!direct.length)
        a.assessment = unspecified
          ? "associations-unspecified"
          : "outside-direct-actuation-scope";
      if (a.kind === "coil")
        auditMirrorTable(
          a,
          needed,
          direct,
          unspecified,
          emit,
          destinations,
          tag,
          g,
        );
      else auditReturnCaption(a, needed, direct, emit, destinations, tag);
      if (!native) emit(a, "navigation-native-source-missing");
    }
    for (const t of g.texts.filter(
      (t) => painted(t) && /not assessed/i.test(t.text),
    ))
      extra.push({
        sheet: sheet.number,
        ...finding("navigation-forbidden-assessment-text", t),
      });
  }
  return {
    records,
    findings: [...records.flatMap((r) => r.findings), ...extra],
    extra,
    coilAppearances: records.filter((r) => r.kind === "coil"),
    contactAppearances: records.filter((r) => r.kind === "contact"),
  };
}

function reconcileFullAppearances(
  records,
  packet,
  occurrences,
  matching,
  emit,
  fn,
  extra,
) {
  // B ↔ C conservation. A stripped or forged boundary locator cannot remove a
  // full native body/terminal obligation, nor can a dropped seed earn a pass.
  for (const a of records) {
    const seedMatches = (packet.navigation?.seeds ?? []).filter(
      (s) =>
        same(s.source, source(a)) &&
        occurrences.some(
          (o) => matching(o, a) && o.appearance === s.appearance,
        ),
    );
    if (!seedMatches.length)
      emit(a, "navigation-seed-reconciliation", a, {
        expectedSource: source(a),
      });
    const located = occurrences.filter((o) => matching(o, a));
    if (located.length !== 1 || located[0].role !== "full-function")
      emit(a, "navigation-appearance-reconciliation", a, {
        actual: located.length,
        roles: located.map((o) => o.role),
      });
  }
  for (const o of occurrences.filter(
    (o) =>
      o.role === "full-function" &&
      ["coil", "contact"].includes(fn(o.source)?.kind),
  )) {
    if (!records.some((a) => matching(o, a)))
      extra.push({
        sheet: o.destination.sheet,
        ...finding(
          "navigation-unexplained-full-occurrence",
          {},
          { source: o.source, occurrence: o.id },
        ),
      });
  }
}

function reconcileSelectedAppearances(request, ir, all, packet, extra) {
  // Native selections are source obligations. Titles locate an issued sheet;
  // an absent locator never erases an unresolved source or missing appearance.
  const views = request?.views ?? (request ? [request] : []);
  for (const [order, v] of views.entries()) {
    for (const selection of (v.groups ?? []).flatMap(
      (g) => g.functions ?? [],
    )) {
      const resolved = selectedNativeFunction(ir, selection);
      if (resolved.error) {
        unresolvedSelection(
          packet,
          extra,
          "navigation-selected-source-unresolved",
          {
            selection,
            view: order,
            ...resolved.error,
          },
        );
        continue;
      }
      const { id, native } = resolved;
      if (
        !["coil", "contact"].includes(native.kind) ||
        all.some((a) => same(source(a), id) && a.view === order)
      )
        continue;
      const sheets = packet.sheets.filter((s) => s.view?.title === v.title);
      if (!sheets.length) {
        unresolvedSelection(
          packet,
          extra,
          "navigation-selected-view-unresolved",
          {
            source: id,
            view: order,
            expectedTitle: v.title,
          },
        );
        continue;
      }
      extra.push({
        sheet: sheets[0].number,
        ...finding(
          "navigation-selected-appearance-missing",
          {},
          { source: id, view: order },
        ),
      });
    }
  }
}
function selectedNativeFunction(ir, selection) {
  const devices = (ir.devices ?? []).filter((d) =>
    selection.device?.by === "uid"
      ? d.uid === selection.device.value
      : d.designation === selection.device?.value,
  );
  if (devices.length !== 1)
    return { error: { candidateDeviceUids: devices.map((d) => d.uid) } };
  const id = { deviceUid: devices[0].uid, functionKey: selection.key },
    functions = (ir.functions ?? []).filter((f) => same(f.id, id));
  return functions.length === 1
    ? { id, native: functions[0] }
    : { error: { source: id, nativeFunctionCount: functions.length } };
}
function unresolvedSelection(packet, extra, kind, detail) {
  const first = packet.sheets[0];
  if (!first)
    throw Error("Cannot reconcile a selected function without an issued sheet");
  extra.push({
    sheet: first.number,
    ...finding(
      kind,
      {},
      {
        sheetLevel: true,
        scope: "packet",
        ...detail,
      },
    ),
  });
}

function navigationBlocks(g, annotations) {
  const groups = [
    ...groupBy(
      g.texts.filter(painted),
      (t) => t.navigationAnnotation ?? t.navigationContainer,
    ),
  ].map(([id, rows]) => {
    const exported = annotations.find(
      (a) =>
        a.id === id ||
        a.primitiveIds?.some((p) =>
          rows.some((t) => t.primitiveIds?.includes(p)),
        ),
    );
    const role = rows[0].navigationRole;
    const shapes = (g.shapes ?? []).filter(
      (s) =>
        s.navigationAnnotation === id &&
        (!s.navigationInkSegments || s.navigationInkSegments.length),
    );
    return {
      id,
      rows,
      exported,
      role,
      text: read(rows),
      element: rows[0].element,
      bbox: boxExtent([...rows, ...shapes]),
    };
  });
  // Wording and native row locators discover M2 even when an export is absent.
  const blocks = groups.filter(
    (b) =>
      ["mirror", "return", "association-unspecified"].includes(b.role) ||
      b.rows.some((t) => t.mirrorRow) ||
      /Contact associations unspecified|Actuating coil not specified/.test(
        b.text,
      ) ||
      (b.exported &&
        ["mirror", "return", "association-unspecified"].includes(
          b.exported.role,
        )),
  );
  return blocks;
}

function bindNavigationBlocks(
  blocks,
  occurrences,
  local,
  tag,
  matching,
  sheet,
  extra,
  emit,
  ir,
  g,
  coils,
) {
  for (const b of blocks) {
    const owner = occurrences.find((o) => o.id === b.exported?.ownerOccurrence);
    const isMirror =
      b.role === "mirror" ||
      b.rows.some((t) => t.mirrorRow) ||
      /Contact associations unspecified/.test(b.text) ||
      b.exported?.role === "mirror";
    let candidates = local.filter(
      (a) =>
        a.kind === (isMirror ? "coil" : "contact") &&
        (owner
          ? matching(owner, a)
          : b.text.startsWith(tag(a.uid) + " ") ||
            b.text === tag(a.uid) ||
            b.text.startsWith(tag(a.uid) + " (")),
    );
    if (candidates.length !== 1) {
      extra.push({
        sheet: sheet.number,
        ...finding("mirror-return-unresolved-owner", b),
      });
      continue;
    }
    const primary = candidates[0];
    if (
      !b.exported ||
      !owner ||
      !b.rows.every((t) => t.navigationAnnotation === b.exported.id)
    )
      emit(primary, "mirror-return-locator-mismatch", b);
    const owners = b.exported?.ownerOccurrences ?? [];
    if (
      b.exported &&
      (!owners.includes(b.exported.ownerOccurrence) ||
        new Set(owners).size !== owners.length)
    )
      emit(primary, "mirror-return-locator-mismatch", b, {
        reason: "primary owner missing or duplicated",
      });
    candidates = [primary];
    if (!isMirror && b.exported?.ownerOccurrences?.length > 1) {
      const members = b.exported.ownerOccurrences.map((id) =>
        occurrences.find((o) => o.id === id),
      );
      const resolved = members.map((o) =>
        local.find((a) => a.kind === "contact" && o && matching(o, a)),
      );
      const nativeGang = (ir.gangedGroups ?? []).find((gang) =>
        resolved.every(
          (a) => a && gang.functionIds.some((id) => same(id, source(a))),
        ),
      );
      const links = (g.shapes ?? []).filter(
        (s) =>
          s.mechanicalAssociation === "ganged" &&
          (s.navigationView == null || s.navigationView === primary.viewKey) &&
          (s.inkSegments?.length ||
            s.navigationInkSegments?.length ||
            s.stroke > 0),
      );
      const linked = links.flatMap((s) => parse(s.gangedFunctions) ?? []);
      const valid =
        nativeGang &&
        resolved.every(
          (a) =>
            a &&
            a.uid === primary.uid &&
            a.view === primary.view &&
            equal(
              coils(source(a)).map((c) => c.id),
              coils(source(primary)).map((c) => c.id),
            ) &&
            linked.some((id) => same(id, source(a))),
        );
      if (!valid || new Set(resolved).size !== resolved.length)
        emit(primary, "return-gang-membership", b);
      else candidates = resolved;
    }
    for (const a of candidates) a.blocks.push({ ...b, isMirror });
  }
}

function auditMirrorTable(
  a,
  needed,
  direct,
  unspecified,
  emit,
  destinations,
  tag,
  g,
) {
  const bs = a.blocks.filter((b) => b.isMirror);
  if ((needed && !bs.length) || (!needed && bs.length))
    emit(a, "mirror-block-count", bs[0] ?? a, {
      expected: needed ? "one complete table (possibly split)" : 0,
      actual: bs.length,
    });
  const actual = bs.flatMap((b) =>
    [
      ...groupBy(
        b.rows.filter((t) => t.mirrorRowScope || t.mirrorRow),
        (t) => t.mirrorRowScope ?? t.mirrorRow,
      ),
    ].map(([id, rows]) => ({
      id,
      rows,
      text: read(rows),
      element: rows[0].element,
      bbox: boxExtent(rows),
      source: parse(rows[0].mirrorRow),
    })),
  );
  if (actual.length !== direct.length)
    emit(a, "mirror-row-count", bs[0] ?? a, {
      expected: direct.length,
      actual: actual.length,
    });
  for (const f of direct) {
    const rows = actual.filter((r) => same(r.source, f.id));
    const expected = [
      f.normal_state === "open" ? "NO" : "NC",
      terminalSet(f.terminals.map((t) => t.terminalKey)),
      ...(destinations(f.id).length ? destinations(f.id) : ["not drawn"]),
    ].join(" ");
    if (rows.length !== 1 || compact(rows[0].text) !== compact(expected))
      emit(a, "mirror-row-facts", rows[0] ?? bs[0] ?? a, {
        contact: f.id,
        expected,
        actual: rows.map((r) => r.text),
      });
  }
  for (const r of actual)
    if (!direct.some((f) => same(f.id, r.source)))
      emit(a, "mirror-extra-row", r, { source: r.source });
  for (const b of bs) {
    const unspecifiedInk = /Contact associations unspecified/.test(b.text);
    if (unspecifiedInk !== unspecified)
      emit(a, "mirror-unspecified", b, { expected: unspecified });
    const heading = read(
      b.rows.filter(
        (t) => !t.mirrorRow && !/Contact associations unspecified/.test(t.text),
      ),
    ).trim();
    // Wrapped unspecified body is excluded using its exact measured lines.
    const headingRows = b.rows
      .filter((t) => !t.mirrorRow)
      .sort((x, y) => x.bbox.y - y.bbox.y);
    const head = headingRows[0]?.text ?? heading;
    const own = tag(a.uid),
      match = head.match(
        /^(.*?)\s*(?:\((\d+)\/(\d+)\))?\s*(?:\/(\d+)\.([A-Z]+\d+))?$/,
      );
    const located =
      !!match?.[4] &&
      match[1].trim() === own &&
      Number(match[4]) === a.sheet &&
      match[5] === a.zone;
    const identity = match?.[1].trim() === own;
    const distanceMm = anchorDistance(a.anchor, b.bbox),
      frames = nearestOwner(g, a, b.bbox);
    const corners = [
      { x: b.bbox.x, y: b.bbox.y },
      { x: b.bbox.x + b.bbox.w, y: b.bbox.y + b.bbox.h },
    ].map((p) => measuredZone(g, p));
    const adjacent =
      a.zone &&
      corners.every(Boolean) &&
      corners[0].charCodeAt(0) <= a.zone.charCodeAt(0) + 1 &&
      corners[1].charCodeAt(0) >= a.zone.charCodeAt(0) - 1 &&
      Number(corners[0].slice(1)) <= Number(a.zone.slice(1)) + 1 &&
      Number(corners[1].slice(1)) >= Number(a.zone.slice(1)) - 1;
    const localTable =
      distanceMm <= 60 + EPS + 1e-9 && adjacent && frames.ownerNearest;
    if (!identity || (!localTable && !located) || (match?.[4] && !located))
      emit(a, "mirror-locality", b, {
        distanceMm,
        adjacent,
        ...frames,
        expectedHeading: `${own} /${token(a)}`,
        actual: head,
      });
    a.measurements.push({
      bbox: b.bbox,
      anchor: a.anchor,
      zone: a.zone,
      distanceMm,
      adjacent,
      ...frames,
      selfLocated: located,
    });
  }
}

function auditReturnCaption(a, needed, direct, emit, destinations, tag) {
  const bs = a.blocks.filter((b) => !b.isMirror);
  if (bs.length !== (needed ? 1 : 0))
    emit(a, "return-caption-count", bs[0] ?? a, {
      expected: needed ? 1 : 0,
      actual: bs.length,
    });
  const expected = direct.length
    ? direct
        .map(
          (c) =>
            `${tag(c.id.deviceUid)} ${
              destinations(c.id).length
                ? destinations(c.id)
                    .map((d) => `/${d}`)
                    .join(", ")
                : "not drawn"
            }`,
        )
        .join("; ")
    : "Actuating coil not specified in device data";
  for (const b of bs) {
    if (compact(b.text) !== compact(expected))
      emit(a, "return-coil-set", b, { expected, actual: b.text });
    a.measurements.push({
      bbox: b.bbox,
      anchor: a.anchor,
      distanceMm: anchorDistance(a.anchor, b.bbox),
      assessment: "measured-no-threshold",
    });
  }
}
