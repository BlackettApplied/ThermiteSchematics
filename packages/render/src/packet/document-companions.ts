import { appendTerminalStrips } from "./terminal-strip.js";
import { inlineAssemblyDocument } from "./document-assembly-inline.js";
import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { Draft, PaperPage } from "./types.js";
import type {
  AssemblyOverflowEvidence,
  DocumentDependency,
  DocumentFact,
  IssuedDocument,
} from "./document-types.js";
import {
  documentIdentity,
  factKey,
  factReport,
  factTable,
} from "./document-facts.js";
import { issuedDocuments, missingDocumentFacts } from "./document-registry.js";
import { assembleSheets } from "./assembly.js";
import { tableDrafts } from "./reports.js";
import { navigationHash } from "./navigation-identity.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { failure } from "./errors.js";
import type { RenderOutcome } from "../types.js";
import { validateDocumentNeed } from "./document-native.js";
import { DocumentDependencyError } from "./document-error.js";

export function documentDependencies(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  presentation?: CompiledProjectPresentation,
): DocumentDependency[] {
  const identity = documentIdentity(ir, presentation),
    nativeFacts = new Map<string, ReadonlySet<string>>();
  if (
    drafts.some(
      (d) =>
        d.autoDocumentOrigin &&
        d.documentNeeds?.length &&
        !isInlineAssemblySource(d),
    )
  )
    throw Error("Cyclic generated companion promise");
  const drawnPorts = new Set(
    drafts.flatMap((d) =>
      (d.topologyCoverage ?? [])
        .filter((c) => c.kind === "connector-assembly")
        .flatMap((c) =>
          c.ports.map((p) => JSON.stringify([p.deviceUid, p.portKey])),
        ),
    ),
  );
  const dependencies = drafts.flatMap((draft, i) =>
    (draft.documentNeeds ?? [])
      .filter(
        (need) =>
          need.need !== "connector-port-status" ||
          !need.requiredFacts.every(
            (f) =>
              f.kind === "connector-port-status" &&
              drawnPorts.has(JSON.stringify([f.deviceUid, f.portKey])),
          ),
      )
      .map((need) => {
        validateDocumentNeed(ir, need, nativeFacts);
        const viewKey = need.viewKey ?? draft.navigationView?.key;
        if (!viewKey)
          throw Error("Document promise has no selected appearance");
        const id = `dependency/1/${navigationHash([viewKey, need.noteId])}`;
        return {
          ...need,
          ...identity,
          id,
          owner: { viewKey, noteId: need.noteId, sheet: i + 1 },
          resolution: [],
        };
      }),
  );
  if (
    new Set(dependencies.map(documentOccurrenceKey)).size !==
    dependencies.length
  )
    throw Error("Duplicate document note identity");
  return dependencies.filter((d) => d.requiredFacts.length);
}
interface MissingGroup {
  facts: Map<string, DocumentFact>;
  dependencies: string[];
}
function missingGroups(
  dependencies: readonly DocumentDependency[],
  printed: readonly IssuedDocument[],
) {
  const groups = new Map<ReturnType<typeof factReport>, MissingGroup>();
  for (const need of dependencies) {
    const missing = missingDocumentFacts(need, printed);
    if (!missing.length) continue;
    const kind = factReport(need.need),
      group = groups.get(kind) ?? {
        facts: new Map<string, DocumentFact>(),
        dependencies: [] as string[],
      };
    for (const fact of missing) group.facts.set(factKey(fact), fact);
    group.dependencies.push(need.id);
    groups.set(kind, group);
  }
  return groups;
}
function companionDrafts(
  ir: Readonly<ElectricalIr>,
  kind: ReturnType<typeof factReport>,
  group: MissingGroup,
  printed: readonly IssuedDocument[],
  dependencies: readonly DocumentDependency[],
  page: PaperPage,
  presentation?: CompiledProjectPresentation,
  overflow?: AssemblyOverflowEvidence,
): Draft[] {
  const table = factTable(ir, kind, [...group.facts.values()]);
  if (!table.rows.length)
    throw Error(`Required ${kind} companion has no printable source rows`);
  if (
    table.rows.some((row) =>
      printed.some(
        (d) => d.kind === kind && d.rows.some((r) => r.nativeKey === row.key),
      ),
    )
  )
    throw Error(
      `Required ${kind} companion would duplicate already issued rows`,
    );
  const extra = tableDrafts(ir, table, presentation, page);
  if (!extra.ok)
    throw new DocumentDependencyError(
      extra.error.message,
      dependencies.filter((d) => group.dependencies.includes(d.id)),
      { cause: extra.error, companionKind: kind },
    );
  const id = `auto-document/1/${navigationHash([kind, [...group.facts.keys()].sort()])}`;
  for (const draft of extra.value) {
    draft.issuedDocument = { ...documentIdentity(ir, presentation), id };
    draft.autoDocumentOrigin = {
      dependencyIds: [...new Set(group.dependencies)],
      ...(overflow ? { overflow } : {}),
    };
    draft.content = `<g data-document-id="${attr(id)}" data-document-origin="auto">${draft.content}</g>`;
    if (draft.documentNeeds?.length)
      throw Error("Cyclic generated companion promise");
  }
  return extra.value;
}
function assertClosed(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  dependencies: readonly DocumentDependency[],
  page: PaperPage,
  presentation?: CompiledProjectPresentation,
) {
  const closed = issuedDocuments(
    ir,
    drafts,
    assembleSheets(ir, structuredClone(drafts), page),
    page,
    presentation,
  );
  const missing = dependencies.filter(
    (need) => missingDocumentFacts(need, closed).length,
  );
  if (missing.length)
    throw Error(
      `Required companion remains insufficient after closure: ${missing.map((d) => d.subject).join(", ")}`,
    );
}
/** Finite monotone source closure. Generated tables cannot create more needs. */
export function appendDocumentCompanions(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Draft[],
  page: PaperPage,
  presentation?: CompiledProjectPresentation,
): RenderOutcome<Draft[]> {
  let dependencies: DocumentDependency[] = [];
  try {
    dependencies = documentDependencies(ir, drafts, presentation);
    if (!dependencies.length)
      return { ok: true, value: appendTerminalStrips([...drafts]) };
    const printed = issuedDocuments(
      ir,
      drafts,
      assembleSheets(ir, structuredClone(drafts) as Draft[], page),
      page,
      presentation,
    );
    const result = [...drafts];
    for (const [kind, group] of missingGroups(dependencies, printed)) {
      const inline = inlineGroup(
        ir,
        result,
        kind,
        group,
        dependencies,
        page,
        presentation,
      );
      if (inline === "inline") continue;
      result.push(
        ...companionDrafts(
          ir,
          kind,
          group,
          printed,
          dependencies,
          page,
          presentation,
          inline,
        ),
      );
      if (result.length > 100)
        throw Error(
          `Required ${kind} companion exceeds the 100-sheet limit (${result.length} sheets before indexes)`,
        );
    }
    assertClosed(ir, result, dependencies, page, presentation);
    return { ok: true, value: appendTerminalStrips(result) };
  } catch (error) {
    return failure(
      "unprintable-layout",
      error instanceof Error
        ? error.message
        : "Required companion closure failed",
      {
        documentDependencies: dependencies.map((d) => d.id),
        subjects: dependencies.map((d) => d.subject),
        candidatePages: drafts.length,
        sheetCap: 100,
        ...(error instanceof DocumentDependencyError ? error.details : {}),
      },
    );
  }
}

/** An authored graphical producer can carry an inventory without generating needs. */
function isInlineAssemblySource(draft: Draft) {
  return (
    draft.documentKind === "assemblies" &&
    !!draft.inlineDocumentBounds &&
    !!draft.navigationView &&
    "kind" in draft.view &&
    draft.view.kind === "connector-assembly" &&
    (draft.documentNeeds ?? []).every(
      (n) =>
        n.noteId === "assembly-reasons" || n.need === "connector-port-status",
    )
  );
}

function inlineGroup(
  ir: Readonly<ElectricalIr>,
  drafts: Draft[],
  kind: ReturnType<typeof factReport>,
  group: MissingGroup,
  dependencies: readonly DocumentDependency[],
  page: PaperPage,
  presentation?: CompiledProjectPresentation,
) {
  if (kind !== "assemblies") return undefined;
  const affected = dependencies.filter((d) =>
    group.dependencies.includes(d.id),
  );
  if (
    !affected.some(
      (d) =>
        d.noteId === "assembly-reasons" || d.need === "connector-port-status",
    )
  )
    return undefined;
  const table = factTable(ir, kind, [...group.facts.values()]);
  const attempt = inlineAssemblyDocument(
    ir,
    drafts,
    table,
    affected,
    page,
    presentation,
  );
  if (attempt.ok) return "inline";
  const overflow: AssemblyOverflowEvidence = {
    profile: "assembly-inline/1",
    rowKeys: table.rows.map((r) => r.key),
    sourceSheets: [...new Set(affected.map((d) => d.owner.sheet))],
    attempts: attempt.attempts,
  };
  return overflow;
}

/** Native reason notes repeat on different parts; their occurrence includes the sheet. */
function documentOccurrenceKey(
  need: Pick<DocumentDependency, "id" | "need" | "noteId" | "owner">,
) {
  return need.need === "connector-port-status" ||
    (need.need === "assembly-pin-map" && need.noteId === "assembly-reasons")
    ? JSON.stringify([need.id, need.owner.sheet])
    : need.id;
}
