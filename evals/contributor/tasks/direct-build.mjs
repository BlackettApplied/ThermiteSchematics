import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import harnessTypeScript from "typescript";
import { sameContributorPath } from "../../agent/contributor-bun.mjs";
import { sha256 } from "../../agent/snapshot.mjs";

function emitSource(ts, repository, input, artifacts) {
  const source = join(repository, input);
  const project = dirname(dirname(source));
  const configPath = join(project, "tsconfig.json");
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) return [];
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, project);
  if (parsed.errors.length) return [];
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
  const file = program.getSourceFile(source);
  if (!file) return [];
  const emitted = [];
  const result = program.emit(file, (path, text, bom) => {
    const artifact = artifacts.find(({ file }) =>
      sameContributorPath(path, join(repository, file)),
    );
    if (artifact)
      emitted.push([artifact.file, sha256(bom ? "\ufeff" + text : text)]);
  });
  return result.emitSkipped ? [] : emitted;
}

function emitDigests(ts, repository, outputs) {
  const bySource = Object.groupBy(outputs, ({ input }) => input.file);
  return Object.fromEntries(
    Object.entries(bySource).flatMap(([source, artifacts]) =>
      emitSource(ts, repository, source, artifacts),
    ),
  );
}

function childDigests(repository, outputs, { module, version }) {
  const worker = fileURLToPath(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [worker, module, version, repository],
    {
      cwd: dirname(worker),
      input: JSON.stringify(
        outputs.map(({ file, input }) => ({
          file,
          input: { file: input.file },
        })),
      ),
      encoding: "utf8",
      timeout: 120000,
    },
  );
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

// Builds can bypass the observer. Re-emit the required artifacts in memory
// from the delivered source and compare their bytes.
export function verifyDirectBuild(repository, outputs, pinned) {
  if (
    !outputs.length ||
    outputs.some(({ sha256, input }) => !sha256 || !input.sha256)
  )
    return { matches: false };
  const useChild =
    pinned?.version && pinned.version !== harnessTypeScript.version;
  const digests = useChild
    ? childDigests(repository, outputs, pinned)
    : emitDigests(harnessTypeScript, repository, outputs);
  return {
    matches: outputs.every(({ file, sha256 }) => digests?.[file] === sha256),
    typescript: useChild
      ? { source: "prepared", version: pinned.version, execution: "child" }
      : {
          source: "harness",
          version: harnessTypeScript.version,
          execution: "in-process",
        },
  };
}

if (import.meta.main) {
  // The parent supplies the compiler from its prepared context. The checkout
  // supplies only the source and compiler configuration for the emit.
  const [module, version, repository] = process.argv.slice(2);
  const ts = createRequire(import.meta.url)(module);
  if (ts.version !== version) process.exitCode = 1;
  else {
    const outputs = JSON.parse(readFileSync(0, "utf8"));
    console.log(JSON.stringify(emitDigests(ts, repository, outputs)));
  }
}
