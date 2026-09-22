import {
  serializeQueryResult,
  type CableResult,
  type NeighborsResult,
  type NetResult,
  type ObjectSelector,
  type QueryEngine,
  type QueryResult,
  type TerminalSelector,
  type TraceResult,
} from "@thermite/query";

import type { AgentToolRequestBase, JsonValue } from "./common/contracts.js";
import { detachAndFreezePlainJson } from "./common/plain-json.js";
import {
  firstAdditionalProperty,
  recordValue,
  requiredRecord,
  requiredString,
  type FieldValidationResult,
  type JsonRecord,
} from "./common/request-validation.js";

export interface ExecuteGraphQueryRequest extends AgentToolRequestBase {
  readonly query:
    | {
        readonly operation: "neighbors" | "trace" | "cable";
        readonly selector: ObjectSelector;
      }
    | {
        readonly operation: "net";
        readonly selector: TerminalSelector;
      };
}

export type GraphQueryValue =
  NeighborsResult | TraceResult | NetResult | CableResult;

const REQUEST_FIELDS = new Set(["format", "project", "query"]);
const QUERY_FIELDS = new Set(["operation", "selector"]);
const OBJECT_SELECTOR_FIELDS = new Set(["by", "value"]);
const TERMINAL_ID_SELECTOR_FIELDS = new Set(["by", "value"]);
const TERMINAL_ID_FIELDS = new Set(["deviceUid", "terminalKey"]);
const TERMINAL_PARTS_SELECTOR_FIELDS = new Set([
  "by",
  "deviceDesignation",
  "terminalKey",
]);
const TERMINAL_DISPLAY_SELECTOR_FIELDS = new Set(["by", "value"]);
const REQUEST_FORMATS = new Set(["agent-tool-request/0.1"]);
const QUERY_OPERATIONS = new Set(["neighbors", "trace", "cable", "net"]);
const OBJECT_SELECTOR_KINDS = new Set(["uid", "designation"]);
const TERMINAL_SELECTOR_KINDS = new Set(["id", "parts", "display"]);

function validateObjectSelector(
  record: JsonRecord,
): FieldValidationResult<ObjectSelector> {
  const by = requiredString(
    "query",
    record,
    "by",
    "/query/selector",
    OBJECT_SELECTOR_KINDS,
  );
  if (!by.ok) return by;
  const value = requiredString("query", record, "value", "/query/selector");
  if (!value.ok) return value;
  const additional = firstAdditionalProperty(
    "query",
    record,
    OBJECT_SELECTOR_FIELDS,
    "/query/selector",
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: record as unknown as ObjectSelector,
  };
}

function validateTerminalIdSelector(
  record: JsonRecord,
): FieldValidationResult<TerminalSelector> {
  const value = requiredRecord("query", record, "value", "/query/selector");
  if (!value.ok) return value;
  const deviceUid = requiredString(
    "query",
    value.value,
    "deviceUid",
    "/query/selector/value",
  );
  if (!deviceUid.ok) return deviceUid;
  const terminalKey = requiredString(
    "query",
    value.value,
    "terminalKey",
    "/query/selector/value",
  );
  if (!terminalKey.ok) return terminalKey;
  const valueAdditional = firstAdditionalProperty(
    "query",
    value.value,
    TERMINAL_ID_FIELDS,
    "/query/selector/value",
  );
  if (valueAdditional !== undefined) {
    return { ok: false, error: valueAdditional };
  }
  const additional = firstAdditionalProperty(
    "query",
    record,
    TERMINAL_ID_SELECTOR_FIELDS,
    "/query/selector",
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: record as unknown as TerminalSelector,
  };
}

function validateTerminalPartsSelector(
  record: JsonRecord,
): FieldValidationResult<TerminalSelector> {
  const deviceDesignation = requiredString(
    "query",
    record,
    "deviceDesignation",
    "/query/selector",
  );
  if (!deviceDesignation.ok) return deviceDesignation;
  const terminalKey = requiredString(
    "query",
    record,
    "terminalKey",
    "/query/selector",
  );
  if (!terminalKey.ok) return terminalKey;
  const additional = firstAdditionalProperty(
    "query",
    record,
    TERMINAL_PARTS_SELECTOR_FIELDS,
    "/query/selector",
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: record as unknown as TerminalSelector,
  };
}

function validateTerminalDisplaySelector(
  record: JsonRecord,
): FieldValidationResult<TerminalSelector> {
  const value = requiredString("query", record, "value", "/query/selector");
  if (!value.ok) return value;
  const additional = firstAdditionalProperty(
    "query",
    record,
    TERMINAL_DISPLAY_SELECTOR_FIELDS,
    "/query/selector",
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: record as unknown as TerminalSelector,
  };
}

function validateTerminalSelector(
  record: JsonRecord,
): FieldValidationResult<TerminalSelector> {
  const by = requiredString(
    "query",
    record,
    "by",
    "/query/selector",
    TERMINAL_SELECTOR_KINDS,
  );
  if (!by.ok) return by;
  if (by.value === "id") return validateTerminalIdSelector(record);
  if (by.value === "parts") return validateTerminalPartsSelector(record);
  return validateTerminalDisplaySelector(record);
}

export function executeGraphQuery(
  engine: QueryEngine,
  query: ExecuteGraphQueryRequest["query"],
): QueryResult<GraphQueryValue> {
  let result: QueryResult<GraphQueryValue>;
  switch (query.operation) {
    case "neighbors":
      result = engine.neighbors(query.selector);
      break;
    case "trace":
      result = engine.trace(query.selector);
      break;
    case "net":
      result = engine.net(query.selector);
      break;
    case "cable":
      result = engine.cable(query.selector);
      break;
  }
  if (!result.ok) return result;
  const canonical = JSON.parse(
    serializeQueryResult(result.value),
  ) as GraphQueryValue;
  return { ok: true, value: canonical };
}

export function validateGraphQueryRequest(
  request: unknown,
): FieldValidationResult<ExecuteGraphQueryRequest> {
  const detached = detachAndFreezePlainJson("query", request);
  if (!detached.ok) return detached;
  const root = recordValue("query", detached.value as JsonValue, "");
  if (!root.ok) return root;
  const format = requiredString(
    "query",
    root.value,
    "format",
    "",
    REQUEST_FORMATS,
  );
  if (!format.ok) return format;
  const project = requiredString("query", root.value, "project");
  if (!project.ok) return project;
  const query = requiredRecord("query", root.value, "query");
  if (!query.ok) return query;
  const operation = requiredString(
    "query",
    query.value,
    "operation",
    "/query",
    QUERY_OPERATIONS,
  );
  if (!operation.ok) return operation;
  const selector = requiredRecord("query", query.value, "selector", "/query");
  if (!selector.ok) return selector;
  const selectorResult =
    operation.value === "net"
      ? validateTerminalSelector(selector.value)
      : validateObjectSelector(selector.value);
  if (!selectorResult.ok) return selectorResult;
  const queryAdditional = firstAdditionalProperty(
    "query",
    query.value,
    QUERY_FIELDS,
    "/query",
  );
  if (queryAdditional !== undefined) {
    return { ok: false, error: queryAdditional };
  }
  const additional = firstAdditionalProperty(
    "query",
    root.value,
    REQUEST_FIELDS,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: detached.value as unknown as ExecuteGraphQueryRequest,
  };
}
