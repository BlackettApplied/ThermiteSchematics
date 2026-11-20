import assert from "node:assert/strict";
import { mkdir, readdir, readFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { watchArguments } from "./docs-example-command.mjs";
import { json, put, shell } from "./docs-example-context.mjs";

export async function cabinetsShell(c, fence) {
  return shell(c, fence.body);
}
export async function repoShell(c, fence) {
  await (c.repoReady ??= prepareRepo(c, fence.file));
  if (fence.file === "docs/machine-demo.md") {
    const run = c.run;
    // This full packet example reaches 99 s on CI; other examples keep 30 s.
    c = {
      ...c,
      run: (args, cwd, env, settings) =>
        run(args, cwd, env, { timeoutMs: 120000, ...settings }),
    };
  }
  if (fence.body.includes(" watch ")) return watchShell(c, fence);
  return shell(c, fence.body);
}

async function prepareRepo(c, file) {
  // The docs test owns one scratch checkout per document and recipe.
  await c.copy("examples", join(c.work, "examples"));
  if (
    file.startsWith("libraries/") ||
    file === "scripts/library-batch/README.md"
  ) {
    await c.copy("libraries", join(c.work, "libraries"));
    await linkDependencies(c);
  }
  if (file.startsWith("packages/") && file.includes("/fixtures/")) {
    const fixture = dirname(file);
    await c.copy(fixture, join(c.work, fixture));
  }
  await c.copy(
    "scripts/demo-change.mjs",
    join(c.work, "scripts/demo-change.mjs"),
  );
  // The demo script resolves thermite.mjs from its own temporary checkout.
  await put(
    join(c.work, "thermite.mjs"),
    `import ${JSON.stringify(pathToFileURL(c.entry).href)};`,
  );
  await put(join(c.work, "package.json"), {
    scripts: { "demo:change": "bun scripts/demo-change.mjs" },
  });
}
function linkDependencies(c) {
  return (c.dependencyLink ??= symlink(
    join(c.root, "node_modules"),
    join(c.work, "node_modules"),
    "junction",
  ));
}

async function linkWorkspaceDependencies(c) {
  const source = join(c.root, "node_modules");
  const destination = join(c.work, "node_modules");
  const scope = "@thermite";
  await mkdir(join(destination, scope), { recursive: true });
  for (const name of await readdir(source))
    if (name === ".bin" || (!name.startsWith(".") && name !== scope))
      await symlink(join(source, name), join(destination, name), "junction");
  for (const name of await readdir(join(source, scope)))
    await symlink(
      join(c.work, "packages", name),
      join(destination, scope, name),
      "junction",
    );
}

export async function runtimeShell(c, fence) {
  await linkDependencies(c);
  const entry = await c.copy(
    "scripts/runtime-package/thermite.mjs",
    join(c.work, "thermite.mjs"),
  );
  return shell({ ...c, entry }, fence.body);
}

export async function workspaceShell(c, fence) {
  await (c.workspaceReady ??= prepareWorkspace(c, fence.file));
  if (fence.file === "evals/agent/README.md") {
    const run = c.run;
    // The single offline run/recheck smoke test took 26.2 s on Windows
    // before Vitest startup and teardown. Give its shell the same budget.
    c = {
      ...c,
      run: (args, cwd, env, settings) =>
        run(args, cwd, env, { timeoutMs: 60000, ...settings }),
    };
  }
  return shell(c, fence.body);
}

async function prepareWorkspace(c, file) {
  // Goldens, evaluator outputs, and builds stay inside the scratch checkout.
  const topicsFile = "docs/topics.json";
  const topics = await json(join(c.root, topicsFile));
  const evaluatorPaths =
    file === "evals/README.md"
      ? ["evals/engine", "evals/corpus", "libraries"]
      : file === "evals/agent/README.md"
        ? ["evals/agent"]
        : [];
  for (const path of [
    "packages",
    "scripts",
    "examples",
    "thermite.mjs",
    "package.json",
    "tsconfig.json",
    "tsconfig.base.json",
    "vitest.config.mjs",
    ".prettierrc.json",
    topicsFile,
    ...topics.map((topic) => topic.file),
    ...evaluatorPaths,
  ])
    await c.copy(path, join(c.work, path));
  await linkWorkspaceDependencies(c);
  const { commit } = await json(
    join(c.root, "packages/cli/assets/guide/source.json"),
  );
  await put(join(c.work, "scripts/source-commit.txt"), `${commit}\n`);
}

export async function sdkExample(c, fence) {
  await c.copy("examples", join(c.work, "examples"));
  await linkDependencies(c);
  await put(join(c.work, "example.ts"), fence.body);
  return shell(c, "bun example.ts");
}

export async function signoffShell(c, fence) {
  const run = c.run;
  c = {
    ...c,
    run: (args, cwd, env, settings) =>
      run(
        args,
        cwd,
        {
          ...Object.fromEntries(
            Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)),
          ),
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
        settings,
      ),
  };
  await put(join(c.work, "example.txt"), "Documentation sign-off fixture.\n");
  await shell(
    c,
    [
      "git init -q --template=",
      'git config user.name "Thermite Docs Fixture"',
      "git config user.email fixture@example.invalid",
      "git config commit.gpgSign false",
      "git -c core.autocrlf=false add example.txt",
    ].join("\n"),
  );
  await shell(c, fence.body);
  const { stdout } = await shell(
    c,
    'git log -1 "--format=%(trailers:key=Signed-off-by,valueonly)"',
  );
  assert.equal(
    stdout.trim(),
    "Thermite Docs Fixture <fixture@example.invalid>",
  );
}

async function watchShell(c, fence) {
  const lines = fence.body.split("\n");
  const args = watchArguments(lines.at(-1)); // Refuse unknown launchers before substitution/work.
  await shell(c, lines.slice(0, -1).join("\n"));
  let output = "";
  const result = await c.run([c.entry, ...args], c.work, process.env, {
    onOutput: (text, interrupt) => {
      output += text;
      if (output.includes("Polling declared") && output.includes("Wrote"))
        interrupt();
    },
  });
  assert.ok(result.code === 0 || result.interrupted, output);
  assert.match(output, /Polling declared/);
  const outputIndex = args.findIndex(
    (arg) => arg === "-o" || arg === "--output",
  );
  assert.ok(outputIndex >= 0, "Watch example must name an output");
  assert.ok((await readFile(join(c.work, args[outputIndex + 1]))).length > 0);
}
export async function agentWorkflow(c, fence) {
  const { agentWorkflow: run } = await import("./docs-example-agent.mjs");
  return run(c, fence);
}
export async function jsonProject(c, fence) {
  const project = join(c.work, "project");
  await c.cli(["init", project]);
  await put(join(project, "system.json"), JSON.parse(fence.body));
  await c.cli(["lock", project]);
  await c.cli(["validate", project]);
}
export async function jsonPacket(c, fence) {
  const { jsonPacket: run } = await import("./docs-example-json.mjs");
  return run(c, fence);
}
export async function jsonSource(c, fence) {
  const { jsonSource: run } = await import("./docs-example-json.mjs");
  return run(c, fence);
}
