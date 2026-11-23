import { printedFunction } from "../print-projection.js";
import type { ElectricalIr } from "@thermite/compiler";
import type { DocumentationTable, resolveDeviceFilter } from "@thermite/query";
import type {
  Draft,
  SheetReference,
  SchematicPacketRequest,
  ReferenceSelection,
} from "./types.js";
import { sheetLabel, bounds, normalizePaperPage } from "./page.js";
import { fieldTextWidth } from "./svg.js";
import { wrapText } from "../text-metrics.js";

export const INDEX_TITLE = "Drawing index";

type ReferenceDraft = Pick<
  Draft,
  "view" | "references" | "documentationTable" | "referenceNotes"
>;
function referenceNotes(
  drafts: readonly ReferenceDraft[],
  request: Pick<SchematicPacketRequest, "page">,
) {
  const notes = [...new Set(drafts.flatMap((d) => d.referenceNotes ?? []))];
  if (!notes.length) return notes;
  const paper = normalizePaperPage(request.page);
  if (!paper.ok) return notes; // Packet validation already reports an invalid page.
  const width = bounds(
    {
      projectName: "",
      revision: "",
      toolVersion: "",
      backgroundColor: "#ffffff",
      lines: [],
    },
    paper.value,
  ).w;
  // The report retains its legacy character wrapping. Bound new engine lines
  // by measured width first; any further split can only make them narrower.
  return notes.flatMap((note) => wrapText(note, fieldTextWidth(width), 2.5));
}

const designationOrder = (
  a: { designation: string },
  b: { designation: string },
) =>
  a.designation < b.designation ? -1 : a.designation > b.designation ? 1 : 0;

function referenceGroupKey(r: SheetReference): string {
  return JSON.stringify([
    r.deviceUid,
    r.functions,
    ...(r.representation ? [r.representation] : []),
  ]);
}
function referenceRepresentation(
  ir: Readonly<ElectricalIr>,
  r: SheetReference,
): string {
  if (r.representation === "terminal-strip") return "Terminal strip";
  return r.representation === "terminal"
    ? "Terminal context (coil outside view)"
    : r.functions
        .map((key) => {
          const fn = ir.functions.find(
            (f) => f.id.deviceUid === r.deviceUid && f.id.functionKey === key,
          );
          const device = ir.devices.find((d) => d.uid === r.deviceUid);
          const type = ir.deviceTypes.find((t) => t.id === device?.typeId);
          return fn
            ? printedFunction(fn, type)
            : "Function facts not specified";
        })
        .join(", ") || "Terminal / schedule";
}

function isDeviceReference(r: SheetReference): boolean {
  return !r.functions.length && !r.representation;
}

function retainAppearance(
  options: SchematicPacketRequest["references"],
  draft: ReferenceDraft,
  reference: SheetReference,
  selected: ReadonlySet<string>,
) {
  return (
    options !== false &&
    selected.has(reference.deviceUid) &&
    (options?.appearances !== "drawings" ||
      !draft.documentationTable ||
      reference.representation === "terminal-strip")
  );
}

/** Content drafts already carry final terminal-centroid locations from the
 * navigation seam. Preserve aggregate report groups while collecting each
 * function's final zones; appending index pages must happen later.
 * Legacy callers use the content-only index table; packet composition discards
 * it and rebuilds the index after reference pagination establishes all rows. */
export function referenceTables(
  ir: Readonly<ElectricalIr>,
  drafts: readonly ReferenceDraft[],
  request: Pick<SchematicPacketRequest, "references" | "page">,
  referenceDevices: ReturnType<typeof resolveDeviceFilter> | undefined,
): {
  tables: DocumentationTable[];
  referenceSelection: ReferenceSelection | undefined;
} {
  let referenceSelection: ReferenceSelection | undefined;
  const indexTable = drawingIndex(drafts, request);
  const groups = new Map<
    string,
    {
      designation: string;
      functions: string;
      locations: string[];
      uid: string;
    }
  >();
  const retainedGroups: typeof groups = new Map();
  const selectedReferenceDevices = new Set(
    referenceDevices?.deviceUids ?? ir.devices.map((d) => d.uid),
  );
  drafts.forEach((d, i) =>
    d.references?.forEach((r) => {
      const key = referenceGroupKey(r);
      const g = groups.get(key) ?? {
        designation: r.designation,
        functions: referenceRepresentation(ir, r),
        locations: [],
        uid: r.deviceUid,
      };
      g.locations.push(`${i + 1} / ${r.zone}`);
      groups.set(key, g);
      if (
        retainAppearance(request.references, d, r, selectedReferenceDevices)
      ) {
        const retained = retainedGroups.get(key) ?? {
          ...g,
          functions:
            request.references &&
            request.references.appearances === "drawings" &&
            isDeviceReference(r)
              ? "Device / terminal / port"
              : g.functions,
          locations: [],
        };
        retained.locations.push(`${i + 1} / ${r.zone}`);
        retainedGroups.set(key, retained);
      }
    }),
  );
  if (request.references !== undefined)
    referenceSelection = {
      format: "reference-selection/0.1",
      enabled: request.references !== false,
      appearances:
        request.references === false
          ? "all"
          : (request.references.appearances ?? "all"),
      ...(referenceDevices ? { filter: referenceDevices.filter } : {}),
      deviceUids:
        referenceDevices?.deviceUids ?? ir.devices.map((d) => d.uid).sort(),
      outsideDeviceUids: referenceDevices?.outsideDeviceUids ?? [],
      totalGroups: groups.size,
      retainedGroups: retainedGroups.size,
      omittedGroupKeys: [...groups.keys()].filter(
        (k) => !retainedGroups.has(k),
      ),
    };
  const refTable: DocumentationTable = {
    kind: "references",
    title: "Device and function references",
    columns: ["Device", "Function / representation", "Sheet / zone"],
    widths: [0.2, 0.35, 0.45],
    notes: [
      request.references && request.references.appearances === "drawings"
        ? "Repeated functions represent the same physical device. References include diagram appearances only."
        : "Repeated functions represent the same physical device. References include schedule appearances.",
      ...(referenceSelection
        ? [
            `Filtered reference index: ${retainedGroups.size} of ${groups.size} device/function groups retained. Content sheets and continuation references are unchanged.`,
          ]
        : []),
      ...referenceNotes(drafts, request),
    ],
    rows: [...retainedGroups]
      .sort(([, a], [, b]) => designationOrder(a, b))
      .map(([key, g]) => ({
        key,
        cells: [
          g.designation,
          g.functions,
          [...new Set(g.locations)].join("; "),
        ],
        deviceUids: [g.uid],
      })),
  };
  return {
    tables:
      request.references === false ? [indexTable] : [indexTable, refTable],
    referenceSelection,
  };
}

/** Titles are presentation; the final physical sheet number is the row identity. */
export function drawingIndex(
  drafts: readonly ReferenceDraft[],
  request: Pick<SchematicPacketRequest, "references" | "page">,
): DocumentationTable {
  const duplicates = new Map<string, number>();
  for (const draft of drafts) {
    const label = sheetLabel(draft.view);
    duplicates.set(label, (duplicates.get(label) ?? 0) + 1);
  }
  return {
    kind: "index",
    title: INDEX_TITLE,
    columns: ["Sheet", "View", "Devices"],
    widths: [0.08, 0.42, 0.5],
    notes: [
      "Index covers every final sheet, including index and reference pages. Devices are listed for content sheets.",
      ...(request.references === false
        ? [
            "Device/function reference index omitted by request; every issued sheet remains indexed.",
          ]
        : []),
    ],
    rows: drafts.map((draft, i) => {
      const d =
        "kind" in draft.view &&
        ["index", "references"].includes(draft.view.kind)
          ? { ...draft, references: [] }
          : draft;
      return {
        key: String(i + 1),
        cells: [
          String(i + 1),
          duplicates.get(sheetLabel(d.view)) === 1
            ? sheetLabel(d.view)
            : `${sheetLabel(d.view)} (sheet ${String(i + 1).padStart(2, "0")})`,
          [...new Set(d.references?.map((r) => r.designation) ?? [])].join(
            ", ",
          ),
        ],
        deviceUids: [...new Set(d.references?.map((r) => r.deviceUid) ?? [])],
      };
    }),
  };
}
