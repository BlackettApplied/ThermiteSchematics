import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { read } from "./task-support.mjs";
export const agents = read(new URL("./agents.json", import.meta.url));
export function agentConfiguration({ agent, model, effort }) {
  if (agent === "reference") {
    assert(
      model === undefined && effort === undefined,
      "No model/effort for reference runs",
    );
    return {
      model: null,
      effort: null,
      modelPin: null,
      modelOverrides: { model: null, effort: null },
    };
  }
  const pin = agents[agent];
  assert(pin, `Unknown agent ${agent}`);
  assert(
    model === undefined ||
      (typeof model === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model)),
    "Use a nonempty portable model ID",
  );
  assert(
    effort === undefined || agent === "codex",
    "--effort is supported only for Codex",
  );
  assert(
    effort === undefined ||
      // codex-cli 0.164.0's bundled gpt-6.1-sol advertised efforts.
      ["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort),
    "Unknown Codex effort",
  );
  return {
    model: model ?? pin.model,
    effort: agent === "codex" ? (effort ?? pin.effort) : null,
    modelPin: { model: pin.model, effort: pin.effort ?? null },
    modelOverrides: { model: model ?? null, effort: effort ?? null },
  };
}
export function launchCommand({
  agent,
  project,
  runtime,
  prompt,
  model,
  effort,
}) {
  const effective = agentConfiguration({ agent, model, effort });
  const pin = agents[agent];
  assert(pin, `Unknown agent ${agent}`);
  return agent === "claude"
    ? [
        pin.binary,
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--setting-sources",
        "project",
        "--no-session-persistence",
        "--add-dir",
        runtime,
        "--model",
        effective.model,
      ]
    : [
        pin.binary,
        "exec",
        "-c",
        "check_for_update_on_startup=false",
        "-c",
        `model_reasoning_effort=${JSON.stringify(effective.effort)}`,
        "--json",
        "--ephemeral",
        "-s",
        "workspace-write",
        "--skip-git-repo-check",
        "-C",
        project,
        "-m",
        effective.model,
        prompt,
      ];
}
export function freshEnvironment(
  root,
  base = process.env,
  { engineRoots = [] } = {},
) {
  // Do not inherit arbitrary configuration, preload hooks, memory or telemetry.
  const env = Object.fromEntries(
    [
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TMPDIR",
      "TEMP",
      "TMP",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "TERM",
    ]
      .filter((k) => base[k])
      .map((k) => [k, base[k]]),
  );
  for (const name of ["home", "claude", "codex", "config", "cache", "data"])
    mkdirSync(join(root, name), { recursive: true });
  if (env.PATH)
    env.PATH = env.PATH.split(process.platform === "win32" ? ";" : ":")
      .filter((p) => !engineRoots.some((root) => p.startsWith(root)))
      .join(process.platform === "win32" ? ";" : ":");
  return {
    ...env,
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CODEX_DISABLE_UPDATE_CHECK: "1",
    TMPDIR: dirname(root),
    TMP: dirname(root),
    TEMP: dirname(root),
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    CODEX_HOME: join(root, "codex"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    COPYFILE_DISABLE: "1",
  };
}
export function assertIsolation(
  project,
  env,
  { claudeLoader = false, codexAuth = false } = {},
) {
  for (const key of [
    "HOME",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ]) {
    assert(env[key] && existsSync(env[key]), `Missing fresh ${key}`);
    assert.deepEqual(
      readdirSync(env[key]).sort(),
      key === "CODEX_HOME" && codexAuth ? ["auth.json"] : [],
      `${key} is not fresh`,
    );
  }
  for (let dir = dirname(resolve(project)); ; dir = dirname(dir)) {
    for (const file of [
      "CLAUDE.md",
      "CLAUDE.local.md",
      "AGENTS.md",
      "AGENTS.override.md",
      ".claude/CLAUDE.md",
      ".claude/settings.json",
      ".codex/config.toml",
    ])
      assert(
        !existsSync(join(dir, file)),
        `Ancestor instructions would load: ${join(dir, file)}`,
      );
    if (dirname(dir) === dir) break;
  }
  if (existsSync(join(project, "CLAUDE.md")))
    assert(
      claudeLoader &&
        readFileSync(join(project, "CLAUDE.md"), "utf8") === "@AGENTS.md\n",
      "Unexpected project CLAUDE.md",
    );
  for (const file of [
    "CLAUDE.local.md",
    "AGENTS.override.md",
    ".claude",
    ".codex",
  ])
    assert(
      !existsSync(join(project, file)),
      `Unexpected task configuration ${file}`,
    );
  return {
    asserted: true,
    home: env.HOME,
    config: [env.CLAUDE_CONFIG_DIR, env.CODEX_HOME],
    memoryDisabled: true,
    ancestorInstructions: false,
    projectGuideLoader: claudeLoader
      ? "CLAUDE.md imports AGENTS.md"
      : "AGENTS.md",
  };
}
export function shellCommand(argv) {
  return argv.map((arg) => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
}
