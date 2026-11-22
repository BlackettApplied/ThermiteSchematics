import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { DocumentationTable } from "@thermite/query";
import type { Draft, PaperPage } from "./types.js";
import { NavigationSlotFailure } from "./navigation-slots.js";
import { ReportMeasurementError } from "./report-measurement.js";
import type { AssemblyInlineAttempt } from "./document-types.js";
import type { DocumentDependency } from "./document-types.js";
import { assembleSheets } from "./assembly.js";
import { bounds } from "./page.js";
import { allocateNavigationSlots } from "./navigation-slots.js";
import { navigationHash } from "./navigation-identity.js";
import { documentIdentity } from "./document-facts.js";
import {
  inlineTablePlan,
  inlineTableContent,
} from "./document-inline-table.js";
import { required } from "../presentation/util.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";

type InlineResult =
  { ok: true } | { ok: false; attempts: AssemblyInlineAttempt[] };

/** Try bounded placements before the caller generates an overflow companion. */
export function inlineAssemblyDocument(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  table: DocumentationTable,
  needs: readonly DocumentDependency[],
  page: PaperPage,
  presentation?: CompiledProjectPresentation,
): InlineResult {
  const owners = new Set(needs.map((d) => d.owner.sheet));
  const sheets = assembleSheets(ir, structuredClone(drafts), page);
  const attempts: AssemblyInlineAttempt[] = [];
  const id = `auto-document/1/${navigationHash(["assemblies", table.rows.map((r) => r.key)])}`;
  for (const [i, draft] of drafts.entries()) {
    if (
      !owners.has(i + 1) ||
      draft.issuedDocument ||
      !("kind" in draft.view) ||
      draft.view.kind !== "connector-assembly"
    )
      continue;
    const field = draft.drawingBounds ?? bounds(draft.title, page);
    for (const width of [
      ...new Set([180, 220, 140, 100, field.w].filter((w) => w <= field.w)),
    ]) {
      let neededHeightMm: number | undefined;
      try {
        const plan = inlineTablePlan(ir, table, width, page);
        neededHeightMm = plan.height;
        const slot = inlineSlot(
          draft,
          plan,
          field,
          required(sheets[i], "Missing inline sheet").svg,
          i + 1,
          id,
        );
        const rendered = inlineTableContent(ir, plan, slot.rect, presentation);
        drafts[i] = {
          ...draft,
          ...rendered,
          documentKind: "assemblies",
          inlineDocumentBounds: slot.rect,
          issuedDocument: { ...documentIdentity(ir, presentation), id },
          autoDocumentOrigin: { dependencyIds: needs.map((d) => d.id) },
          content:
            draft.content +
            `<g data-document-kind="assemblies" data-document-id="${attr(id)}" data-document-origin="auto">${rendered.content}</g>`,
        };
        return { ok: true };
      } catch (error) {
        attempts.push(
          inlineAttempt(error, i + 1, width, neededHeightMm, field),
        );
      }
    }
  }
  return { ok: false, attempts };
}

function inlineSlot(
  draft: Draft,
  plan: ReturnType<typeof inlineTablePlan>,
  field: import("./types.js").DrawingBounds,
  svg: string,
  sheet: number,
  id: string,
) {
  const reservation: import("./navigation-types.js").AnnotationReservation = {
    id,
    ownerAppearance: draft.navigationView?.key ?? id,
    ownerOccurrence: id,
    profileId: "assembly-inline/1",
    space: "sheet-slot",
    inkMm: { x: 0, y: 0, w: plan.width, h: plan.height },
    maximumForms: ["complete native header, rows and scope notes"],
  };
  return required(
    allocateNavigationSlots(
      [{ reservation, owner: field }],
      field,
      svg,
      sheet,
    )[0]?.allocatedMm,
    "Missing inline slot",
  );
}

function inlineAttempt(
  error: unknown,
  sheet: number,
  widthMm: number,
  neededHeightMm: number | undefined,
  field: import("./types.js").DrawingBounds,
): AssemblyInlineAttempt {
  if (
    !(error instanceof NavigationSlotFailure) &&
    !(error instanceof ReportMeasurementError)
  )
    throw error;
  return {
    sheet,
    widthMm,
    ...(neededHeightMm === undefined ? {} : { neededHeightMm }),
    availableMm: { x: field.x, y: field.y, w: field.w, h: field.h },
    reason: error instanceof NavigationSlotFailure ? "vacancy" : "measurement",
    message: String(error),
  };
}
