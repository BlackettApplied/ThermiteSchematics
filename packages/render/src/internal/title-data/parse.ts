import {
  createAjv2020,
  parseJson,
  validateJsonValue,
  type JsonValue,
  type JsonPointerNodeMap,
} from "@thermite/schema";
import { packetSchema } from "./schema.js";
import {
  parsePresentationStructure,
  validatePresentationStructure,
} from "#title-schema/presentation";
export { PRESENTATION_BYTE_LIMIT } from "#title-schema/presentation";
import {
  Issues,
  checkStrings,
  checkTitleData,
  isObject,
} from "./validation.js";
import type { PacketRequest, Presentation, Result } from "./model.js";

const ajv = createAjv2020();
ajv.opts.allowUnionTypes = true;
const validatePacket = ajv.compile(packetSchema);
function decode(
  input: string | Uint8Array,
  issues: Issues,
): string | undefined {
  if (typeof input === "string") return input;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      input,
    );
  } catch {
    issues.add("E002", "", "Input is not strict UTF-8.");
    return undefined;
  }
}
function parse<T>(input: string | Uint8Array, file: string): Result<T> {
  const initial = new Issues(file);
  const text = decode(input, initial);
  if (text === undefined) return { diagnostics: initial.sorted() };
  const parsed = parseJson(text, file);
  if (parsed.diagnostics.length || parsed.value === undefined)
    return { diagnostics: parsed.diagnostics };
  return validatePacketMetadata(parsed.value, file, parsed.nodes) as Result<T>;
}
/** Only the packet envelope and title metadata are checked here. View validation
 * belongs to the existing render pipeline. */
export function validatePacketMetadata(
  value: JsonValue,
  file = "packet.json",
  nodes: JsonPointerNodeMap = new Map(),
): Result<PacketRequest> {
  const issues = new Issues(file, nodes);
  issues.diagnostics.push(
    ...validateJsonValue(validatePacket, value, {
      file,
      nodes: nodes,
    }),
  );
  if (isObject(value)) {
    checkPacketEnvelope(value, issues);
    if (Array.isArray(value.views)) checkStrings(value.views, "/views", issues);
    if (isObject(value.titleData)) {
      checkStrings(value.titleData, "/titleData", issues);
      checkTitleData(
        value.titleData,
        Array.isArray(value.views) ? value.views.length : 0,
        issues,
      );
    }
  }
  const diagnostics = issues.sorted();
  return diagnostics.length
    ? { diagnostics }
    : { value: value as unknown as PacketRequest, diagnostics };
}

function checkPacketEnvelope(
  value: Record<string, JsonValue>,
  issues: Issues,
): void {
  const refs = value.references;
  const malformedRefs =
    isObject(refs) &&
    (!Object.keys(refs).length ||
      Object.keys(refs).some((k) => !["filter", "appearances"].includes(k)) ||
      (refs.appearances !== undefined &&
        !["all", "drawings"].includes(String(refs.appearances))));
  if (
    refs !== undefined &&
    (value.index !== true || refs === true || malformedRefs)
  ) {
    issues.add(
      "R006",
      "/references",
      "Reference options require index: true and false or filter/appearances settings.",
      "invalid-packet",
    );
  }
  if (Array.isArray(value.views))
    value.views.forEach((view, i) => {
      if (isObject(view) && Object.hasOwn(view, "page"))
        issues.add(
          "R006",
          `/views/${i}/page`,
          "Individual views cannot override the packet page.",
          "invalid-packet",
        );
    });
}
export function parseInternalPresentation(
  input: string | Uint8Array,
  file = "presentation.json",
): Result<Presentation> {
  const result = parsePresentationStructure(input, file);
  if (result.value === undefined) return { diagnostics: result.diagnostics };
  const issues = new Issues(file, result.nodes);
  checkStrings(result.value as unknown as JsonValue, "", issues);
  return issues.diagnostics.length
    ? { diagnostics: issues.sorted() }
    : { value: result.value, diagnostics: [] };
}
export function validateInternalPresentation(
  value: JsonValue,
  file = "presentation.json",
  nodes: JsonPointerNodeMap = new Map(),
): Result<Presentation> {
  const result = validatePresentationStructure(value, file, nodes);
  if (!result.value) return { diagnostics: result.diagnostics };
  const issues = new Issues(file, nodes);
  checkStrings(result.value as unknown as JsonValue, "", issues);
  return issues.diagnostics.length
    ? { diagnostics: issues.sorted() }
    : { value: result.value, diagnostics: [] };
}
export function parseInternalPacket(
  input: string | Uint8Array,
  file = "packet.json",
): Result<PacketRequest> {
  return parse(input, file);
}
