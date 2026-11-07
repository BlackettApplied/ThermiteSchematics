import { AGENT_REQUEST_VOCABULARY } from "./request-vocabulary.js";
import {
  serializeQueryResult,
  type InspectResult as QueryInspectResult,
  type ObjectSelector,
  type QueryEngine,
  type QueryResult,
} from "@thermite/query";

import type { AgentToolRequestBase, JsonValue } from "./common/contracts.js";
import { detachAndFreezePlainJson } from "./common/plain-json.js";
import {
  firstAdditionalProperty,
  recordValue,
  requiredRecord,
  requiredString,
  type FieldValidationResult,
} from "./common/request-validation.js";
import {
  validateSourceInclude,
  type SourceMetadataRequest,
  type SourceMetadataResult,
} from "./source-metadata.js";

export type InspectResult = SourceMetadataResult<QueryInspectResult>;

export interface InspectObjectRequest
  extends AgentToolRequestBase, SourceMetadataRequest {
  readonly selector: ObjectSelector;
}

const REQUEST_FIELDS = new Set(["format", "project", "selector", "include"]);
const SELECTOR_FIELDS = new Set(["by", "value"]);
const REQUEST_FORMATS = new Set<string>(
  AGENT_REQUEST_VOCABULARY["inspect"]["/format"],
);
const SELECTOR_KINDS = new Set<string>(
  AGENT_REQUEST_VOCABULARY["inspect"]["/selector/by"],
);

export function inspectCompiledProject(
  engine: QueryEngine,
  selector: ObjectSelector,
): QueryResult<InspectResult> {
  const inspected = engine.inspect(selector);
  if (!inspected.ok) return inspected;
  const canonical = JSON.parse(
    serializeQueryResult(inspected.value),
  ) as InspectResult;
  return { ok: true, value: canonical };
}

export function validateInspectRequest(
  request: unknown,
): FieldValidationResult<InspectObjectRequest> {
  const detached = detachAndFreezePlainJson("inspect", request);
  if (!detached.ok) return detached;
  const root = recordValue("inspect", detached.value as JsonValue, "");
  if (!root.ok) return root;
  const format = requiredString(
    "inspect",
    root.value,
    "format",
    "",
    REQUEST_FORMATS,
  );
  if (!format.ok) return format;
  const project = requiredString("inspect", root.value, "project");
  if (!project.ok) return project;
  const selector = requiredRecord("inspect", root.value, "selector");
  if (!selector.ok) return selector;
  const by = requiredString(
    "inspect",
    selector.value,
    "by",
    "/selector",
    SELECTOR_KINDS,
  );
  if (!by.ok) return by;
  const value = requiredString("inspect", selector.value, "value", "/selector");
  if (!value.ok) return value;
  const selectorAdditional = firstAdditionalProperty(
    "inspect",
    selector.value,
    SELECTOR_FIELDS,
    "/selector",
  );
  if (selectorAdditional !== undefined) {
    return { ok: false, error: selectorAdditional };
  }
  const include = validateSourceInclude("inspect", root.value);
  if (!include.ok) return include;
  const additional = firstAdditionalProperty(
    "inspect",
    root.value,
    REQUEST_FIELDS,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: detached.value as unknown as InspectObjectRequest,
  };
}
