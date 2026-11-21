import { createHash } from "node:crypto";
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const clone = (x) => structuredClone(x);
export const point = (x, y) => ({ x, y });
export const ink = (text, extra = {}) => ({
  text,
  element: `text-${text}`,
  painted: true,
  reviewPainted: true,
  fontSize: 3.5,
  bbox: { x: 30, y: 40, w: 20, h: 3 },
  anchor: point(30, 43),
  ...extra,
});
function grid() {
  return [
    ...Array.from({ length: 6 }, (_, i) =>
      ink(`${i + 1}`, {
        sheetText: true,
        bbox: { x: 30 + i * 30, y: 10, w: 1, h: 2 },
        anchor: point(30 + i * 30, 12),
      }),
    ),
    ...Array.from("ABCD", (text, i) =>
      ink(text, {
        sheetText: true,
        bbox: { x: 10, y: 40 + i * 40, w: 2, h: 3 },
        anchor: point(10, 42 + i * 40),
      }),
    ),
  ];
}
export const binding = {
  snapshotDigest: "native-snapshot",
  presentationDigest: "native-presentation",
  revision: "UNSPECIFIED",
};
export function fixture() {
  const ir = {
    devices: [{ uid: "a", designation: "A", typeId: "t" }],
    deviceTypes: [
      { id: "t", ports: { P: { kind: "communication", medium: "ethernet" } } },
    ],
    relations: [],
    terminals: [],
    wires: [],
    jumpers: [],
    cables: [],
    cableConductors: [],
    cableTypes: [],
  };
  const fact = { kind: "port-link-status", deviceUid: "a", portKey: "P" },
    key = '["a","P"]',
    viewKey = "native-view",
    noteId = `communication-status/${hash([["a"], []])}`,
    id = `dependency/1/${hash([viewKey, noteId])}`,
    docId = "auto-document/1/native",
    rowId = `${docId}/row/native`,
    primitiveId = "row-ink";
  const columns = [
    "Link",
    "Protocol / medium",
    "End A / location",
    "End B / location",
    "Status",
  ];
  const caption =
    "Port protocol, status and unconnected ports: network inventory 02.A3 (A: P).";
  const row = {
    id: rowId,
    nativeKey: key,
    displayName: "A: P",
    facts: [fact],
    columns: ["identity", "endpoints", "protocol", "status"],
    sheet: 2,
    zone: "A3",
    anchorMm: point(90, 45),
    rectMm: { x: 25, y: 40, w: 130, h: 10 },
    anchorRule: "row-region-center/1",
    primitiveId,
  };
  const doc = {
    id: docId,
    kind: "network",
    label: "network inventory",
    ...binding,
    autoOrigin: { dependencyIds: [id] },
    rows: [row],
  };
  const dep = {
    id,
    need: "port-link-status",
    ...binding,
    owner: { sheet: 1, noteId, viewKey },
    requiredFacts: [fact],
    requiredColumns: ["identity", "endpoints", "protocol", "status"],
    resolution: [{ documentId: docId, rows: [rowId] }],
    caption: { text: caption, primitiveId: "caption-ink", form: "identities" },
  };
  const packet = {
    navigation: {
      format: "issued-navigation/0.1",
      documentFormat: "issued-documents/1",
      documents: [doc],
      dependencies: [dep],
      autoDocuments: [{ documentId: docId, dependencyIds: [id], sheets: [2] }],
    },
    sheets: [
      { number: 1, view: { kind: "communication" } },
      { number: 2, view: { kind: "network", title: "network inventory" } },
    ],
  };
  const source = {
    navigationViews: ["native-view"],
    devices: [{ deviceUid: "a" }],
    terminals: [],
    shapes: [],
    texts: [ink(caption, { primitiveIds: ["caption-ink"], dependencyId: id })],
  };
  const report = {
    devices: [],
    terminals: [],
    shapes: [],
    reportRows: [key],
    reportCells: columns.map((_, i) => ({
      row: key,
      documentId: docId,
      documentOrigin: "auto",
      reportRowScope: "row",
      bbox: { x: 25 + i * 26, y: 40, w: 26, h: 10 },
      columnIndex: i,
    })),
    texts: [
      ink("network inventory", { documentId: docId }),
      ...grid(),
      ...columns.map((c, i) =>
        ink(c, { documentId: docId, columnIndex: i, columnName: c }),
      ),
      ...["--", "ethernet", "A: P", "Unconnected", "Unspecified"].map(
        (text, i) =>
          ink(text, {
            documentId: docId,
            documentOrigin: "auto",
            row: key,
            reportRowScope: "row",
            columnIndex: i,
            primitiveIds: [primitiveId],
            bbox: { x: 26 + i * 26, y: 42, w: 20, h: 3 },
          }),
      ),
    ],
  };
  const tables = [{ kind: "network", documentId: docId, columns }];
  return {
    ir,
    packet,
    source,
    report,
    tables,
    request: { views: [{ format: "communication-view-request/0.1" }] },
  };
}
