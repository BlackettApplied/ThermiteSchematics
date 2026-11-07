// Complete, byte-exact maintainer recipe, including the required relock AFTER
// formatting. --verify regenerates into disposable scratch and changes no input.
import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { corpus, temporary, json } from "./support.mjs";
import { renderDiagnosticRecipe } from "./seed-render-diagnostics.mjs";
import { seedCorpus } from "./seed-corpus.mjs";
import { mutationRecipe } from "./seed-mutations.mjs";
import { corpusInventory } from "./provenance.mjs";
import { sealCorpus } from "./seal-corpus.mjs";
import { lockProject } from "./engine.mjs";
async function reseed(destination) {
  await mkdir(destination, { recursive: true });
  await seedCorpus(destination);
  await writeFile(
    join(destination, "render-diagnostics.json"),
    json(renderDiagnosticRecipe()),
  );
  if (destination !== corpus)
    await cp(
      join(corpus, "baselines.json"),
      join(destination, "baselines.json"),
    );
  await writeFile(join(destination, "mutations.json"), json(mutationRecipe()));
  const options = {
    ...(await resolveConfig(join(corpus, "mutations.json"))),
    parser: "json",
  };
  for (const { path } of await corpusInventory(destination))
    await writeFile(
      join(destination, path),
      await format(await readFile(join(destination, path), "utf8"), options),
    );
  for (const fixture of ["topology", "ratings-pair"]) {
    const locked = await lockProject(join(destination, fixture));
    assert(locked.ok, json(locked.diagnostics));
  }
  await sealCorpus(destination);
  await writeFile(
    join(destination, "manifest.json"),
    await format(
      await readFile(join(destination, "manifest.json"), "utf8"),
      options,
    ),
  );
}
if (process.argv.includes("--verify"))
  await temporary(async (destination) => {
    await reseed(destination);
    assert.deepEqual(
      await corpusInventory(destination),
      await corpusInventory(),
    );
    assert.equal(
      await readFile(join(destination, "manifest.json"), "utf8"),
      await readFile(join(corpus, "manifest.json"), "utf8"),
    );
    process.stdout.write(
      "Corpus recipe reproduces every fixture and manifest byte.\n",
    );
  }, null);
else await reseed(corpus);
