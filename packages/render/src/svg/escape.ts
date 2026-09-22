import type { InvalidRenderTextError, RenderTextReason } from "../errors.js";
import type {
  NormalizedSchematicView,
  PresentationGraph,
  RenderOutcome,
  RenderTextSource,
} from "../types.js";
import { buildRenderSourceRegistry } from "./source-registry.js";

export type SvgSemanticIdPrefix =
  | "aggregate"
  | "boundary"
  | "cable"
  | "cable-conductor"
  | "clip"
  | "device"
  | "function"
  | "junction"
  | "jumper"
  | "location"
  | "net"
  | "potential"
  | "rail"
  | "terminal"
  | "wire";

function encodeUtf16CodeUnits(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index++) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

export function svgSemanticId(
  prefix: SvgSemanticIdPrefix,
  parts: readonly string[],
): string {
  if (parts.length === 0) {
    throw new Error("A semantic SVG ID requires at least one tuple part.");
  }
  return `${prefix}-${parts.map(encodeUtf16CodeUnits).join("--")}`;
}

export function decodeSvgSemanticId(
  prefix: SvgSemanticIdPrefix,
  id: string,
): readonly string[] {
  const marker = `${prefix}-`;
  if (!id.startsWith(marker)) {
    throw new Error(`Semantic SVG ID does not use the ${prefix} namespace.`);
  }
  return id
    .slice(marker.length)
    .split("--")
    .map((part) => {
      if (part.length % 4 !== 0 || !/^[0-9a-f]*$/.test(part)) {
        throw new Error("Semantic SVG ID has a non-canonical UTF-16 encoding.");
      }
      let decoded = "";
      for (let index = 0; index < part.length; index += 4) {
        decoded += String.fromCharCode(
          Number.parseInt(part.slice(index, index + 4), 16),
        );
      }
      return decoded;
    });
}

type StringContentReason = Extract<
  RenderTextReason,
  | "unpaired-surrogate"
  | "xml-illegal-code-point"
  | "forbidden-single-line-code-point"
>;

function invalidTextReason(
  value: string,
  forbidSingleLineCodePoints: boolean,
): StringContentReason | undefined {
  for (let index = 0; index < value.length; index++) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) {
        return "unpaired-surrogate";
      }
      index++;
      continue;
    }
    if (first >= 0xdc00 && first <= 0xdfff) return "unpaired-surrogate";
    if (
      first !== 0x9 &&
      first !== 0xa &&
      first !== 0xd &&
      !(first >= 0x20 && first <= 0xd7ff) &&
      !(first >= 0xe000 && first <= 0xfffd)
    ) {
      return "xml-illegal-code-point";
    }
    if (
      forbidSingleLineCodePoints &&
      (first === 0x9 ||
        first === 0xa ||
        first === 0xd ||
        first === 0x85 ||
        first === 0x2028 ||
        first === 0x2029)
    ) {
      return "forbidden-single-line-code-point";
    }
  }
  return undefined;
}

function invalidRenderTextError(
  view: Readonly<NormalizedSchematicView>,
  source: Readonly<RenderTextSource>,
  reason: StringContentReason,
): InvalidRenderTextError {
  return Object.freeze({
    code: "R005",
    message: `Invalid render text: ${source.ownerKind} ${source.ownerId} field ${source.field} contains ${reason}.`,
    family: view.family,
    ownerKind: source.ownerKind,
    ownerId: source.ownerId,
    field: source.field,
    reason,
    root: view.root.designation,
  });
}

function preflightSources(
  view: Readonly<NormalizedSchematicView>,
  sources: readonly RenderTextSource[],
  forbidSingleLineCodePoints: boolean,
): RenderOutcome<undefined> {
  for (const source of sources) {
    const reason = invalidTextReason(source.value, forbidSingleLineCodePoints);
    if (reason !== undefined) {
      return {
        ok: false,
        error: invalidRenderTextError(view, source, reason),
      };
    }
  }
  return { ok: true, value: undefined };
}

export function preflightTitleRenderText(
  view: Readonly<NormalizedSchematicView>,
  sources: readonly RenderTextSource[],
): RenderOutcome<undefined> {
  return preflightSources(view, sources, true);
}

export function preflightRenderText(
  graph: Readonly<PresentationGraph>,
): RenderOutcome<undefined> {
  const sources = buildRenderSourceRegistry(graph).sources;
  return preflightSources(graph.view, sources, false);
}

function escapeXml(value: string, attribute: boolean): string {
  const reason = invalidTextReason(value, false);
  if (reason !== undefined) {
    throw new Error(
      `XML emitter received text that failed preflight: ${reason}.`,
    );
  }

  let escaped = "";
  for (const character of value) {
    switch (character) {
      case "\t":
        escaped += "&#x9;";
        break;
      case "\n":
        escaped += "&#xA;";
        break;
      case "\r":
        escaped += "&#xD;";
        break;
      case "&":
        escaped += "&amp;";
        break;
      case "<":
        escaped += "&lt;";
        break;
      case ">":
        escaped += "&gt;";
        break;
      case '"':
        escaped += attribute ? "&quot;" : character;
        break;
      default:
        escaped += character;
    }
  }
  return escaped;
}

export function escapeXmlText(value: string): string {
  return escapeXml(value, false);
}

export function escapeXmlAttribute(value: string): string {
  return escapeXml(value, true);
}
