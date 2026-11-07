import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir, hostname, userInfo } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { engineRoot } from "./engine.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const corpus = join(root, "evals/corpus");
export const version = "1.0";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const integrity = (bytes) =>
  `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
export const json = (value) => JSON.stringify(value, null, 2) + "\n";
export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));
export const request = (project, fields = {}) => ({
  format: "agent-tool-request/0.1",
  project,
  ...fields,
});

export async function temporary(action, fixture = "topology") {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "thermite-eval-"));
  try {
    const project = join(dir, "project");
    if (fixture) await cp(join(corpus, fixture), project, { recursive: true });
    try {
      return portable(await action(project, dir), dir);
    } catch (error) {
      error.message = portable(error.message, dir);
      if (error.evalEvidence)
        error.evalEvidence = portable(error.evalEvidence, dir);
      throw error;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function edit(project, file, action) {
  const path = join(project, file);
  const value = await readJson(path);
  action(value);
  await writeFile(path, json(value));
}

export async function filePatch(project, path, operations) {
  return {
    path,
    expectedIntegrity: integrity(await readFile(join(project, path))),
    operations,
  };
}
export const patchRequest = (project, files, dryRun = true) =>
  request(project, { patchFormat: "json-patch/0.1", dryRun, files });

// Streams stay separate. Parsing each entire stream rejects banners, extra JSON,
// ANSI output, or accidental logging. No shell and no merged stderr/stdout.
export function cli(tool, input, args = ["--input", "-"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(engineRoot, "thermite.mjs"), "agent", tool, ...args],
      {
        cwd: engineRoot,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timeout: ${tool}`));
    }, 30000);
    child.on("error", reject);
    child.stdout.on("data", (bytes) => {
      stdout += bytes;
    });
    child.stderr.on("data", (bytes) => {
      stderr += bytes;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(typeof input === "string" ? input : json(input));
  });
}

export function streams(invocation, tool, exit) {
  assert.equal(invocation.code, exit, invocation.stderr);
  let report;
  assert.doesNotThrow(() => {
    report = JSON.parse(invocation.stderr);
  }, "stderr must contain exactly one JSON report");
  assert.equal(report.format, "agent-tool-report/0.1");
  assert.equal(report.tool, tool);
  assert(Array.isArray(report.diagnostics));
  if (exit === 0) {
    let result;
    assert.doesNotThrow(() => {
      result = JSON.parse(invocation.stdout);
    }, "stdout must contain exactly one JSON result");
    assert.equal(result.format, "agent-tool-result/0.1");
    assert.equal(result.tool, tool);
    assert.equal(report.error, null);
    return { report, result };
  }
  assert.equal(invocation.stdout, "");
  return { report };
}

// Expected failures are observations, never swallowed exceptions. XPASS is an
// explicit result and can be promoted by deleting the marker after review.
export async function probe(id, action) {
  try {
    const evidence = await action();
    return evidence?.assessment === true
      ? { id, ...evidence }
      : { id, status: "pass", evidence };
  } catch (error) {
    return {
      id,
      status: error?.code === "ERR_ASSERTION" ? "fail" : "infrastructure-error",
      failure: error.message,
      ...(error.evalEvidence && { evidence: error.evalEvidence }),
    };
  }
}

// Protocol and code/pointer assertions remain hard failures even when the
// separate repair-discovery predicate is an acknowledged expected failure.
export function required(action) {
  return action();
}
export async function observed(evidence, action) {
  try {
    await action();
    return evidence;
  } catch (error) {
    error.evalEvidence = evidence;
    throw error;
  }
}

export function portable(value, project = root) {
  if (typeof value === "string") {
    return value
      .replaceAll(project, "<scratch>")
      .replaceAll(JSON.stringify(project).slice(1, -1), "<scratch>")
      .replaceAll(engineRoot.replace(/[\\/]$/, ""), "<engine>")
      .replaceAll(
        JSON.stringify(engineRoot.replace(/[\\/]$/, "")).slice(1, -1),
        "<engine>",
      )
      .replaceAll(root.replace(/[\\/]$/, ""), "<evals>")
      .replaceAll(
        JSON.stringify(root.replace(/[\\/]$/, "")).slice(1, -1),
        "<evals>",
      )
      .replaceAll(hostname(), "<host>")
      .replace(
        /\\*"hostname\\*"\s*:\s*\\*"[^"\n]*?\\*"/g,
        '"hostname":"<host>"',
      )
      .replaceAll(userInfo().username, "<user>")
      .replace(/\\*"(?:pid|ageMs)\\*"\s*:\s*[\d.+-]+\s*,?/g, "")
      .replace(/\\*"createdAt\\*"\s*:\s*\\*"[^"\n]*?\\*"\s*,?/g, "")
      .replace(/\b(?:PID|pid)\s*[:=]?\s*\d+/g, "PID <pid>")
      .replace(/\bage\s+\d+(?:\.\d+)?\s+ms/g, "age <age> ms");
  }
  if (Array.isArray(value)) return value.map((item) => portable(item, project));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["pid", "createdAt", "ageMs"].includes(key))
        .map(([key, item]) => [
          key,
          key === "hostname" ? "<host>" : portable(item, project),
        ]),
    );
  return value;
}

export const relativePath = (path) =>
  relative(root, path).split("\\").join("/");
