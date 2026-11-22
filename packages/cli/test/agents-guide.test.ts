import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentToolJsonResult,
  ApplySourcePatchRequest,
} from "@thermite/agent-tools";

import { INIT_SUCCESS_MESSAGE, runCli } from "../src/index.js";
import { initializeAlphaProject } from "../src/alpha-init.js";

import { exec as execGuide } from "./project-guide/harness.js";
import { parseFences } from "./project-guide/guide-model.js";
import { splitWords } from "./project-guide/commands.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const rootGuide = join(repositoryRoot, "AGENTS.md");
const packagedGuide = join(packageRoot, "assets", "AGENTS.md");
const requestGuide = join(repositoryRoot, "docs", "agent-requests.md");
const legacyGuide = join(
  repositoryRoot,
  "docs",
  "legacy",
  "private-release-agent-guide.md",
);
// This pins the current legacy asset, independently of the engine guide and the
// historical release inventory (which belongs to its original source revision).
const frozenGuideSha256 =
  "5e1ec3a4d465ba2eb85d2bbe9ac802f17212f77711763a547cfe403f5a499a49";
const historicalInstallText =
  /\bNode\.js\b|\b(?:npm|npx)\b|\bnode[ \t]+\S+\.[cm]?js\b|thermite-cli-0\.2\.0\.tgz|isolated-prefix|--offline/iu;
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

function extractLegacyJsonExamples(guide: string): unknown[] {
  return [...guide.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) =>
    JSON.parse(match[1]!),
  );
}

function extractSourceGuardExample(guide: string): unknown {
  const examples = [
    ...guide.matchAll(/```json inspect-source\.request\.json\n([\s\S]*?)```/gu),
  ];
  expect(examples).toHaveLength(1);
  return JSON.parse(examples[0]![1]!);
}

// Each excluded section names the test that executes its examples.
const SEPARATELY_EXECUTED_SECTIONS = new Map([
  [
    "### Repair schema errors through the guarded loop",
    "agent-schema-repair.test.ts",
  ],
]);
function excludeSeparatelyExecutedSections(guide: string): string {
  const sections = guide.split(/(?=^#{1,6} )/mu);
  for (const heading of SEPARATELY_EXECUTED_SECTIONS.keys())
    expect(
      sections.filter((section) => section.split("\n")[0] === heading),
    ).toHaveLength(1);
  return sections
    .filter(
      (section) => !SEPARATELY_EXECUTED_SECTIONS.has(section.split("\n")[0]!),
    )
    .join("");
}
async function referenceRequestGuide(): Promise<string> {
  return excludeSeparatelyExecutedSections(
    await readFile(requestGuide, "utf8"),
  );
}

it.each([1, 2, 3, 4, 5, 6])(
  "excluded examples stop at a level-%s heading",
  (level) => {
    const guide = `# Guide\n\n### Repair schema errors through the guarded loop\nEXCLUDED\n\n${"#".repeat(level)} Following section\nKEEP\n`;
    const filtered = excludeSeparatelyExecutedSections(guide);
    expect(filtered).not.toContain("EXCLUDED");
    expect(filtered).toContain(`${"#".repeat(level)} Following section\nKEEP`);
  },
);

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

describe("frozen legacy AGENTS guide", () => {
  it("pins the packaged asset's SHA-256", async () => {
    expect(
      createHash("sha256")
        .update(await readFile(packagedGuide))
        .digest("hex"),
    ).toBe(frozenGuideSha256);
  });

  it("keeps packaged and legacy-initialized bytes identical and link-free", async () => {
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

    const [authority, copied] = await Promise.all([
      readFile(packagedGuide),
      readFile(join(root, "AGENTS.md")),
    ]);
    expect(copied).toEqual(authority);
    for (const path of [packagedGuide, join(root, "AGENTS.md")]) {
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
    const guide = await readFile(packagedGuide, "utf8");
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

  it("preserves old root sections 1–10 verbatim in the legacy reference", async () => {
    const frozen = await readFile(packagedGuide, "utf8");
    const legacy = await readFile(legacyGuide, "utf8");
    const heading = "## 1. Runtime and private installation";
    expect(legacy.slice(legacy.indexOf(heading))).toBe(
      frozen.slice(frozen.indexOf(heading)),
    );
  });

  it("G2 migration: request JSON is unchanged from the frozen guide", async () => {
    expect(
      extractLegacyJsonExamples(await readFile(requestGuide, "utf8")),
    ).toEqual(extractLegacyJsonExamples(await readFile(packagedGuide, "utf8")));
  });

  it.each(["legacy", "alpha"])(
    "executes every request example and its stream/exit claims on the %s starter",
    async (starter) => {
      const guide = await referenceRequestGuide();
      const examples = extractLegacyJsonExamples(guide);
      const fences = parseFences(guide).filter(
        (f) => f.lang === "json" || f.lang === "sh",
      );
      expect(fences.filter((f) => f.lang === "json")).toHaveLength(7);
      expect(fences.filter((f) => f.lang === "sh")).toHaveLength(9);
      expect(examples).toHaveLength(6);
      for (const request of examples) {
        expect(request).toMatchObject({
          format: "agent-tool-request/0.1",
          project: ".",
        });
      }

      const parent = await mkdtemp(
        join(tmpdir(), "thermite-schematics-guide-examples-"),
      );
      temporaryRoots.push(parent);
      const root = join(parent, "project");
      if (starter === "alpha") {
        await initializeAlphaProject(root);
      } else {
        await mkdir(root);
        expect(await invoke(root, ["init"])).toMatchObject({ exitCode: 0 });
      }
      const executedCommands: string[] = [];
      async function invokeExample(
        args: readonly string[],
        stdinFile?: string,
      ) {
        executedCommands.push(
          `bun "$thermite_entry" ${args.join(" ")}${stdinFile === undefined ? "" : ` < ${stdinFile}`}`,
        );
        return invoke(
          root,
          args,
          stdinFile === undefined
            ? undefined
            : await readFile(join(root, stdinFile), "utf8"),
        );
      }
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
        await invokeExample([
          "agent",
          "validate",
          "--input",
          "validate.request.json",
        ]),
        "validate",
      );
      expect(validate.result).toMatchObject({ value: { valid: true } });

      const resolveResult = parseSuccess(
        await invokeExample(
          ["agent", "resolve", "--input", "-"],
          "resolve.request.json",
        ),
        "resolve",
      );
      expect(JSON.stringify(resolveResult.result)).toContain("PS1");

      const inspect = parseSuccess(
        await invokeExample([
          "agent",
          "inspect",
          "--input",
          "inspect.request.json",
        ]),
        "inspect",
      );
      expect(JSON.stringify(inspect.result)).toContain("PS1");

      const sourceRequest = extractSourceGuardExample(guide);
      expect(sourceRequest).toEqual({
        format: "agent-tool-request/0.1",
        project: ".",
        selector: { by: "designation", value: "PS1" },
        include: ["source"],
      });
      await writeFile(
        join(root, "inspect-source.request.json"),
        `${JSON.stringify(sourceRequest, undefined, 2)}\n`,
      );
      const sourceInspection = parseSuccess(
        await invokeExample([
          "agent",
          "inspect",
          "--input",
          "inspect-source.request.json",
        ]),
        "inspect",
      ).result as unknown as AgentToolJsonResult<"inspect">;
      const source = sourceInspection.value.object.source!;
      const patchExample = examples[4] as ApplySourcePatchRequest;
      const exampleFile = patchExample.files[0]!;
      expect(source).toMatchObject({
        file: exampleFile.path,
        integrity:
          "sha256-" +
          createHash("sha256")
            .update(await readFile(join(root, exampleFile.path)))
            .digest("base64"),
        uid: sourceInspection.value.object.uid,
        patchEligible: true,
      });
      expect(source.pointer).toBe("/objects/0");
      for (const operation of exampleFile.operations) {
        expect(operation.path).toBe(`${source.pointer}/description`);
      }
      // The frozen sample guard belongs to the old starter. A stale guard must
      // still fail; only a fresh inspection can authorize the current bytes.
      const beforeStale = await readFile(join(root, exampleFile.path));
      const recipe = parseFences(guide).find(
        (f) => f.lang === "sh" && f.body.startsWith("bun -e "),
      )!;
      const recipeRun = await execGuide(
        splitWords(recipe.body, false).words.slice(1),
        root,
      );
      expect(recipeRun.code, recipeRun.stderr).toBe(0);
      expect(recipeRun.stdout.trim()).toBe(source.integrity);
      const stale = await invoke(root, [
        "agent",
        "apply-source-patch",
        "--input",
        "patch-dry-run.request.json",
      ]);
      expect(stale.exitCode).toBe(1);
      expect(JSON.parse(stale.stderr).error.code).toBe("A004");
      expect(stale.stdout).toBe("");
      expect(await readFile(join(root, exampleFile.path))).toEqual(beforeStale);
      const currentPatch = structuredClone(patchExample);
      currentPatch.files[0]!.expectedIntegrity = source.integrity;
      await writeFile(
        join(root, "patch-dry-run.request.json"),
        JSON.stringify(currentPatch, undefined, 2) + "\n",
      );
      // Execute the documented current-inspection recipe. All six reference
      // JSON examples remain byte-for-byte identical to the frozen guide.

      const guardedPatch = {
        ...patchExample,
        files: [
          {
            path: source.file,
            expectedIntegrity: source.integrity,
            operations: [
              { op: "test", path: `${source.pointer}/uid`, value: source.uid },
              ...exampleFile.operations.filter(({ op }) => op !== "test"),
            ],
          },
        ],
      };
      const beforeGuardedDryRun = await readFile(join(root, source.file));
      const guardedDryRun = parseSuccess(
        await invoke(
          root,
          ["agent", "apply-source-patch", "--input", "-"],
          JSON.stringify(guardedPatch),
        ),
        "apply-source-patch",
      );
      expect(guardedDryRun.result).toMatchObject({
        value: { dryRun: true, files: [{ beforeIntegrity: source.integrity }] },
      });
      expect(await readFile(join(root, source.file))).toEqual(
        beforeGuardedDryRun,
      );

      const query = parseSuccess(
        await invokeExample([
          "agent",
          "query",
          "--input",
          "query.request.json",
        ]),
        "query",
      );
      expect(JSON.stringify(query.result)).toContain("PS1");

      const equipmentPath = join(root, "devices", "equipment.json");
      const beforeDryRun = await readFile(equipmentPath);
      const dryRun = parseSuccess(
        await invokeExample([
          "agent",
          "apply-source-patch",
          "--input",
          "patch-dry-run.request.json",
        ]),
        "apply-source-patch",
      );
      expect(dryRun.result).toMatchObject({ value: { dryRun: true } });
      expect(await readFile(equipmentPath)).toEqual(beforeDryRun);

      const applyRequest = structuredClone(currentPatch) as {
        dryRun: boolean;
      };
      applyRequest.dryRun = false;
      await writeFile(
        join(root, "patch-apply.request.json"),
        JSON.stringify(applyRequest, undefined, 2) + "\n",
        "utf8",
      );
      const applied = parseSuccess(
        await invokeExample([
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
        await invokeExample([
          "agent",
          "validate",
          "--input",
          "validate.request.json",
        ]),
        "validate",
      );
      expect(revalidated.result).toMatchObject({ value: { valid: true } });

      const view = parseSuccess(
        await invokeExample([
          "agent",
          "create-view",
          "--input",
          "create-view.request.json",
        ]),
        "create-view",
      );
      expect(JSON.stringify(view.result)).toContain("<svg");
      const documentedCommands = [
        ...guide.matchAll(/^```sh\n([\s\S]*?)^```/gmu),
      ]
        .flatMap((block) => block[1]!.trim().split("\n"))
        .filter((line) => line.startsWith('bun "$thermite_entry"'));
      expect(documentedCommands).toEqual(executedCommands);
    },
  );
});

describe("root engine guide", () => {
  it("fits the 4,096-byte budget without historical install instructions", async () => {
    const bytes = await readFile(rootGuide);
    expect(bytes.byteLength).toBeLessThanOrEqual(4_096);
    expect(bytes.toString("utf8")).not.toMatch(historicalInstallText);
  });

  it.each([
    ["ELK node placement", false],
    ["a node in the graph", false],
    ["Node.js 22", true],
    ["npm install", true],
    ["npm ci", true],
    ["npx thermite", true],
    ["node thermite.mjs", true],
    ["node scripts/build.js", true],
    ["node scripts/build.cjs", true],
  ])("classifies historical runtime/install text: %s", (text, blocked) => {
    expect(historicalInstallText.test(text)).toBe(blocked);
  });
});
