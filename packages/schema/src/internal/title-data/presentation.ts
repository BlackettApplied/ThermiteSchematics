// Private structural parser shared by the public compact validation path.
// No font or render dependency is allowed in this structural parser.
import { createAjv2020, validateJsonValue } from "../../ajv-validation.js";
import {
  parseJson,
  type JsonPointerNodeMap,
  type JsonValue,
} from "../../parser.js";
import type { Result } from "./diagnostics.js";
import type { Presentation } from "./model.js";
import { presentationSchema } from "./schema.js";
import { checkPresentation } from "./presentation-validation.js";
import { checkPlainText, visitStrings } from "./text.js";
import { splitJsonPointer } from "../../json-pointer.js";
import { slots } from "./model.js";
import { Issues, isObject } from "./validation-common.js";
const ajv = createAjv2020();
ajv.opts.allowUnionTypes = true;
const validatePresentation = ajv.compile(presentationSchema);
export interface ParsedPresentationStructure extends Result<Presentation> {
  readonly nodes?: JsonPointerNodeMap;
}
export const PRESENTATION_BYTE_LIMIT = 64 * 1024;
export function parsePresentationStructure(
  input: string | Uint8Array,
  file = "presentation.json",
): ParsedPresentationStructure {
  const issues = new Issues(file);
  const bytes =
    typeof input === "string"
      ? Buffer.byteLength(input, "utf8")
      : input.byteLength;
  if (bytes > PRESENTATION_BYTE_LIMIT) {
    issues.add("E015", "", "Presentation exceeds 64 KiB.");
    return { diagnostics: issues.sorted() };
  }
  let text: string;
  try {
    text =
      typeof input === "string"
        ? input
        : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            input,
          );
  } catch {
    issues.add("E002", "", "Input is not strict UTF-8.");
    return { diagnostics: issues.sorted() };
  }
  const parsed = parseJson(text, file);
  if (parsed.diagnostics.length || parsed.value === undefined)
    return { diagnostics: parsed.diagnostics, nodes: parsed.nodes };
  return {
    ...validatePresentationStructure(parsed.value, file, parsed.nodes),
    nodes: parsed.nodes,
  };
}
/** Structural value validation shared with the public registry and renderer. */
export function validatePresentationStructure(
  value: JsonValue,
  file = "presentation.json",
  nodes: JsonPointerNodeMap = new Map(),
): ParsedPresentationStructure {
  const located = new Issues(file, nodes);
  located.diagnostics.push(
    ...validateJsonValue(validatePresentation, value, {
      file,
      nodes: nodes,
    }),
  );
  const hasFieldObject =
    isObject(value) &&
    isObject(value.titleBlock) &&
    isObject(value.titleBlock.fields);
  visitStrings(value, "", (value, pointer) =>
    checkPresentationText(value, pointer, located, hasFieldObject),
  );
  if (isObject(value)) checkPresentation(value, located);
  if (
    !located.diagnostics.length &&
    Buffer.byteLength(JSON.stringify(value), "utf8") > PRESENTATION_BYTE_LIMIT
  )
    located.add("E015", "", "Presentation exceeds 64 KiB.");
  const diagnostics = located.sorted();
  return diagnostics.length
    ? { diagnostics, nodes: nodes }
    : {
        value: value as unknown as Presentation,
        diagnostics,
        nodes: nodes,
      };
}

function checkPresentationText(
  value: string,
  pointer: string,
  issues: Issues,
  hasFieldObject: boolean,
): void {
  const [root, fields, key] = splitJsonPointer(pointer);
  // Unknown slots are already rejected by the closed schema. Their unused
  // contents must not add semantic diagnostics to that single E012.
  if (
    hasFieldObject &&
    root === "titleBlock" &&
    fields === "fields" &&
    !slots.some((slot) => slot === key)
  )
    return;
  checkPlainText(value, pointer, issues);
}
