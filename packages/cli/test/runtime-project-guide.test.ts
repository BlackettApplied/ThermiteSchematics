import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { RUNTIME_PROJECT_GUIDE_PATTERN } from "../../../scripts/runtime-package/verify.mjs";
import { initializeAlphaProject } from "../src/alpha-init.js";

const guidePath = new URL("../assets/THERMITE_AGENTS.md", import.meta.url);
let root: string;
beforeAll(async () => {
  root = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-runtime-guide-"),
  );
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function assertRuntimeGuide(guide: string) {
  assert.match(guide, RUNTIME_PROJECT_GUIDE_PATTERN);
}

it("keeps the project guide content required by runtime archive verification", async () => {
  assertRuntimeGuide(await readFile(guidePath, "utf8"));
});

it.each(["starter", "cabinets"] as const)(
  "initializes %s with the complete runtime project guide",
  async (template) => {
    const project = join(root, template);
    await initializeAlphaProject(project, { template });
    const initialized = await readFile(join(project, "AGENTS.md"));
    assertRuntimeGuide(initialized.toString("utf8"));
    expect(initialized).toEqual(await readFile(guidePath));
  },
);
