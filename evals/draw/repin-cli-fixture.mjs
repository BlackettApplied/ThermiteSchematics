// Isolated production CLI with synthetic corpus exports; never reads live corpus.
import {
  mkdtemp,
  mkdir,
  readdir,
  copyFile,
  cp,
  symlink,
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
  await symlink(
    fileURLToPath(new URL("../../node_modules", import.meta.url)),
    join(root, "node_modules"),
    "junction",
  );
  for (const e of await readdir(source))
    if (e.endsWith(".mjs")) await copyFile(join(source, e), join(kit, e));
  await cp(join(source, "measurement"), join(kit, "measurement"), {
    recursive: true,
  });
  await writeFile(
    join(kit, "corpus.mjs"),
    `export const cases=()=>[{id:${JSON.stringify(A)},flow:"left-to-right"}];export const verifyCorpus=async()=>({seal:"seal"});`,
  );
  // Browser-free protocol test double. Real browser acceptance runs separately.
  await writeFile(
    join(kit, "crop-source.mjs"),
    `import {verificationFact} from "./crop-report.mjs";import {sourceVerificationFixture,verificationFixtures} from "./crop-source-fixture.mjs";export async function verifyCropSources(root,index,crops){const p=new Map(index.crops.map(c=>[c.path,{...sourceVerificationFixture(crops.get(c.path),c.headerPixels??0),...verificationFact(c,c.sourceRender[c.scope.medium+"Sha256"])}]));p.references=verificationFixtures(crops,index.crops);return p;}`,
  );
  await writeFile(
    join(kit, "crop-stamp-check.mjs"),
    "export async function verifyStampHeaders(){}",
  );
  const old = it0("old", { bbox: { x: 1, y: 1, w: 1, h: 1 } }),
    target = it0("target", { bbox: { x: 1, y: 1, w: 1, h: 1 } });
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
  const runScript = (script, ...args) =>
    spawnSync(
      process.execPath,
      ["run", "--no-install", join(kit, script), ...args],
      { cwd: root, encoding: "utf8" },
    );
  return {
    root,
    out,
    context: c,
    run: (...args) => runScript("repin.mjs", ...args),
    runScript,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
