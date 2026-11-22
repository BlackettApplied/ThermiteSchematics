import { invalidViewRequestError } from "./errors.js";
import type { SchematicViewFamily } from "./types.js";
import type {
  NormalizeSchematicViewResult,
  RequestDescriptorSnapshot,
} from "./view-spec-types.js";

export function rejectedView(
  error: import("./errors.js").InvalidViewRequestError,
): NormalizeSchematicViewResult {
  return Object.freeze({ ok: false, error: Object.freeze(error) });
}

export function invalid(
  message: string,
  descriptors: RequestDescriptorSnapshot,
  root: string,
  family?: SchematicViewFamily,
  deviceUid?: string,
): NormalizeSchematicViewResult {
  return Object.freeze({
    ok: false,
    error: invalidViewRequestError({
      message,
      ...descriptors,
      root,
      ...(family === undefined ? {} : { family }),
      ...(deviceUid === undefined ? {} : { deviceUid }),
    }),
  });
}
