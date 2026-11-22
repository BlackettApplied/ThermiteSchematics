import { packedPortCaptions } from "./document-port-captions.js";
import { assemblyPortPointers } from "./document-assembly-pointers.js";
import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { Draft, PaperPage, RenderedSheet } from "./types.js";
import type { DocumentDependency, IssuedDocument } from "./document-types.js";
import type { IssuedNavigation } from "./navigation-types.js";
import { documentDependencies } from "./document-companions.js";
import {
  issuedDocuments,
  missingDocumentFacts,
  resolveDocumentNeed,
} from "./document-registry.js";
import { bounds } from "./page.js";
import { required } from "../presentation/util.js";
import { DocumentDependencyError } from "./document-error.js";
import { documentCaptionInk } from "./document-caption-ink.js";
import { placeDocumentCaption } from "./document-caption-place.js";
import { terminalInventoryPointers } from "./terminal-strip-inventory.js";
import { assemblyPeerReferences } from "./assembly-peer-references.js";
import { terminalPeerReferences } from "./terminal-peer-references.js";
function captionSheet(
  ir: Readonly<ElectricalIr>,
  sheet: RenderedSheet,
  draft: Draft,
  needs: readonly DocumentDependency[],
  documents: readonly IssuedDocument[],
  page: PaperPage,
  navigation: IssuedNavigation,
  standalone: boolean,
): RenderedSheet {
  const result = {
    ...sheet,
    svg: sheet.svg.replace(
      /<text\b([^>]*data-document-note-replacement="([^"]*)"[^>]*)>[^<]*<\/text>/g,
      (_, attributes: string, value: string) =>
        `<text${attributes}>${value}</text>`,
    ),
  };
  if (!needs.length) return result;
  const field = draft.drawingBounds ?? bounds(draft.title, page);
  const claims = navigation.reservations
    .filter((r) => r.allocatedMm?.sheet === sheet.number)
    .map((r) => required(r.allocatedMm, "Missing navigation claim").rect);
  if (draft.inlineDocumentBounds) claims.push(draft.inlineDocumentBounds);
  const ports = standalone
    ? []
    : needs.filter((n) => n.need === "connector-port-status");
  const other = needs.filter((n) => !ports.includes(n));
  let ink = captionNeeds(
    ir,
    result,
    field,
    other,
    documents,
    claims,
    standalone,
  );
  for (const need of ports) {
    if (missingDocumentFacts(need, documents).length)
      throw new DocumentDependencyError(
        `Unresolved document promise at sheet ${sheet.number}: ${need.subject}`,
        [need],
      );
    need.resolution = resolveDocumentNeed(need, documents);
  }
  const packed = packedPortCaptions(ports, documents, field, result, claims);
  ink += packed
    ? packed.svg
    : captionNeeds(ir, result, field, ports, documents, claims, standalone);
  result.svg = result.svg.replace(/<\/svg>(\s*)$/, `${ink}</svg>$1`);
  return result;
}
/** Extension of NAV's pure finalization: never reroutes or repaginates drawings. */
export function finalizeDocuments(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  sheets: readonly RenderedSheet[],
  page: PaperPage,
  navigation: IssuedNavigation,
  standalone: boolean,
  presentation?: CompiledProjectPresentation,
): { sheets: RenderedSheet[]; navigation: IssuedNavigation } {
  const documents = issuedDocuments(ir, drafts, sheets, page, presentation),
    dependencies = documentDependencies(ir, drafts, presentation);
  const result = sheets.map((sheet, i) =>
    captionSheet(
      ir,
      sheet,
      required(drafts[i], "Missing document draft"),
      dependencies.filter((d) => d.owner.sheet === sheet.number),
      documents,
      page,
      navigation,
      standalone,
    ),
  );
  return {
    sheets: terminalInventoryPointers(
      drafts,
      terminalPeerReferences(
        ir,
        drafts,
        assemblyPeerReferences(
          ir,
          drafts,
          assemblyPortPointers(ir, drafts, result, page, dependencies),
          page,
          documents,
        ),
        page,
      ),
      documents,
    ),
    navigation: {
      ...navigation,
      documentFormat: "issued-documents/1",
      documents,
      dependencies,
      autoDocuments: documents
        .filter((d) => d.autoOrigin)
        .map((d) => ({
          documentId: d.id,
          dependencyIds: required(d.autoOrigin, "Missing auto origin")
            .dependencyIds,
          sheets: [...new Set(d.rows.map((r) => r.sheet))],
        })),
    },
  };
}

function captionNeeds(
  ir: Readonly<ElectricalIr>,
  sheet: RenderedSheet,
  field: import("../device-legend/geometry.js").Rect,
  needs: readonly DocumentDependency[],
  documents: readonly IssuedDocument[],
  claims: import("../device-legend/geometry.js").Rect[],
  standalone: boolean,
) {
  return needs
    .map((need) => {
      if (!standalone && missingDocumentFacts(need, documents).length)
        throw new DocumentDependencyError(
          `Unresolved document promise at sheet ${need.owner.sheet}: ${need.subject}`,
          [need],
        );
      need.resolution = standalone ? [] : resolveDocumentNeed(need, documents);
      const placed = placeDocumentCaption(
        ir,
        need,
        documents,
        field,
        sheet,
        claims,
        standalone,
      );
      claims.push(
        required(placed.slot.allocatedMm, "Missing document caption slot").rect,
        ...(placed.slot.leader ? [placed.slot.leader.rect] : []),
      );
      return documentCaptionInk(need, placed.slot, {
        form: placed.form,
        ...("groups" in placed ? { groups: placed.groups } : {}),
      });
    })
    .join("");
}
