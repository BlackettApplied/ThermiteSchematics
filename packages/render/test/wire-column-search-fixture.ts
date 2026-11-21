import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import type { SchematicTitleContext } from "../src/title-block.js";
import { bounds, normalizePaperPage } from "../src/packet/page.js";
import {
  paginatedReportCells,
  reportPageCount,
} from "../src/packet/report-layout.js";

/** The saved FITREG request: seven drawings, five reports, then index/references. */
export function repeatRequest(flow: "left-to-right" | "top-to-bottom") {
  return {
    format: "schematic-packet-request/0.1",
    index: true,
    layout: "compact",
    page: { size: "letter", orientation: "landscape" },
    views: [
      ...(
        [
          ["M1", "power"],
          ["M2", "power"],
          ["K1", "control"],
          ["K2", "control"],
        ] as const
      ).map(([value, family]) => ({
        format: "schematic-view-request/0.1",
        root: { by: "designation", value },
        family,
        flow,
      })),
      ...(
        [
          ["LS1", "PLC1"],
          ["LS2", "RIO1"],
        ] as const
      ).map(([value, target]) => ({
        format: "schematic-view-request/0.2",
        root: { by: "designation", value },
        flow,
        intent: {
          kind: "trace",
          to: { by: "designation", value: target },
          includePower: true,
        },
      })),
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "CBL1" },
        flow,
        intent: { kind: "conductors" },
      },
      ...["terminals", "io", "bom", "cables", "wires"].map((kind) => ({
        format: "documentation-view-request/0.1",
        kind,
      })),
    ],
  };
}

/** The same native report field used by the public packet renderer. */
export function wireAllocationFixture(
  ir: Readonly<ElectricalIr>,
  presentation: CompiledProjectPresentation | undefined,
  paper: unknown,
) {
  const normalized = normalizePaperPage(paper);
  if (!normalized.ok) throw Error(normalized.error.message);
  const page = normalized.value;
  const table = buildDocumentation(
    ir,
    { format: "documentation-view-request/0.1", kind: "wires" },
    {},
  );
  const title: SchematicTitleContext = {
    projectName: ir.project.name,
    revision: presentation?.revision ?? "UNSPECIFIED",
    backgroundColor: "#ffffff",
    toolVersion: "0.3.0-alpha.2",
    lines: [
      {
        ownerKind: "view",
        ownerId: "report",
        field: "title.view-line",
        value: table.title,
      },
      ...(presentation?.titleBlockLines ?? []).map((value) => ({
        ownerKind: "presentation" as const,
        ownerId: "presentation",
        field: "title.authored-line",
        value,
      })),
    ],
  };
  const field = bounds(title, page),
    measured = paginatedReportCells(ir, table, field.w, field.h, page, field.y);
  return {
    measured,
    receipt: measured.allocationReceipt,
    pages: reportPageCount(table, measured, field.w, field.h, field.y),
  };
}
