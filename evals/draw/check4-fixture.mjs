import { netLabelFixture } from "./net-label-fixture.mjs";
export const c = { id: "check4", flow: "left-to-right" };
export const ir = {
  devices: [],
  functions: [],
  nets: [],
  cables: [],
  relations: [],
  wires: [],
  jumpers: [],
};
export const sheet = (kind = "bom") => ({
  number: 1,
  view: { format: "documentation-view/0.1", kind },
  references: [],
  continuations: [],
});
export function fixture(kind = "bom") {
  const { g } = netLabelFixture();
  g.texts = [];
  g.shapes = [];
  g.reportRows = [];
  g.reportCells = [];
  const s = sheet(kind);
  return { s, g, packet: { sheets: [s] }, ir: structuredClone(ir), tables: [] };
}
export function documents(kind = "bom") {
  const x = fixture(kind);
  x.g.reportRows = ["shared"];
  for (const [index, value] of ["AA-001", "BB-002"].entries()) {
    const documentId = "doc-" + index,
      px = 10 + index * 100;
    x.tables.push({
      kind,
      documentId,
      columns: ["Qty", "Designations", "Location", "Mfr.", "Order number"],
      rows: [
        { key: "shared", cells: ["1", "", "", "", value], deviceUids: [] },
      ],
    });
    x.g.texts.push({
      element: "text-" + index,
      text: value,
      row: "shared",
      documentId,
      documentKind: kind,
      reportRowScope: "part-" + index,
      columnIndex: 4,
      painted: true,
      fontSize: 3.5,
      bbox: { x: px, y: 18, w: 20, h: 3 },
      cell: { x: px - 5, y: 5, w: 90, h: 40 },
      reportRuns: [
        {
          text: value,
          anchor: { x: px, y: 20 },
          bbox: { x: px, y: 18, w: 20, h: 2 },
        },
      ],
    });
    x.g.reportCells.push({
      row: "shared",
      columnIndex: 4,
      documentId,
      documentKind: kind,
      reportRowScope: "part-" + index,
      element: "cell-" + index,
      bbox: { x: px - 5, y: 5, w: 90, h: 40 },
    });
  }
  return x;
}
export function split(x, index) {
  const t = x.g.texts[index],
    px = t.bbox.x;
  t.reportRuns = [
    {
      text: t.text.slice(0, 3),
      anchor: { x: px, y: 20 },
      bbox: { x: px, y: 18, w: 10, h: 2 },
    },
    {
      text: t.text.slice(3),
      anchor: { x: px, y: 25 },
      bbox: { x: px, y: 23, w: 10, h: 2 },
    },
  ];
  return x;
}
