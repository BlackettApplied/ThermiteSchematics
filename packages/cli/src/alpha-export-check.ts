import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { assertOrdinaryPath } from "./alpha-output.js";
import {
  ExportInputError,
  filesystemCode,
  parseExportJson,
  sha256,
} from "./alpha-export-input.js";
import {
  MANIFEST_PATH,
  RECEIPT_SUFFIX,
  type PlannedArtifact,
} from "./alpha-export-plan.js";
import {
  equalJson,
  readBundleRecord,
  readReceiptRecord,
  type ExportBinding,
} from "./alpha-export-record.js";

type ReasonCode =
  | "missing_file"
  | "missing_manifest"
  | "missing_receipt"
  | "source_changed"
  | "request_changed"
  | "byte_mismatch"
  | "producer_mismatch"
  | "unverifiable_input";

interface Finding {
  path: string;
  code: ReasonCode;
  message?: string;
}

export class ExportCheck {
  private findings: Finding[] = [];
  private infrastructureFailure = false;

  add(path: string, code: ReasonCode, message?: string) {
    this.findings.push({ path, code, ...(message ? { message } : {}) });
  }

  failure(path: string, error: unknown) {
    if (!(error instanceof ExportInputError) || error.exitCode === 2)
      this.infrastructureFailure = true;
    if (error instanceof ExportInputError && error.diagnostics.length)
      process.stderr.write(
        JSON.stringify({ diagnostics: error.diagnostics }) + "\n",
      );
    this.add(
      path,
      "unverifiable_input",
      error instanceof Error ? error.message : undefined,
    );
  }

  result() {
    return {
      format: "export-check/1",
      fresh: this.findings.length === 0,
      reasons: this.findings,
    };
  }

  exitCode() {
    return this.infrastructureFailure ? 2 : this.findings.length === 0 ? 0 : 1;
  }

  async read(directory: string, path: string, missing: ReasonCode) {
    try {
      const file = resolve(directory, path);
      await assertOrdinaryPath(file, "file");
      return await readFile(file);
    } catch (error) {
      const code = filesystemCode(error);
      if (code === "ENOENT") this.add(path, missing);
      else
        this.failure(
          path,
          new ExportInputError(
            error instanceof Error
              ? error.message
              : "Unable to read export file.",
            code && code !== "ENOTDIR" ? 2 : 1,
          ),
        );
      return undefined;
    }
  }

  binding(path: string, actual: ExportBinding, expected: ExportBinding) {
    if (!equalJson(actual.producer, expected.producer))
      this.add(path, "producer_mismatch");
    if (!equalJson(actual.source, expected.source))
      this.add(path, "source_changed");
  }
}

function readMarker<T>(
  check: ExportCheck,
  path: string,
  bytes: Buffer,
  parse: (value: unknown) => T,
) {
  try {
    return parse(parseExportJson(bytes, path).value);
  } catch (error) {
    check.failure(
      path,
      error instanceof ExportInputError
        ? error
        : new ExportInputError(
            error instanceof Error ? error.message : "Invalid export metadata.",
          ),
    );
    return undefined;
  }
}

interface ActualArtifact {
  path: string;
  sha256: string;
  intent: unknown;
}
async function checkArtifact(
  check: ExportCheck,
  directory: string,
  planned: PlannedArtifact,
  actual: ActualArtifact | undefined,
  expectedPath: string,
) {
  if (
    actual &&
    (actual.path !== expectedPath || !equalJson(actual.intent, planned.intent))
  )
    check.add(planned.path, "request_changed");
  const bytes = await check.read(directory, planned.path, "missing_file");
  if (actual && bytes && actual.sha256 !== sha256(bytes))
    check.add(planned.path, "byte_mismatch");
}

async function finishMarker(
  check: ExportCheck,
  directory: string,
  path: string,
  bytes: Buffer | undefined,
  missing: ReasonCode,
) {
  if (!bytes) return;
  const current = await check.read(directory, path, missing);
  if (current && !bytes.equals(current))
    check.add(
      path,
      "unverifiable_input",
      "Export metadata changed while checking. Retry.",
    );
}

export async function checkBundle(
  check: ExportCheck,
  directory: string,
  artifacts: PlannedArtifact[],
  expected: ExportBinding,
  requestSha256: string,
) {
  const bytes = await check.read(directory, MANIFEST_PATH, "missing_manifest");
  const manifest =
    bytes && readMarker(check, MANIFEST_PATH, bytes, readBundleRecord);
  if (manifest) {
    check.binding(MANIFEST_PATH, manifest, expected);
    const planned = new Set(artifacts.map(({ path }) => path));
    if (
      manifest.requestSha256 !== requestSha256 ||
      [...manifest.artifacts.keys()].some((path) => !planned.has(path))
    )
      check.add(MANIFEST_PATH, "request_changed");
  }
  for (const artifact of artifacts) {
    const actual = manifest?.artifacts.get(artifact.path);
    if (manifest && !actual)
      check.add(
        artifact.path,
        "request_changed",
        "Artifact is absent from the manifest.",
      );
    await checkArtifact(check, directory, artifact, actual, artifact.path);
  }
  await finishMarker(
    check,
    directory,
    MANIFEST_PATH,
    bytes,
    "missing_manifest",
  );
}

export async function checkSidecars(
  check: ExportCheck,
  directory: string,
  artifacts: PlannedArtifact[],
  expected: ExportBinding,
) {
  for (const artifact of artifacts) {
    const path = artifact.path + RECEIPT_SUFFIX;
    const bytes = await check.read(directory, path, "missing_receipt");
    const receipt = bytes && readMarker(check, path, bytes, readReceiptRecord);
    if (receipt) check.binding(artifact.path, receipt, expected);
    await checkArtifact(
      check,
      directory,
      artifact,
      receipt?.artifact,
      posix.basename(artifact.path),
    );
    await finishMarker(check, directory, path, bytes, "missing_receipt");
  }
}
