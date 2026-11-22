// Independent future-client declaration fixture. Native needs are NEVER read to
// construct the declaration being checked. Geometry is synthetic, not print evidence.
import { createHash } from "node:crypto";
import { geometry4, text, addRow } from "./tranche4-fixtures.mjs";
import { viewBindings } from "./tranche4-views.mjs";
import { issuedRows } from "./m3-documents.mjs";
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const columns = [
  "Assembly / cable",
  "Specification / description",
  "End A / location",
  "End B / location",
  "Status / pin mapping",
];
const portFact = (deviceUid, portKey) => ({
  kind: "connector-port-status",
  deviceUid,
  portKey,
});
function rowFacts(ir, key) {
  const r = ir.relations.find((r) => r.uid === key && r.assembly);
  if (!r) {
    const [uid, port] = JSON.parse(key);
    return [portFact(uid, port)];
  }
  return [
    { kind: "assembly-pin-map", relationUid: r.uid },
    portFact(r.fromDeviceUid, r.assembly.fromPort),
    portFact(r.toDeviceUid, r.assembly.toPort),
  ];
}
function expectedContract(ir, relation) {
  const c = relation.assembly,
    own = [relation.fromDeviceUid, relation.toDeviceUid];
  const expected = [
    {
      need: "assembly-pin-map",
      noteId: "assembly-reasons",
      requiredFacts: [{ kind: "assembly-pin-map", relationUid: relation.uid }],
      rowKey: relation.uid,
      prefix: "Assembly inventory",
      columns: ["identity", "endpoints", "status", "pin-map"],
    },
  ];
  for (const uid of own) {
    const d = ir.devices.find((d) => d.uid === uid),
      type = ir.deviceTypes.find((t) => t.id === d.typeId);
    for (const key of Object.keys(type.connectorPorts)) {
      if (
        (uid === relation.fromDeviceUid && key === c.fromPort) ||
        (uid === relation.toDeviceUid && key === c.toPort)
      )
        continue;
      const incident = ir.relations.find(
        (r) =>
          r.assembly &&
          ((r.fromDeviceUid === uid && r.assembly.fromPort === key) ||
            (r.toDeviceUid === uid && r.assembly.toPort === key)),
      );
      expected.push({
        need: "connector-port-status",
        noteId: `connector-port-status/${JSON.stringify([uid, key])}`,
        requiredFacts: [portFact(uid, key)],
        rowKey: incident?.uid ?? JSON.stringify([uid, key]),
        prefix: `${d.designation}.${key} → connector port status: assembly inventory`,
        columns: ["identity", "endpoints", "status"],
      });
    }
  }
  return expected;
}
function sourceGeometry(request, ir, r) {
  const g = geometry4(),
    a = r.assembly;
  g.navigationViews = viewBindings(request, ir);
  g.devices = [{ deviceUid: r.fromDeviceUid }, { deviceUid: r.toDeviceUid }];
  const points = [
      { x: 30, y: 40 },
      { x: 50, y: 40 },
    ],
    ends = [
      { deviceUid: r.fromDeviceUid, portKey: a.fromPort },
      { deviceUid: r.toDeviceUid, portKey: a.toPort },
    ];
  g.tranche4.ports = ends.map((e, i) => ({
    kind: "assembly",
    ...e,
    key: e.portKey,
    point: points[i],
    radius: 1,
    texts: [text(e.portKey)],
  }));
  g.tranche4.assemblies = [
    { uid: r.uid, ends, ink: [[...points]], paths: [{ ends: points }] },
  ];
  return g;
}
function reportGeometry(table, keys, id) {
  const g = geometry4();
  for (const r of table.rows.filter((r) => keys.includes(r.key)))
    addRow(g, r.key, r.cells, id);
  for (const t of [...g.texts, ...g.reportCells])
    if (t.row) {
      t.documentId = id;
      t.documentOrigin = "auto";
      t.reportRowScope = t.row;
      t.primitiveIds = [`row/${t.row}`];
    }
  g.texts.push(
    text("assembly inventory"),
    ...columns.map((c, i) =>
      text(c, { documentId: id, columnIndex: i, columnName: c }),
    ),
  );
  return g;
}
function registry(packet, geometries, ir, expected, table, binding) {
  const id = "auto-document/1/c5",
    source = geometries[0],
    actual = issuedRows(packet, geometries);
  const rows = actual.map((r) => ({
    id: `${id}/row/${r.key}`,
    nativeKey: r.key,
    displayName:
      ir.relations.find((a) => a.uid === r.key)?.designation ??
      (() => {
        const [uid, key] = JSON.parse(r.key);
        return `${ir.devices.find((d) => d.uid === uid).designation} / ${key}`;
      })(),
    facts: rowFacts(ir, r.key),
    columns: r.key.startsWith("[")
      ? ["identity", "endpoints", "status"]
      : ["identity", "endpoints", "status", "pin-map"],
    sheet: 2,
    zone: r.zone,
    anchorMm: r.anchor,
    rectMm: r.region,
    anchorRule: "row-region-center/1",
    primitiveId: `row/${r.key}`,
  }));
  const deps = expected.map((e, i) => {
    const row = rows.find((r) => r.nativeKey === e.rowKey),
      caption = `${e.prefix} 02.${row.zone} (${row.displayName}).`;
    const primitiveId = `caption/${i}`;
    source.texts.push(
      text(caption, { element: primitiveId, primitiveIds: [primitiveId] }),
    );
    return {
      id: `dependency/1/${digest([source.navigationViews[0], e.noteId])}`,
      need: e.need,
      ...binding,
      owner: { sheet: 1, noteId: e.noteId, viewKey: source.navigationViews[0] },
      requiredFacts: e.requiredFacts,
      requiredColumns: e.columns,
      resolution: [{ documentId: id, rows: [row.id] }],
      caption: { text: caption, primitiveId, form: "identities" },
    };
  });
  const ids = deps.map((d) => d.id);
  packet.navigation = {
    documentFormat: "issued-documents/1",
    documents: [
      {
        id,
        kind: "assemblies",
        label: "assembly inventory",
        ...binding,
        autoOrigin: { dependencyIds: ids },
        rows,
      },
    ],
    dependencies: deps,
    autoDocuments: [{ documentId: id, dependencyIds: ids, sheets: [2] }],
  };
  return [
    { ...table, kind: "assemblies", documentId: id, origin: "auto", columns },
  ];
}
export function contractCandidate(ir, view, relation, table) {
  const request = { views: [view] },
    expected = expectedContract(ir, relation),
    source = sourceGeometry(request, ir, relation),
    report = reportGeometry(
      table,
      [...new Set(expected.map((e) => e.rowKey))],
      "auto-document/1/c5",
    );
  const packet = {
    sheets: [
      { number: 1, view: { kind: "connector-assembly" } },
      { number: 2, view: { kind: "assemblies" } },
    ],
  };
  const geometries = [source, report],
    binding = {
      snapshotDigest: digest(ir),
      presentationDigest: "synthetic-contract-geometry",
      revision: "UNSPECIFIED",
    };
  const tables = registry(packet, geometries, ir, expected, table, binding);
  return { ir, request, packet, geometries, binding, tables, expected };
}
export function inlineCandidate(x) {
  const [source, report] = x.geometries;
  source.texts.push(
    ...report.texts
      .filter((t) => !t.sheetText)
      .map((t) => ({ ...t, documentKind: "assemblies" })),
  );
  source.reportCells = report.reportCells.map((c) => ({
    ...c,
    documentKind: "assemblies",
  }));
  for (const d of x.packet.navigation.dependencies) {
    d.caption.text = d.caption.text.replaceAll("02.", "01.");
    source.texts.find((t) =>
      t.primitiveIds?.includes(d.caption.primitiveId),
    ).text = d.caption.text;
  }
  for (const d of x.packet.navigation.documents)
    for (const r of d.rows) r.sheet = 1;
  for (const d of x.packet.navigation.autoDocuments) d.sheets = [1];
  x.packet.sheets = x.packet.sheets.slice(0, 1);
  x.geometries = [source];
  return x;
}
