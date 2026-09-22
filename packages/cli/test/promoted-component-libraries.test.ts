import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { verifyPromotedExample } from "../../../scripts/library-batch/promote.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

for (const library of [
  "abb-pilot",
  "weidmueller-pilot",
  "siemens-pilot",
  "stahl-pilot",
  "schneider-pilot",
  "murr-pilot",
  "releco-pilot",
]) {
  const examplesDirectory = join(repository, "libraries", library, "examples");
  const examples = existsSync(examplesDirectory)
    ? readdirSync(examplesDirectory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(join(examplesDirectory, entry.name, "promotion.json")),
        )
        .map((entry) => entry.name)
        .sort()
    : [];

  describe(`${library} promoted components`, () => {
    test("contains promoted examples with provenance metadata", () => {
      expect(examples.length).toBeGreaterThan(0);
    });

    test.each(examples)(
      "%s preserves its accepted bytes, locked nets and rendered coverage",
      async (example) => {
        const result = await verifyPromotedExample({
          example: join(examplesDirectory, example),
        });
        expect(result.status).toBe("verified-promoted-example");
        expect(result.typeId).toBe(`${library}:${example}`);
        expect(result.sheets).toBeGreaterThan(0);
      },
      30_000,
    );
  });
}
