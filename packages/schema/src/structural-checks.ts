import {
  DIAGNOSTIC_CATALOG,
  type DiagnosticCode,
} from "./diagnostic-catalog.js";
import {
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
  type RelatedDiagnosticLocation,
} from "./diagnostics.js";
import { appendJsonPointer } from "./json-pointer.js";
import type { JsonPointerNodeMap, JsonValue } from "./parser.js";

export const FUNCTION_KINDS = [
  "coil",
  "contact",
  "channel",
  "source",
  "load",
  "bus",
  "mechanism",
  "other",
] as const;

export type FunctionKind = (typeof FUNCTION_KINDS)[number];

export interface StructuralCheckContext {
  file: string;
  nodes: JsonPointerNodeMap;
}

type JsonObject = { [key: string]: JsonValue | undefined };

const ELECTRICAL_FUNCTION_KINDS = new Set<FunctionKind>([
  "coil",
  "contact",
  "channel",
  "source",
  "load",
  "bus",
]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFunctionKind(value: unknown): value is FunctionKind {
  return (
    typeof value === "string" &&
    (FUNCTION_KINDS as readonly string[]).includes(value)
  );
}

function locationAt(
  nodes: JsonPointerNodeMap,
  pointer: string,
): { line: number; column: number } {
  const location = nodes.get(pointer)?.value;
  return location === undefined
    ? { line: 1, column: 1 }
    : { line: location.line, column: location.column };
}

function codeDiagnostic(
  code: DiagnosticCode,
  message: string,
  pointer: string,
  context: StructuralCheckContext,
  options: {
    uid?: string;
    related?: RelatedDiagnosticLocation[];
  } = {},
): Diagnostic {
  return {
    code,
    severity: DIAGNOSTIC_CATALOG[code].severity,
    message,
    file: normalizeDiagnosticFile(context.file),
    ...locationAt(context.nodes, pointer),
    jsonPointer: pointer,
    ...(options.uid === undefined ? {} : { uid: options.uid }),
    ...(options.related === undefined ? {} : { related: options.related }),
  };
}

function firstDeclaration(
  context: StructuralCheckContext,
  pointer: string,
  note: string,
): RelatedDiagnosticLocation {
  return {
    file: normalizeDiagnosticFile(context.file),
    ...locationAt(context.nodes, pointer),
    note,
  };
}

function identicalTerminalRefs(left: JsonValue, right: JsonValue): boolean {
  return (
    isJsonObject(left) &&
    isJsonObject(right) &&
    typeof left.device === "string" &&
    typeof left.terminal === "string" &&
    left.device === right.device &&
    left.terminal === right.terminal
  );
}

function checkEndpointPair(
  endpoints: JsonValue | undefined,
  pointer: string,
  context: StructuralCheckContext,
  uid?: string,
): Diagnostic[] {
  if (!Array.isArray(endpoints) || endpoints.length !== 2) {
    return [];
  }

  const first = endpoints[0];
  const second = endpoints[1];

  if (
    first === undefined ||
    second === undefined ||
    !identicalTerminalRefs(first, second)
  ) {
    return [];
  }

  return [
    codeDiagnostic(
      "E024",
      "Conductive element endpoints must refer to different terminals.",
      appendJsonPointer(pointer, 1),
      context,
      uid === undefined ? {} : { uid },
    ),
  ];
}

function checkConductiveElement(
  value: JsonObject,
  context: StructuralCheckContext,
): Diagnostic[] {
  const uid = typeof value.uid === "string" ? value.uid : undefined;
  return checkEndpointPair(value.endpoints, "/endpoints", context, uid);
}

function checkCable(
  value: JsonObject,
  context: StructuralCheckContext,
): Diagnostic[] {
  const conductors = value.conductors;

  if (!Array.isArray(conductors)) {
    return [];
  }

  const firstById = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  const uid = typeof value.uid === "string" ? value.uid : undefined;

  conductors.forEach((conductor, index) => {
    if (!isJsonObject(conductor) || typeof conductor.id !== "string") {
      return;
    }

    if (conductor.usage !== "spare" && Array.isArray(conductor.endpoints)) {
      conductor.endpoints.forEach((endpoint, endpointIndex) => {
        if (endpoint === null)
          diagnostics.push(
            codeDiagnostic(
              "E015",
              'An unterminated cable endpoint requires explicit usage "spare".',
              `/conductors/${index}/endpoints/${endpointIndex}`,
              context,
              uid === undefined ? {} : { uid },
            ),
          );
      });
    }

    diagnostics.push(
      ...checkEndpointPair(
        conductor.endpoints,
        appendJsonPointer(appendJsonPointer("/conductors", index), "endpoints"),
        context,
        uid,
      ),
    );

    const pointer = appendJsonPointer(
      appendJsonPointer("/conductors", index),
      "id",
    );
    const firstPointer = firstById.get(conductor.id);

    if (firstPointer === undefined) {
      firstById.set(conductor.id, pointer);
      return;
    }

    diagnostics.push(
      codeDiagnostic(
        "E021",
        `Duplicate conductor id ${JSON.stringify(conductor.id)} within one cable.`,
        pointer,
        context,
        {
          ...(uid === undefined ? {} : { uid }),
          related: [
            firstDeclaration(
              context,
              firstPointer,
              "First declaration of this conductor id.",
            ),
          ],
        },
      ),
    );
  });

  return diagnostics;
}

function checkCableType(
  value: JsonObject,
  context: StructuralCheckContext,
): Diagnostic[] {
  const conductors = value.conductors;

  if (!Array.isArray(conductors)) {
    return [];
  }

  const firstById = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];

  conductors.forEach((conductor, index) => {
    if (!isJsonObject(conductor) || typeof conductor.id !== "string") {
      return;
    }

    const pointer = appendJsonPointer(
      appendJsonPointer("/conductors", index),
      "id",
    );
    const firstPointer = firstById.get(conductor.id);

    if (firstPointer === undefined) {
      firstById.set(conductor.id, pointer);
      return;
    }

    diagnostics.push(
      codeDiagnostic(
        "E031",
        `Duplicate conductor id ${JSON.stringify(conductor.id)} within one cable type.`,
        pointer,
        context,
        {
          related: [
            firstDeclaration(
              context,
              firstPointer,
              "First declaration of this conductor id.",
            ),
          ],
        },
      ),
    );
  });

  return diagnostics;
}

function legalInternalRelation(
  relation: string,
  fromKind: FunctionKind,
  toKind: FunctionKind,
): boolean {
  switch (relation) {
    case "actuates":
      return (
        (fromKind === "coil" ||
          fromKind === "channel" ||
          fromKind === "mechanism") &&
        toKind === "contact"
      );
    case "trips":
      return fromKind === "mechanism" && toKind === "contact";
    case "ganged_with":
      return (
        (fromKind === "contact" || fromKind === "mechanism") &&
        toKind === fromKind
      );
    case "feeds_internal":
      return (
        ELECTRICAL_FUNCTION_KINDS.has(fromKind) &&
        ELECTRICAL_FUNCTION_KINDS.has(toKind)
      );
    default:
      return false;
  }
}

function checkDeviceType(
  value: JsonObject,
  context: StructuralCheckContext,
): Diagnostic[] {
  const terminals = value.terminals;
  const functions = value.functions;

  if (!isJsonObject(terminals) || !isJsonObject(functions)) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const functionKinds = new Map<string, FunctionKind>();

  for (const [functionId, functionValue] of Object.entries(functions)) {
    if (!isJsonObject(functionValue)) {
      continue;
    }

    if (isFunctionKind(functionValue.kind)) {
      functionKinds.set(functionId, functionValue.kind);
    }

    if (!Array.isArray(functionValue.terminals)) {
      continue;
    }

    functionValue.terminals.forEach((terminal, index) => {
      if (typeof terminal !== "string" || Object.hasOwn(terminals, terminal)) {
        return;
      }

      const pointer = appendJsonPointer(
        appendJsonPointer(
          appendJsonPointer("/functions", functionId),
          "terminals",
        ),
        index,
      );
      diagnostics.push(
        codeDiagnostic(
          "E025",
          `Function ${JSON.stringify(functionId)} references undeclared terminal ${JSON.stringify(terminal)}.`,
          pointer,
          context,
        ),
      );
    });
  }

  const relations = value.internal_relations;

  if (!Array.isArray(relations)) {
    return diagnostics;
  }

  relations.forEach((relationValue, index) => {
    if (!isJsonObject(relationValue)) {
      return;
    }

    const relationPointer = appendJsonPointer("/internal_relations", index);
    const relation = relationValue.relation;
    const from = relationValue.from;
    const to = relationValue.to;
    let hasUndeclaredEndpoint = false;

    for (const [field, functionId] of [
      ["from", from],
      ["to", to],
    ] as const) {
      if (typeof functionId !== "string" || functionKinds.has(functionId)) {
        continue;
      }

      hasUndeclaredEndpoint = true;
      diagnostics.push(
        codeDiagnostic(
          "E026",
          `Internal relation references undeclared function ${JSON.stringify(functionId)}.`,
          appendJsonPointer(relationPointer, field),
          context,
        ),
      );
    }

    if (
      hasUndeclaredEndpoint ||
      typeof relation !== "string" ||
      typeof from !== "string" ||
      typeof to !== "string"
    ) {
      return;
    }

    const fromKind = functionKinds.get(from);
    const toKind = functionKinds.get(to);

    if (
      fromKind !== undefined &&
      toKind !== undefined &&
      !legalInternalRelation(relation, fromKind, toKind)
    ) {
      diagnostics.push(
        codeDiagnostic(
          "E030",
          `Internal relation ${JSON.stringify(relation)} is illegal from ${fromKind} to ${toKind}.`,
          appendJsonPointer(relationPointer, "relation"),
          context,
        ),
      );
    }
  });

  return diagnostics;
}

function checkLibraryFile(
  value: JsonObject,
  context: StructuralCheckContext,
): Diagnostic[] {
  const types = value.types;

  if (!Array.isArray(types)) {
    return [];
  }

  const firstById = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];

  types.forEach((typeValue, index) => {
    if (!isJsonObject(typeValue) || typeof typeValue.id !== "string") {
      return;
    }

    const pointer = appendJsonPointer(appendJsonPointer("/types", index), "id");
    const firstPointer = firstById.get(typeValue.id);

    if (firstPointer === undefined) {
      firstById.set(typeValue.id, pointer);
      return;
    }

    diagnostics.push(
      codeDiagnostic(
        "E022",
        `Duplicate type id ${JSON.stringify(typeValue.id)} within one library file.`,
        pointer,
        context,
        {
          related: [
            firstDeclaration(
              context,
              firstPointer,
              "First declaration of this type id.",
            ),
          ],
        },
      ),
    );
  });

  return diagnostics;
}

export function validateStructuralChecks(
  entity: string,
  value: JsonValue,
  context: StructuralCheckContext,
): Diagnostic[] {
  if (!isJsonObject(value)) {
    return [];
  }

  const diagnostics =
    entity === "cable"
      ? checkCable(value, context)
      : entity === "cable-type"
        ? checkCableType(value, context)
        : entity === "wire" || entity === "jumper"
          ? checkConductiveElement(value, context)
          : entity === "device-type"
            ? checkDeviceType(value, context)
            : entity === "library-file"
              ? checkLibraryFile(value, context)
              : [];

  return normalizeDiagnostics(diagnostics);
}
