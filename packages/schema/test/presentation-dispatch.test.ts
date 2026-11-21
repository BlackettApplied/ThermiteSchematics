import { expect, it } from "vitest";
import { createAjv2020, mapAjvErrors } from "../src/ajv-validation.js";
import { parseJson, type JsonValue } from "../src/parser.js";
import {
  createInMemoryCanonicalSchemaRegistry,
  loadCanonicalSchemas,
} from "../src/schema-registry.js";

const registry = createInMemoryCanonicalSchemaRegistry();
function diagnostics(value: JsonValue) {
  const parsed = parseJson(JSON.stringify(value, null, 2), "contract.json");
  if (parsed.value === undefined) throw Error("Invalid fixture");
  return registry.validateEntity("project-presentation", parsed.value, {
    file: "contract.json",
    nodes: parsed.nodes,
  });
}
function error(
  code: string,
  message: string,
  jsonPointer: string,
  line = 1,
  column = 1,
) {
  return {
    code,
    severity: "error",
    message,
    file: "contract.json",
    line,
    column,
    jsonPointer,
  };
}
const accepted = [
  "project-presentation/0.1",
  "project-presentation/0.2",
  "project-presentation/0.3",
];
const formatMessage =
  'Expected "format" to be one of: ["project-presentation/0.1", "project-presentation/0.2", "project-presentation/0.3"].';

it("reports one accepted-version diagnostic at the unknown format key or missing root", () => {
  for (const [value, line, column] of [
    [
      { format: "project-presentation/0.4", titleBlock: { broken: true } },
      2,
      3,
    ],
    [{ revision: "A", backgroundColor: "#ffffff" }, 1, 1],
    [{ format: 3 }, 2, 3],
  ] as const) {
    expect(diagnostics(value)).toEqual([
      {
        ...error("E014", formatMessage, "/format", line, column),
        allowed: accepted,
        allowedCount: 3,
      },
    ]);
  }
});
it("reports a non-object root once, without branch or union errors", () => {
  for (const value of [null, [], "project-presentation/0.3", 3])
    expect(diagnostics(value)).toEqual([
      error("E011", "Expected object value.", ""),
    ]);
});
it("dispatches malformed compact fields only to compact diagnostics", () => {
  const compact = (fields: JsonValue) =>
    diagnostics({ format: "project-presentation/0.3", titleBlock: { fields } });
  expect(compact({ custom: { slot: "customer", label: "Customer" } })).toEqual([
    error(
      "E012",
      'Unknown property "custom".',
      "/titleBlock/fields/custom",
      5,
      7,
    ),
  ]);
  expect(
    compact({ customer: { slot: "customer", label: "Customer", extra: true } }),
  ).toEqual([
    error(
      "E012",
      'Unknown property "extra".',
      "/titleBlock/fields/customer/extra",
      8,
      9,
    ),
  ]);
  expect(
    compact({ customer: { slot: "customer", label: "Customer", value: 12 } }),
  ).toEqual([
    error(
      "E011",
      "Expected string or null value.",
      "/titleBlock/fields/customer/value",
      8,
      18,
    ),
  ]);
});
it("keeps exact legacy diagnostics, including compact-only properties", () => {
  for (const format of [
    "project-presentation/0.1",
    "project-presentation/0.2",
  ]) {
    expect(
      diagnostics({
        format,
        revision: "A",
        backgroundColor: "#ffffff",
        frame: { preset: "compact" },
      }),
    ).toEqual([error("E012", 'Unknown property "frame".', "/frame", 5, 3)]);
    expect(
      diagnostics({ format, revision: 42, backgroundColor: "#ffffff" }),
    ).toEqual([error("E011", "Expected string value.", "/revision", 3, 15)]);
    expect(diagnostics({ format, revision: "A" })).toEqual([
      error(
        "E010",
        'Missing required property "backgroundColor".',
        "/backgroundColor",
      ),
    ]);
  }
});
it("maps an actual anyOf error to a located D4 diagnostic", () => {
  const validate = createAjv2020().compile({
    anyOf: [{ type: "string" }, { type: "number" }],
  });
  const parsed = parseJson("\n  null", "contract.json");
  expect(validate(parsed.value)).toBe(false);
  const union = validate.errors?.filter((e) => e.keyword === "anyOf") ?? [];
  expect(union).toHaveLength(1);
  expect(
    mapAjvErrors(union, { file: "contract.json", nodes: parsed.nodes }),
  ).toEqual([
    error("E014", "Value must match an accepted schema alternative.", "", 2, 3),
  ]);
});
it("keeps published anyOf acceptance identical to the disjoint oneOf contract", async () => {
  const canonical = (await loadCanonicalSchemas()).find(
    (s) => s.fileName === "project-presentation.schema.json",
  );
  if (!canonical) throw Error("Missing schema");
  const schema = canonical.schema as Record<string, unknown>;
  expect(schema.anyOf).toHaveLength(2);
  expect(schema).not.toHaveProperty("oneOf");
  const { anyOf, ...rest } = schema;
  const any = createAjv2020().compile(schema);
  const one = createAjv2020().compile({ ...rest, oneOf: anyOf });
  for (const value of [
    ...accepted.map((format) => ({
      format,
      revision: "A",
      backgroundColor: "#ffffff",
    })),
    {
      format: accepted[2],
      titleBlock: {
        fields: { customer: { slot: "customer", label: "X", value: "Y" } },
      },
    },
    {},
    { format: "project-presentation/0.4" },
    null,
    [],
    { format: accepted[1], frame: { preset: "compact" } },
    { format: accepted[2], titleBlock: { fields: { bad: {} } } },
  ])
    expect(any(value)).toBe(one(value));
});
