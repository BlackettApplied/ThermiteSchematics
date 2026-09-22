import { describe, expect, it } from "vitest";

import {
  validateProjectManifest,
  validateSourceDocument,
  validateUniqueUids,
  type ParsedDocument,
} from "../src/document-validation.js";
import { parseJson, type JsonValue } from "../src/parser.js";
import {
  SUPPORTED_PROJECT_FORMATS,
  loadSchemaRegistry,
} from "../src/schema-registry.js";

function parseDocument(value: JsonValue, file: string): ParsedDocument {
  const parsed = parseJson(JSON.stringify(value), file);

  if (parsed.value === undefined) {
    throw new Error(`Test document ${file} did not parse.`);
  }

  return { file, value: parsed.value, nodes: parsed.nodes };
}

describe("source document dispatch", async () => {
  const registry = await loadSchemaRegistry();

  it.each([
    {
      name: "unknown",
      object: { kind: "mystery" },
      pointer: "/objects/0/kind",
    },
    {
      name: "non-string",
      object: { kind: 42 },
      pointer: "/objects/0/kind",
    },
    {
      name: "missing",
      object: {},
      pointer: "/objects/0",
    },
  ])("reports exactly one E016 for a $name kind", (testCase) => {
    const document = parseDocument(
      { objects: [testCase.object] },
      `${testCase.name}.json`,
    );

    expect(validateSourceDocument(registry, document)).toMatchObject([
      { code: "E016", jsonPointer: testCase.pointer },
    ]);
  });

  it("prefixes dispatched entity diagnostics with the object pointer", () => {
    const document = parseDocument(
      {
        objects: [
          {
            kind: "device",
            designation: "K1",
            type: "core:contactor",
          },
        ],
      },
      "source.json",
    );

    expect(validateSourceDocument(registry, document)).toMatchObject([
      { code: "E010", jsonPointer: "/objects/0/uid" },
    ]);
  });
});

describe("project manifest checks", async () => {
  const registry = await loadSchemaRegistry();

  it("keeps the supported format list in code", () => {
    expect(SUPPORTED_PROJECT_FORMATS).toEqual(["electrical-system/0.1"]);
  });

  it("reports E017 and E023 at their value nodes", () => {
    const document = parseDocument(
      {
        format: "electrical-system/9.9",
        project: { name: "Example" },
        sources: ["sources/*.json"],
        libraries: [
          { name: "core", version: "0.1.0", path: "../core" },
          { name: "core", version: "0.2.0", path: "../core-next" },
        ],
      },
      "system.json",
    );

    expect(validateProjectManifest(registry, document)).toMatchObject([
      { code: "E017", jsonPointer: "/format" },
      {
        code: "E023",
        jsonPointer: "/libraries/1/name",
        related: [
          {
            file: "system.json",
            note: "First declaration of this library dependency name.",
          },
        ],
      },
    ]);
  });
});

describe("multi-document uid checks", () => {
  it("reports every duplicate after the first declaration across files", () => {
    const uid = "12345678-1234-4234-9234-123456789abc";
    const documents = [
      parseDocument({ objects: [{ uid }] }, "z-first.json"),
      parseDocument({ types: [] }, "library/types.json"),
      parseDocument({ objects: [{ uid }] }, "a-second.json"),
      parseDocument({ objects: [{ uid }] }, "m-third.json"),
    ];

    expect(validateUniqueUids(documents)).toMatchObject([
      {
        code: "E020",
        file: "a-second.json",
        jsonPointer: "/objects/0/uid",
        related: [
          {
            file: "z-first.json",
            note: "First declaration of this uid.",
          },
        ],
      },
      {
        code: "E020",
        file: "m-third.json",
        jsonPointer: "/objects/0/uid",
        related: [
          {
            file: "z-first.json",
            note: "First declaration of this uid.",
          },
        ],
      },
    ]);
  });
});
