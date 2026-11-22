import { expect, it } from "vitest";
import { createAjv2020 } from "../src/ajv-validation.js";
import { slots } from "../src/internal/title-data/model.js";
import { titleLiteralLimit } from "../src/internal/title-data/validation-common.js";
import { loadCanonicalSchemas } from "../src/schema-registry.js";

it.each(slots)(
  "publishes the exact semantic value limit for %s",
  async (slot) => {
    const canonical = (await loadCanonicalSchemas()).find(
      (s) => s.fileName === "project-presentation.schema.json",
    );
    if (!canonical) throw Error("Missing presentation schema");
    const validate = createAjv2020().compile(canonical.schema);
    const limit = titleLiteralLimit(slot);
    // Measure the schema boundary rather than depending on its reference layout.
    const value = (length: number) => ({
      format: "project-presentation/0.3",
      titleBlock: {
        fields: { [slot]: { slot, label: "X", value: "é".repeat(length) } },
      },
    });
    expect(validate(value(limit))).toBe(true);
    expect(validate(value(limit + 1))).toBe(false);
    expect(
      validate.errors?.map((e) => ({
        keyword: e.keyword,
        instancePath: e.instancePath,
      })),
    ).toContainEqual({
      keyword: "maxLength",
      instancePath: `/titleBlock/fields/${slot}/value`,
    });
  },
);

it("keeps the header bound equal to the existing short-title semantic limit", async () => {
  const canonical = (await loadCanonicalSchemas()).find(
    (s) => s.fileName === "project-presentation.schema.json",
  );
  if (!canonical) throw Error("Missing presentation schema");
  const validate = createAjv2020().compile(canonical.schema);
  const value = (length: number) => ({
    format: "project-presentation/0.3",
    frame: { header: { text: "é".repeat(length) } },
  });
  const limit = titleLiteralLimit("sheetTitle");
  expect(validate(value(limit))).toBe(true);
  expect(validate(value(limit + 1))).toBe(false);
  expect(
    validate.errors?.map((e) => ({
      keyword: e.keyword,
      instancePath: e.instancePath,
    })),
  ).toContainEqual({
    keyword: "maxLength",
    instancePath: "/frame/header/text",
  });
});
