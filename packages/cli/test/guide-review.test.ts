import {
  rewriteGuideLinks,
  assertGuideLinksResolved,
} from "../src/guide-markdown.js";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, expect, it } from "vitest";

import { exec, repositoryRoot, thermite } from "./project-guide/harness.js";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function provenanceFixture(installed: boolean) {
  const root = await mkdtemp(
    join(realpathSync(tmpdir()), "thermite-guide-provenance-"),
  );
  roots.push(root);
  const checkout = join(root, "checkout");
  const cli = join(
    checkout,
    installed ? "node_modules/@thermite/cli" : "packages/cli",
  );
  await mkdir(cli, { recursive: true });
  await cp(join(repositoryRoot, "packages/cli/dist"), join(cli, "dist"), {
    recursive: true,
  });
  await cp(join(repositoryRoot, "packages/cli/assets"), join(cli, "assets"), {
    recursive: true,
  });
  await mkdir(join(cli, "node_modules"));
  await mkdir(join(cli, "node_modules/@thermite"));
  await symlink(
    join(repositoryRoot, "packages/schema"),
    join(cli, "node_modules/@thermite/schema"),
    "junction",
  );
  await writeFile(join(cli, "package.json"), '{"type":"module"}');
  await writeFile(
    join(cli, "assets/guide/source.json"),
    JSON.stringify({ commit: "a".repeat(40) }),
  );
  const probe = join(cli, "probe.mjs");
  await writeFile(
    probe,
    'import { guideCommit } from "./dist/alpha-guide.js"; console.log(await guideCommit());',
  );
  return { root, checkout, cli, probe };
}
it.each([
  JSON.stringify({ commit: "d".repeat(40) }),
  JSON.stringify({ format: "wrong", commit: "d".repeat(40) }),
  '{"format":"thermite-runtime-release/0.1","commit":"' + "d".repeat(40) + '"}',
  "not json",
])("ignores a stray source-parent manifest: %s", async (manifest) => {
  const f = await provenanceFixture(false);
  await writeFile(join(f.root, "runtime-manifest.json"), manifest);
  await writeFile(join(f.checkout, "runtime-manifest.json"), manifest);
  const result = await exec([f.probe], f.checkout);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("a".repeat(40));
});
it("requires the installed runtime manifest format", async () => {
  const f = await provenanceFixture(true);
  await writeFile(
    join(f.checkout, "runtime-manifest.json"),
    JSON.stringify({
      format: "thermite-runtime-release/0.1",
      commit: "a".repeat(40),
    }),
  );
  const valid = await exec([f.probe], f.checkout);
  expect(valid.code, valid.stderr).toBe(0);
  expect(valid.stdout.trim()).toBe("a".repeat(40));
  await writeFile(
    join(f.cli, "assets/guide/source.json"),
    JSON.stringify({ commit: "b".repeat(40) }),
  );
  const mismatch = await exec([f.probe], f.checkout);
  expect(mismatch.code).toBe(1);
  expect(mismatch.stderr).toContain("commit mismatch");
  await writeFile(
    join(f.checkout, "runtime-manifest.json"),
    JSON.stringify({ format: "wrong", commit: "b".repeat(40) }),
  );
  const result = await exec([f.probe], f.checkout);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("runtime");
});
it.each(["R001", "R006", "Q001", "A004", "T001"])(
  "serves %s offline",
  async (code) => {
    const result = await thermite(
      ["guide", "diagnostics", code!],
      repositoryRoot,
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(code);
    expect(result.stderr).toBe("");
  },
);
it("rewrites titled, nested and reference links while preserving code", () => {
  const topic = {
    id: "modeling",
    file: "docs/data-model.md",
    title: "Modeling",
    readBefore: [],
  };
  const target = { ...topic, id: "views", file: "docs/views.md" };
  const sample =
    '[title](views.md "Paper") [nested [label]](views.md#paper) [reference][v]\n\n[v]: views.md "Views"\n\n`[code](../private.md)`\n\n  ```sh\n  [fence](../private.md)\n  ```\n\n~~~text\n[tilde](../private.md)\n~~~\n\n    [indented](../private.md)\n';
  const result = rewriteGuideLinks(
    sample,
    topic,
    [topic, target],
    "c".repeat(40),
  );
  expect(result).toContain("title (`thermite guide views`)");
  expect(result).toContain(
    "nested [label] (`thermite guide views`, section `paper`)",
  );
  expect(result).toContain("reference (`thermite guide views`)");
  expect(result).toContain("`[code](../private.md)`");
  expect(result).toContain("  [fence](../private.md)");
  expect(result).toContain("[tilde](../private.md)");
  expect(result).toContain("    [indented](../private.md)");
});

it.each([
  '[x](views.md "title")',
  "[x][a]\n\n[a]: views.md",
  "[a [b]](views.md)",
  '<a href="views.md">x</a>',
])("guards remaining relative targets: %s", (markdown) => {
  expect(() => assertGuideLinksResolved(markdown)).toThrow("Unresolved guide");
});
it.each([
  "`[x](views.md)`",
  "  ```sh\n  [x](views.md)\n  ```",
  "~~~sh\n[x](views.md)\n~~~",
  "    [x](views.md)",
])("preserves code byte-for-byte: %s", (markdown) => {
  const topic = {
    id: "views",
    file: "docs/views.md",
    title: "Views",
    readBefore: [],
  };
  expect(rewriteGuideLinks(markdown, topic, [topic], "c".repeat(40))).toBe(
    markdown,
  );
  expect(() => assertGuideLinksResolved(markdown)).not.toThrow();
});

it("rewrites angle destinations with spaces and parentheses without breaking Markdown", () => {
  const topic = {
    id: "views",
    file: "docs/views.md",
    title: "Views",
    readBefore: [],
  };
  const result = rewriteGuideLinks(
    '[nested [label]](<a (b).md#section one> "Title")',
    topic,
    [topic],
    "c".repeat(40),
  );
  expect(result).toBe(
    `[nested [label]](https://github.com/BlackettApplied/ThermiteSchematics/blob/${"c".repeat(40)}/docs/a%20%28b%29.md#section%20one "Title")`,
  );
  assertGuideLinksResolved(result);
});
