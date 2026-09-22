import type { ObjectSelector } from "@thermite/query";
import type {
  RenderedSchematic,
  SchematicFlow,
  SchematicViewRequest,
} from "@thermite/render";

import type { AgentToolRequestBase, JsonValue } from "./common/contracts.js";
import { detachAndFreezePlainJson } from "./common/plain-json.js";
import {
  firstAdditionalProperty,
  optionalString,
  recordValue,
  requiredBoolean,
  requiredRecord,
  requiredString,
  type FieldValidationResult,
  type JsonRecord,
} from "./common/request-validation.js";

export type { RenderedSchematic } from "@thermite/render";

export interface CreateViewRequest extends AgentToolRequestBase {
  readonly spec: SchematicViewRequest;
}

const REQUEST_FIELDS = new Set(["format", "project", "spec"]);
const LEGACY_SPEC_FIELDS = new Set(["format", "family", "root", "flow"]);
const INTENT_SPEC_FIELDS = new Set(["format", "root", "intent", "flow"]);
const SELECTOR_FIELDS = new Set(["by", "value"]);
const TRACE_INTENT_FIELDS = new Set(["kind", "to", "includePower"]);
const SIMPLE_INTENT_FIELDS = new Set(["kind"]);
const REQUEST_FORMATS = new Set(["agent-tool-request/0.1"]);
const SPEC_FORMATS = new Set([
  "schematic-view-request/0.1",
  "schematic-view-request/0.2",
]);
const FAMILIES = new Set(["control", "power"]);
const FLOWS = new Set(["left-to-right", "top-to-bottom"]);
const SELECTOR_KINDS = new Set(["uid", "designation"]);
const INTENT_KINDS = new Set(["trace", "conductors", "loads"]);

function validateSelector(
  record: JsonRecord,
  field: string,
): FieldValidationResult<ObjectSelector> {
  const by = requiredString("create-view", record, "by", field, SELECTOR_KINDS);
  if (!by.ok) return by;
  const value = requiredString("create-view", record, "value", field);
  if (!value.ok) return value;
  const additional = firstAdditionalProperty(
    "create-view",
    record,
    SELECTOR_FIELDS,
    field,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return { ok: true, value: record as unknown as ObjectSelector };
}

function validateOptionalFlow(
  spec: JsonRecord,
): FieldValidationResult<SchematicFlow | undefined> {
  return optionalString(
    "create-view",
    spec,
    "flow",
    "/spec",
    FLOWS,
  ) as FieldValidationResult<SchematicFlow | undefined>;
}

function validateLegacySpec(
  spec: JsonRecord,
): FieldValidationResult<SchematicViewRequest> {
  const family = requiredString(
    "create-view",
    spec,
    "family",
    "/spec",
    FAMILIES,
  );
  if (!family.ok) return family;
  const root = requiredRecord("create-view", spec, "root", "/spec");
  if (!root.ok) return root;
  const selector = validateSelector(root.value, "/spec/root");
  if (!selector.ok) return selector;
  const flow = validateOptionalFlow(spec);
  if (!flow.ok) return flow;
  const additional = firstAdditionalProperty(
    "create-view",
    spec,
    LEGACY_SPEC_FIELDS,
    "/spec",
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return { ok: true, value: spec as unknown as SchematicViewRequest };
}

function validateIntent(intent: JsonRecord): FieldValidationResult<JsonRecord> {
  const kind = requiredString(
    "create-view",
    intent,
    "kind",
    "/spec/intent",
    INTENT_KINDS,
  );
  if (!kind.ok) return kind;

  if (kind.value === "trace") {
    const to = requiredRecord("create-view", intent, "to", "/spec/intent");
    if (!to.ok) return to;
    const selector = validateSelector(to.value, "/spec/intent/to");
    if (!selector.ok) return selector;
    const includePower = requiredBoolean(
      "create-view",
      intent,
      "includePower",
      "/spec/intent",
    );
    if (!includePower.ok) return includePower;
    const additional = firstAdditionalProperty(
      "create-view",
      intent,
      TRACE_INTENT_FIELDS,
      "/spec/intent",
    );
    if (additional !== undefined) return { ok: false, error: additional };
  } else {
    const additional = firstAdditionalProperty(
      "create-view",
      intent,
      SIMPLE_INTENT_FIELDS,
      "/spec/intent",
    );
    if (additional !== undefined) return { ok: false, error: additional };
  }

  return { ok: true, value: intent };
}

function validateIntentSpec(
  spec: JsonRecord,
): FieldValidationResult<SchematicViewRequest> {
  const root = requiredRecord("create-view", spec, "root", "/spec");
  if (!root.ok) return root;
  const selector = validateSelector(root.value, "/spec/root");
  if (!selector.ok) return selector;
  const intent = requiredRecord("create-view", spec, "intent", "/spec");
  if (!intent.ok) return intent;
  const validatedIntent = validateIntent(intent.value);
  if (!validatedIntent.ok) return validatedIntent;
  const flow = validateOptionalFlow(spec);
  if (!flow.ok) return flow;
  const additional = firstAdditionalProperty(
    "create-view",
    spec,
    INTENT_SPEC_FIELDS,
    "/spec",
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return { ok: true, value: spec as unknown as SchematicViewRequest };
}

export function validateCreateViewRequest(
  request: unknown,
): FieldValidationResult<CreateViewRequest> {
  const detached = detachAndFreezePlainJson("create-view", request);
  if (!detached.ok) return detached;
  const root = recordValue("create-view", detached.value as JsonValue, "");
  if (!root.ok) return root;
  const format = requiredString(
    "create-view",
    root.value,
    "format",
    "",
    REQUEST_FORMATS,
  );
  if (!format.ok) return format;
  const project = requiredString("create-view", root.value, "project");
  if (!project.ok) return project;
  const spec = requiredRecord("create-view", root.value, "spec");
  if (!spec.ok) return spec;
  const specFormat = requiredString(
    "create-view",
    spec.value,
    "format",
    "/spec",
    SPEC_FORMATS,
  );
  if (!specFormat.ok) return specFormat;
  const validatedSpec =
    specFormat.value === "schematic-view-request/0.1"
      ? validateLegacySpec(spec.value)
      : validateIntentSpec(spec.value);
  if (!validatedSpec.ok) return validatedSpec;
  const additional = firstAdditionalProperty(
    "create-view",
    root.value,
    REQUEST_FIELDS,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: detached.value as unknown as CreateViewRequest,
  };
}
