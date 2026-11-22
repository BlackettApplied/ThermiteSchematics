import { IdentifierMeasurementError } from "./identifier-errors.mjs";
import { packetNativeNeeds } from "./m3-needs-context.mjs";
import { sufficient } from "./document-dependencies.mjs";
import { rowZones } from "./m3-zones.mjs";
import { painted, groupBy, extent } from "./review-geometry.mjs";
import { quantize, measuredZone } from "./repeat-appearances.mjs";
import { compact, factKey, nativeRows } from "./m3-native.mjs";
export const rowMatchesFact = (r, f) =>
  r.facts.some((x) => factKey(x) === factKey(f));
export function rowRegion(cells) {
  if (!cells.length) return null;
  return extent(
    cells.flatMap(({ bbox: b }) => [b, { x: b.x + b.w, y: b.y + b.h }]),
  );
}
function rowKind(sheet, texts, cells) {
  const parts = [...texts, ...cells];
  if (parts.every((p) => p.documentKind === undefined)) return sheet.view.kind;
  const kinds = new Set(parts.map((p) => p.documentKind));
  return kinds.size === 1 &&
    typeof texts[0].documentKind === "string" &&
    texts[0].documentKind.trim()
    ? texts[0].documentKind
    : "unresolved-document-kind";
}
export function issuedRows(packet, geometries) {
  return packet.sheets.flatMap((sheet, index) => {
    const g = geometries[index];
    return [
      ...groupBy(
        (g?.texts ?? []).filter((t) => t.row),
        (t) => JSON.stringify([t.documentId, t.row, t.reportRowScope]),
      ),
    ].map(([, texts]) => {
      const t = texts[0],
        cells = (g.reportCells ?? []).filter(
          (c) =>
            c.row === t.row &&
            c.documentId === t.documentId &&
            c.reportRowScope === t.reportRowScope,
        );
      const visible =
        cells.length > 0 &&
        cells.every((c) => c.regionVisible !== false) &&
        texts.every(
          (x) =>
            !String(x.text ?? "").trim() ||
            (painted(x) && (x.fontSize ?? 3.5) >= 2.5),
        );
      const region = rowRegion(cells),
        anchor = region && {
          x: quantize(region.x + region.w / 2),
          y: quantize(region.y + region.h / 2),
        };
      return {
        kind: rowKind(sheet, texts, cells),
        key: t.row,
        documentId: t.documentId,
        auto: t.documentOrigin === "auto",
        sheet: sheet.number,
        texts,
        visible,
        region,
        anchor,
        zone: anchor && measuredZone(g, anchor),
        zones: rowZones(g, region),
        primitiveIds: [...new Set(texts.flatMap((x) => x.primitiveIds ?? []))],
        cells: !visible
          ? {}
          : Object.fromEntries(
              [...groupBy(texts, (x) => x.columnIndex)].map(([col, ts]) => [
                col,
                ts
                  .sort(
                    (a, b) =>
                      (a.anchor?.y ?? a.bbox.y) - (b.anchor?.y ?? b.bbox.y) ||
                      a.bbox.x - b.bbox.x,
                  )
                  .map((x) => x.text)
                  .join(" "),
              ]),
            ),
        columnNames: [
          ...groupBy(
            (g.texts ?? []).filter((x) => !x.row && x.columnName && painted(x)),
            (x) => x.columnIndex,
          ),
        ]
          .sort(([a], [b]) => a - b)
          .map(([, ts]) => ts.map((x) => x.text).join(" ")),
      };
    });
  });
}
export function buildSourceTables(ir, request, buildDocumentation) {
  const tables = (request.views ?? []).flatMap((v, authoredOrder) =>
    v.format === "documentation-view-request/0.1"
      ? [{ ...buildDocumentation(ir, v), authoredOrder, origin: "requested" }]
      : [],
  );
  // Full native row universes are for identifier projection only. Auto scope is
  // reconstructed below from unresolved needs, never from exported row facts.
  tables.universe = ["wires", "terminals", "network", "assemblies"].map(
    (kind) =>
      buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind,
        ...(kind === "terminals" && ir.devices.length
          ? { filter: { devices: ir.devices.map((d) => d.uid) } }
          : {}),
      }),
  );
  return tables;
}
export function scopeTables(packet, geometries, ir, tables, request) {
  if (!tables.universe) return tables;
  const rows = issuedRows(packet, geometries),
    catalog = nativeRows(ir),
    result = [];
  for (const kind of [...new Set(tables.map((t) => t.kind))]) {
    const docs = [
      ...new Set(
        packet.sheets.flatMap((s, i) =>
          s.view.kind === kind
            ? (geometries[i].texts ?? [])
                .filter(
                  (t) =>
                    t.documentId &&
                    t.documentOrigin !== "auto" &&
                    !rows.some((r) => r.documentId === t.documentId && r.auto),
                )
                .map((t) => t.documentId)
            : [],
        ),
      ),
    ];
    const requested = tables.filter((t) => t.kind === kind);
    for (const table of requested) {
      // Registry identity locates a document; its header and every source row
      // are still checked against ink. Never infer identity from page order.
      const matches = (packet.navigation?.documents ?? []).filter(
        (d) =>
          d.kind === kind &&
          !d.autoOrigin &&
          d.authoredOrder === table.authoredOrder &&
          docs.includes(d.id),
      );
      const documentId =
        matches.length === 1
          ? matches[0].id
          : requested.length === 1 && docs.length === 1
            ? docs[0]
            : undefined;
      result.push({ ...table, documentId });
    }
  }
  const needs = packetNativeNeeds(packet, geometries, ir, catalog, request);
  for (const universe of tables.universe) {
    const requested = result.filter((t) => t.kind === universe.kind),
      missing = catalog.filter(
        (r) =>
          r.kind === universe.kind &&
          needs.some((n) => n.facts.some((f) => rowMatchesFact(r, f))) &&
          !requestedSupplies(r, requested, rows),
      ),
      ids = [
        ...new Set(
          rows
            .filter((r) => r.kind === universe.kind && r.auto)
            .map((r) => r.documentId),
        ),
      ];
    for (const id of ids)
      result.push({
        ...universe,
        origin: "auto",
        documentId: id,
        // Multiple companions form one inventory. Check the complete union,
        // including missing and duplicate rows, independently of their order.
        inventoryDocumentIds: ids,
        rows: universe.rows.filter((r) => missing.some((x) => x.key === r.key)),
      });
  }
  result.universe = tables.universe;
  return result;
}
export function tableForSheet(sheet, g, tables) {
  const ids = [
    ...new Set((g.texts ?? []).map((t) => t.documentId).filter(Boolean)),
  ];
  const rows = issuedRows({ sheets: [sheet] }, [g]);
  const candidates = tables.filter((t) => {
    const own = rows.filter((r) => r.documentId === t.documentId);
    return own.length
      ? own.every((r) => r.kind === t.kind)
      : t.kind === sheet.view.kind;
  });
  const bound = candidates.filter(
    (t) => t.documentId && ids.includes(t.documentId),
  );
  if (bound.length > 1)
    throw new IdentifierMeasurementError(
      "Identifier measurement: ambiguous document table on sheet " +
        sheet.number,
    );
  return (
    bound[0] ?? candidates.find((t) => !t.documentId && t.origin !== "auto")
  );
}
export function documentInventory(table, packet, geometries) {
  const actual = issuedRows(packet, geometries)
      .filter(
        (r) =>
          r.kind === table.kind &&
          (table.inventoryDocumentIds
            ? table.inventoryDocumentIds.includes(r.documentId)
            : table.documentId
              ? r.documentId === table.documentId
              : !r.auto),
      )
      .map((r) => r.key),
    expected = table.rows.map((r) => r.key),
    counts = (xs, k) => xs.filter((x) => x === k).length;
  const differences = [...new Set([...expected, ...actual])]
    .sort()
    .filter((k) => counts(expected, k) !== counts(actual, k))
    .map((key) => ({
      key,
      expected: counts(expected, key),
      actual: counts(actual, key),
    }));
  return differences.length
    ? [
        {
          kind: "report-row-inventory-mismatch",
          element: "report-table",
          designation: table.kind,
          sheetLevel: true,
          expectedRows: expected.length,
          actualRows: actual.length,
          differences,
          origin: table.origin,
        },
      ]
    : [];
}
export function printedHeader(row, tables) {
  const table = tables?.find(
    (t) => t.documentId === row.documentId && t.kind === row.kind,
  );
  return (
    !!table &&
    table.columns.every((c) =>
      row.columnNames.some((n) => compact(c) === compact(n)),
    )
  );
}

export function requestedTerminalPlan(sheet, g, tables) {
  return (
    sheet.view.kind === "terminals" &&
    tableForSheet(sheet, g, tables)?.origin !== "auto"
  );
}

export function requestedSupplies(native, tables, rows) {
  return tables.some(
    (t) =>
      t.kind === native.kind &&
      t.rows.some((r) => r.key === native.key) &&
      rows.some(
        (r) =>
          r.key === native.key &&
          r.kind === native.kind &&
          r.documentId === t.documentId &&
          !r.auto &&
          sufficient(r, native) &&
          printedHeader(r, [t]),
      ),
  );
}
