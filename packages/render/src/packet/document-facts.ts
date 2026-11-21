import { assemblyFactRows } from "./document-assembly-facts.js";
import { documentSourcePresentation } from "../internal/title-data/frame-context.js";
import { renderCache } from "./render-cache.js";
import { required } from "../presentation/util.js";
import type { ElectricalIr } from "@thermite/compiler";
import {
  buildDocumentation,
  type DocumentationTable,
  type ReportKind,
} from "@thermite/query";
import type { CompiledProjectPresentation } from "@thermite/compiler";
import {
  navigationHash,
  navigationSnapshotDigest,
} from "./navigation-identity.js";
import {
  sourceIncidences,
  type SourceIncidence,
} from "./navigation-incidence.js";
import type {
  DocumentFact,
  DocumentNeed,
  DocumentIdentity,
  SemanticColumn,
} from "./document-types.js";
export function factKey(fact: DocumentFact): string {
  switch (fact.kind) {
    case "conductor-incidence":
      return JSON.stringify([
        fact.kind,
        fact.element.kind,
        fact.element.kind === "cable_conductor"
          ? [fact.element.cableUid, fact.element.conductorId]
          : fact.element.uid,
        fact.end,
        fact.terminal.deviceUid,
        fact.terminal.terminalKey,
      ]);
    case "terminal-inventory":
      return JSON.stringify([
        fact.kind,
        fact.terminal.deviceUid,
        fact.terminal.terminalKey,
      ]);
    case "connector-port-status":
    case "port-link-status":
      return JSON.stringify([fact.kind, fact.deviceUid, fact.portKey]);
    case "core-inventory":
      return JSON.stringify([fact.kind, fact.cableUid, fact.conductorId]);
    case "assembly-pin-map":
      return JSON.stringify([fact.kind, fact.relationUid]);
    default:
      throw Error("Unsupported document fact");
  }
}
export const needColumns: Readonly<
  Record<DocumentNeed, readonly SemanticColumn[]>
> = {
  "conductor-incidence": ["identity", "endpoints", "status"],
  "terminal-inventory": ["identity", "connections", "status"],
  "connector-port-status": ["identity", "endpoints", "status"],
  "port-link-status": ["identity", "endpoints", "protocol", "status"],
  "assembly-pin-map": ["identity", "endpoints", "status", "pin-map"],
  "core-inventory": ["identity", "endpoints", "status"],
};
export const documentLabel = (kind: string) =>
  ({
    wires: "wire inventory",
    terminals: "terminal inventory",
    network: "network inventory",
    assemblies: "assembly inventory",
  })[kind] ?? "inventory";
export function documentIdentity(
  ir: Readonly<ElectricalIr>,
  presentation?: CompiledProjectPresentation,
): Omit<DocumentIdentity, "id"> {
  const source = documentSourcePresentation(presentation);
  return {
    snapshotDigest: navigationSnapshotDigest(ir),
    presentationDigest: navigationHash(source ?? null),
    revision: source?.revision ?? "UNSPECIFIED",
  };
}
export function factReport(need: DocumentNeed): ReportKind {
  return (
    {
      "conductor-incidence": "wires",
      "terminal-inventory": "terminals",
      "port-link-status": "network",
      "connector-port-status": "assemblies",
      "assembly-pin-map": "assemblies",
      "core-inventory": "wires",
    } as const
  )[need];
}
export function factRowKey(fact: DocumentFact): string {
  switch (fact.kind) {
    case "conductor-incidence":
      return fact.element.kind === "cable_conductor"
        ? JSON.stringify([fact.element.cableUid, fact.element.conductorId])
        : fact.element.uid;
    case "terminal-inventory":
      return JSON.stringify([
        fact.terminal.deviceUid,
        fact.terminal.terminalKey,
      ]);
    case "assembly-pin-map":
      return fact.relationUid;
    case "core-inventory":
      return JSON.stringify([fact.cableUid, fact.conductorId]);
    case "connector-port-status":
    case "port-link-status":
      return JSON.stringify([fact.deviceUid, fact.portKey]);
  }
}
export function rowFacts(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable,
  key: string,
  incidences: readonly SourceIncidence[] = sourceIncidences(ir),
  cores?: readonly Extract<DocumentFact, { kind: "core-inventory" }>[],
): {
  facts: DocumentFact[];
  columns: SemanticColumn[];
} {
  if (table.kind === "wires") {
    const facts: DocumentFact[] = incidences
      .filter((i) => factRowKey({ kind: "conductor-incidence", ...i }) === key)
      .map((i) => ({ kind: "conductor-incidence", ...i }));
    for (const core of cores ?? sourceCoreFacts(ir))
      if (JSON.stringify([core.cableUid, core.conductorId]) === key)
        facts.push({ ...core });
    return { facts, columns: ["identity", "endpoints", "status"] };
  }
  if (table.kind === "terminals") {
    const facts: DocumentFact[] = ir.terminals
      .filter((t) => JSON.stringify([t.id.deviceUid, t.id.terminalKey]) === key)
      .map((t) => ({ kind: "terminal-inventory", terminal: t.id }));
    return { facts, columns: ["identity", "connections", "status"] };
  }
  if (table.kind === "network") {
    const facts: DocumentFact[] = [];
    for (const d of ir.devices)
      for (const portKey of Object.keys(
        ir.deviceTypes.find((t) => t.id === d.typeId)?.ports ?? {},
      )) {
        const relation = ir.relations.find(
          (r) =>
            r.connection &&
            ((r.fromDeviceUid === d.uid && r.connection.fromPort === portKey) ||
              (r.toDeviceUid === d.uid && r.connection.toPort === portKey)),
        );
        if ((relation?.uid ?? JSON.stringify([d.uid, portKey])) === key)
          facts.push({ kind: "port-link-status", deviceUid: d.uid, portKey });
      }
    return { facts, columns: ["identity", "endpoints", "protocol", "status"] };
  }
  if (table.kind === "assemblies")
    return assemblyFactRows(ir).get(key) ?? { facts: [], columns: [] };
  return { facts: [], columns: [] };
}
/** Remove only the query's internal lookup notes; preserve unrelated native notes. */
export function companionNotes(
  table: DocumentationTable,
  rows: DocumentationTable["rows"],
  totalDevices: number,
): string[] {
  const selection = table.selection;
  const lookupNotes = new Set(
    selection
      ? [
          `Filtered report: ${selection.deviceUids.length} of ${totalDevices} devices selected; ${selection.retainedRows} of ${selection.totalRows} source rows retained.`,
          "Device-owned rows follow the selection; complete connection and cable rows retain peer details. Records without device endpoints remain included.",
        ]
      : [],
  );
  const notes = table.notes
    .filter((note) => !lookupNotes.has(note))
    .map((note) =>
      note.replace(
        "Lists every terminal, including",
        "Selected terminal rows may include",
      ),
    );
  const unit =
    table.kind === "wires"
      ? "conductor"
      : table.kind === "terminals"
        ? "terminal"
        : table.kind === "assemblies"
          ? "assembly"
          : "network";
  const complete = !selection && rows.length === table.rows.length;
  const scope = `${complete ? "all " : ""}${rows.length} ${unit} row${rows.length === 1 ? "" : "s"}`;
  return [
    ...notes,
    complete
      ? `Supplementary scope: ${scope} for source-detail notes; not a safety assessment.`
      : `Supplementary scope: ${scope} for source-detail notes; not ${table.kind === "terminals" ? "a safety assessment" : "a complete inventory or safety assessment"}.`,
  ];
}
/** Explicit device UIDs include non-strip terminals. Preserve whole native rows. */
export function factTable(
  ir: Readonly<ElectricalIr>,
  kind: ReportKind,
  facts: readonly DocumentFact[],
): DocumentationTable {
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind,
    ...(kind === "terminals"
      ? {
          filter: {
            devices: [
              ...new Set(
                facts.flatMap((f) =>
                  f.kind === "terminal-inventory" ? [f.terminal.deviceUid] : [],
                ),
              ),
            ],
          },
        }
      : {}),
  });
  const wanted = new Set(facts.map(factKey)),
    factsForRow = indexedRowFacts(ir);
  const { selection: _selection, ...native } = table;
  const rows = table.rows.filter((r) =>
    factsForRow(table, r.key).facts.some((f) => wanted.has(factKey(f))),
  );
  const coresOnly =
    kind === "wires" &&
    facts.length > 0 &&
    facts.every(
      (f) =>
        f.kind === "core-inventory" ||
        (f.kind === "conductor-incidence" &&
          f.element.kind === "cable_conductor"),
    );
  return {
    ...native,
    title: `Supplementary ${kind === "wires" ? (coresOnly ? "cable cores" : "connections") : documentLabel(kind).replace(" inventory", " details")}`,
    rows,
    notes: companionNotes(table, rows, ir.devices.length),
  };
}

function* sourceCoreFacts(
  ir: Readonly<ElectricalIr>,
): Generator<Extract<DocumentFact, { kind: "core-inventory" }>> {
  for (const cable of ir.cables) {
    const type = required(
      ir.cableTypes.find((t) => t.id === cable.typeId),
      "Missing document source",
    );
    for (const core of type.conductors)
      yield {
        kind: "core-inventory",
        cableUid: cable.uid,
        conductorId: core.id,
      };
  }
}

function createRowFactsIndex(ir: Readonly<ElectricalIr>) {
  let assemblies: ReturnType<typeof assemblyFactRows> | undefined;
  let rows: Map<string, SourceIncidence[]> | undefined,
    cores:
      | Map<string, Extract<DocumentFact, { kind: "core-inventory" }>[]>
      | undefined;
  return (table: DocumentationTable, key: string) => {
    if (table.kind === "assemblies")
      return (
        (assemblies ??= assemblyFactRows(ir)).get(key) ?? {
          facts: [],
          columns: [],
        }
      );
    if (!rows) {
      const grouped = new Map<string, SourceIncidence[]>();
      for (const incidence of sourceIncidences(ir)) {
        const rowKey = factRowKey({
          kind: "conductor-incidence",
          ...incidence,
        });
        const values = grouped.get(rowKey) ?? [];
        values.push(incidence);
        grouped.set(rowKey, values);
      }
      rows = grouped;
    }
    // Keep type validation lazy: non-wire rows never required cable types.
    if (table.kind === "wires" && !cores) {
      const grouped = new Map<
        string,
        Extract<DocumentFact, { kind: "core-inventory" }>[]
      >();
      for (const core of sourceCoreFacts(ir)) {
        const rowKey = factRowKey(core),
          values = grouped.get(rowKey) ?? [];
        values.push(core);
        grouped.set(rowKey, values);
      }
      cores = grouped;
    }
    return rowFacts(ir, table, key, rows.get(key) ?? [], cores?.get(key) ?? []);
  };
}
const rowIndexes = new WeakMap<
  NonNullable<ReturnType<typeof renderCache.getStore>>,
  WeakMap<Readonly<ElectricalIr>, ReturnType<typeof createRowFactsIndex>>
>();

/** One render's source endpoints and native cores, in their enumeration order. */
export function indexedRowFacts(ir: Readonly<ElectricalIr>) {
  const scope = renderCache.getStore();
  if (!scope) return createRowFactsIndex(ir);
  let indexes = rowIndexes.get(scope);
  if (!indexes) {
    indexes = new WeakMap();
    rowIndexes.set(scope, indexes);
  }
  let index = indexes.get(ir);
  if (!index) {
    index = createRowFactsIndex(ir);
    indexes.set(ir, index);
  }
  return index;
}
