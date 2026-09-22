import { DIAGNOSTIC_CATALOG } from "./diagnostic-catalog.js";
import {
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
  type RelatedDiagnosticLocation,
} from "./diagnostics.js";
import { appendJsonPointer } from "./json-pointer.js";
import type { JsonPointerNodeMap, JsonValue } from "./parser.js";
import type { SchemaRegistry } from "./schema-registry.js";

export interface ParsedDocument {
  file: string;
  value: JsonValue;
  nodes: JsonPointerNodeMap;
}

interface UidDeclaration {
  file: string;
  line: number;
  column: number;
}

function isJsonObject(
  value: unknown,
): value is { [key: string]: JsonValue | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positionAt(
  nodes: JsonPointerNodeMap,
  pointer: string,
): { line: number; column: number } {
  const location = nodes.get(pointer)?.value;
  return location === undefined
    ? { line: 1, column: 1 }
    : { line: location.line, column: location.column };
}

export function validateSourceDocument(
  registry: SchemaRegistry,
  document: ParsedDocument,
): Diagnostic[] {
  return registry.validateSourceDocument(document.value, {
    file: document.file,
    nodes: document.nodes,
  });
}

export function validateProjectManifest(
  registry: SchemaRegistry,
  document: ParsedDocument,
): Diagnostic[] {
  return registry.validateProjectManifest(document.value, {
    file: document.file,
    nodes: document.nodes,
  });
}

export function validateUniqueUids(
  documents: readonly ParsedDocument[],
): Diagnostic[] {
  const firstByUid = new Map<string, UidDeclaration>();
  const diagnostics: Diagnostic[] = [];

  for (const document of documents) {
    if (
      !isJsonObject(document.value) ||
      !Array.isArray(document.value.objects)
    ) {
      continue;
    }

    const file = normalizeDiagnosticFile(document.file);

    document.value.objects.forEach((objectValue, index) => {
      if (!isJsonObject(objectValue) || typeof objectValue.uid !== "string") {
        return;
      }

      const pointer = appendJsonPointer(
        appendJsonPointer("/objects", index),
        "uid",
      );
      const position = positionAt(document.nodes, pointer);
      const first = firstByUid.get(objectValue.uid);

      if (first === undefined) {
        firstByUid.set(objectValue.uid, { file, ...position });
        return;
      }

      const related: RelatedDiagnosticLocation[] = [
        {
          ...first,
          note: "First declaration of this uid.",
        },
      ];

      diagnostics.push({
        code: "E020",
        severity: DIAGNOSTIC_CATALOG.E020.severity,
        message: `Duplicate uid ${JSON.stringify(objectValue.uid)}.`,
        file,
        ...position,
        jsonPointer: pointer,
        uid: objectValue.uid,
        related,
      });
    });
  }

  return normalizeDiagnostics(diagnostics);
}
