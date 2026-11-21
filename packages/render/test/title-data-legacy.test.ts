import { expect, it } from "vitest";
import { prepareSchematicTitleContext } from "../src/title-block.js";
const view = {
  format: "schematic-view/0.1",
  root: { deviceUid: "synthetic-native-uid", designation: "Q1" },
  family: "control",
  flow: "left-to-right",
} as const;
it.each([
  "project-presentation/0.1",
  "project-presentation/0.2",
  undefined,
] as const)("preserves the original title contract for %s", (format) => {
  const p = format
    ? {
        format,
        revision: "SOURCE REV",
        backgroundColor: "#ffffff",
        titleBlockLines: ["Source note"],
      }
    : undefined;
  const result = prepareSchematicTitleContext("Source project", view, p);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.revision).toBe(format ? "SOURCE REV" : "UNSPECIFIED");
  expect(
    result.value.lines
      .filter((line) => line.field === "title.authored-line")
      .map((line) => line.value),
  ).toEqual(format ? ["Source note"] : []);
  expect(result.value.lines[1]?.value).toBe(
    `Revision: ${format ? "SOURCE REV" : "UNSPECIFIED"}`,
  );
});
