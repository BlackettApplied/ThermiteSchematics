import type { RobustnessDraft } from "./render-robustness-draft.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";

export async function compileRobustnessDraft(
  root: string,
  { eq, w, p }: RobustnessDraft,
) {
  for (const [file, value] of [
    ["devices/equipment.json", eq],
    ["connections/control-power.json", w],
    ["potentials/potentials.json", p],
  ] as const)
    await writeFile(join(root, file), JSON.stringify(value));

  const compiled = await compileProject(root);

  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));

  return compiled;
}
