import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { Draft, PaperPage } from "../../packet/types.js";
import type { FinalSheet, SheetIdentity } from "./model.js";
import { sheetIdentityKey } from "./sheet-key.js";
import { sheetLabel } from "../../packet/page.js";
import { documentDependencies } from "../../packet/document-companions.js";
import { navigationDraftInputs } from "../../packet/navigation-seeds.js";
import { titleFrameContext } from "./frame-context.js";
import { resolveTitles } from "./resolve.js";
import { titleFailure } from "./errors.js";
import { failure } from "../../packet/errors.js";

/** Bind native selection keys to authored request indexes before looking at
 * dependencies. Titles and final sheet positions never participate. */
export function authoredViewIndexes(drafts: readonly Draft[]) {
  const correspondence = new Map<string, number>();
  for (const input of navigationDraftInputs(drafts)) {
    const index = input.view.authoredOrder + 1;
    const previous = correspondence.get(input.view.key);
    if (previous !== undefined && previous !== index)
      throw Error("Native view key has inconsistent authored ownership.");
    correspondence.set(input.view.key, index);
  }
  return correspondence;
}
export function finalTitleSheets(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  presentation?: CompiledProjectPresentation,
): FinalSheet[] {
  const correspondence = authoredViewIndexes(drafts);
  const dependencies = new Map(
    documentDependencies(ir, drafts, presentation).map((dependency) => [
      dependency.id,
      dependency,
    ]),
  );
  const descriptors = drafts.map(
    (draft): Omit<FinalSheet, "partIndex" | "partTotal"> => {
      if (draft.autoDocumentOrigin) {
        const owners = draft.autoDocumentOrigin.dependencyIds.map((id) => {
          const dependency = dependencies.get(id);
          const index =
            dependency && correspondence.get(dependency.owner.viewKey);
          if (index === undefined)
            throw Error("Companion dependency has no authored owner.");
          return index;
        });
        if (!draft.issuedDocument)
          throw Error("Companion has no native document identity.");
        return {
          identity: { kind: "companion", documentId: draft.issuedDocument.id },
          ownerViewIndexes: [...new Set(owners)].sort((a, b) => a - b),
          title: sheetLabel(draft.view),
        };
      }
      const authored =
        draft.navigationView && correspondence.get(draft.navigationView.key);
      const identity: SheetIdentity = draft.issuedDocument
        ? { kind: "document", documentId: draft.issuedDocument.id }
        : draft.navigationView
          ? { kind: "view", viewKey: draft.navigationView.key }
          : draft.view.format === "documentation-view/0.1" &&
              draft.view.kind === "references"
            ? { kind: "references" }
            : { kind: "index" };
      return {
        identity,
        ...(authored === undefined ? {} : { viewIndex: authored }),
        title: sheetLabel(draft.view),
      };
    },
  );
  const totals = new Map<string, number>(),
    parts = new Map<string, number>();
  for (const descriptor of descriptors) {
    const key = sheetIdentityKey(descriptor.identity);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return descriptors.map((descriptor) => {
    const key = sheetIdentityKey(descriptor.identity),
      partIndex = (parts.get(key) ?? 0) + 1;
    parts.set(key, partIndex);
    return { ...descriptor, partIndex, partTotal: totals.get(key) ?? 0 };
  });
}
export function finalizeTitleData(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  page: PaperPage,
  presentation?: CompiledProjectPresentation,
) {
  const context = titleFrameContext(page);
  if (!context) return { ok: true as const, value: drafts };
  let descriptors: FinalSheet[];
  try {
    descriptors = finalTitleSheets(ir, drafts, presentation);
  } catch (error) {
    return failure(
      "invalid-packet",
      error instanceof Error
        ? error.message
        : "Invalid native title ownership.",
      { reason: "unresolved-sheet-key" },
    );
  }
  const result = resolveTitles(
    context.presentation,
    context.request,
    ir.project.name,
    descriptors,
    context.sources,
  );
  if (!result.value) return titleFailure(result.diagnostics);
  for (const [index, title] of result.value.entries()) {
    const draft = drafts[index];
    if (!draft) throw Error("Missing final title draft.");
    draft.resolvedTitle = title;
  }
  return { ok: true as const, value: drafts };
}
