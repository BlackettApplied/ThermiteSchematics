// Browser-required mutations of visible outline geometry, outside the checkout.
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../../", import.meta.url));
const copy = await mkdtemp(join(tmpdir(), "thermite-utilisation-mutations-"));
const results = [];
try {
  await cp(join(root, "evals/draw"), join(copy, "evals/draw"), {
    recursive: true,
  });
  await symlink(
    join(root, "node_modules"),
    join(copy, "node_modules"),
    "junction",
  );
  const path = join(copy, "evals/draw/browser.mjs"),
    source = await readFile(path, "utf8");
  const paintCalls = source.match(/paintedShapeBounds\([\s\S]*?\)/g);
  assert.equal(paintCalls?.length, 1);
  const run = (id) => {
    const result = spawnSync(
      process.execPath,
      [join(copy, "evals/draw/utilisation-browser.check.mjs")],
      { cwd: copy, encoding: "utf8" },
    );
    const status =
      result.status === 0
        ? "passed"
        : result.stderr.includes("AssertionError")
          ? "killed"
          : "invalid";
    results.push({
      id,
      status,
      stderr: status === "invalid" ? result.stderr : undefined,
    });
    console.log(id + ": " + status);
    return status;
  };
  assert.equal(run("unmodified-control"), "passed");
  for (const [id, from, to] of [
    ["painted-outline-call", paintCalls[0], "v.b"],
    [
      "outline-viewport",
      "const clip = masks.reduce(intersect);",
      "const clip = { ...bbox };",
    ],
    ["native-stroke-hit", "e.isPointInStroke(local)", "true"],
    ["active-mask", 'css.maskImage && css.maskImage !== "none"', "false"],
    [
      "refusal-scope",
      'if (!error.message.startsWith("DQ-12 ")) throw error;',
      "throw error;",
    ],
    [
      "compact-arc-flags",
      'parameter(kind === "A" && (j === 3 || j === 4))',
      "parameter(false)",
    ],
    [
      "exact-subpath-endpoints",
      'if (e.tagName.toLowerCase() === "path") {',
      "if (false) {",
    ],
  ]) {
    assert.equal(
      source.split(from).length,
      2,
      "Expected one mutation anchor: " + id,
    );
    await writeFile(path, source.replace(from, to));
    assert.equal(
      run(id),
      "killed",
      "Behavioral mutant must fail an assertion: " + id,
    );
    await writeFile(path, source);
  }
  const output = process.argv[2];
  assert(output, "Supply an output JSON path");
  await writeFile(
    resolve(output),
    JSON.stringify({ results }, null, 2) + "\n",
    { flag: "wx" },
  );
} finally {
  await rm(copy, { recursive: true, force: true });
}
