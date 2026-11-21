#!/usr/bin/env bun
// Manual, loopback-only protocol capture. Not part of the normal test/check.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { tmpdir } from "node:os";
import { freshEnvironment, assertIsolation } from "./launch.mjs";
import { normalizeUsageToday } from "./capture-normalization.mjs";
const { values } = parseArgs({
  options: {
    agent: { type: "string", default: "codex" },
    case: { type: "string" },
    output: { type: "string", default: "evals/out/agent/cli-captures" },
  },
});
const allCases = [
  "usage_limit_reached",
  "usage_not_included",
  "usage-no-reset",
  "usage-pro",
  "usage-pro-no-reset",
  "usage-today",
  "insufficient_quota",
  "rate-limit",
  "rate-limit-no-id",
  "disconnect",
  "content-filter",
];
assert(["codex", "claude"].includes(values.agent));
const cases =
  values.agent === "claude"
    ? values.case
      ? [values.case]
      : ["server-overload", "unknown-400"]
    : values.case
      ? [values.case]
      : allCases;
assert(
  cases.every(
    (c) =>
      allCases.includes(c) ||
      (values.agent === "claude" &&
        ["server-overload", "unknown-400"].includes(c)),
  ),
  "Unknown local response case",
);
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
for (const name of cases) {
  const work = realpathSync(
      mkdtempSync(
        join(
          process.platform === "win32" ? tmpdir() : "/tmp",
          "thermite-cli-protocol-",
        ),
      ),
    ),
    requests = [];
  const server = createServer((req, res) => {
    // No request headers or bodies are retained.
    requests.push({
      method: req.method,
      path: new URL(req.url, "http://localhost").pathname,
    });
    req.resume();
    if (values.agent === "claude") {
      res.writeHead(name === "unknown-400" ? 400 : 529, {
        "content-type": "application/json",
        "retry-after": "0",
      });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type:
              name === "unknown-400"
                ? "invalid_request_error"
                : "overloaded_error",
            message:
              name === "unknown-400"
                ? "LOCAL_STUB_PROMPT_TOO_LONG"
                : "LOCAL_STUB_OVERLOADED",
          },
          request_id: "local-request",
        }),
      );
      return;
    }
    if (["disconnect", "content-filter"].includes(name)) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        "event: response.created\ndata: " +
          JSON.stringify({
            type: "response.created",
            response: {
              id: "local-response",
              object: "response",
              status: "in_progress",
              output: [],
            },
          }) +
          "\n\n",
      );
      if (name === "content-filter")
        res.write(
          "event: response.incomplete\ndata: " +
            JSON.stringify({
              type: "response.incomplete",
              response: {
                id: "local-response",
                object: "response",
                status: "incomplete",
                incomplete_details: { reason: "content_filter" },
                output: [],
              },
            }) +
            "\n\n",
        );
      res.end();
      return;
    }
    const code = name.startsWith("rate-limit")
      ? "rate_limit_exceeded"
      : name.startsWith("usage-")
        ? "usage_limit_reached"
        : name;
    res.writeHead(429, {
      "content-type": "application/json",
      "retry-after": "0",
      ...(name === "rate-limit-no-id"
        ? {}
        : { "x-request-id": "local-request" }),
    });
    res.end(
      JSON.stringify({
        error: {
          type: code,
          code,
          message: "LOCAL_STUB_ERROR",
          plan_type: name.startsWith("usage-pro") ? "pro" : "plus",
          ...(["usage-no-reset", "usage-pro-no-reset"].includes(name)
            ? {}
            : {
                resets_at:
                  name === "usage-today"
                    ? Math.floor(Date.now() / 1000) + 3600
                    : 4102444800,
              }),
        },
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port,
    base = `http://127.0.0.1:${port}`;
  const env = {
    ...freshEnvironment(join(work, "isolated"), { PATH: process.env.PATH }),
    OPENAI_API_KEY: "local-dummy-key",
    EVAL_DUMMY_KEY: "local-dummy-key",
    OPENAI_BASE_URL: base + "/v1",
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_API_KEY: "local-dummy-key",
    API_MAX_RETRIES: "0",
    CLAUDE_CODE_MAX_RETRIES: "0",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    HTTP_PROXY: base,
    HTTPS_PROXY: base,
    NO_PROXY: "127.0.0.1,localhost",
    TZ: "UTC",
  };
  let child;
  try {
    assertIsolation(work, env);
    const cliVersion = spawnSync(values.agent, ["--version"], {
      env,
      cwd: work,
      encoding: "utf8",
    }).stdout.trim();
    assert.equal(
      cliVersion,
      values.agent === "codex" ? "codex-cli 0.164.0" : "2.1.280 (Claude Code)",
      "Capture flags are pinned to the installed CLI version",
    );
    const args =
      values.agent === "codex"
        ? [
            "exec",
            "--ignore-user-config",
            "--ignore-rules",
            "--ephemeral",
            "--skip-git-repo-check",
            "--json",
            "-C",
            work,
            "-m",
            "gpt-6.1-sol",
            "-c",
            "check_for_update_on_startup=false",
            "-c",
            'model_reasoning_effort="xhigh"',
            "-c",
            'model_provider="local_eval"',
            "-c",
            'model_providers.local_eval.name="Loopback only"',
            "-c",
            `model_providers.local_eval.base_url="${base}/v1"`,
            "-c",
            'model_providers.local_eval.wire_api="responses"',
            "-c",
            'model_providers.local_eval.env_key="EVAL_DUMMY_KEY"',
            "-c",
            "model_providers.local_eval.request_max_retries=0",
            "-c",
            "model_providers.local_eval.stream_max_retries=0",
            "Reply OK. Do not use tools.",
          ]
        : [
            "-p",
            "Reply OK.",
            "--output-format",
            "stream-json",
            "--verbose",
            "--no-session-persistence",
            "--setting-sources",
            "",
            "--model",
            "claude-opus-5-5",
            "--max-turns",
            "1",
            "--tools",
            "",
          ];
    const started = Date.now();
    child = spawn(values.agent, args, {
      cwd: work,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const timer = setTimeout(() => child.kill("SIGTERM"), 20000);
    const result = await new Promise((r, j) => {
      child.on("error", j);
      child.on("close", (exit, signal) => r({ exit, signal }));
    });
    clearTimeout(timer);
    const anon = (v, key = "") => {
      if (["id", "uuid", "session_id", "thread_id"].includes(key))
        return "fixture-" + key;
      if (key === "timestamp") return "2026-11-05T00:00:00Z";
      if (key === "cwd") return "<work>";
      if (key === "messaging_socket_path") return "<socket>";
      if (typeof v === "string") {
        const text = name === "usage-today" ? normalizeUsageToday(v) : v;
        return text
          .replaceAll(work, "<work>")
          .replaceAll(String(port), "<port>")
          .replaceAll("local-dummy-key", "<dummy-key>");
      }
      if (Array.isArray(v)) return v.map((x) => anon(x));
      return v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, anon(x, k)]))
        : v;
    };
    const lines = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.stringify(anon(JSON.parse(line))));
    writeFileSync(join(output, name + ".jsonl"), lines.join("\n") + "\n");
    writeFileSync(join(output, name + ".stderr"), anon(stderr));
    const proof = {
      case: name,
      cliVersion,
      ...result,
      wallTimeMs: Date.now() - started,
      requests,
      dummyAuth: true,
      requestHeadersLogged: false,
      externalServices: false,
    };
    writeFileSync(
      join(output, name + ".capture.json"),
      JSON.stringify(proof, null, 2) + "\n",
    );
    console.log(JSON.stringify(proof));
  } finally {
    if (child?.exitCode == null) child?.kill();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(work, { recursive: true, force: true });
  }
}
