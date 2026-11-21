import { describe, expect, it } from "vitest";
import { validateSourceDocument } from "../src/document-validation.js";
import { parseJson, type JsonValue } from "../src/parser.js";
import { loadSchemaRegistry } from "../src/schema-registry.js";

describe("authored non-procurement metadata", async () => {
  const registry = await loadSchemaRegistry();
  const validate = (extra: Record<string, JsonValue>) => {
    const parsed = parseJson(
      JSON.stringify({
        objects: [
          {
            uid: "56000000-0000-4000-8000-000000000001",
            kind: "device",
            designation: "SUP1",
            type: "fixture:source",
            ...extra,
          },
        ],
      }),
      "source.json",
    );
    return validateSourceDocument(registry, {
      file: "source.json",
      value: parsed.value!,
      nodes: parsed.nodes,
    });
  };
  it("accepts old devices unchanged and an explicit reason", () => {
    expect(validate({})).toEqual([]);
    expect(
      validate({
        nonProcurement: {
          reason: "Existing site utility; outside purchasing scope",
        },
      }),
    ).toEqual([]);
  });
  it.each([
    [null, "E011", "/objects/0/nonProcurement"],
    [true, "E011", "/objects/0/nonProcurement"],
    [{}, "E010", "/objects/0/nonProcurement/reason"],
    [{ reason: "" }, "E013", "/objects/0/nonProcurement/reason"],
    [{ reason: " \n\t" }, "E013", "/objects/0/nonProcurement/reason"],
    [{ reason: 1 }, "E011", "/objects/0/nonProcurement/reason"],
    [
      { reason: "Utility", inferred: true },
      "E012",
      "/objects/0/nonProcurement/inferred",
    ],
  ])(
    "rejects invalid flag %j with a located diagnostic",
    (value, code, jsonPointer) => {
      expect(validate({ nonProcurement: value as JsonValue })).toMatchObject([
        { code, jsonPointer },
      ]);
    },
  );
});
