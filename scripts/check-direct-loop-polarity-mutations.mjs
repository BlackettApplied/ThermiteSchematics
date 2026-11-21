// Intentional source mutations, run sequentially with no other build/test readers.
// Always restore source bytes and rebuild, including after a killed test run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".verification-work/polarity-85/mutations");
const drawing = "packages/render/src/signal-loop/direct-polarity.ts";
const cases = [
  {
    name: "first-hop-instead-of-final-terminal",
    path: drawing,
    pattern: /\?\.terminals\.at\(-1\);/g,
    replacement: "?.terminals[1];",
  },
  {
    name: "check-output-views-too",
    path: "packages/render/src/signal-loop.ts",
    pattern:
      /unverifiedEndpoints: input \? directLoopPolarity\(ir, from, to, paths\) : \[\],/g,
    replacement:
      "unverifiedEndpoints: directLoopPolarity(ir, from, to, paths),",
  },
  {
    name: "unescaped-desc-note",
    path: drawing,
    pattern: /xml\(engineNotes\.join\("\\n"\)\)/g,
    replacement: 'engineNotes.join("\\n")',
  },
  {
    name: "remove-refusal",
    path: "packages/render/src/signal-loop/direct-polarity.ts",
    pattern: /\n\s+assertLoopPolarityEntry\([\s\S]*?\n\s+\);/g,
    replacement: "",
  },
  {
    name: "drop-visible-note",
    path: drawing,
    pattern: /\.\.\.\(engineNotes \?\? \[\]\),/g,
    replacement: "",
  },
  {
    name: "drop-desc-note",
    path: drawing,
    pattern: /\(engineNotes \? `<desc>.*?<\/desc>` : ""\) \+/g,
    replacement: "",
  },
  {
    name: "drop-reference-note",
    path: "packages/render/src/packet/topology.ts",
    pattern:
      /\.\.\.\(drawing\.engineNotes\s*\? \{ referenceNotes: drawing\.engineNotes \}\s*: \{\}\),/g,
    replacement: "",
  },
  {
    name: "attach-note-to-verified",
    path: drawing,
    pattern: /const engineNotes = selected\.unverifiedEndpoints\.length/g,
    replacement: "const engineNotes = true",
  },
  {
    name: "attach-empty-metadata-to-verified",
    path: drawing,
    pattern: /: undefined;\n  return \{\n    \.\.\.drawing,/g,
    replacement: ": [];\n  return {\n    ...drawing,",
  },
];
const tests = ["polarity", "roles", "notes", "paths"].map(
  (name) => `packages/render/test/direct-loop-${name}.test.ts`,
);
await mkdir(output, { recursive: true });
const originals = new Map(
  await Promise.all(
    [...new Set(cases.map((c) => c.path))].map(async (p) => [
      p,
      await readFile(join(root, p), "utf8"),
    ]),
  ),
);
function command(args) {
  const run = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 << 20,
    env: { ...process.env, VITEST_MAX_WORKERS: "2" },
  });
  if (run.error) throw run.error;
  return run;
}
async function check(name) {
  const build = command(["run", "build"]);
  assert.equal(build.status, 0, build.stderr);
  const resultFile = join(output, `${name}.json`);
  const run = command([
    "run",
    "test",
    "--",
    ...tests,
    "--reporter=json",
    `--outputFile.json=${resultFile}`,
  ]);
  await writeFile(join(output, `${name}.log`), run.stdout + run.stderr);
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  return {
    name,
    exit: run.status,
    failed: result.numFailedTests,
    passed: result.numPassedTests,
  };
}
const results = [];
try {
  const control = await check("control");
  assert.equal(control.exit, 0, "Unmodified focused tests must pass first");
  results.push(control);
  for (const c of cases) {
    const original = originals.get(c.path);
    assert.equal(
      [...original.matchAll(c.pattern)].length,
      1,
      `Mutation anchor: ${c.name}`,
    );
    await writeFile(
      join(root, c.path),
      original.replace(c.pattern, c.replacement),
    );
    try {
      const result = await check(c.name);
      results.push(result);
      assert.equal(result.exit, 1, `Mutation did not fail tests: ${c.name}`);
      assert(
        result.failed > 0,
        `Mutation must be killed by an assertion: ${c.name}`,
      );
      console.log(`${c.name}: killed (${result.failed} failing tests)`);
    } finally {
      await writeFile(join(root, c.path), original);
    }
  }
} finally {
  for (const [path, original] of originals)
    await writeFile(join(root, path), original);
  const build = command(["run", "build"]);
  assert.equal(build.status, 0, build.stderr);
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
