import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";

import {
  AJV_KEYWORD_TO_CODE,
  UnmappedAjvKeywordError,
  createAjv2020,
  mapAjvErrors,
} from "../src/ajv-validation.js";
import { parseJson } from "../src/parser.js";
import { loadCanonicalSchemas } from "../src/schema-registry.js";

const NON_ERROR_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$defs",
  "$ref",
  "description",
  "title",
  "properties",
  "patternProperties",
  "items",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectErrorProducingSchemaKeywords(
  schema: unknown,
  keywords = new Set<string>(),
): Set<string> {
  if (!isObject(schema)) {
    return keywords;
  }

  for (const keyword of Object.keys(schema)) {
    if (!NON_ERROR_SCHEMA_KEYWORDS.has(keyword)) {
      keywords.add(keyword);
    }
  }

  for (const keyword of [
    "items",
    "additionalProperties",
    "propertyNames",
    "contains",
    "not",
    "if",
    "then",
    "else",
  ]) {
    collectErrorProducingSchemaKeywords(schema[keyword], keywords);
  }

  for (const keyword of [
    "$defs",
    "properties",
    "patternProperties",
    "dependentSchemas",
  ]) {
    const children = schema[keyword];

    if (isObject(children)) {
      Object.values(children).forEach((child) =>
        collectErrorProducingSchemaKeywords(child, keywords),
      );
    }
  }

  for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const children = schema[keyword];

    if (Array.isArray(children)) {
      children.forEach((child) =>
        collectErrorProducingSchemaKeywords(child, keywords),
      );
    }
  }

  return keywords;
}

describe("Ajv2020 configuration", () => {
  it("runs draft 2020-12 in strict, all-errors mode", () => {
    const ajv = createAjv2020();

    expect(() =>
      ajv.compile({ type: "string", unknownKeyword: true }),
    ).toThrow();

    const validate = ajv.compile({
      type: "object",
      additionalProperties: false,
      required: ["requiredValue"],
      properties: {
        requiredValue: { type: "string" },
        count: { type: "number" },
      },
    });

    expect(validate({ count: "wrong", extra: true })).toBe(false);
    expect(validate.errors?.map((error) => error.keyword)).toEqual(
      expect.arrayContaining(["required", "additionalProperties", "type"]),
    );
  });
});

describe("closed Ajv keyword mapping", () => {
  it("matches D4 exactly", () => {
    expect(AJV_KEYWORD_TO_CODE).toEqual({
      required: "E010",
      type: "E011",
      additionalProperties: "E012",
      pattern: "E013",
      format: "E013",
      propertyNames: "E013",
      minLength: "E013",
      maxLength: "E013",
      enum: "E014",
      const: "E014",
      minItems: "E015",
      maxItems: "E015",
      minimum: "E015",
      maximum: "E015",
    });
  });

  it("maps every error-producing keyword used by the canonical schemas", async () => {
    const canonicalSchemas = await loadCanonicalSchemas();
    const usedKeywords = new Set<string>();

    canonicalSchemas.forEach(({ schema }) =>
      collectErrorProducingSchemaKeywords(schema, usedKeywords),
    );

    expect([...usedKeywords].sort()).toEqual([
      "additionalProperties",
      "const",
      "enum",
      "maxItems",
      "maxLength",
      "maximum",
      "minItems",
      "minLength",
      "minimum",
      "pattern",
      "propertyNames",
      "required",
      "type",
    ]);
    expect(
      [...usedKeywords].filter(
        (keyword) => !Object.hasOwn(AJV_KEYWORD_TO_CODE, keyword),
      ),
    ).toEqual([]);
  });

  it("rejects an Ajv error whose keyword has no mapping", () => {
    const unmappedError = {
      instancePath: "",
      schemaPath: "#/multipleOf",
      keyword: "multipleOf",
      params: { limit: 0 },
    } as ErrorObject;

    expect(() =>
      mapAjvErrors([unmappedError], {
        file: "input.json",
        nodes: new Map(),
      }),
    ).toThrow(UnmappedAjvKeywordError);
  });
});

describe("Ajv source-location mapping", () => {
  it("uses object, key, and value anchors exactly as specified by D4", () => {
    const source = [
      "{",
      '  "Name!": "bad",',
      '  "name": 1,',
      '  "extra": true',
      "}",
    ].join("\n");
    const parsed = parseJson(source, "schema/input.json");
    expect(parsed.value).toBeDefined();

    const ajv = createAjv2020();
    const validate = ajv.compile({
      type: "object",
      additionalProperties: false,
      propertyNames: { pattern: "^[a-z]+$" },
      required: ["missing"],
      properties: {
        missing: { type: "string" },
        name: { type: "string" },
      },
    });

    expect(validate(parsed.value)).toBe(false);
    const diagnostics = mapAjvErrors(validate.errors ?? [], {
      file: "schema\\input.json",
      nodes: parsed.nodes,
      ...(parsed.value === undefined ? {} : { value: parsed.value }),
    });

    expect(
      diagnostics.map(({ code, file, jsonPointer, line, column }) => ({
        code,
        file,
        jsonPointer,
        line,
        column,
      })),
    ).toEqual([
      {
        code: "E010",
        file: "schema/input.json",
        jsonPointer: "/missing",
        line: 1,
        column: 1,
      },
      {
        code: "E012",
        file: "schema/input.json",
        jsonPointer: "/Name!",
        line: 2,
        column: 3,
      },
      {
        code: "E013",
        file: "schema/input.json",
        jsonPointer: "/Name!",
        line: 2,
        column: 3,
      },
      {
        code: "E011",
        file: "schema/input.json",
        jsonPointer: "/name",
        line: 3,
        column: 11,
      },
      {
        code: "E012",
        file: "schema/input.json",
        jsonPointer: "/extra",
        line: 4,
        column: 3,
      },
    ]);
    expect(
      diagnostics.every((diagnostic) => !diagnostic.message.startsWith("must")),
    ).toBe(true);
  });
});
