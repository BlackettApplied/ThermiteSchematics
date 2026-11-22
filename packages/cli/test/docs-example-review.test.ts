import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { classify } from "../../../scripts/docs-examples.mjs";
import {
  exampleFences,
  exampleFindings,
} from "../../../scripts/docs-examples-lib.mjs";
import {
  parseDocument,
  repositoryRoot,
  sha256,
} from "../../../scripts/docs-lib.mjs";

import {
  ProcessOwner,
  closeExampleProcesses,
} from "../../../scripts/docs-example-process.mjs";
import { evidencePath } from "../../../scripts/docs-example-evidence.mjs";
import { watchArguments } from "../../../scripts/docs-example-command.mjs";

const roots: string[] = [];
afterEach(async () => {
  await closeExampleProcesses();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(file: string, text: string) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-doc-review-"),
  );
  roots.push(root);
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, file), text);
  await writeFile(join(root, "docs/topics.json"), "[]");
  await writeFile(
    join(root, "scripts/docs-policy.json"),
    JSON.stringify({
      exclude: {
        directoryNames: ["node_modules"],
        prefixes: [],
        files: [],
        patterns: [],
      },
    }),
  );
  return root;
}
async function saveInventory(root: string, bindings = {}) {
  await writeFile(
    join(root, "scripts/docs-examples.json"),
    JSON.stringify({ version: 1, bindings, entries: [] }),
  );
  return readFile(join(root, "scripts/docs-examples.json"));
}
async function topicFixture() {
  const root = await fixture("docs/data-model.md", "# Fixture\n");
  const topics = JSON.parse(
    await readFile(join(repositoryRoot, "docs/topics.json"), "utf8"),
  );
  for (const topic of topics)
    await cp(join(repositoryRoot, topic.file), join(root, topic.file));
  await writeFile(join(root, "docs/topics.json"), JSON.stringify(topics));
  for (const name of ["examples", "libraries", "node_modules"])
    await symlink(join(repositoryRoot, name), join(root, name), "junction");
  const series = "packages/core-library/test/fixtures/series-loop";
  await mkdir(join(root, "packages/core-library/test/fixtures"), {
    recursive: true,
  });
  await cp(join(repositoryRoot, series), join(root, series), {
    recursive: true,
  });
  const coreGuide = "packages/cli/assets/THERMITE_AGENTS.md";
  await mkdir(join(root, "packages/cli/assets"), { recursive: true });
  await cp(join(repositoryRoot, coreGuide), join(root, coreGuide));
  return { root, ...(await fixtureBindings(root)) };
}

async function fixtureBindings(root: string) {
  const inventory: {
    bindings: Record<
      string,
      { file: string; testFile: string; testName: string }
    >;
  } = JSON.parse(
    await readFile(join(repositoryRoot, "scripts/docs-examples.json"), "utf8"),
  );
  const harness = join(
    repositoryRoot,
    "packages/cli/test/project-guide/harness.ts",
  );
  const runners = new Map<string, { testFile: string; testHash: string }>();
  const bindings = Object.fromEntries(
    await Promise.all(
      Object.entries(inventory.bindings).map(async ([recipe, binding]) => {
        let runner = runners.get(binding.testFile);
        if (!runner) {
          const source = `import { vi } from "vitest";
vi.mock(${JSON.stringify(harness)}, async (original) => ({
 ...await original(), repositoryRoot: ${JSON.stringify(root)}
}));
import ${JSON.stringify(pathToFileURL(join(repositoryRoot, binding.testFile)).href)};\n`;
          runner = {
            testFile: `bound-${runners.size}.test.ts`,
            testHash: sha256(source),
          };
          runners.set(binding.testFile, runner);
          await writeFile(join(root, runner.testFile), source);
        }
        return [recipe, { ...binding, ...runner }] as const;
      }),
    ),
  );
  return {
    bindings,
    testFiles: [...runners.values()].map(({ testFile }) => testFile),
  };
}

it("refuses an exit-7 shell fence in the real modeling topic instead of reporting it consumed", async () => {
  const { root, bindings } = await topicFixture();
  const file = join(root, "docs/data-model.md");
  await writeFile(
    file,
    (await readFile(file, "utf8")) + "\n```sh\nbun -e 'process.exit(7)'\n```\n",
  );
  const before = await saveInventory(root, bindings);
  await expect(
    classify(root, "docs/data-model.md#13", {
      kind: "executed",
      recipe: "topic-modeling",
    }),
  ).rejects.toThrow(/cannot execute sh fence/);
  expect(await readFile(join(root, "scripts/docs-examples.json"))).toEqual(
    before,
  );
});

it(
  "every real topic recipe records successful fences only, excluding a failing fence and its unexecuted successor",
  { timeout: 180000 },
  async () => {
    const { root, bindings, testFiles } = await topicFixture();
    const originals = new Map<string, ReturnType<typeof exampleFences>>();
    for (const binding of Object.values(bindings)) {
      const text = await readFile(join(root, binding.file), "utf8");
      originals.set(
        binding.file,
        exampleFences({
          documents: new Map([[binding.file, { text }]]),
        }).filter((f) => ["json", "sh"].includes(f.lang)),
      );
      await writeFile(
        join(root, binding.file),
        text +
          '\n```json\n{"unexecutedTopicProbe":true}\n```\n\n```sh\nbun -e \'process.exit(7)\'\n```\n\n```json\n{"unexecutedSuccessor":true}\n```\n',
      );
    }
    const directory = join(root, "evidence");
    await mkdir(directory);
    const report = join(root, "results.json");
    const owner = new ProcessOwner({ timeoutMs: 180000 });
    try {
      const run = await owner.run(
        [
          join(repositoryRoot, "scripts/test.mjs"),
          ...testFiles,
          "-t",
          `^(?:${Object.values(bindings)
            .map((binding) =>
              binding.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("|")})$`,
          "--reporter=json",
          `--outputFile=${report}`,
        ],
        root,
        {
          ...process.env,
          VITEST_MAX_WORKERS: "2",
          THERMITE_DOC_EXAMPLE_EVIDENCE: directory,
          TMPDIR: root,
          TMP: root,
          TEMP: root,
        },
      );
      expect(run.code, run.stderr).toBe(1);
      const results = JSON.parse(await readFile(report, "utf8"));
      const tests = results.testResults.flatMap((r: any) => r.assertionResults);
      expect(tests.filter((t: any) => t.status === "failed")).toHaveLength(
        Object.keys(bindings).length,
      );
      for (const [recipe, binding] of Object.entries(bindings)) {
        const proof = await readFile(
          evidencePath(directory, binding.file),
          "utf8",
        )
          .then(JSON.parse)
          .catch(() => ({ hashes: [] }));
        // Modeling cannot run shell; it must refuse before executing any fence.
        // Other recipes must retain the successful prefix, never either mutation.
        expect(proof.hashes, recipe).toEqual(
          recipe === "topic-modeling"
            ? []
            : originals.get(binding.file)!.map((f) => f.hash),
        );
      }
    } finally {
      await owner.close();
    }
  },
);
it("refuses the quoted invalid JSON fence even when the actual topic parser ignores it", async () => {
  const root = await fixture(
    "docs/review.md",
    '# Review\n\n```json\n{"valid":true}\n```\n\n> ```json\n> {broken JSON\n> ```\n',
  );
  const parser = pathToFileURL(
    join(repositoryRoot, "packages/cli/test/project-guide/guide-model.ts"),
  ).href;
  const vitest = pathToFileURL(
    join(repositoryRoot, "node_modules/vitest/dist/index.js"),
  ).href;
  const source = `import { it } from ${JSON.stringify(vitest)};
import { readFileSync } from "node:fs";
import { guideModel } from ${JSON.stringify(parser)};
it("reads topic fences", async () => {
 const text = readFileSync(${JSON.stringify(join(root, "docs/review.md"))}, "utf8");
 const fences = guideModel(text).fences;
 const { topicExecution } = await import(${JSON.stringify(pathToFileURL(join(repositoryRoot, "scripts/docs-example-evidence.mjs")).href)});
 const execution = topicExecution("docs/review.md", text, ["json"]);
 for (const fence of fences) if (fence.lang === "json")
  await execution.run(fence, async () => JSON.parse(fence.body));
});\n`;
  await writeFile(join(root, "bound.test.ts"), source);
  const before = await saveInventory(root, {
    "topic-review": {
      file: "docs/review.md",
      testFile: "bound.test.ts",
      testName: "reads topic fences",
      testHash: sha256(source),
    },
  });
  await expect(
    classify(root, "docs/review.md#2", {
      kind: "executed",
      recipe: "topic-review",
    }),
  ).rejects.toThrow(/selected fence.*consumed/i);
  expect(await readFile(join(root, "scripts/docs-examples.json"))).toEqual(
    before,
  );
  await classify(root, "docs/review.md#1", {
    kind: "executed",
    recipe: "topic-review",
  });
  const saved = JSON.parse(
    await readFile(join(root, "scripts/docs-examples.json"), "utf8"),
  );
  const corpus = {
    root,
    documents: new Map([
      [
        "docs/review.md",
        parseDocument(await readFile(join(root, "docs/review.md"), "utf8")),
      ],
    ]),
  };
  const quoted = exampleFences(corpus)[1];
  expect(saved.bindings["topic-review"].consumedHashes).toHaveLength(1);
  expect(saved.bindings["topic-review"].consumedHashes).not.toContain(
    quoted.hash,
  );
  saved.entries.push({
    file: quoted.file,
    hash: quoted.hash,
    kind: "executed",
    recipe: "topic-review",
  });
  await writeFile(
    join(root, "scripts/docs-examples.json"),
    JSON.stringify(saved),
  );
  expect(await exampleFindings(corpus)).toContainEqual(
    expect.objectContaining({
      reason: expect.stringContaining("lacks consumed-hash evidence"),
    }),
  );
});
async function machineFixture(launcher: string) {
  const text = await readFile(
    join(repositoryRoot, "docs/machine-demo.md"),
    "utf8",
  );
  // This fixture checks watch launcher handling. The complete fenced command
  // sequence, including packet and report exports, runs in the docs suite.
  const body = text
    .split("\n")
    .find((line) => line.startsWith("bun thermite.mjs watch "))!
    .replace("bun thermite.mjs watch", `bun ${launcher} watch`);
  const root = await fixture(
    "docs/machine-demo.md",
    `# Machine\n\n\`\`\`sh\n${body}\n\`\`\`\n`,
  );
  await cp(join(repositoryRoot, "examples"), join(root, "examples"), {
    recursive: true,
  });
  await cp(
    join(repositoryRoot, "scripts/demo-change.mjs"),
    join(root, "scripts/demo-change.mjs"),
  );
  await writeFile(
    join(root, "thermite.mjs"),
    `import ${JSON.stringify(pathToFileURL(join(repositoryRoot, "thermite.mjs")).href)};`,
  );
  return root;
}
it("refuses the reviewer's missing watch launcher without approving its fence", async () => {
  const root = await machineFixture("definitely-missing.mjs");
  const before = await saveInventory(root);
  await expect(
    classify(root, "docs/machine-demo.md#1", {
      kind: "executed",
      recipe: "repo-shell",
    }),
  ).rejects.toThrow(/watch launcher/i);
  expect(await readFile(join(root, "scripts/docs-examples.json"))).toEqual(
    before,
  );
});

it.each(["'$thermite_entry'", "\\$thermite_entry", '"\\$thermite_entry"'])(
  "refuses the literal-dollar watch launcher %s without approving its fence",
  async (launcher) => {
    const root = await machineFixture(launcher);
    const before = await saveInventory(root);
    await expect(
      classify(root, "docs/machine-demo.md#1", {
        kind: "executed",
        recipe: "repo-shell",
      }),
    ).rejects.toThrow(/watch launcher/i);
    expect(await readFile(join(root, "scripts/docs-examples.json"))).toEqual(
      before,
    );
  },
);

it.each([
  "$thermite_entry",
  '"$"thermite_entry',
  '"$thermite"_entry',
  '"${thermite_entry}"',
  "\"$thermite_entry\"''",
])(
  "refuses non-document variable spelling %s before substitution",
  (launcher) => {
    expect(() =>
      watchArguments(`bun ${launcher} watch -o drawing.html`),
    ).toThrow(/watch launcher/);
  },
);
it.each([
  "thermite.mjs",
  "'thermite.mjs'",
  '"thermite.mjs"',
  '"/path/to/thermite/thermite.mjs"',
  '"$thermite_entry"',
])("preserves quoted arguments for documented launcher %s", (launcher) => {
  expect(
    watchArguments(`bun ${launcher} watch -o "drawing output.html"`),
  ).toEqual(["watch", "-o", "drawing output.html"]);
});

it.each(['"thermite.mjs"', '"$thermite_entry"'])(
  "runs the documented watch launcher %s with a quoted output path",
  async (launcher) => {
    const root = await machineFixture(launcher);
    const file = join(root, "docs/machine-demo.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "-o alpha-out/machine-demo.html",
        '-o "alpha-out/watch output.html"',
      ),
    );
    await saveInventory(root);
    await classify(root, "docs/machine-demo.md#1", {
      kind: "executed",
      recipe: "repo-shell",
    });
    expect(
      JSON.parse(
        await readFile(join(root, "scripts/docs-examples.json"), "utf8"),
      ).entries,
    ).toHaveLength(1);
  },
);
