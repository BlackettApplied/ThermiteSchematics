import type { ElectricalIr } from "@thermite/compiler";
import type { Rect } from "../device-legend/geometry.js";
import type {
  DocumentDependency,
  IssuedDocument,
  DocumentCaptionGroup,
} from "./document-types.js";
import type { RenderedSheet } from "./types.js";
import { documentCaptionTokens } from "./document-caption-text.js";
import { compactDocumentCaption } from "./document-caption-compact.js";
import { DocumentDependencyError } from "./document-error.js";
import { documentCaptionOwner } from "./document-caption-owner.js";
import { documentCaptionSlot } from "./document-caption-slot.js";

interface CaptionForm {
  kind: "identities" | "compact";
  build(): { tokens: string[]; groups?: readonly DocumentCaptionGroup[] };
}
export function placeDocumentCaption(
  ir: Readonly<ElectricalIr>,
  need: DocumentDependency,
  documents: readonly IssuedDocument[],
  field: Rect,
  sheet: RenderedSheet,
  claims: readonly Rect[],
  standalone: boolean,
) {
  const owner = documentCaptionOwner(need, sheet, field);
  const forms = captionForms(ir, need, documents, standalone);
  const errors: Partial<
    Record<
      "local" | "self-located",
      Partial<Record<"identities" | "compact", string>>
    >
  > = {};
  for (const mode of owner
    ? (["local", "self-located"] as const)
    : (["self-located"] as const)) {
    for (const { kind, build } of forms) {
      try {
        const { tokens, ...metadata } = build();
        return {
          ...metadata,
          form: kind,
          slot: documentCaptionSlot(
            need,
            tokens,
            field,
            sheet,
            claims,
            mode,
            owner,
          ),
        };
      } catch (error) {
        (errors[mode] ??= {})[kind] = String(error);
      }
    }
  }
  throw new DocumentDependencyError(
    `Required companion captions at sheet ${sheet.number} (${need.subject}): identity and compact forms cannot fit: ${String(errors["self-located"]?.compact)}`,
    [need],
    {
      sheet: sheet.number,
      profile: "document-caption/1",
      availableMm: field,
      identityFormError: errors["self-located"]?.identities,
      compactFormError: errors["self-located"]?.compact,
      localFormErrors: errors.local,
      remoteFormErrors: errors["self-located"],
    },
  );
}

function captionForms(
  ir: Readonly<ElectricalIr>,
  need: DocumentDependency,
  documents: readonly IssuedDocument[],
  standalone: boolean,
): CaptionForm[] {
  return [
    {
      kind: "identities" as const,
      build: () => ({
        tokens: documentCaptionTokens(need, documents, standalone),
      }),
    },
    {
      kind: "compact" as const,
      build: () => {
        if (standalone)
          throw Error("Standalone captions have no issued target to compact");
        return compactDocumentCaption(ir, need, documents);
      },
    },
  ];
}
