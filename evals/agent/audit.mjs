import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { snapshot, sha256 } from "./snapshot.mjs";
import { captureProcess } from "./process.mjs";
export function fileState(project, real, env = process.env, previous) {
  const state = snapshot(project);
  const patterns = state.documents["system.json"]?.sources ?? [];
  try {
    const glob = createRequire(real)("fast-glob");
    state.sourceFiles = [
      ...new Set(
        patterns
          .filter((p) => typeof p === "string")
          .flatMap((pattern) =>
            glob.sync(pattern, {
              cwd: project,
              onlyFiles: true,
              followSymbolicLinks: false,
              unique: true,
              ignore: [".thermite-schematics-write.lock"],
            }),
          ),
      ),
    ].sort();
  } catch {
    state.sourceFiles = Object.keys(state.files)
      .filter((path) =>
        patterns.some(
          (pattern) =>
            typeof pattern === "string" &&
            !pattern.startsWith("!") &&
            new Bun.Glob(pattern).match(path),
        ),
      )
      .sort();
  }
  state.schemaInvalidFiles = (previous?.schemaInvalidFiles ?? []).filter(
    (path) => state.files[path] === previous.files[path],
  );
  state.invalidJsonFiles = [
    ...new Set([
      ...state.invalidJsonFiles,
      ...(previous?.invalidJsonFiles ?? []).filter(
        (path) => state.files[path] === previous.files[path],
      ),
    ]),
  ];
  if (
    !existsSync(project) ||
    !existsSync(project + "/system.json") ||
    env.THERMITE_EVAL_SCHEMA_VALIDATE === "0"
  )
    return state;
  const r = spawnSync(process.execPath, [real, "validate", project, "--json"], {
    cwd: project,
    env,
    encoding: "utf8",
    maxBuffer: 32 << 20,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return validatedState(state, r);
}
// The shim keeps synchronous boundary validation. The runner must await the
// same validation during setup so a sibling's terminal event can be handled.
export async function fileStateAsync(
  project,
  real,
  env = process.env,
  previous,
  capture = captureProcess,
) {
  const state = fileState(
    project,
    real,
    { ...env, THERMITE_EVAL_SCHEMA_VALIDATE: "0" },
    previous,
  );
  if (
    !existsSync(project + "/system.json") ||
    env.THERMITE_EVAL_SCHEMA_VALIDATE === "0"
  )
    return state;
  const result = await capture(
    process.execPath,
    [real, "validate", project, "--json"],
    {
      cwd: project,
      env,
      maxBuffer: 32 << 20,
    },
  );
  return validatedState(state, result);
}
function validatedState(state, r) {
  let diagnostics = [];
  for (const text of [r.stdout, r.stderr])
    try {
      const value = JSON.parse(text);
      diagnostics.push(
        ...(Array.isArray(value) ? value : (value.diagnostics ?? [])),
      );
    } catch {}
  if (r.error || (r.status !== 0 && diagnostics.length === 0))
    throw Object.assign(
      new Error("Boundary validation could not establish file state"),
      { code: r.error?.code ?? "STATE_VALIDATION_FAILED" },
    );
  state.invalidJsonFiles = [
    ...new Set([
      ...state.invalidJsonFiles,
      ...diagnostics
        .filter((d) => d.code === "E002" || d.code === "E003")
        .map((d) => d.file)
        .filter(Boolean),
    ]),
  ];
  state.schemaInvalidFiles = [
    ...new Set([
      ...state.schemaInvalidFiles,
      ...diagnostics
        .filter((d) => /^E0(?:0[2-9]|1[0-9])$/.test(d.code))
        .map((d) => d.file)
        .filter(Boolean),
    ]),
  ];
  return state;
}
export function sealEntry(entry, previousHash = null) {
  const payload = { ...entry, previousHash };
  return { ...payload, entryHash: sha256(JSON.stringify(payload)) };
}
export function auditErrors(calls, head) {
  const errors = [];
  let previous = null;
  for (const [index, call] of calls.entries()) {
    const { entryHash, ...payload } = call;
    if (
      call.previousHash !== previous ||
      sha256(JSON.stringify(payload)) !== entryHash
    )
      errors.push({ kind: "shim-error", stage: "integrity", call: index });
    previous = entryHash;
  }
  if (head !== undefined && previous !== head)
    errors.push({ kind: "shim-error", stage: "head" });
  return errors;
}
