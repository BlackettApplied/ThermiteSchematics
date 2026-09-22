import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import { createAjv2020, validateJsonValue } from "./ajv-validation.js";
import { DIAGNOSTIC_CATALOG } from "./diagnostic-catalog.js";
import {
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
} from "./diagnostics.js";
import { appendJsonPointer } from "./json-pointer.js";
import {
  parseJson,
  type JsonPointerNodeMap,
  type JsonValue,
} from "./parser.js";
import { IN_MEMORY_CANONICAL_SCHEMAS } from "./generated/canonical-schemas.js";
import {
  FUNCTION_KINDS,
  isFunctionKind,
  validateStructuralChecks,
  type FunctionKind,
} from "./structural-checks.js";

export const ENTITY_SCHEMA_NAMES = [
  "project",
  "project-presentation",
  "source-file",
  "device",
  "device-type",
  "wire",
  "cable",
  "cable-type",
  "jumper",
  "relation",
  "potential",
  "library",
  "library-file",
  "library-lock",
] as const;

export const SUPPORTED_PROJECT_FORMATS = ["electrical-system/0.1"] as const;

export const PROJECT_PRESENTATION_SINGLE_LINE_PATTERN =
  "^[^\\u0009\\u000a\\u000d\\u0085\\u2028\\u2029]+$";

const SOURCE_KIND_TO_ENTITY: Readonly<Record<string, EntitySchemaName>> = {
  device: "device",
  wire: "wire",
  cable: "cable",
  jumper: "jumper",
  relation: "relation",
  potential: "potential",
};

export type EntitySchemaName = (typeof ENTITY_SCHEMA_NAMES)[number];

export interface LoadedSchema {
  fileName: string;
  id: string;
  schema: AnySchema;
}

export interface EntityValidationContext {
  file: string;
  nodes: JsonPointerNodeMap;
}

export interface LoadSchemaRegistryOptions {
  schemaDirectory?: string;
}

const DEFAULT_SCHEMA_DIRECTORY = fileURLToPath(
  new URL("../schemas/", import.meta.url),
);

function isJsonObject(
  value: unknown,
): value is { [key: string]: JsonValue | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativeNodes(
  nodes: JsonPointerNodeMap,
  basePointer: string,
): JsonPointerNodeMap {
  const relative = new Map();

  for (const [pointer, node] of nodes) {
    if (pointer === basePointer) {
      relative.set("", node);
    } else if (pointer.startsWith(`${basePointer}/`)) {
      relative.set(pointer.slice(basePointer.length), node);
    }
  }

  return relative;
}

function prefixDiagnostic(
  diagnostic: Diagnostic,
  basePointer: string,
): Diagnostic {
  return {
    ...diagnostic,
    jsonPointer:
      diagnostic.jsonPointer === ""
        ? basePointer
        : `${basePointer}${diagnostic.jsonPointer}`,
  };
}

function functionDefinitionName(kind: FunctionKind): string {
  return `${kind}Function`;
}

function schemaId(value: JsonValue, fileName: string): string {
  if (!isJsonObject(value) || typeof value.$id !== "string") {
    throw new Error(`Schema ${JSON.stringify(fileName)} has no string $id.`);
  }

  return value.$id;
}

export function isEntitySchemaName(value: string): value is EntitySchemaName {
  return (ENTITY_SCHEMA_NAMES as readonly string[]).includes(value);
}

export async function loadCanonicalSchemas(
  schemaDirectory = DEFAULT_SCHEMA_DIRECTORY,
): Promise<LoadedSchema[]> {
  const fileNames = (await readdir(schemaDirectory))
    .filter((fileName) => extname(fileName) === ".json")
    .filter((fileName) => fileName.endsWith(".schema.json"))
    .sort();
  const schemas: LoadedSchema[] = [];

  for (const fileName of fileNames) {
    const source = await readFile(join(schemaDirectory, fileName), "utf8");
    const parsed = parseJson(source, fileName);

    if (parsed.diagnostics.length > 0 || parsed.value === undefined) {
      const details = parsed.diagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}`,
        )
        .join(", ");
      throw new Error(
        `Unable to parse canonical schema ${JSON.stringify(fileName)}${
          details === "" ? "." : `: ${details}`
        }`,
      );
    }

    const id = schemaId(parsed.value, fileName);
    schemas.push({
      fileName,
      id,
      schema: parsed.value as AnySchema,
    });
  }

  return schemas;
}

export class SchemaRegistry {
  readonly ajv: Ajv2020;
  readonly schemas: ReadonlyMap<string, LoadedSchema>;
  readonly #entityValidators: ReadonlyMap<EntitySchemaName, ValidateFunction>;
  readonly #functionValidators: ReadonlyMap<FunctionKind, ValidateFunction>;

  constructor(ajv: Ajv2020, schemas: readonly LoadedSchema[]) {
    this.ajv = ajv;
    this.schemas = new Map(schemas.map((schema) => [schema.id, schema]));

    const entityValidators = new Map<EntitySchemaName, ValidateFunction>();

    for (const name of ENTITY_SCHEMA_NAMES) {
      const id = `https://thermiteschematics.com/schemas/0.1/${name}.schema.json`;
      const validate = ajv.getSchema(id);

      if (validate === undefined) {
        throw new Error(
          `Canonical entity schema ${JSON.stringify(id)} is missing.`,
        );
      }

      entityValidators.set(name, validate);
    }

    this.#entityValidators = entityValidators;

    const functionValidators = new Map<FunctionKind, ValidateFunction>();
    const deviceTypeId =
      "https://thermiteschematics.com/schemas/0.1/device-type.schema.json";

    for (const kind of FUNCTION_KINDS) {
      const id = `${deviceTypeId}#/$defs/${functionDefinitionName(kind)}`;
      const validate = ajv.getSchema(id);

      if (validate === undefined) {
        throw new Error(
          `Canonical function schema ${JSON.stringify(id)} is missing.`,
        );
      }

      functionValidators.set(kind, validate);
    }

    this.#functionValidators = functionValidators;
  }

  #validateFunctionBranches(
    value: JsonValue,
    context: EntityValidationContext,
  ): Diagnostic[] {
    if (!isJsonObject(value) || !isJsonObject(value.functions)) {
      return [];
    }

    const diagnostics: Diagnostic[] = [];

    for (const [functionId, functionValue] of Object.entries(value.functions)) {
      if (!isJsonObject(functionValue) || !isFunctionKind(functionValue.kind)) {
        continue;
      }

      const validate = this.#functionValidators.get(functionValue.kind);

      if (validate === undefined) {
        throw new Error(
          `No function validator is registered for ${JSON.stringify(functionValue.kind)}.`,
        );
      }

      const basePointer = appendJsonPointer("/functions", functionId);
      diagnostics.push(
        ...validateJsonValue(validate, functionValue, {
          file: context.file,
          nodes: relativeNodes(context.nodes, basePointer),
        }).map((diagnostic) => prefixDiagnostic(diagnostic, basePointer)),
      );
    }

    return normalizeDiagnostics(diagnostics);
  }

  #unknownLibraryTypeDiagnostic(
    value: JsonValue,
    index: number,
    context: EntityValidationContext,
  ): Diagnostic {
    const basePointer = appendJsonPointer("/types", index);
    const kindPointer = appendJsonPointer(basePointer, "kind");
    const hasKind = isJsonObject(value) && Object.hasOwn(value, "kind");
    const kind = isJsonObject(value) ? value.kind : undefined;
    const pointer = hasKind ? kindPointer : basePointer;
    const anchor =
      context.nodes.get(pointer)?.value ??
      context.nodes.get(basePointer)?.value;

    return {
      code: "E016",
      severity: DIAGNOSTIC_CATALOG.E016.severity,
      message:
        typeof kind === "string"
          ? `Unknown library type kind ${JSON.stringify(kind)}.`
          : "Library type is missing a recognized kind.",
      file: normalizeDiagnosticFile(context.file),
      line: anchor?.line ?? 1,
      column: anchor?.column ?? 1,
      jsonPointer: pointer,
    };
  }

  #validateLibraryFileTypes(
    value: JsonValue,
    context: EntityValidationContext,
  ): Diagnostic[] {
    if (!isJsonObject(value) || !Array.isArray(value.types)) {
      return [];
    }

    const diagnostics: Diagnostic[] = [];

    value.types.forEach((typeValue, index) => {
      const entity =
        isJsonObject(typeValue) && typeValue.kind === "device_type"
          ? "device-type"
          : isJsonObject(typeValue) && typeValue.kind === "cable_type"
            ? "cable-type"
            : undefined;

      if (entity === undefined) {
        diagnostics.push(
          this.#unknownLibraryTypeDiagnostic(typeValue, index, context),
        );
        return;
      }

      const basePointer = appendJsonPointer("/types", index);
      diagnostics.push(
        ...this.validateEntity(entity, typeValue, {
          file: context.file,
          nodes: relativeNodes(context.nodes, basePointer),
        }).map((diagnostic) => prefixDiagnostic(diagnostic, basePointer)),
      );
    });

    return normalizeDiagnostics(diagnostics);
  }

  #unknownSourceObjectDiagnostic(
    value: JsonValue,
    index: number,
    context: EntityValidationContext,
  ): Diagnostic {
    const basePointer = appendJsonPointer("/objects", index);
    const kindPointer = appendJsonPointer(basePointer, "kind");
    const hasKind = isJsonObject(value) && Object.hasOwn(value, "kind");
    const kind = isJsonObject(value) ? value.kind : undefined;
    const pointer = hasKind ? kindPointer : basePointer;
    const anchor =
      context.nodes.get(pointer)?.value ??
      context.nodes.get(basePointer)?.value;

    return {
      code: "E016",
      severity: DIAGNOSTIC_CATALOG.E016.severity,
      message:
        typeof kind === "string"
          ? `Unknown source object kind ${JSON.stringify(kind)}.`
          : "Source object is missing a recognized string kind.",
      file: normalizeDiagnosticFile(context.file),
      line: anchor?.line ?? 1,
      column: anchor?.column ?? 1,
      jsonPointer: pointer,
    };
  }

  validateSourceDocument(
    value: JsonValue,
    context: EntityValidationContext,
  ): Diagnostic[] {
    const envelopeDiagnostics = this.validateEntity(
      "source-file",
      value,
      context,
    );

    if (envelopeDiagnostics.length > 0) {
      return envelopeDiagnostics;
    }

    if (!isJsonObject(value) || !Array.isArray(value.objects)) {
      return [];
    }

    const diagnostics: Diagnostic[] = [];

    value.objects.forEach((objectValue, index) => {
      const entity =
        isJsonObject(objectValue) && typeof objectValue.kind === "string"
          ? SOURCE_KIND_TO_ENTITY[objectValue.kind]
          : undefined;

      if (entity === undefined) {
        diagnostics.push(
          this.#unknownSourceObjectDiagnostic(objectValue, index, context),
        );
        return;
      }

      const basePointer = appendJsonPointer("/objects", index);
      diagnostics.push(
        ...this.validateEntity(entity, objectValue, {
          file: context.file,
          nodes: relativeNodes(context.nodes, basePointer),
        }).map((diagnostic) => prefixDiagnostic(diagnostic, basePointer)),
      );
    });

    return normalizeDiagnostics(diagnostics);
  }

  validateProjectManifest(
    value: JsonValue,
    context: EntityValidationContext,
  ): Diagnostic[] {
    const schemaDiagnostics = this.validateEntity("project", value, context);

    if (schemaDiagnostics.length > 0) {
      return schemaDiagnostics;
    }

    if (!isJsonObject(value)) {
      return [];
    }

    const file = normalizeDiagnosticFile(context.file);
    const diagnostics: Diagnostic[] = [];
    const positionAt = (pointer: string): { line: number; column: number } => {
      const location = context.nodes.get(pointer)?.value;
      return location === undefined
        ? { line: 1, column: 1 }
        : { line: location.line, column: location.column };
    };

    if (
      typeof value.format === "string" &&
      !(SUPPORTED_PROJECT_FORMATS as readonly string[]).includes(value.format)
    ) {
      diagnostics.push({
        code: "E017",
        severity: DIAGNOSTIC_CATALOG.E017.severity,
        message: `Unsupported manifest format ${JSON.stringify(value.format)}.`,
        file,
        ...positionAt("/format"),
        jsonPointer: "/format",
      });
    }

    if (Array.isArray(value.libraries)) {
      const firstByName = new Map<string, string>();

      value.libraries.forEach((dependency, index) => {
        if (!isJsonObject(dependency) || typeof dependency.name !== "string") {
          return;
        }

        const pointer = appendJsonPointer(
          appendJsonPointer("/libraries", index),
          "name",
        );
        const firstPointer = firstByName.get(dependency.name);

        if (firstPointer === undefined) {
          firstByName.set(dependency.name, pointer);
          return;
        }

        diagnostics.push({
          code: "E023",
          severity: DIAGNOSTIC_CATALOG.E023.severity,
          message: `Duplicate library dependency name ${JSON.stringify(dependency.name)}.`,
          file,
          ...positionAt(pointer),
          jsonPointer: pointer,
          related: [
            {
              file,
              ...positionAt(firstPointer),
              note: "First declaration of this library dependency name.",
            },
          ],
        });
      });
    }

    return normalizeDiagnostics(diagnostics);
  }

  validateEntity(
    entity: EntitySchemaName,
    value: JsonValue,
    context: EntityValidationContext,
  ): Diagnostic[] {
    const validate = this.#entityValidators.get(entity);

    if (validate === undefined) {
      throw new Error(
        `No validator is registered for ${JSON.stringify(entity)}.`,
      );
    }

    const schemaDiagnostics = validateJsonValue(validate, value, context);

    if (schemaDiagnostics.length > 0) {
      return schemaDiagnostics;
    }

    const dispatchedDiagnostics =
      entity === "device-type"
        ? this.#validateFunctionBranches(value, context)
        : entity === "library-file"
          ? this.#validateLibraryFileTypes(value, context)
          : [];

    if (dispatchedDiagnostics.length > 0) {
      return dispatchedDiagnostics;
    }

    return validateStructuralChecks(entity, value, context);
  }
}

function createSchemaRegistry(
  schemas: readonly LoadedSchema[],
): SchemaRegistry {
  const ajv = createAjv2020(schemas.map(({ schema }) => schema));

  for (const { id } of schemas) {
    if (ajv.getSchema(id) === undefined) {
      throw new Error(
        `Ajv did not register canonical schema ${JSON.stringify(id)}.`,
      );
    }
  }

  return new SchemaRegistry(ajv, schemas);
}

export async function loadSchemaRegistry(
  options: LoadSchemaRegistryOptions = {},
): Promise<SchemaRegistry> {
  const schemas = await loadCanonicalSchemas(options.schemaDirectory);
  return createSchemaRegistry(schemas);
}

export function createInMemoryCanonicalSchemaRegistry(): SchemaRegistry {
  const schemas = structuredClone(
    IN_MEMORY_CANONICAL_SCHEMAS,
  ) as LoadedSchema[];
  return createSchemaRegistry(schemas);
}
