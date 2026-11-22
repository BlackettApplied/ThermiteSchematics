import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { mutationRecipe } from "./seed-mutations.mjs";

const committed = JSON.parse(
  readFileSync(new URL("../corpus/mutations.json", import.meta.url), "utf8"),
);
it("keeps class-builder output in the complete committed seed order on every call", () => {
  const ids = committed.cases.map((row) => row.id);
  expect(ids).toHaveLength(60);
  expect(new Set(ids).size).toBe(ids.length);
  for (let i = 0; i < 3; i++)
    expect(mutationRecipe().cases.map((row) => row.id)).toEqual(ids);
});
it("preserves within-recipe alternatives sharing with fresh state for each recipe", () => {
  const first = mutationRecipe(),
    second = mutationRecipe();
  const find = (recipe, id) => recipe.cases.find((row) => row.id === id);
  expect(find(first, "kind-0").alternatives).toBe(
    find(first, "kind-1").alternatives,
  );
  expect(find(first, "unknown-type-0").alternatives).toBe(
    find(first, "unknown-type-1").alternatives,
  );
  expect(find(first, "unknown-type-0").alternatives).not.toBe(
    find(second, "unknown-type-0").alternatives,
  );
  first.cases.reverse();
  find(first, "unknown-type-0").alternatives.push("changed in first recipe");
  find(first, "missing-uid").changes[0].file = "changed.json";
  expect(mutationRecipe()).toEqual(second);
  expect(second.cases.map((row) => row.id)).toEqual(
    committed.cases.map((row) => row.id),
  );
});
