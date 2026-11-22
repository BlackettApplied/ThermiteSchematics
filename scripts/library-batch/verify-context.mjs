import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
export function createVerificationReport() {
  return {
    status: "failed",
    checks: [],
    diagnostics: [],
    outputs: {},
    reviewFlags: [
      {
        code: "manufacturer-review-required",
        message:
          "Automatic structural/topology checks do not approve manufacturer facts, engineering suitability or installation safety.",
      },
      {
        code: "visual-review-required",
        message:
          "Generated geometry and selection are checked structurally; a human must review the packet at its intended print size.",
      },
    ],
    inputs: {},
  };
}
export async function createVerificationContext(jobPath, outputPath, support) {
  const { readStrict, digest, json } = support;
  const jobDir = resolve(jobPath),
    output = resolve(outputPath);
  assert(
    jobDir !== output &&
      !relative(output, jobDir)
        .split(/[\\/]/)
        .every((part) => part !== ".."),
    "Output must not be the job folder or an ancestor of it",
  );
  await mkdir(output, { recursive: true });
  const report = createVerificationReport();
  const check = async (name, action) => {
    try {
      const value = await action();
      report.checks.push({ name, status: "passed" });
      return value;
    } catch (error) {
      report.checks.push({ name, status: "failed", message: error.message });
      throw error;
    }
  };
  const flag = (code, message) => report.reviewFlags.push({ code, message });
  const diagnostic = (stage, result) => {
    report.diagnostics.push({
      stage,
      diagnostics: result.diagnostics ?? [],
      ...(result.error ? { error: result.error } : {}),
    });
  };
  const snapshots = new Map();
  const read = async (name) => {
    const data = await readStrict(join(jobDir, name));
    snapshots.set(name, data.bytes);
    report.inputs[name] = digest(data.bytes);
    return data.value;
  };
  return {
    ...support,
    jobDir,
    output,
    report,
    check,
    flag,
    diagnostic,
    snapshots,
    read,
  };
}
