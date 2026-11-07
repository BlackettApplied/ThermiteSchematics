import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";

import {
  AJV_KEYWORD_TO_CODE,
  UnmappedAjvKeywordError,
  createAjv2020,
  mapAjvErrors,
} from "../src/ajv-validation.js";
import { DIAGNOSTIC_ALLOWED_LIMIT } from "../src/diagnostic-alternatives.js";
import { parseJson } from "../src/parser.js";
import {
  describeSchemaPattern,
  hasSchemaPatternDescription,
} from "../src/pattern-descriptions.js";
import {
  ENTITY_SCHEMA_NAMES,
  loadCanonicalSchemas,
} from "../src/schema-registry.js";

const OUTPUT_SCHEMA_FILES = new Set([
  "diagnostic.schema.json",
  "agent-tool-result.schema.json",
  "agent-tool-report.schema.json",
]);

const NON_ERROR_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$defs",
  "$ref",
  "description",
  "title",
  "properties",
  "patternProperties",
  // This applicator adds no wrapper error; child enum/type errors are walked below.
  "dependentSchemas",
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

  it("maps every error-producing keyword used by canonical source schemas", async () => {
    const canonicalSchemas = await loadCanonicalSchemas();
    const sourceSchemas = canonicalSchemas.filter(
      ({ fileName }) => !OUTPUT_SCHEMA_FILES.has(fileName),
    );
    expect(sourceSchemas.map(({ fileName }) => fileName).sort()).toEqual(
      [
        ...ENTITY_SCHEMA_NAMES.map((name) => `${name}.schema.json`),
        "common.schema.json",
      ].sort(),
    );
    const usedKeywords = new Set<string>();

    sourceSchemas.forEach(({ schema }) =>
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

  it("audits output-contract keywords without expanding the D4 source error mapping", async () => {
    const canonicalSchemas = await loadCanonicalSchemas();
    const outputSchemas = canonicalSchemas.filter(({ fileName }) =>
      OUTPUT_SCHEMA_FILES.has(fileName),
    );
    expect(outputSchemas.map(({ fileName }) => fileName).sort()).toEqual(
      [...OUTPUT_SCHEMA_FILES].sort(),
    );
    const keywords = new Set<string>();
    outputSchemas.forEach(({ schema }) =>
      collectErrorProducingSchemaKeywords(schema, keywords),
    );
    expect([...keywords].sort()).toEqual([
      "additionalProperties",
      "anyOf",
      "const",
      "enum",
      "maxItems",
      "minLength",
      "minimum",
      "pattern",
      "required",
      "type",
    ]);
    // Output contracts return raw Ajv validation errors. They are not source
    // entity validators and do not translate failures into electrical E-codes.
    const ajv = createAjv2020(canonicalSchemas.map(({ schema }) => schema));
    for (const { id } of outputSchemas)
      expect(ajv.getSchema(id)).toBeTypeOf("function");
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

function collectSchemaKeywordValues(
  schema: unknown,
  keyword: "enum" | "pattern",
  values: unknown[] = [],
): unknown[] {
  if (Array.isArray(schema)) {
    schema.forEach((child) =>
      collectSchemaKeywordValues(child, keyword, values),
    );
  } else if (isObject(schema)) {
    for (const [key, child] of Object.entries(schema)) {
      if (
        key === keyword &&
        (typeof child === "string" || keyword === "enum")
      ) {
        values.push(child);
      } else {
        collectSchemaKeywordValues(child, keyword, values);
      }
    }
  }
  return values;
}

function validateOnce(schema: object, source: string) {
  const parsed = parseJson(source, "input.json");
  const validate = createAjv2020().compile(schema);
  expect(validate(parsed.value)).toBe(false);
  return mapAjvErrors(validate.errors ?? [], {
    file: "input.json",
    nodes: parsed.nodes,
    ...(parsed.value === undefined ? {} : { value: parsed.value }),
  });
}

describe("valid alternatives on schema diagnostics", () => {
  it("describes every canonical schema pattern in words", async () => {
    const patterns = new Set<string>();
    for (const { schema } of await loadCanonicalSchemas()) {
      for (const pattern of collectSchemaKeywordValues(schema, "pattern")) {
        patterns.add(pattern as string);
      }
    }
    expect(patterns.size).toBeGreaterThan(0);
    expect(
      [...patterns].filter((pattern) => !hasSchemaPatternDescription(pattern)),
    ).toEqual([]);
  });

  it("keeps every canonical enum scalar and within the structured limit", async () => {
    const enums: unknown[] = [];
    for (const { schema } of await loadCanonicalSchemas()) {
      enums.push(...collectSchemaKeywordValues(schema, "enum"));
    }
    expect(enums.length).toBeGreaterThan(0);
    for (const values of enums) {
      expect(Array.isArray(values)).toBe(true);
      expect((values as unknown[]).length).toBeLessThanOrEqual(
        DIAGNOSTIC_ALLOWED_LIMIT,
      );
      expect(
        (values as unknown[]).every(
          (value) =>
            value === null ||
            ["string", "number", "boolean"].includes(typeof value),
        ),
      ).toBe(true);
    }
  });

  it("lists a small enum completely in schema order", () => {
    expect(
      validateOnce(
        {
          type: "object",
          properties: { flow: { enum: ["top-to-bottom", "left-to-right"] } },
        },
        '{ "flow": "sideways" }',
      ),
    ).toEqual([
      {
        code: "E014",
        severity: "error",
        message:
          'Value is not one of the allowed values: ["top-to-bottom", "left-to-right"].',
        file: "input.json",
        line: 1,
        column: 11,
        jsonPointer: "/flow",
        allowed: ["top-to-bottom", "left-to-right"],
        allowedCount: 2,
      },
    ]);
  });

  it("bounds a long enum and names the schema lookup", () => {
    const values = Array.from(
      { length: 60 },
      (_, index) => `v${String(index).padStart(2, "0")}`,
    );
    const [diagnostic] = validateOnce(
      { type: "object", properties: { value: { enum: values } } },
      '{ "value": "missing" }',
    );
    const lookup = 'the "enum" at schema path #/properties/value/enum';
    expect(diagnostic).toMatchObject({
      code: "E014",
      jsonPointer: "/value",
      allowed: values.slice(0, DIAGNOSTIC_ALLOWED_LIMIT),
      allowedCount: 60,
      allowedLookup: lookup,
      message: `Value is not one of the allowed values: [${values
        .slice(0, 10)
        .map((value) => JSON.stringify(value))
        .join(", ")}] and 50 more; full list: ${lookup}.`,
    });
    expect(diagnostic?.allowed).toHaveLength(DIAGNOSTIC_ALLOWED_LIMIT);
  });

  it("lists the required constant", () => {
    expect(
      validateOnce(
        { type: "object", properties: { format: { const: "thermite/0.1" } } },
        '{ "format": "thermite/9" }',
      ),
    ).toEqual([
      {
        code: "E014",
        severity: "error",
        message: 'Value does not equal the required constant "thermite/0.1".',
        file: "input.json",
        line: 1,
        column: 13,
        jsonPointer: "/format",
        allowed: ["thermite/0.1"],
        allowedCount: 1,
      },
    ]);
  });

  it("quotes an undescribed pattern as a raw regex and keeps it structured", () => {
    expect(describeSchemaPattern("^[a-z]+$")).toBe("/^[a-z]+$/");
    expect(
      validateOnce(
        {
          type: "object",
          properties: { name: { type: "string", pattern: "^[a-z]+$" } },
        },
        '{ "name": "ABC" }',
      ),
    ).toEqual([
      {
        code: "E013",
        severity: "error",
        message:
          "String value does not match the required pattern: /^[a-z]+$/.",
        file: "input.json",
        line: 1,
        column: 11,
        jsonPointer: "/name",
        pattern: "^[a-z]+$",
      },
    ]);
  });

  it("adds no alternatives to other schema keywords", () => {
    const [diagnostic] = validateOnce(
      { type: "object", properties: { name: { type: "string" } } },
      '{ "name": 1 }',
    );
    expect(diagnostic?.code).toBe("E011");
    expect(diagnostic).not.toHaveProperty("allowed");
    expect(diagnostic).not.toHaveProperty("allowedCount");
    expect(diagnostic).not.toHaveProperty("pattern");
  });
});
