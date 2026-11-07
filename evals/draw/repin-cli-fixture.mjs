// Isolated production CLI with synthetic corpus exports; never reads live corpus.
import {
  mkdtemp,
  mkdir,
  readdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assemble, it0, A } from "./repin-fixture.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
import { readCheckers, checkerManifestHash } from "./checker-manifest.mjs";
import { reviewInventory } from "./repin-core.mjs";
import { hash, json } from "./support.mjs";
export async function cliFixture({ survivor = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "thermite-repin-cli-")),
    kit = join(root, "evals/draw"),
    out = join(root, "evals/out");
  await mkdir(kit, { recursive: true });
  await mkdir(out);
  const source = fileURLToPath(new URL("./", import.meta.url));
  for (const e of await readdir(source))
    if (e.endsWith(".mjs")) await copyFile(join(source, e), join(kit, e));
  await writeFile(
    join(kit, "corpus.mjs"),
    `export const cases=()=>[{id:${JSON.stringify(A)},flow:"left-to-right"}];export const verifyCorpus=async()=>({seal:"seal"});`,
  );
  const old = it0("old"),
    target = it0("target");
  const c = assemble({
    registryItems: survivor ? [old, target] : [old],
    currentItems: [target],
    entries: ({ add, retire }) => [retire(old, "fixed"), add(target)],
  });
  await writeFile(join(kit, "expectations.mjs"), serializeRegistry(c.registry));
  c.report.checkers = await readCheckers(kit);
  c.report.checkerSha256 = checkerManifestHash(c.report.checkers);
  c.checkerSha256 = c.report.checkerSha256;
  c.reportSha256 = hash(json(c.report));
  await writeFile(join(out, "report.json"), json(c.report));
  await writeFile(join(out, "inventory.json"), json(reviewInventory(c)));
  return {
    root,
    out,
    context: c,
    run: (...args) =>
      spawnSync("bun", [join(kit, "repin.mjs"), ...args], {
        cwd: root,
        encoding: "utf8",
      }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
