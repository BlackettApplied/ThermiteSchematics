import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node,
  type NodeType,
  type ParseError,
  type ParseErrorCode,
} from "jsonc-parser";

import { DIAGNOSTIC_CATALOG } from "./diagnostic-catalog.js";
import {
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
} from "./diagnostics.js";
import { appendJsonPointer } from "./json-pointer.js";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface JsonNodeLocation {
  type: NodeType;
  offset: number;
  length: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface JsonPointerNode {
  key?: JsonNodeLocation;
  value: JsonNodeLocation;
}

export type JsonPointerNodeMap = Map<string, JsonPointerNode>;

export interface ParseJsonResult {
  value?: JsonValue;
  nodes: JsonPointerNodeMap;
  diagnostics: Diagnostic[];
}

const INVALID_CHARACTER_PARSE_ERROR = 16 as ParseErrorCode;

class LineIndex {
  readonly #textLength: number;
  readonly #lineStarts: number[] = [0];

  constructor(text: string) {
    this.#textLength = text.length;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

      if (character === "\r") {
        if (text[index + 1] === "\n") {
          index += 1;
        }

        this.#lineStarts.push(index + 1);
      } else if (character === "\n") {
        this.#lineStarts.push(index + 1);
      }
    }
  }

  position(offset: number): SourcePosition {
    const boundedOffset = Math.max(0, Math.min(offset, this.#textLength));
    let low = 0;
    let high = this.#lineStarts.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const lineStart = this.#lineStarts[middle]!;

      if (lineStart <= boundedOffset) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    const lineIndex = Math.max(0, high);
    const lineStart = this.#lineStarts[lineIndex]!;

    return {
      offset: boundedOffset,
      line: lineIndex + 1,
      column: boundedOffset - lineStart + 1,
    };
  }
}

function toNodeLocation(node: Node, lines: LineIndex): JsonNodeLocation {
  const start = lines.position(node.offset);
  const end = lines.position(node.offset + node.length);

  return {
    type: node.type,
    offset: node.offset,
    length: node.length,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function syntaxErrorOffset(text: string, error: ParseError): number {
  if (error.error !== INVALID_CHARACTER_PARSE_ERROR) {
    return error.offset;
  }

  const end = Math.min(text.length, error.offset + Math.max(error.length, 1));

  for (let offset = error.offset; offset < end; offset += 1) {
    const characterCode = text.charCodeAt(offset);

    if (characterCode < 0x20) {
      return offset;
    }
  }

  return error.offset;
}

function syntaxErrorMessage(text: string, error: ParseError): string {
  if (error.offset >= text.length) {
    return "Unexpected end of JSON input.";
  }

  const reason = printParseErrorCode(error.error);
  return `Invalid JSON syntax (${reason}).`;
}

function createSyntaxDiagnostics(
  text: string,
  file: string,
  errors: readonly ParseError[],
  lines: LineIndex,
): Diagnostic[] {
  return errors.map((error) => {
    const position = lines.position(syntaxErrorOffset(text, error));

    return {
      code: "E002",
      severity: DIAGNOSTIC_CATALOG.E002.severity,
      message: syntaxErrorMessage(text, error),
      file,
      line: position.line,
      column: position.column,
      jsonPointer: "",
    };
  });
}

function mapTree(
  node: Node,
  pointer: string,
  keyNode: Node | undefined,
  file: string,
  lines: LineIndex,
  nodes: JsonPointerNodeMap,
  duplicateDiagnostics: Diagnostic[],
): void {
  const entry: JsonPointerNode = {
    value: toNodeLocation(node, lines),
    ...(keyNode === undefined ? {} : { key: toNodeLocation(keyNode, lines) }),
  };
  nodes.set(pointer, entry);

  if (node.type === "array") {
    node.children?.forEach((child, index) => {
      mapTree(
        child,
        appendJsonPointer(pointer, index),
        undefined,
        file,
        lines,
        nodes,
        duplicateDiagnostics,
      );
    });
    return;
  }

  if (node.type !== "object") {
    return;
  }

  const seenKeys = new Set<string>();

  for (const property of node.children ?? []) {
    const propertyKeyNode = property.children?.[0];
    const propertyValueNode = property.children?.[1];

    if (
      property.type !== "property" ||
      propertyKeyNode?.type !== "string" ||
      typeof propertyKeyNode.value !== "string"
    ) {
      continue;
    }

    const propertyPointer = appendJsonPointer(pointer, propertyKeyNode.value);

    if (seenKeys.has(propertyKeyNode.value)) {
      const location = toNodeLocation(propertyKeyNode, lines);
      duplicateDiagnostics.push({
        code: "E003",
        severity: DIAGNOSTIC_CATALOG.E003.severity,
        message: `Duplicate object key ${JSON.stringify(propertyKeyNode.value)}.`,
        file,
        line: location.line,
        column: location.column,
        jsonPointer: propertyPointer,
      });
    } else {
      seenKeys.add(propertyKeyNode.value);
    }

    if (propertyValueNode !== undefined) {
      mapTree(
        propertyValueNode,
        propertyPointer,
        propertyKeyNode,
        file,
        lines,
        nodes,
        duplicateDiagnostics,
      );
    }
  }
}

export function offsetToPosition(text: string, offset: number): SourcePosition {
  return new LineIndex(text).position(offset);
}

export function parseJson(text: string, file: string): ParseJsonResult {
  const normalizedFile = normalizeDiagnosticFile(file);
  const parseErrors: ParseError[] = [];
  const root = parseTree(text, parseErrors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  });
  const lines = new LineIndex(text);
  const nodes: JsonPointerNodeMap = new Map();
  const duplicateDiagnostics: Diagnostic[] = [];

  if (root !== undefined) {
    mapTree(
      root,
      "",
      undefined,
      normalizedFile,
      lines,
      nodes,
      duplicateDiagnostics,
    );
  }

  const diagnostics = normalizeDiagnostics([
    ...createSyntaxDiagnostics(text, normalizedFile, parseErrors, lines),
    ...duplicateDiagnostics,
  ]);

  if (parseErrors.length > 0 || root === undefined) {
    return { nodes, diagnostics };
  }

  return {
    value: getNodeValue(root) as JsonValue,
    nodes,
    diagnostics,
  };
}
