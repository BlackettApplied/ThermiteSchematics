import { compareText } from "./ordering.js";
import type { QueryCommandResult } from "./types.js";

type JsonRecord = Record<string, unknown>;

const METADATA_FIELDS = new Set([
  "rating",
  "electrical",
  "properties",
  "construction",
]);
const PROJECT_OBJECT_FIELDS = [
  "kind",
  "uid",
  "designation",
  "description",
  "aliases",
] as const;

const INSPECTED_OBJECT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  device: [
    ...PROJECT_OBJECT_FIELDS,
    "typeId",
    "location",
    "terminals",
    "functions",
    "gangedGroups",
    "internalRelations",
    "projectRelations",
  ],
  wire: [...PROJECT_OBJECT_FIELDS, "properties", "endpoints", "net"],
  jumper: [...PROJECT_OBJECT_FIELDS, "endpoints", "net"],
  cable: [
    ...PROJECT_OBJECT_FIELDS,
    "typeId",
    "cableType",
    "conductorCount",
    "conductorIds",
  ],
  relation: [...PROJECT_OBJECT_FIELDS, "verb", "from", "to"],
  potential: [
    ...PROJECT_OBJECT_FIELDS,
    "name",
    "electrical",
    "terminal",
    "net",
  ],
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(record: JsonRecord, key: string): boolean {
  return Object.hasOwn(record, key);
}

function preferredFields(record: JsonRecord): readonly string[] {
  const keys = Object.keys(record);
  if (has(record, "ok") && has(record, "value")) {
    return ["ok", "value"];
  }
  if (has(record, "ok") && has(record, "error")) {
    return ["ok", "error"];
  }
  if (
    keys.length === 2 &&
    has(record, "deviceUid") &&
    has(record, "terminalKey")
  ) {
    return ["deviceUid", "terminalKey"];
  }
  if (
    keys.length === 2 &&
    has(record, "cableUid") &&
    has(record, "conductorId")
  ) {
    return ["cableUid", "conductorId"];
  }
  if (has(record, "kind") && has(record, "uid") && has(record, "aliases")) {
    return (
      INSPECTED_OBJECT_FIELDS[String(record.kind)] ?? [
        ...PROJECT_OBJECT_FIELDS,
        "typeId",
        "location",
      ]
    );
  }
  if (has(record, "code") && has(record, "message") && has(record, "input")) {
    return [
      "code",
      "message",
      "input",
      "expectedKind",
      "actualKind",
      "deviceDesignation",
      "terminalKey",
    ];
  }
  if (
    has(record, "id") &&
    has(record, "deviceDesignation") &&
    has(record, "display")
  ) {
    return [
      "id",
      "deviceDesignation",
      "display",
      "role",
      "rating",
      "connectionPolicy",
      "description",
      "net",
      "elements",
    ];
  }
  if (has(record, "uid") && has(record, "name") && has(record, "electrical")) {
    return ["uid", "name", "electrical"];
  }
  if (
    has(record, "id") &&
    has(record, "potentials") &&
    has(record, "terminals") &&
    has(record, "elements")
  ) {
    return ["id", "potentials", "terminals", "elements"];
  }
  if (has(record, "id") && has(record, "potentials")) {
    return ["id", "potentials"];
  }
  if (
    has(record, "uid") &&
    has(record, "display") &&
    has(record, "verb") &&
    has(record, "from") &&
    has(record, "to")
  ) {
    return ["uid", "designation", "display", "verb", "from", "to"];
  }
  if (record.kind === "wire" && has(record, "display")) {
    return ["kind", "uid", "designation", "display"];
  }
  if (record.kind === "jumper" && has(record, "display")) {
    return ["kind", "uid", "designation", "display"];
  }
  if (record.kind === "cable_conductor" && has(record, "display")) {
    return ["kind", "cableUid", "cableDesignation", "conductorId", "display"];
  }
  if (has(record, "element") && has(record, "endpoints")) {
    return ["element", "endpoints"];
  }
  if (has(record, "key") && has(record, "kind") && has(record, "terminals")) {
    return ["key", "kind", "normalState", "direction", "terminals"];
  }
  if (
    has(record, "verb") &&
    has(record, "fromFunctionKey") &&
    has(record, "toFunctionKey")
  ) {
    return ["verb", "fromFunctionKey", "toFunctionKey"];
  }
  if (has(record, "id") && has(record, "functionKeys")) {
    return ["id", "functionKeys"];
  }
  if (
    has(record, "relation") &&
    has(record, "direction") &&
    has(record, "otherDevice")
  ) {
    return ["relation", "direction", "otherDevice"];
  }
  if (
    has(record, "terminal") &&
    has(record, "element") &&
    has(record, "otherTerminal") &&
    has(record, "otherDevice")
  ) {
    return ["terminal", "element", "otherTerminal", "otherDevice"];
  }
  if (
    has(record, "net") &&
    has(record, "roots") &&
    has(record, "visits") &&
    has(record, "elements")
  ) {
    return ["net", "roots", "visits", "elements"];
  }
  if (has(record, "terminal") && has(record, "hops")) {
    return ["terminal", "hops", "via"];
  }
  if (has(record, "from") && has(record, "element")) {
    return ["from", "element"];
  }
  if (
    has(record, "id") &&
    has(record, "display") &&
    has(record, "color") &&
    has(record, "endpoints") &&
    has(record, "net")
  ) {
    return ["id", "display", "color", "size", "endpoints", "net"];
  }
  if (
    has(record, "id") &&
    (has(record, "shield") || has(record, "construction"))
  ) {
    return ["id", "shield", "construction"];
  }
  if (has(record, "command") && record.command === "inspect") {
    return ["command", "object"];
  }
  if (has(record, "command") && record.command === "neighbors") {
    return ["command", "device", "conductive", "relations"];
  }
  if (has(record, "command") && record.command === "trace") {
    return ["command", "device", "components"];
  }
  if (has(record, "command") && record.command === "net") {
    return ["command", "selectedTerminal", "net"];
  }
  if (has(record, "command") && record.command === "cable") {
    return ["command", "cable", "cableType", "conductors"];
  }
  return [];
}

function orderedKeys(record: JsonRecord, metadata: boolean): string[] {
  const keys = Object.keys(record).filter((key) => record[key] !== undefined);
  if (metadata) return keys.sort(compareText);
  const rank = new Map(
    preferredFields(record).map((key, index) => [key, index]),
  );
  return keys.sort((left, right) => {
    const leftRank = rank.get(left);
    const rightRank = rank.get(right);
    if (leftRank !== undefined || rightRank !== undefined) {
      return (
        (leftRank ?? Number.MAX_SAFE_INTEGER) -
          (rightRank ?? Number.MAX_SAFE_INTEGER) || compareText(left, right)
      );
    }
    return compareText(left, right);
  });
}

function canonicalCopy(value: unknown, metadata = false): unknown {
  if (Array.isArray(value)) {
    return value.map((member) => canonicalCopy(member, metadata));
  }
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const key of orderedKeys(value, metadata)) {
    result[key] = canonicalCopy(
      value[key],
      metadata || METADATA_FIELDS.has(key),
    );
  }
  return result;
}

export function serializeQueryResult(result: QueryCommandResult): string {
  return `${JSON.stringify(canonicalCopy(result), null, 2)}\n`;
}
