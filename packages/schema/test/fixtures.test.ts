import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  validateProjectManifest,
  validateSourceDocument,
  validateUniqueUids,
  type ParsedDocument,
} from "../src/document-validation.js";
import { normalizeDiagnostics, type Diagnostic } from "../src/diagnostics.js";
import { parseJson } from "../src/parser.js";
import {
  ENTITY_SCHEMA_NAMES,
  isEntitySchemaName,
  loadSchemaRegistry,
  type EntitySchemaName,
  type SchemaRegistry,
} from "../src/schema-registry.js";

interface ExpectedDiagnostic {
  code: string;
  file?: string;
  jsonPointer: string;
  line: number;
  column: number;
  related?: {
    file: string;
    line: number;
    column: number;
    note: string;
  }[];
}

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

function diagnosticShape(
  diagnostic: Diagnostic,
  includeFile = false,
): ExpectedDiagnostic {
  return {
    code: diagnostic.code,
    ...(includeFile ? { file: diagnostic.file } : {}),
    jsonPointer: diagnostic.jsonPointer,
    line: diagnostic.line,
    column: diagnostic.column,
    ...(diagnostic.related === undefined
      ? {}
      : { related: diagnostic.related }),
  };
}

function validateParsedDocument(
  registry: SchemaRegistry,
  entity: EntitySchemaName | undefined,
  document: ParsedDocument,
): Diagnostic[] {
  return entity === "source-file"
    ? validateSourceDocument(registry, document)
    : entity === "project"
      ? validateProjectManifest(registry, document)
      : entity === undefined
        ? []
        : registry.validateEntity(entity, document.value, {
            file: document.file,
            nodes: document.nodes,
          });
}

function entityForFixture(name: string): EntitySchemaName | undefined {
  return [...ENTITY_SCHEMA_NAMES]
    .sort((left, right) => right.length - left.length)
    .find((entity) => name === entity || name.startsWith(`${entity}-`));
}

describe("parser and entity-schema fixtures", async () => {
  const invalidRoot = join(fixtureRoot, "invalid");
  const registry = await loadSchemaRegistry();
  const fixtureNames = (await readdir(invalidRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it.each(fixtureNames)("matches invalid/%s/expected.json", async (name) => {
    const fixtureDirectory = join(invalidRoot, name);
    const expected = JSON.parse(
      await readFile(join(fixtureDirectory, "expected.json"), "utf8"),
    ) as ExpectedDiagnostic[];
    const fixtureEntries = await readdir(fixtureDirectory, {
      withFileTypes: true,
    });
    const inputsEntry = fixtureEntries.find(
      (entry) => entry.isDirectory() && entry.name === "inputs",
    );

    if (inputsEntry !== undefined) {
      const inputsRoot = join(fixtureDirectory, inputsEntry.name);
      const inputNames = (await readdir(inputsRoot))
        .filter((inputName) => inputName.endsWith(".json"))
        .sort();
      const documents: ParsedDocument[] = [];
      const diagnostics: Diagnostic[] = [];

      for (const inputName of inputNames) {
        const input = await readFile(join(inputsRoot, inputName), "utf8");
        const file = `fixtures\\invalid\\${name}\\inputs\\${inputName}`;
        const result = parseJson(input, file);
        diagnostics.push(...result.diagnostics);

        if (result.value !== undefined && result.diagnostics.length === 0) {
          const document = { file, value: result.value, nodes: result.nodes };
          documents.push(document);
          diagnostics.push(
            ...validateParsedDocument(registry, "source-file", document),
          );
        }
      }

      diagnostics.push(...validateUniqueUids(documents));
      expect(
        normalizeDiagnostics(diagnostics).map((diagnostic) =>
          diagnosticShape(diagnostic, true),
        ),
      ).toEqual(expected);
      return;
    }

    const input = await readFile(join(fixtureDirectory, "input.json"), "utf8");
    const result = parseJson(input, `fixtures\\invalid\\${name}\\input.json`);
    const diagnostics: Diagnostic[] = [...result.diagnostics];
    const entity = entityForFixture(name);

    if (
      entity !== undefined &&
      result.value !== undefined &&
      result.diagnostics.length === 0
    ) {
      diagnostics.push(
        ...validateParsedDocument(registry, entity, {
          file: `fixtures\\invalid\\${name}\\input.json`,
          value: result.value,
          nodes: result.nodes,
        }),
      );
    }

    expect(
      diagnostics.map((diagnostic) => diagnosticShape(diagnostic)),
    ).toEqual(expected);
  });

  it("keeps the CRLF fixture byte-sensitive", async () => {
    const input = await readFile(
      join(invalidRoot, "crlf-file", "input.json"),
      "utf8",
    );

    expect(input).toContain("\r\n");
    expect(input.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("keeps the tab-indented fixture byte-sensitive", async () => {
    const input = await readFile(
      join(invalidRoot, "tab-indented", "input.json"),
      "utf8",
    );

    expect(input).toContain('\n\t"tab"');
  });

  it("parses valid fixtures without diagnostics", async () => {
    const validRoot = join(fixtureRoot, "valid");
    const names = (await readdir(validRoot))
      .filter((name) => name.endsWith(".json"))
      .sort();

    for (const name of names) {
      const input = await readFile(join(validRoot, name), "utf8");
      const result = parseJson(input, `fixtures/valid/${name}`);
      const entity = entityForFixture(name.slice(0, -".json".length));

      expect(result.value, name).toBeDefined();
      expect(result.diagnostics, name).toEqual([]);

      if (entity !== undefined && result.value !== undefined) {
        expect(
          validateParsedDocument(registry, entity, {
            file: `fixtures/valid/${name}`,
            value: result.value,
            nodes: result.nodes,
          }),
          name,
        ).toEqual([]);
      }
    }
  });
});
