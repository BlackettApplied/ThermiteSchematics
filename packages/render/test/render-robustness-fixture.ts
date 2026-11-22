import { mkdtemp, cp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type {
  RobustnessVariant,
  RobustnessOptions,
} from "./render-robustness-draft.js";
import {
  createRobustnessDraft,
  applyRobustnessOptions,
} from "./render-robustness-draft.js";
import { applyRobustnessVariant } from "./render-robustness-variants.js";
import { compileRobustnessDraft } from "./render-robustness-compile.js";

export const byDesignation = (value: string) => ({
  by: "designation" as const,
  value,
});

/** Recompile source, including nets and indexes, after each identity assignment. */
export async function robustnessFixture() {
  const root = await mkdtemp(join(tmpdir(), "thermite-render-robustness-"));

  await cp(resolve("packages/cli/templates/starter-default"), root, {
    recursive: true,
  });

  const read = async (file: string) =>
    JSON.parse(await readFile(join(root, file), "utf8"));

  const equipment = await read("devices/equipment.json");

  const wires = await read("connections/control-power.json");

  const potentials = await read("potentials/potentials.json");
  return {
    root,
    close: () => rm(root, { recursive: true, force: true }),
    async compile(
      variant: RobustnessVariant,
      seed?: number,
      options: RobustnessOptions = {},
    ) {
      const draft = createRobustnessDraft(
        equipment,
        wires,
        potentials,
        seed,
        options,
      );
      applyRobustnessVariant(draft, variant);
      applyRobustnessOptions(draft, variant, seed, options);
      return compileRobustnessDraft(root, draft);
    },
  };
}
