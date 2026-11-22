import { renderCache } from "./render-cache.js";
import type { ElectricalIr } from "@thermite/compiler";
import {
  buildDocumentation,
  type DocumentationTable,
  type ScheduleReferences,
} from "@thermite/query";
import type { DocumentNeedSeed } from "./document-types.js";
import {
  factKey,
  factReport,
  needColumns,
  indexedRowFacts,
} from "./document-facts.js";

export const MAX_NATIVE_TABLE_CACHE_ENTRIES = 64;

interface NativeTableEntry {
  kind: string;
  device: string | undefined;
  references: ScheduleReferences | undefined;
  table: DocumentationTable;
}
const nativeTables = new WeakMap<
  NonNullable<ReturnType<typeof renderCache.getStore>>,
  { count: number; byIr: WeakMap<Readonly<ElectricalIr>, NativeTableEntry[]> }
>();
function nativeTableEntries(ir: Readonly<ElectricalIr>) {
  const scope = renderCache.getStore();
  if (!scope) return undefined;
  let tables = nativeTables.get(scope);
  if (!tables) {
    tables = { count: 0, byIr: new WeakMap() };
    nativeTables.set(scope, tables);
  }
  let entries = tables.byIr.get(ir);
  if (!entries) {
    entries = [];
    tables.byIr.set(ir, entries);
  }
  return { entries, tables };
}
/** The public query remains the source projection, including non-strip devices. */
export function nativeDocumentTable(
  ir: Readonly<ElectricalIr>,
  kind: string,
  rowKey: string,
  references?: ScheduleReferences,
): DocumentationTable | undefined {
  if (!["wires", "terminals", "network", "assemblies"].includes(kind))
    return undefined;
  let device: string | undefined;
  if (kind === "terminals") {
    try {
      const key: unknown = JSON.parse(rowKey);
      if (
        !Array.isArray(key) ||
        typeof key[0] !== "string" ||
        !ir.devices.some((d) => d.uid === key[0])
      )
        return undefined;
      device = key[0];
    } catch {
      return undefined;
    }
  }
  const cached = nativeTableEntries(ir),
    actualReferences = kind === "wires" ? references : undefined;
  const found = cached?.entries.find(
    (e) =>
      e.kind === kind &&
      e.device === device &&
      e.references === actualReferences,
  );
  if (found) return found.table;
  const table = buildDocumentation(
    ir,
    {
      format: "documentation-view-request/0.1",
      kind: kind as "wires" | "terminals" | "network" | "assemblies",
      ...(device ? { device } : {}),
    },
    kind === "wires" ? (references ?? {}) : undefined,
  );
  if (cached && cached.tables.count < MAX_NATIVE_TABLE_CACHE_ENTRIES) {
    cached.entries.push({ kind, device, references: actualReferences, table });
    cached.tables.count++;
  }
  return table;
}
const keys = (value: object) => Object.keys(value).sort().join(",");
function factShape(fact: DocumentNeedSeed["requiredFacts"][number]) {
  const shapes = {
    "conductor-incidence": "element,end,kind,terminal",
    "terminal-inventory": "kind,terminal",
    "port-link-status": "deviceUid,kind,portKey",
    "connector-port-status": "deviceUid,kind,portKey",
    "core-inventory": "cableUid,conductorId,kind",
    "assembly-pin-map": "kind,relationUid",
  };
  if (!fact || keys(fact) !== shapes[fact.kind])
    throw Error("Invalid document fact schema");
  if (fact.kind === "conductor-incidence" || fact.kind === "terminal-inventory")
    if (!fact.terminal || keys(fact.terminal) !== "deviceUid,terminalKey")
      throw Error("Invalid terminal fact schema");
  if (
    fact.kind === "conductor-incidence" &&
    (!fact.element ||
      keys(fact.element) !==
        (fact.element.kind === "cable_conductor"
          ? "cableUid,conductorId,kind"
          : "kind,uid"))
  )
    throw Error("Invalid incidence fact schema");
}
export function validateDocumentNeed(
  ir: Readonly<ElectricalIr>,
  need: DocumentNeedSeed,
  cache = new Map<string, ReadonlySet<string>>(),
) {
  if (
    !need ||
    Object.keys(need).some(
      (k) =>
        ![
          "viewKey",
          "noteId",
          "need",
          "requiredFacts",
          "requiredColumns",
          "subject",
          "count",
        ].includes(k),
    ) ||
    !Object.hasOwn(needColumns, need.need) ||
    !need.noteId?.trim() ||
    !need.subject?.trim() ||
    !Array.isArray(need.requiredFacts) ||
    !Array.isArray(need.requiredColumns)
  )
    throw Error("Invalid document dependency schema");
  if (
    JSON.stringify(need.requiredColumns) !==
    JSON.stringify(needColumns[need.need])
  )
    throw Error("Required semantic columns are incomplete or unsupported");
  if (
    ["conductor-incidence", "terminal-inventory"].includes(need.need) &&
    need.count !== need.requiredFacts.length
  )
    throw Error("Hidden count does not equal native fact count");
  const seen = new Set<string>();
  for (const fact of need.requiredFacts) {
    factShape(fact);
    if (fact.kind !== need.need)
      throw Error("Document need and fact kinds disagree");
    const cacheKey =
      fact.kind === "terminal-inventory"
        ? `${need.need}/${fact.terminal.deviceUid}`
        : need.need;
    if (!cache.has(cacheKey)) {
      const table = nativeDocumentTable(
        ir,
        factReport(need.need),
        fact.kind === "terminal-inventory"
          ? JSON.stringify([fact.terminal.deviceUid, fact.terminal.terminalKey])
          : "",
      );
      cache.set(cacheKey, nativeFactKeys(ir, table));
    }
    const key = factKey(fact);
    if (seen.has(key) || !cache.get(cacheKey)?.has(key))
      throw Error("Duplicate or non-native document fact");
    seen.add(key);
  }
}

function nativeFactKeys(
  ir: Readonly<ElectricalIr>,
  table: DocumentationTable | undefined,
) {
  if (!table) return new Set<string>();
  const factsForRow = indexedRowFacts(ir);
  return new Set(
    table.rows.flatMap((r) => factsForRow(table, r.key).facts.map(factKey)),
  );
}
