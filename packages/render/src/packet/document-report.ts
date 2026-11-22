import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { DocumentationTable } from "@thermite/query";
import type { DocumentRowDraft } from "./document-types.js";
import { text } from "./svg.js";
import { zone } from "./page.js";
import type { DrawingBounds } from "./types.js";
import {
  documentIdentity,
  documentLabel,
  indexedRowFacts,
} from "./document-facts.js";
import { navigationHash } from "./navigation-identity.js";
import { required } from "../presentation/util.js";
export function documentReportTitle(table: DocumentationTable): string {
  const label = documentLabel(table.kind);
  return label === "inventory" || table.title === label
    ? table.title
    : `${table.title} — ${label}`;
}
export function reportDocumentContext(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  presentation: CompiledProjectPresentation | undefined,
  b: DrawingBounds,
  header: string[][],
  headerH: number,
) {
  const facts = indexedRowFacts(ir);
  const issuedDocument = {
    ...documentIdentity(ir, presentation),
    id: `document/1/${navigationHash([table.kind, table.rows.map((r) => r.key), table.selection ?? null])}`,
  };
  const documentHeader = {
    labelText: documentReportTitle(table),
    cells: table.columns,
    printedCells: header,
    primitiveId: "document-header",
    rectMm: { x: b.x, y: b.y + 9, w: b.w, h: headerH },
  };
  return {
    titleSvg: () =>
      text(b.x, b.y + 3, documentReportTitle(table), 4, "start", 700).replace(
        "<text ",
        '<text id="document-label" ',
      ),
    metadata: (documentRows: readonly DocumentRowDraft[]) => ({
      issuedDocument,
      documentHeader,
      documentRows,
    }),
    references(index: number, y: number, height: number) {
      return [
        ...new Set(
          required(table.rows[index], "Missing native document row").deviceUids,
        ),
      ].flatMap((uid) => {
        const device = ir.devices.find((d) => d.uid === uid);
        return device
          ? [
              {
                deviceUid: uid,
                designation: device.designation,
                functions: [] as string[],
                zone: zone(b.x + b.w / 2, y + height / 2, b),
              },
            ]
          : [];
      });
    },
    row(
      index: number,
      cells: string[][],
      y: number,
      height: number,
      displayName: string,
    ): DocumentRowDraft {
      const source = required(table.rows[index], "Missing native document row");
      return {
        nativeKey: source.key,
        displayName,
        ...facts(table, source.key),
        cells: source.cells,
        printedCells: cells,
        primitiveId: `document-row-${index}`,
        rectMm: { x: b.x, y, w: b.w, h: height },
      };
    },
  };
}
