import {
  captionForms,
  pointerMatches,
  ownerFor,
  checkConnectorSubject,
} from "./m3-caption-kinds.mjs";
import { registryFindings } from "./m3-registry.mjs";
import { finding, groupBy } from "./review-geometry.mjs";
import {
  M3_FORMAT,
  sha,
  factKey,
  factKeys,
  compact,
  semanticColumns,
  nativeRows,
  nativeNeeds,
  nativeRequestForSheet,
  nativeProducerKind,
} from "./m3-native.mjs";
import { issuedRows, rowMatchesFact, printedHeader } from "./m3-documents.mjs";
import {
  sufficient,
  logicalPointerNotes,
  legacyDependencyFindings,
} from "./document-dependencies.mjs";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setEqual = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  equal(a.slice().sort(), b.slice().sort());
const located = (t, id) => id && (t.primitiveIds ?? []).includes(id);
const bindingsMatch = (record, binding) =>
  binding &&
  ["snapshotDigest", "presentationDigest", "revision"].every(
    (k) => record[k] === binding[k],
  );
const loc = (r) => `${String(r.sheet).padStart(2, "0")}.${r.zone}`;
function completeCaption(groups, note, need, ir, compactForm) {
  const failures = [],
    text = note.text;
  const compactTokens = new Map();
  for (const group of groups) {
    const location = loc(group.rows[0]);
    const region = text.matchAll(
      /(?:^|[;:]\s*|inventory\s+)(\d+\.[A-Z]+\d+)\s*\(([^)]*)\)/gu,
    );
    const entries = [...region].filter(
      (m) =>
        compact(m[1].replace(/^0+(?=\d)/u, "")) ===
        compact(location.replace(/^0+(?=\d)/u, "")),
    );
    const contents = entries.map((m) => m[2]).join(", ");
    if (!entries.length)
      failures.push({
        kind: "printed-document-target-location-missing",
        location,
      });
    if (compactForm) {
      const count = group.facts.length,
        owner = group.owner,
        name =
          owner.kind === "device"
            ? ir.devices.find((d) => d.uid === owner.uid)?.designation
            : ir.cables.find((c) => c.uid === owner.uid)?.designation;
      const unit = captionForms[need][count === 1 ? 0 : 1];
      const key = location.replace(/^0+(?=\d)/u, "");
      if (!compactTokens.has(key)) compactTokens.set(key, []);
      compactTokens.get(key).push(`${name}: ${count} ${unit}`);
      if (!contents.includes(`${name}: ${count} ${unit}`))
        failures.push({
          kind: "document-caption-compact-count-mismatch",
          owner,
          count,
          unit,
          location,
          actual: contents,
        });
    } else {
      for (const row of group.rows)
        if (!compact(contents).includes(compact(row.native.name)))
          failures.push({
            kind: "document-caption-row-identity-mismatch",
            row: row.key,
            expected: row.native.name,
            location,
            actual: contents,
          });
    }
  }
  if (compactForm)
    for (const match of text.matchAll(/(\d+\.[A-Z]+\d+)\s*\(([^)]*)\)/gu)) {
      let remainder = compact(match[2]);
      const tokens =
        compactTokens.get(match[1].replace(/^0+(?=\d)/u, "")) ?? [];
      for (const token of tokens.slice().sort((a, b) => b.length - a.length))
        remainder = remainder.replace(compact(token), "");
      if (remainder.replace(/[,;\s]/gu, ""))
        failures.push({
          kind: "document-caption-extra-native-identity",
          location: match[1],
          actual: match[2],
        });
    }
  if (!compactForm) {
    for (const match of text.matchAll(/(\d+\.[A-Z]+\d+)\s*\(([^)]*)\)/gu)) {
      const here = groups.filter(
        (g) =>
          loc(g.rows[0]).replace(/^0+(?=\d)/u, "") ===
          match[1].replace(/^0+(?=\d)/u, ""),
      );
      const names = [
        ...new Set(here.flatMap((g) => g.rows.map((r) => r.native.name))),
      ].sort((a, b) => b.length - a.length);
      let remainder = compact(match[2]);
      for (const name of names)
        remainder = remainder.replace(compact(name), "");
      // Incidence captions also name their source terminal before the rows.
      if (need === "conductor-incidence")
        for (const g of here)
          for (const f of g.facts) {
            const d = ir.devices.find((d) => d.uid === f.terminal?.deviceUid);
            remainder = remainder.replace(
              compact(`${d?.designation}.${f.terminal?.terminalKey}`),
              "",
            );
          }
      if (remainder.replace(/[,;\s]/gu, ""))
        failures.push({
          kind: "document-caption-extra-native-identity",
          location: match[1],
          actual: match[2],
        });
    }
  }
  const expected = new Set(
    groups.map((g) => loc(g.rows[0]).replace(/^0+(?=\d)/u, "")),
  );
  for (const match of text.matchAll(/\b(\d+\.[A-Z]+\d+)\b/gu))
    if (!expected.has(match[1].replace(/^0+(?=\d)/u, "")))
      failures.push({
        kind: "document-caption-extra-location",
        actual: match[1],
      });
  return failures;
}
function partition(rows, facts, ir) {
  const placed = new Set(),
    entries = [];
  for (const row of rows)
    for (const f of facts) {
      const k = factKey(f);
      if (placed.has(k) || !rowMatchesFact(row.native, f)) continue;
      placed.add(k);
      entries.push({ row, fact: f, owner: ownerFor(f, row, ir) });
    }
  return [
    ...groupBy(entries, (e) =>
      JSON.stringify([e.row.documentId, e.row.sheet, e.row.zone, e.owner]),
    ),
  ].map(([, es]) => ({
    owner: es[0].owner,
    rows: [...new Set(es.map((e) => e.row))],
    facts: es.map((e) => e.fact),
  }));
}
function legacyCoverage(sheet, packet, g, geometries, ir, request, notes) {
  // Legacy generic promises remain subject to their existing native circuit
  // completeness check. Honest standalone generic partial warnings promise none.
  if (notes.some((t) => /see circuit views or packet coverage/i.test(t.text))) {
    const old = legacyDependencyFindings(
      sheet,
      { ...packet, navigation: undefined },
      g,
      geometries,
      ir,
      request,
    );
    return old.findings.filter((f) => f.need === "coverage");
  }
  return [];
}
export function m3Delivery(
  sheet,
  packet,
  g,
  geometries,
  ir,
  request,
  context = {},
) {
  const scopedRequest = nativeRequestForSheet(
    packet,
    geometries,
    request,
    sheet,
  );
  const catalog = nativeRows(ir),
    needs = nativeNeeds(sheet, g, ir, catalog, scopedRequest, {
      packet,
      geometries,
      request,
    }),
    rows = issuedRows(packet, geometries),
    notes = logicalPointerNotes(g.texts ?? []).map((t) => ({
      ...t,
      // Provenance flags can locate a row, but only authored source content
      // excludes it from generated dependency captions.
      nativeRequestNote: (scopedRequest?.views?.length === 1
        ? (scopedRequest.views[0].notes ?? [])
        : (scopedRequest?.notes ?? [])
      ).some((n) => compact(n) === compact(t.text)),
    })),
    nav = packet.navigation,
    versioned = nav?.documentFormat === M3_FORMAT,
    exports = nav?.dependencies ?? [],
    findings = [],
    targetFindings = [],
    used = new Set(),
    measurements = [];
  findings.push(
    ...legacyCoverage(sheet, packet, g, geometries, ir, request, notes),
  );
  if (nav?.documentFormat && !versioned)
    findings.push(
      finding(
        "document-export-version-unsupported",
        {},
        { actual: nav.documentFormat, expected: M3_FORMAT },
      ),
    );
  if (!versioned && needs.length)
    findings.push(
      finding(
        "document-export-measurement-gap",
        {},
        { expectedFormat: M3_FORMAT, nativeNeeds: needs.map((n) => n.noteId) },
      ),
    );
  if (versioned && scopedRequest.m3ViewScopeGap && needs.length)
    findings.push(
      finding(
        "document-native-view-scope-unresolved",
        {},
        scopedRequest.m3ViewScopeGap,
      ),
    );
  const producer = nativeProducerKind(scopedRequest, sheet);
  if (
    versioned &&
    scopedRequest.m3AuthoredViewIndex !== undefined &&
    ["wiring", "communication", "signal-loop", "connector-assembly"].includes(
      producer,
    ) &&
    sheet.view.kind !== producer
  )
    findings.push(
      finding(
        "document-source-view-kind-mismatch",
        {},
        { expected: producer, actual: sheet.view.kind },
      ),
    );
  if (versioned && sheet.number === packet.sheets[0]?.number)
    findings.push(
      ...registryFindings(packet, geometries, ir, catalog, rows, {
        ...context,
        request,
      }),
    );
  for (const need of needs)
    measureNativeNeed(need, {
      exports,
      sheet,
      notes,
      used,
      g,
      findings,
      versioned,
      context,
      rows,
      catalog,
      nav,
      ir,
      targetFindings,
      measurements,
    });
  for (const record of exports.filter((d) => d.owner?.sheet === sheet.number))
    if (
      !needs.some(
        (n) => n.noteId === record.owner.noteId && n.need === record.need,
      )
    )
      findings.push(
        finding(
          "document-dependency-without-native-need",
          {},
          { dependency: record.id, need: record.need },
        ),
      );
  for (const note of notes.filter(
    (t) =>
      !used.has(t.element) &&
      !t.row &&
      !t.nativeRequestNote &&
      /(?:wire|terminal|network|assembly) inventory\s+\d+\.[A-Z]+\d+/u.test(
        t.text,
      ),
  ))
    findings.push(
      finding("document-visible-caption-without-native-need", note),
    );
  return {
    findings,
    targetFindings,
    measurement: {
      adapter: M3_FORMAT,
      printedDependencies: needs.length,
      requiredFacts: needs.reduce((n, d) => n + d.facts.length, 0),
      issuedVisibleRows: rows.filter((r) => r.visible).length,
      inventory: versioned
        ? "three-set-reconciled"
        : "legacy-native-reconstruction",
      obligations: measurements,
    },
  };
}
const rowMatchesAny = (row, facts) =>
  row && facts.some((f) => rowMatchesFact(row, f));
const samePoint = (a, b) =>
  a && b && Math.abs(a.x - b.x) <= 0.011 && Math.abs(a.y - b.y) <= 0.011;
const sameBox = (a, b) =>
  a && b && ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) <= 0.011);

function locateNeedCaption(
  need,
  exports,
  sheet,
  notes,
  used,
  g,
  findings,
  versioned,
  context,
) {
  const records = exports.filter(
      (d) =>
        d.owner?.sheet === sheet.number &&
        d.owner?.noteId === need.noteId &&
        d.need === need.need,
    ),
    record = records.length === 1 ? records[0] : null;
  let matches = record
    ? notes.filter((t) => located(t, record.caption?.primitiveId))
    : [];
  const captionLocatorCount = matches.length;
  if (!matches.length)
    matches = notes.filter(
      (t) => !used.has(t.element) && pointerMatches(need, t),
    );
  const note = matches[0] ?? { element: "sheet", text: "", sheetLevel: true };
  used.add(note.element);
  const fail = (kind, evidence = {}) =>
    findings.push(
      finding(kind, note, {
        need: need.need,
        noteId: need.noteId,
        ...evidence,
      }),
    );
  if (
    record &&
    (captionLocatorCount !== 1 ||
      !(g.navigationViews ?? []).includes(record.owner?.viewKey))
  )
    fail("document-caption-locator-mismatch");
  if (!matches.length) fail("document-native-need-without-visible-caption");
  if (record && !pointerMatches(need, note))
    fail("document-caption-native-scope-mismatch");
  if (need.scopeMismatch?.length)
    fail("document-source-view-scope-mismatch", {
      foreignDeviceUids: need.scopeMismatch,
    });
  const nativeCount =
    need.need === "conductor-incidence"
      ? note.text.match(/\[\+(\d+)\]/u)
      : need.need === "terminal-inventory"
        ? note.text.match(/\b(\d+) other terminals?\b/u)
        : null;
  if (nativeCount && Number(nativeCount[1]) !== need.facts.length)
    fail("document-caption-native-count-mismatch", {
      expected: need.facts.length,
      actual: Number(nativeCount[1]),
    });
  if (versioned) {
    const columns = semanticColumns[need.need];
    if (
      records.length !== 1 ||
      !bindingsMatch(record, context.binding) ||
      !setEqual(factKeys(record.requiredFacts ?? []), factKeys(need.facts)) ||
      !setEqual(record.requiredColumns, columns) ||
      record.id !==
        `dependency/1/${sha([record.owner?.viewKey, need.noteId])}` ||
      ((["conductor-incidence", "terminal-inventory"].includes(need.need) ||
        record.count !== undefined) &&
        record.count !== need.facts.length) ||
      compact(record.caption?.text) !== compact(note.text)
    )
      fail("document-dependency-inventory-mismatch", {
        expectedFacts: need.facts,
        actual: record,
      });
  }
  return { record, matches, note, fail };
}

function resolveDeliveredRows(
  need,
  rows,
  catalog,
  context,
  versioned,
  record,
  nav,
  fail,
) {
  const candidates = rows
    .map((r) => ({
      ...r,
      native: catalog.find((n) => n.kind === r.kind && n.key === r.key),
    }))
    .filter(
      (r) =>
        r.native && sufficient(r, r.native) && printedHeader(r, context.tables),
    );
  let delivered = candidates;
  if (versioned) {
    delivered = [];
    for (const resolution of record?.resolution ?? []) {
      const doc = nav.documents?.find((d) => d.id === resolution.documentId);
      if (!doc || !bindingsMatch(doc, context.binding)) {
        fail("document-resolution-source-mismatch", {
          documentId: resolution.documentId,
        });
        continue;
      }
      for (const id of resolution.rows ?? []) {
        const row = doc.rows?.find((r) => r.id === id),
          actual =
            row &&
            candidates.filter(
              (r) =>
                r.documentId === doc.id &&
                r.key === row.nativeKey &&
                r.sheet === row.sheet &&
                r.primitiveIds.includes(row.primitiveId),
            );
        if (
          !row ||
          actual.length !== 1 ||
          !rowMatchesAny(actual[0]?.native, need.facts)
        ) {
          fail("document-resolution-row-mismatch", {
            documentId: doc.id,
            rowId: id,
          });
          continue;
        }
        const visible = actual[0];
        if (
          !setEqual(
            factKeys(row.facts ?? []),
            factKeys(visible.native.facts),
          ) ||
          row.anchorRule !== "row-region-center/1" ||
          !samePoint(row.anchorMm, visible.anchor) ||
          !sameBox(row.rectMm, visible.region) ||
          !visible.zones.includes(row.zone) ||
          row.displayName !== visible.native.name
        )
          fail("document-row-locator-mismatch", {
            rowId: id,
            measured: {
              anchor: visible.anchor,
              region: visible.region,
              zone: visible.zone,
            },
            claimed: row,
          });
        delivered.push({ ...visible, exportedRow: row });
      }
    }
  }
  return delivered;
}

function selectCaptionRows(need, delivered, note, record, fail) {
  const missing = need.facts.filter(
    (f) => !delivered.some((r) => rowMatchesFact(r.native, f)),
  );
  if (missing.length)
    fail("printed-document-target-insufficient", {
      requiredFacts: need.facts.length,
      missingFacts: missing,
      reason: "missing-or-insufficient-visible-issued-rows",
    });
  const captions = [
    ...note.text.matchAll(/(\d+)\.([A-Z]+\d+)\s*\(([^)]*)\)/gu),
  ];
  const countInk =
    /:\s*\d+\s+(?:physical connections?|ports?|terminals?|cores?|assembl(?:y|ies))\b/u.test(
      note.text,
    );
  const scoped = delivered.filter((r) => rowMatchesAny(r.native, need.facts));
  const identityInk =
    scoped.length &&
    scoped.every((r) =>
      captions.some(
        (m) =>
          Number(m[1]) === r.sheet &&
          r.zones.includes(m[2]) &&
          compact(m[3]).includes(compact(r.native.name)),
      ),
    );
  // Native markings can themselves read "1 port". A locator may disambiguate
  // two valid readings, but native rows/counts still have to verify that reading.
  const compactForm =
    countInk && (!identityInk || record?.caption?.form === "compact");
  if (
    record &&
    record.caption?.form !== (compactForm ? "compact" : "identities")
  )
    fail("document-caption-form-mismatch");
  const selected = delivered
    .filter((r) => rowMatchesAny(r.native, need.facts))
    .map((r) => {
      // Export groups are locators only: admit their location solely after the
      // row region and actual printed token independently verify it.
      const group =
        compactForm &&
        record?.caption?.groups?.find(
          (x) =>
            x.documentId === r.documentId &&
            x.rows?.includes(r.exportedRow?.id) &&
            x.sheet === r.sheet &&
            r.zones.includes(x.zone),
        );
      const printed = captions.find(
        (m) =>
          Number(m[1]) === r.sheet &&
          r.zones.includes(m[2]) &&
          (compactForm
            ? group?.zone === m[2]
            : compact(m[3]).includes(compact(r.native.name))),
      );
      return { ...r, zone: printed?.[2] ?? r.zone };
    });
  return { missing, compactForm, selected };
}

function measureNativeNeed(
  need,
  {
    exports,
    sheet,
    notes,
    used,
    g,
    findings,
    versioned,
    context,
    rows,
    catalog,
    nav,
    ir,
    targetFindings,
    measurements,
  },
) {
  const { record, matches, note, fail } = locateNeedCaption(
    need,
    exports,
    sheet,
    notes,
    used,
    g,
    findings,
    versioned,
    context,
  );
  if (need.sourceGap)
    fail("document-native-assembly-source-unavailable", {
      reason: need.sourceGap,
    });
  checkConnectorSubject(need, note, ir, fail);
  const delivered = resolveDeliveredRows(
    need,
    rows,
    catalog,
    context,
    versioned,
    record,
    nav,
    fail,
  );
  const { missing, compactForm, selected } = selectCaptionRows(
    need,
    delivered,
    note,
    record,
    fail,
  );
  const groups = partition(selected, need.facts, ir);
  if (!missing.length && need.facts.length && matches.length) {
    const captionFailures = completeCaption(
      groups,
      note,
      need.need,
      ir,
      compactForm,
    );
    for (const f of captionFailures) {
      const result = finding(f.kind, note, { need: need.need, ...f });
      if (/location/.test(f.kind)) targetFindings.push(result);
      else findings.push(result);
    }
    if (compactForm && record) {
      const actual = record.caption?.groups ?? [];
      const expected = groups.map((x) => ({
        documentId: x.rows[0].documentId,
        rows: x.rows.map((r) => r.exportedRow?.id).sort(),
        sheet: x.rows[0].sheet,
        zone: x.rows[0].zone,
        owner: x.owner,
        count: x.facts.length,
        unit: captionForms[need.need][1],
        factKeys: factKeys(x.facts),
      }));
      if (
        record.caption.form !== "compact" ||
        !equal(
          actual.map((x) => ({
            documentId: x.documentId,
            rows: x.rows?.slice().sort(),
            sheet: x.sheet,
            zone: x.zone,
            owner: x.owner,
            count: x.count,
            unit: x.unit,
            factKeys: x.factKeys?.slice().sort(),
          })),
          expected,
        )
      )
        fail("document-caption-partition-mismatch", { expected, actual });
    }
  }
  if (need.need === "port-link-status")
    for (const f of need.facts) {
      const name = ir.devices.find((d) => d.uid === f.deviceUid)?.designation;
      if (note.text.includes(`${name}.${f.portKey}`))
        fail("document-caption-dotted-port-selector", {
          deviceUid: f.deviceUid,
          portKey: f.portKey,
        });
    }
  measurements.push({
    noteId: need.noteId,
    need: need.need,
    requiredFacts: need.facts.length,
    deliveredFacts: need.facts.length - missing.length,
    rows: selected.map((r) => ({
      documentId: r.documentId,
      key: r.key,
      sheet: r.sheet,
      zone: r.zone,
      anchor: r.anchor,
    })),
    compact: compactForm,
  });
}
