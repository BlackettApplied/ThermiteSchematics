import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceFiles, createSeal, verifyCorpus } from "./corpus.mjs";
import { command, json } from "./support.mjs";
it("seals tracked drawing inputs, ignores output, and reports tracked drift without failing", async () => {
  const root = await mkdtemp(join(tmpdir(), "draw-seal-")),
    selection = { roots: ["fixture"], requests: [] };
  try {
    await command(root, "git", ["init", "-q"]);
    await command(root, "git", [
      "config",
      "user.email",
      "fixture@example.invalid",
    ]);
    await command(root, "git", ["config", "user.name", "Synthetic fixture"]);
    await mkdir(join(root, "fixture/out"), { recursive: true });
    await mkdir(join(root, "corpus"));
    await writeFile(join(root, ".gitignore"), "out/\n");
    await writeFile(join(root, "fixture/source.json"), "{}\n");
    await writeFile(join(root, "fixture/package.json"), "{}\n");
    await command(root, "git", ["add", "."]);
    await command(root, "git", [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "synthetic seal input",
    ]);
    const before = await createSeal(root, selection);
    await writeFile(join(root, "corpus/manifest.json"), json(before));
    await writeFile(join(root, "fixture/out/view.json"), "{}\n");
    expect(await sourceFiles(root, selection)).toEqual(before.files);
    expect(Object.keys(before.files)).toEqual(["fixture/source.json"]);
    await writeFile(join(root, "fixture/source.json"), '{"changed":true}\n');
    const drift = await verifyCorpus(root, root, selection);
    expect(drift.changedFiles).toEqual(["fixture/source.json"]);
    expect(drift.actual.base).toMatch(/^[a-f0-9]{40}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
