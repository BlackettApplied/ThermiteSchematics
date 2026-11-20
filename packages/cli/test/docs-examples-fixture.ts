import { afterEach, expect, it } from "vitest";
import { loadCorpus } from "../../../scripts/docs-lib.mjs";
import {
  exampleFences,
  exampleKey,
  readInventory,
} from "../../../scripts/docs-examples-lib.mjs";
import { recipes } from "../../../scripts/docs-example-recipes.mjs";
import { context } from "../../../scripts/docs-example-context.mjs";
import { repositoryRoot } from "./project-guide/harness.js";

export const corpus = await loadCorpus(repositoryRoot);
const fences = exampleFences(corpus);
const inventory = await readInventory(repositoryRoot);
const groups = new Map<string, typeof inventory.entries>();
for (const entry of inventory.entries) {
  if (entry.kind !== "executed" || inventory.bindings?.[entry.recipe]) continue;
  const key = `${entry.file} [${entry.recipe}]`;
  groups.set(key, [...(groups.get(key) ?? []), entry]);
}
// Sequential groups: at most one CLI child per worker, with independent trees.
// Existing topic recipes are executed by their specifically named guide tests,
// not recursively launched from here. The inventory test checks their hashes.
export function registerDocsExampleTests(
  parts: "agent" | "workspace" | "other",
) {
  const active = new Set<Awaited<ReturnType<typeof context>>>();
  afterEach(async () => {
    await Promise.all([...active].map((c) => c.cleanup()));
    active.clear();
  });
  for (const entries of groups.values()) {
    const { file, recipe } = entries[0];
    const workspace =
      recipe === "workspace-shell" || file === "docs/machine-demo.md";
    const group =
      recipe === "workspace-shell" && file === "evals/agent/README.md"
        ? "agent"
        : workspace
          ? "workspace"
          : "other";
    if (parts !== group) continue;
    it(
      recipes[recipe].testName(file, recipe),
      async () => {
        const c = await context(repositoryRoot);
        active.add(c);
        c.fences = fences;
        try {
          for (const entry of entries) {
            const fence = fences.find(
              (f) => exampleKey(f) === exampleKey(entry),
            );
            expect(fence, `missing ${entry.file}:${entry.hash}`).toBeDefined();
            await recipes[entry.recipe](c, fence);
          }
        } finally {
          await c.cleanup();
          active.delete(c);
        }
      },
      file === "docs/machine-demo.md" && recipe === "repo-shell"
        ? 240000
        : 120000,
    );
  }
}
