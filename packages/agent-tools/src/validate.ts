import type { AgentToolRequestBase, JsonValue } from "./common/contracts.js";
import { detachAndFreezePlainJson } from "./common/plain-json.js";
import {
  firstAdditionalProperty,
  recordValue,
  requiredString,
  type FieldValidationResult,
} from "./common/request-validation.js";

export interface ValidateProjectRequest extends AgentToolRequestBase {}

export interface ValidateProjectValue {
  readonly valid: true;
}

const REQUEST_FIELDS = new Set(["format", "project"]);
const REQUEST_FORMATS = new Set(["agent-tool-request/0.1"]);

export function validateValidateProjectRequest(
  request: unknown,
): FieldValidationResult<ValidateProjectRequest> {
  const detached = detachAndFreezePlainJson("validate", request);
  if (!detached.ok) return detached;
  const root = recordValue("validate", detached.value as JsonValue, "");
  if (!root.ok) return root;
  const format = requiredString(
    "validate",
    root.value,
    "format",
    "",
    REQUEST_FORMATS,
  );
  if (!format.ok) return format;
  const project = requiredString("validate", root.value, "project");
  if (!project.ok) return project;
  const additional = firstAdditionalProperty(
    "validate",
    root.value,
    REQUEST_FIELDS,
  );
  if (additional !== undefined) return { ok: false, error: additional };
  return {
    ok: true,
    value: detached.value as unknown as ValidateProjectRequest,
  };
}
