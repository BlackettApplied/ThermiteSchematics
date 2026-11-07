import { it, expect } from "vitest";
import * as launch from "./launch.mjs";
import { runKey, runDirectoryName, selectAttempts } from "./attempts.mjs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOne } from "./run.mjs";
import { estimateCost } from "./cost.mjs";

it("pins model and Codex effort independently of user config", () => {
  expect(launch.agents.codex).toMatchObject({
    model: "gpt-6.1-sol",
    effort: "xhigh",
  });
  expect(launch.agents.claude.model).toBe("claude-opus-5-5");
  const ctx = { project: "/project", runtime: "/runtime", prompt: "OK" };
  const codex = launch.launchCommand({ agent: "codex", ...ctx });
  expect(codex[codex.indexOf("-m") + 1]).toBe("gpt-6.1-sol");
  expect(codex).toContain('model_reasoning_effort="xhigh"');
  const claude = launch.launchCommand({ agent: "claude", ...ctx });
  expect(claude[claude.indexOf("--model") + 1]).toBe("claude-opus-5-5");
  expect(claude.join(" ")).not.toContain("effort");
});

it("overrides are explicit and cannot join pinned attempt histories", () => {
  const row = {
    context: "runtime",
    task: "T01",
    agent: "codex",
    seed: 1,
    arm: "A",
    attempt: 1,
    status: "complete",
  };
  const pinned = { ...row, ...launch.agentConfiguration({ agent: "codex" }) };
  const model = {
    ...row,
    ...launch.agentConfiguration({ agent: "codex", model: "operator-model" }),
  };
  const effort = {
    ...row,
    ...launch.agentConfiguration({ agent: "codex", effort: "high" }),
  };
  const explicit = {
    ...row,
    ...launch.agentConfiguration({ agent: "codex", model: "gpt-6.1-sol" }),
  };
  expect(new Set([pinned, model, effort, explicit].map(runKey)).size).toBe(4);
  expect(
    new Set([pinned, model, effort, explicit].map(runDirectoryName)).size,
  ).toBe(4);
  expect(selectAttempts([pinned, model, effort, explicit]).errors).toEqual([]);
  expect(
    selectAttempts([pinned, model, effort, explicit]).selected,
  ).toHaveLength(4);
  expect(effort).toMatchObject({
    model: "gpt-6.1-sol",
    effort: "high",
    modelOverrides: { effort: "high", model: null },
  });
  const command = launch.launchCommand({
    agent: "codex",
    project: "/p",
    runtime: "/r",
    prompt: "OK",
    model: "operator-model",
    effort: "high",
  });
  expect(command).toContain("operator-model");
  expect(command).toContain('model_reasoning_effort="high"');
  const claude = launch.launchCommand({
    agent: "claude",
    project: "/p",
    runtime: "/r",
    prompt: "OK",
    model: "operator-opus",
  });
  expect(claude[claude.indexOf("--model") + 1]).toBe("operator-opus");
  expect(claude.join(" ")).not.toContain("effort");
  expect(() =>
    launch.agentConfiguration({ agent: "claude", effort: "high" }),
  ).toThrow(/Codex/);
  expect(() =>
    launch.agentConfiguration({ agent: "reference", model: "unused" }),
  ).toThrow(/reference/);
  expect(() =>
    launch.agentConfiguration({ agent: "codex", effort: "injected=value" }),
  ).toThrow(/effort/);
  expect(() =>
    launch.agentConfiguration({ agent: "codex", model: "" }),
  ).toThrow(/model/);
});

it("even early infrastructure records retain the effective configuration and key", async () => {
  const work = mkdtempSync(join(tmpdir(), "eval-pin-record-"));
  try {
    for (const overrides of [{}, { model: "operator-model", effort: "high" }]) {
      const evidence = join(work, overrides.model ?? "pinned");
      const config = launch.agentConfiguration({
        agent: "codex",
        ...overrides,
      });
      const r = await runOne({
        taskDir: join(work, "T01"),
        prepared: { path: join(work, "missing"), commit: "test" },
        evidence,
        agent: "codex",
        ...overrides,
      });
      expect(r.status).toBe("infrastructure-failure");
      expect(r).toMatchObject(config);
      expect(r.runKey).toBe(runKey(r));
      expect(
        JSON.parse(readFileSync(join(evidence, "manifest.json"), "utf8")),
      ).toMatchObject(config);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

it("new pins with unquoted prices remain explicit partial estimates", () => {
  const table = JSON.parse(
    readFileSync(new URL("./prices.json", import.meta.url), "utf8"),
  );
  for (const agent of ["claude", "codex"]) {
    const model = launch.agents[agent].model;
    expect(
      estimateCost(
        {
          usage: {
            inputTokens: 10,
            outputTokens: 1,
            cachedInputTokens: 0,
            partial: false,
          },
        },
        model,
        table,
      ),
    ).toMatchObject({
      amount: null,
      partial: true,
      unknownModels: [model],
      estimate: true,
    });
  }
});

it("effort overrides stay within the installed pinned-model catalog", () => {
  for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"])
    expect(launch.agentConfiguration({ agent: "codex", effort }).effort).toBe(
      effort,
    );
  for (const effort of ["none", "minimal", "automatic", "extreme"])
    expect(() => launch.agentConfiguration({ agent: "codex", effort })).toThrow(
      /effort/,
    );
  for (const effort of ["low", "medium", "high", "xhigh", "max"])
    expect(() =>
      launch.agentConfiguration({ agent: "claude", effort }),
    ).toThrow(/Codex/);
});
