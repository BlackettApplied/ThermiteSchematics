import { it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { assertArchiveOutsideSandbox, judgePacket } from "./run.mjs";
import { projectReader } from "./capture-files.mjs";
import { launchCommand, freshEnvironment, assertIsolation } from "./launch.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const moduleURL = (path) => pathToFileURL(join(root, path)).href;
it("pins both GI launch commands and rejects ancestor instructions and memory", () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "eval-isolation-")));
  try {
    const project = join(work, "project");
    mkdirSync(project);
    const env = freshEnvironment(join(work, "isolated"), {
      PATH: process.env.PATH,
      CODEX_INSTRUCTIONS: "untrusted",
    });
    expect(env.CODEX_INSTRUCTIONS).toBeUndefined();
    expect(assertIsolation(project, env).asserted).toBe(true);
    writeFileSync(join(env.CODEX_HOME, "memory.md"), "old memory");
    expect(() => assertIsolation(project, env)).toThrow(/not fresh/);
    rmSync(join(env.CODEX_HOME, "memory.md"));
    writeFileSync(join(project, "CLAUDE.md"), "@AGENTS.md\n");
    expect(() => assertIsolation(project, env)).toThrow(/Unexpected/);
    expect(assertIsolation(project, env, { claudeLoader: true }).asserted).toBe(
      true,
    );
    rmSync(join(project, "CLAUDE.md"));
    writeFileSync(join(work, "AGENTS.md"), "unexpected");
    expect(() => assertIsolation(project, env)).toThrow(/Ancestor/);
    for (const agent of ["claude", "codex"]) {
      const command = launchCommand({
        agent,
        project,
        runtime: "/runtime",
        prompt: "task",
      });
      expect(command[0]).toBe(agent);
      expect(command).toContain(
        agent === "claude" ? "stream-json" : "--ephemeral",
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
it("reference pipeline rechecks the kept workspace without another agent attempt", async () => {
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), "eval-reference-test-")),
  );
  let kept;
  try {
    const prepared = join(work, "prepared"),
      taskDir = join(work, "task"),
      evidence = join(work, "evidence"),
      ready = join(work, "ready"),
      referenceCount = join(work, "reference-count"),
      paths = join(work, "paths.json");
    mkdirSync(prepared);
    mkdirSync(taskDir);
    writeFileSync(
      join(prepared, "thermite.mjs"),
      `const{runThermite}=await import(${JSON.stringify(moduleURL("packages/cli/dist/alpha.js"))});process.exitCode=await runThermite();`,
    );
    writeFileSync(
      join(taskDir, "task.json"),
      JSON.stringify({
        id: "pipeline",
        template: "starter",
        prompt: 'Change PS1 description to "Pipeline checked".',
        expectedWarnings: [],
        reference: "reference.mjs",
      }),
    );
    writeFileSync(
      join(taskDir, "reference.mjs"),
      `import{replaceObject}from${JSON.stringify(moduleURL("evals/agent/task-support.mjs"))};import{readFileSync,existsSync,writeFileSync}from"node:fs";export default ctx=>{const p=${JSON.stringify(referenceCount)};writeFileSync(p,String((existsSync(p)?Number(readFileSync(p,"utf8")):0)+1));writeFileSync(${JSON.stringify(paths)},JSON.stringify({evidence:ctx.evidence,project:ctx.project}));replaceObject(ctx,"PS1","description","Pipeline checked");process.exitCode=1;return "Reference complete";}`,
    );
    writeFileSync(
      join(taskDir, "check.mjs"),
      `import{locate,ok}from${JSON.stringify(moduleURL("evals/agent/task-support.mjs"))};import{CheckerInfrastructureError}from${JSON.stringify(moduleURL("evals/agent/checker.mjs"))};import{existsSync}from"node:fs";export default ctx=>{if(!existsSync(${JSON.stringify(ready)}))throw new CheckerInfrastructureError("checker unavailable");ok(ctx,"validate",".");return {pass:locate(ctx.project,"PS1").object.description==="Pipeline checked"};}`,
    );
    const { runOne, recheckRun } = await import("./run.mjs");
    if (process.platform === "win32") {
      await expect(
        runOne({
          taskDir,
          prepared: { path: prepared, commit: "test-adapter" },
          evidence,
        }),
      ).rejects.toThrow("unavailable on Windows");
      return;
    }
    const original = await runOne({
      taskDir,
      prepared: { path: prepared, commit: "test-adapter" },
      evidence,
    });
    kept = original.workspace;
    expect(original.exitAfterCompletion).toBe(true);
    expect(original.warnings).toContainEqual({
      code: "exit-after-completion",
      exit: 1,
    });
    expect(original).toMatchObject({
      evalVersion: "1.20.8",
      model: null,
      effort: null,
      modelPin: null,
      modelOverrides: { model: null, effort: null },
    });
    expect(original.runKey).toContain("pipeline/reference/1/");
    expect(original.status, JSON.stringify(original)).toBe("checker-error");
    const { sha256 } = await import("./snapshot.mjs");
    const task = JSON.parse(readFileSync(join(taskDir, "task.json"), "utf8"));
    expect(original.promptHash).toBe(
      sha256(`Thermite is at {{THERMITE}}.\n\n${task.prompt}`),
    );
    expect(readFileSync(referenceCount, "utf8")).toBe("1");
    // Live evidence stays outside the run directory and /tmp, which a
    // sandboxed agent can write, and is removed once copied.
    const live = JSON.parse(readFileSync(paths, "utf8"));
    expect(live.evidence.startsWith(realpathSync(homedir()) + sep)).toBe(true);
    expect(live.evidence.startsWith(dirname(live.project) + sep)).toBe(false);
    expect(existsSync(live.evidence)).toBe(false);
    expect(existsSync(join(evidence, "manifest.json"))).toBe(true);
    writeFileSync(ready, "ready");
    writeFileSync(join(taskDir, "changed-context.md"), "Changed checker input");
    const checkFile = join(taskDir, "check.mjs");
    writeFileSync(
      checkFile,
      readFileSync(checkFile, "utf8")
        .replace("export default ctx=>", "export default async ctx=>")
        .replace("return {pass:", "return {forcedCode:true,pass:"),
    );

    const context = { path: prepared, commit: "test-adapter" };
    await expect(recheckRun({ evidence, prepared: context })).rejects.toThrow(
      /Task directory changed/,
    );
    const result = await recheckRun({
      evidence,
      forceRecheck: true,
      prepared: context,
    });
    expect(result).toMatchObject({
      attempt: 1,
      evalVersion: "1.20.8",
      checkerRechecks: 1,
      status: "complete",
      workspace: null,
      outcome: { pass: true },
    });
    expect(result.metrics.violations).toEqual([]);
    expect(result.usage).toEqual(original.usage);
    expect(result.forceRecheck).toBe(true);
    expect(result.outcome.forcedCode).toBe(true);
    expect(result.checkerTaskTreeHash).not.toBe(original.taskTreeHash);
    expect(result.checkerRecheckHistory[0].forced).toBe(true);
    expect(result.harnessHash).toBe(original.harnessHash);
    const { harnessIdentity } = await import("./checkpoint.mjs");
    const { checkerHarnessHash, checkerHash } = harnessIdentity();
    expect(result).toMatchObject({ checkerHarnessHash, checkerHash });
    expect(result.checkerRecheckHistory[0].harnessHash).toBe(
      checkerHarnessHash,
    );
    expect(readFileSync(referenceCount, "utf8")).toBe("1");
    expect(
      JSON.parse(readFileSync(join(evidence, "checker-history-001.json")))
        .status,
    ).toBe("checker-error");
  } finally {
    if (kept) rmSync(kept, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
  // This exercises real guarded CLI writes and both checker passes. Rendering has
  // its own artifact tests; duplicating PDF generation here obscured recovery.
  // The Windows check took 26.2 s through this fixed run/recheck sequence.
}, 60000);

it("judge packet removes run identities and includes rubric deliverables", () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "eval-judge-")));
  try {
    mkdirSync(join(work, "drawings"));
    writeFileSync(
      join(work, "requirement-matrix.json"),
      '[{"requirement":"motor"}]',
    );
    const binary = Buffer.from("AA/GPT/A", "base64");
    writeFileSync(join(work, "drawings/provider.pdf"), binary);
    const make = (source = null) =>
      judgePacket({
        source,
        project: work,
        runtime: "/runtime",
        finalMessage:
          "Anthropic OpenAI GPT Claude Opus 4.5 Codex Opus Sonnet Haiku Fable o-series o3-pro o4-mini-high Gemini DeepSeek Grok Llama Qwen Mistral Copilot arm B. PLC output O1 and O2.1, voltage 4.5, model o1, codex sandbox, xhigh, Codex CLI 0.164.0, Claude Code v2.1.280, 2.1.280 (Claude Code), claude --version printed 2.1.280, CLI version 0.164.0, thermite CLI 0.2.0, thermite CLI version 0.2.0",
        sourceDiff: "/runtime/example",
        task: { rubric: ["Preserve unknown facts"] },
      });
    if (process.platform === "win32") {
      expect(make).toThrow("unavailable on Windows");
      return;
    }
    const source = projectReader(work);
    let packet;
    try {
      packet = make(source);
    } finally {
      source.close();
    }
    const text = JSON.stringify({
      ...packet,
      outputs: Object.fromEntries(
        Object.entries(packet.outputs).filter(([key]) => !key.endsWith(".pdf")),
      ),
    });
    expect(text).not.toMatch(
      /Anthropic|OpenAI|GPT|Claude|Codex|Opus|Sonnet|Haiku|Fable|o-series|o3-pro|o4-mini|Gemini|DeepSeek|Grok|Llama|Qwen|Mistral|Copilot|arm B|\/runtime/,
    );
    expect(packet.outputs["requirement-matrix.json"]).toBeTruthy();
    expect(packet.finalMessage).toContain("PLC output O1 and O2.1");
    expect(packet.finalMessage).not.toContain("0.164.0");
    expect(packet.finalMessage).toContain("thermite CLI version 0.2.0");
    expect(packet.finalMessage).toContain("sandbox");
    expect(packet.finalMessage).not.toContain("<identity> 4.5");
    expect(packet.finalMessage).not.toContain("-high");
    expect(packet.finalMessage).toContain("voltage 4.5");
    expect(packet.finalMessage).not.toContain("model o1");
    expect(packet.finalMessage).not.toMatch(/xhigh|0\.164\.0|2\.1\.280/);
    expect(packet.finalMessage).toContain("thermite CLI 0.2.0");
    expect(packet).not.toHaveProperty("agent");
    expect(packet.rubric).toHaveLength(1);
    expect(packet.outputs["drawings/provider.pdf"]).toBe(
      binary.toString("base64"),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

it("refuses a Codex evidence archive under a temporary directory", () => {
  const tasks = realpathSync(mkdtempSync(join(tmpdir(), "eval-archive-")));
  const checkpoint = "test-archive-" + basename(tasks);
  const destination = join(root, "evals/out/agent", checkpoint);
  const home = mkdtempSync(join(homedir(), ".thermite-archive-test-"));
  try {
    expect(() => assertArchiveOutsideSandbox(tasks)).toThrow(
      "which a sandboxed Codex agent can write",
    );
    expect(() => assertArchiveOutsideSandbox(home)).not.toThrow();
    mkdirSync(join(tasks, "T"));
    writeFileSync(join(tasks, "T", "task.json"), JSON.stringify({ id: "T" }));
    // Point the CLI's temporary directory at this checkout's parent so its
    // archive is under it wherever the checkout lives.
    const run = spawnSync(
      process.execPath,
      [
        join(root, "evals/agent/run.mjs"),
        ...["--agent", "codex", "--checkpoint", checkpoint, "--task", "T"],
        ...["--tasks-dir", tasks, "--commit", "not-a-commit"],
      ],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          ...Object.fromEntries(
            ["TMPDIR", "TEMP", "TMP"].map((key) => [
              key,
              dirname(realpathSync(root)),
            ]),
          ),
        },
      },
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(
      process.platform === "win32"
        ? "unavailable on Windows"
        : "which a sandboxed Codex agent can write",
    );
  } finally {
    rmSync(tasks, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(destination, { recursive: true, force: true });
  }
});
