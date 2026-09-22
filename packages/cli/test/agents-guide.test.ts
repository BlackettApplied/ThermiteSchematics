import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { INIT_SUCCESS_MESSAGE, runCli } from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const rootGuide = join(repositoryRoot, "AGENTS.md");
const packagedGuide = join(packageRoot, "assets", "AGENTS.md");
const temporaryRoots: string[] = [];

interface Invocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function inputStream(input: string): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield input;
    },
  };
}

async function invoke(
  cwd: string,
  args: readonly string[],
  input?: string,
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["node", "thermite", ...args], {
    cwd,
    ...(input === undefined ? {} : { agentStdin: inputStream(input) }),
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

function parseSuccess(
  invocation: Invocation,
  tool: string,
): { result: Record<string, unknown>; report: Record<string, unknown> } {
  expect(invocation.exitCode).toBe(0);
  expect(invocation.stdout.endsWith("\n")).toBe(true);
  expect(invocation.stderr.endsWith("\n")).toBe(true);
  expect(invocation.stdout).not.toContain("\r");
  expect(invocation.stderr).not.toContain("\r");
  const result = JSON.parse(invocation.stdout) as Record<string, unknown>;
  const report = JSON.parse(invocation.stderr) as Record<string, unknown>;
  expect(result).toMatchObject({
    format: "agent-tool-result/0.1",
    tool,
  });
  expect(report).toMatchObject({
    format: "agent-tool-report/0.1",
    tool,
    error: null,
  });
  return { result, report };
}

function extractJsonExamples(guide: string): unknown[] {
  return [...guide.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) =>
    JSON.parse(match[1]!),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

describe("canonical AGENTS guide", () => {
  it("keeps root, packaged, and initialized bytes identical and link-free", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "thermite-schematics-agents-guide-"),
    );
    temporaryRoots.push(root);
    const initialized = await invoke(root, ["init"]);
    expect(initialized).toEqual({
      exitCode: 0,
      stdout: INIT_SUCCESS_MESSAGE,
      stderr: "",
    });

    const [authority, packaged, copied] = await Promise.all([
      readFile(rootGuide),
      readFile(packagedGuide),
      readFile(join(root, "AGENTS.md")),
    ]);
    expect(packaged).toEqual(authority);
    expect(copied).toEqual(authority);
    for (const path of [rootGuide, packagedGuide, join(root, "AGENTS.md")]) {
      const status = await lstat(path, { bigint: true });
      expect(status.isFile()).toBe(true);
      expect(status.isSymbolicLink()).toBe(false);
      expect(status.nlink).toBe(1n);
    }
    const text = authority.toString("utf8");
    expect(text.startsWith("\ufeff")).toBe(false);
    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("contains the ten frozen topics in order without workspace dist paths", async () => {
    const guide = await readFile(rootGuide, "utf8");
    const headings = [
      "## 1. Runtime and private installation",
      "## 2. Project authority",
      "## 3. Agent workflow",
      "## 4. Six executable agent commands",
      "## 5. Split streams",
      "## 6. Exit classification",
      "## 7. Engineering responsibility",
      "## 8. Guarded JSON Patch rules",
      "## 9. Presentation changes",
      "## 10. Local libraries",
    ];
    let prior = -1;
    for (const heading of headings) {
      const index = guide.indexOf(heading);
      expect(index).toBeGreaterThan(prior);
      prior = index;
    }
    expect(guide).toContain("^22.12.0 || >=24");
    expect(guide).toContain("JSON project source is authoritative");
    expect(guide).toContain(
      "validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view",
    );
    expect(guide).toContain(
      "stdout carries the `agent-tool-result/0.1` result",
    );
    expect(guide).toContain("its report on stderr");
    expect(guide).toContain("Do not invent electrical validity");
    expect(guide).toContain("per-file atomicity");
    expect(guide).toContain("presentation.json");
    expect(guide).toContain("explicit relative `path`");
    expect(guide).not.toMatch(/(?:^|[\\/])dist(?:[\\/]|$)/mu);
  });

  it("parses and executes every request example and its stream/exit claims", async () => {
    const guide = await readFile(rootGuide, "utf8");
    const examples = extractJsonExamples(guide);
    expect(examples).toHaveLength(6);
    for (const request of examples) {
      expect(request).toMatchObject({
        format: "agent-tool-request/0.1",
        project: ".",
      });
    }

    const root = await mkdtemp(
      join(tmpdir(), "thermite-schematics-guide-examples-"),
    );
    temporaryRoots.push(root);
    expect(await invoke(root, ["init"])).toMatchObject({ exitCode: 0 });
    const names = [
      "validate.request.json",
      "resolve.request.json",
      "inspect.request.json",
      "query.request.json",
      "patch-dry-run.request.json",
      "create-view.request.json",
    ];
    for (const [index, name] of names.entries()) {
      await writeFile(
        join(root, name),
        JSON.stringify(examples[index], undefined, 2) + "\n",
        "utf8",
      );
    }

    const validate = parseSuccess(
      await invoke(root, [
        "agent",
        "validate",
        "--input",
        "validate.request.json",
      ]),
      "validate",
    );
    expect(validate.result).toMatchObject({ value: { valid: true } });

    const resolveResult = parseSuccess(
      await invoke(
        root,
        ["agent", "resolve", "--input", "-"],
        JSON.stringify(examples[1]),
      ),
      "resolve",
    );
    expect(JSON.stringify(resolveResult.result)).toContain("PS1");

    const inspect = parseSuccess(
      await invoke(root, [
        "agent",
        "inspect",
        "--input",
        "inspect.request.json",
      ]),
      "inspect",
    );
    expect(JSON.stringify(inspect.result)).toContain("PS1");

    const query = parseSuccess(
      await invoke(root, ["agent", "query", "--input", "query.request.json"]),
      "query",
    );
    expect(JSON.stringify(query.result)).toContain("PS1");

    const equipmentPath = join(root, "devices", "equipment.json");
    const beforeDryRun = await readFile(equipmentPath);
    const dryRun = parseSuccess(
      await invoke(root, [
        "agent",
        "apply-source-patch",
        "--input",
        "patch-dry-run.request.json",
      ]),
      "apply-source-patch",
    );
    expect(dryRun.result).toMatchObject({ value: { dryRun: true } });
    expect(await readFile(equipmentPath)).toEqual(beforeDryRun);

    const applyRequest = structuredClone(examples[4]) as {
      dryRun: boolean;
    };
    applyRequest.dryRun = false;
    await writeFile(
      join(root, "patch-apply.request.json"),
      JSON.stringify(applyRequest, undefined, 2) + "\n",
      "utf8",
    );
    const applied = parseSuccess(
      await invoke(root, [
        "agent",
        "apply-source-patch",
        "--input",
        "patch-apply.request.json",
      ]),
      "apply-source-patch",
    );
    expect(applied.result).toMatchObject({ value: { dryRun: false } });
    expect(await readFile(equipmentPath)).not.toEqual(beforeDryRun);

    const revalidated = parseSuccess(
      await invoke(root, [
        "agent",
        "validate",
        "--input",
        "validate.request.json",
      ]),
      "validate",
    );
    expect(revalidated.result).toMatchObject({ value: { valid: true } });

    const view = parseSuccess(
      await invoke(root, [
        "agent",
        "create-view",
        "--input",
        "create-view.request.json",
      ]),
      "create-view",
    );
    expect(JSON.stringify(view.result)).toContain("<svg");
  });
});
