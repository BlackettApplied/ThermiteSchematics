import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
it("drops the unused render checkPresentation re-export", () => {
  const render = readFileSync(
    "packages/render/src/internal/title-data/validation.ts",
    "utf8",
  );
  expect(render).not.toContain("export { checkPresentation }");
});
it("removes the unused schema validation subpath while retaining other internal imports", () => {
  const pkg = JSON.parse(readFileSync("packages/schema/package.json", "utf8"));
  expect(
    pkg.exports["./internal/title-data/presentation-validation"],
  ).toBeNull();
  expect(
    execFileSync(
      "node",
      [
        "--input-type=module",
        "-e",
        'try { import.meta.resolve("@thermite/schema/internal/title-data/presentation-validation"); process.exit(2); } catch(error) { if(error.code!=="ERR_PACKAGE_PATH_NOT_EXPORTED")throw error; }',
      ],
      { encoding: "utf8" },
    ),
  ).toBe("");
});
it("documents checkPresentation's canonical-validator precondition", () => {
  const schema = readFileSync(
    "packages/schema/src/internal/title-data/presentation-validation.ts",
    "utf8",
  );
  expect(schema).toContain("Must run after the canonical schema validator");
});
