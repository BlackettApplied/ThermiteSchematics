import type { ElectricalIr } from "@thermite/compiler";
import {
  buildDocumentation,
  type DocumentationRequest,
  type DocumentationTable,
} from "@thermite/query";
import { tableDrafts } from "../src/packet/reports.js";
import { normalizePaperPage, bounds } from "../src/packet/page.js";
import type { Draft } from "../src/packet/types.js";
import type { DocumentNeedSeed } from "../src/packet/document-types.js";
import { assembleSheets } from "../src/packet/assembly.js";

export const documentPaper = () => {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("page");
  return page.value;
};
export function reportFixture(
  ir: ElectricalIr,
  request: DocumentationRequest,
  keys?: readonly string[],
  id = "requested",
) {
  const native = buildDocumentation(ir, request);
  const table: DocumentationTable = {
    ...native,
    rows: keys ? native.rows.filter((r) => keys.includes(r.key)) : native.rows,
  };
  const result = tableDrafts(ir, table, undefined, documentPaper());
  if (!result.ok) throw Error(JSON.stringify(result.error));
  for (const draft of result.value) draft.issuedDocument!.id = id;
  return result.value;
}
export function dependencyDraft(
  ir: ElectricalIr,
  needs: readonly DocumentNeedSeed[] = [],
): Draft {
  const draft = structuredClone(
    reportFixture(ir, {
      format: "documentation-view-request/0.1",
      kind: "network",
    })[0]!,
  );
  delete draft.issuedDocument;
  delete draft.documentRows;
  delete draft.documentHeader;
  draft.view = {
    format: "documentation-view/0.1",
    kind: "wiring",
    title: "Synthetic selected wiring",
  };
  draft.documentationTable = false;
  draft.content = "";
  draft.drawingBounds = bounds(draft.title, documentPaper());
  draft.navigationView = { key: "synthetic-view", authoredOrder: 0 };
  draft.documentNeeds = needs;
  draft.views = [{ viewIndex: 0, title: draft.view.title }];
  return draft;
}
export function wireNeed(ir: ElectricalIr, name = "W3"): DocumentNeedSeed {
  const wire = ir.wires.find((w) => w.designation === name)!;
  return {
    noteId: `hidden/${wire.uid}`,
    need: "conductor-incidence",
    requiredFacts: wire.endpoints.map((e, end) => ({
      kind: "conductor-incidence",
      element: { kind: "wire", uid: wire.uid },
      end,
      terminal: e.terminal,
    })),
    requiredColumns: ["identity", "endpoints", "status"],
    subject: "PS1.+",
    count: 2,
  };
}
export const fixtureSheets = (ir: ElectricalIr, drafts: readonly Draft[]) =>
  assembleSheets(ir, structuredClone(drafts) as Draft[], documentPaper());
