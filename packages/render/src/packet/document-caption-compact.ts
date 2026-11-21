import type { ElectricalIr } from "@thermite/compiler";
import type {
  DocumentCaptionGroup,
  DocumentDependency,
  DocumentFact,
  IssuedDocument,
  IssuedDocumentRow,
} from "./document-types.js";
import { factKey, rowFacts } from "./document-facts.js";
import { nativeDocumentTable } from "./document-native.js";
import { destinationToken } from "./navigation-location.js";
import { required } from "../presentation/util.js";
import { documentCaptionLead } from "./document-caption-text.js";

const units = {
  "conductor-incidence": ["physical connection", "physical connections"],
  "terminal-inventory": ["terminal", "terminals"],
  "connector-port-status": ["port", "ports"],
  "port-link-status": ["port", "ports"],
  "core-inventory": ["core", "cores"],
  "assembly-pin-map": ["assembly", "assemblies"],
} as const;
function factOwner(
  ir: Readonly<ElectricalIr>,
  fact: DocumentFact,
  devices: readonly string[],
): DocumentCaptionGroup["owner"] {
  if (fact.kind === "port-link-status" || fact.kind === "connector-port-status")
    return { kind: "device", uid: fact.deviceUid };
  if (fact.kind === "conductor-incidence" || fact.kind === "terminal-inventory")
    return { kind: "device", uid: fact.terminal.deviceUid };
  if (fact.kind === "assembly-pin-map")
    return {
      kind: "device",
      uid: required(
        ir.relations.find((r) => r.uid === fact.relationUid),
        "Missing assembly",
      ).fromDeviceUid,
    };
  return devices[0]
    ? { kind: "device", uid: devices[0] }
    : { kind: "cable", uid: fact.cableUid };
}
function ownerName(
  ir: Readonly<ElectricalIr>,
  owner: DocumentCaptionGroup["owner"],
) {
  return required(
    (owner.kind === "device" ? ir.devices : ir.cables).find(
      (d) => d.uid === owner.uid,
    ),
    "Missing compact caption owner",
  ).designation;
}
function printedOwner(
  ir: Readonly<ElectricalIr>,
  owner: DocumentCaptionGroup["owner"],
  native: { cells: readonly string[]; deviceUids: readonly string[] },
) {
  const name = ownerName(ir, owner);
  if (owner.kind === "device" && !native.deviceUids.includes(owner.uid))
    throw Error("Compact caption device is absent from its native row");
  if (
    !native.cells.some((cell) =>
      cell
        .split("\n")
        .some(
          (line) =>
            line === name ||
            [":", ".", "/"].some((separator) =>
              line.startsWith(name + separator),
            ),
        ),
    )
  )
    throw Error("Compact caption owner is not printed in its native row");
}
function addRow(
  ir: Readonly<ElectricalIr>,
  document: IssuedDocument,
  row: IssuedDocumentRow,
  pending: Set<string>,
  groups: Map<string, DocumentCaptionGroup>,
) {
  const table = required(
    nativeDocumentTable(ir, document.kind, row.nativeKey),
    "Missing compact table",
  );
  const native = required(
    table.rows.find((r) => r.key === row.nativeKey),
    "Missing compact source row",
  );
  const nativeFacts = new Set(
    rowFacts(ir, table, row.nativeKey).facts.map(factKey),
  );
  for (const fact of row.facts) {
    const key = factKey(fact);
    if (!pending.has(key)) continue;
    if (!nativeFacts.has(key))
      throw Error("Compact fact is absent from its native row");
    const owner = factOwner(ir, fact, native.deviceUids);
    printedOwner(ir, owner, native);
    const id = JSON.stringify([document.id, row.sheet, row.zone, owner]);
    const group = groups.get(id) ?? {
      documentId: document.id,
      rows: [],
      sheet: row.sheet,
      zone: row.zone,
      owner,
      count: 0,
      unit: units[fact.kind][1],
      factKeys: [],
    };
    if (!group.rows.includes(row.id)) group.rows.push(row.id);
    group.factKeys.push(key);
    group.count++;
    groups.set(id, group);
    pending.delete(key);
  }
}
/** One scoped native fact belongs to one resolved row/owner/region group. */
export function compactDocumentCaption(
  ir: Readonly<ElectricalIr>,
  need: DocumentDependency,
  documents: readonly IssuedDocument[],
) {
  const pending = new Set(need.requiredFacts.map(factKey));
  const groups = new Map<string, DocumentCaptionGroup>();
  for (const resolution of need.resolution) {
    const document = required(
      documents.find((d) => d.id === resolution.documentId),
      "Missing compact document",
    );
    for (const id of resolution.rows)
      addRow(
        ir,
        document,
        required(
          document.rows.find((r) => r.id === id),
          "Missing compact row",
        ),
        pending,
        groups,
      );
  }
  if (pending.size || !groups.size)
    throw Error("Compact caption leaves unresolved facts");
  const tokens = documentCaptionLead(need);
  tokens[tokens.length - 1] += ":";
  let prior = "";
  for (const group of groups.values()) {
    if (prior) tokens[tokens.length - 1] += ";";
    if (prior !== group.documentId)
      tokens.push(
        ...required(
          documents.find((d) => d.id === group.documentId),
          "Missing compact document",
        ).label.split(" "),
      );
    const forms = units[need.need];
    const unit = forms[group.count === 1 ? 0 : 1];
    tokens.push(
      destinationToken(group),
      `(${ownerName(ir, group.owner)}: ${group.count} ${unit})`,
    );
    prior = group.documentId;
  }
  tokens[tokens.length - 1] += ".";
  return { tokens, groups: [...groups.values()] };
}
