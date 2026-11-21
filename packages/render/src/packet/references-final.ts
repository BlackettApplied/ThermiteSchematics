import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import type { resolveDeviceFilter } from "@thermite/query";
import type { RenderOutcome } from "../types.js";
import type {
  Draft,
  PaperPage,
  SchematicPacketRequest,
  ReferenceSelection,
} from "./types.js";
import { INDEX_TITLE, drawingIndex, referenceTables } from "./references.js";
import { tableDrafts } from "./reports.js";
import { failure } from "./errors.js";

export const FINAL_INDEX_SHEET_LIMIT = 100;

/** Reserve complete final rows against each finite, legal index-page capacity. */
export function reserveFinalIndex(
  content: readonly Draft[],
  references: readonly Draft[],
  placeholder: Draft,
  compose: (drafts: readonly Draft[]) => RenderOutcome<Draft[]>,
): RenderOutcome<Draft[]> {
  const capacity = FINAL_INDEX_SHEET_LIMIT - content.length - references.length;
  for (let count = 1; count <= capacity; count++) {
    const final = [
      ...content,
      ...Array.from({ length: count }, () => placeholder),
      ...references,
    ];
    const index = compose(final);
    if (!index.ok) return index;
    if (index.value.length === count)
      return { ok: true, value: [...content, ...index.value, ...references] };
  }
  return failure(
    "unprintable-layout",
    "A bounded final index cannot fit within the 100-sheet packet limit.",
  );
}

export function finalReferenceDrafts(
  ir: Readonly<ElectricalIr>,
  content: readonly Draft[],
  request: Pick<SchematicPacketRequest, "references" | "page">,
  devices: ReturnType<typeof resolveDeviceFilter> | undefined,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): RenderOutcome<{
  drafts: Draft[];
  referenceSelection: ReferenceSelection | undefined;
}> {
  const tables = referenceTables(ir, content, request, devices);
  const references: Draft[] = [];
  for (const table of tables.tables.filter((t) => t.kind === "references")) {
    const result = tableDrafts(ir, table, presentation, page);
    if (!result.ok) return result;
    references.push(...result.value);
  }
  const placeholder: Draft = {
    view: {
      format: "documentation-view/0.1",
      kind: "index",
      title: INDEX_TITLE,
    },
    title: {
      projectName: INDEX_TITLE,
      revision: "",
      toolVersion: "",
      backgroundColor: "#ffffff",
      lines: [],
    },
    references: [],
    documentationTable: true,
    content: "",
    links: [],
    note: "",
  };
  const result = reserveFinalIndex(content, references, placeholder, (final) =>
    tableDrafts(ir, drawingIndex(final, request), presentation, page),
  );
  return result.ok
    ? {
        ok: true,
        value: {
          drafts: result.value,
          referenceSelection: tables.referenceSelection,
        },
      }
    : result;
}
