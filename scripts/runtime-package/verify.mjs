import { assertRuntimePlatform } from "./platform.mjs";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractSafeZipArchive } from "../safe-zip-reader.mjs";
import { fileInventory, json, listFiles } from "./common.mjs";
import {
  prepareConsumerExecution,
  readRuntimeArchive,
  runtimeVerificationReport,
} from "./verify-archive.mjs";
import { createConsumerContext } from "./verify-context.mjs";
import {
  verifyGuideProvenance,
  verifyReadOnlyRuntime,
} from "./verify-installation.mjs";
import { verifyOfflineGuides } from "./verify-guides.mjs";
import { verifyShippedCore } from "./verify-core.mjs";
import {
  verifyHelpRequests,
  verifyTemplatesAndNotices,
} from "./verify-projects.mjs";
import { verifyDrawings } from "./verify-drawings.mjs";
import { verifyAgentCommands } from "./verify-agents.mjs";

export const RUNTIME_PROJECT_GUIDE_PATTERN = /runtime package/;

export async function verifyRuntimeArchive(
  archivePath,
  { sourceCli, allowPreview = false } = {},
) {
  assertRuntimePlatform();
  const execution = prepareConsumerExecution(sourceCli);
  const { bytes, digest, entries, manifest } = await readRuntimeArchive(
    archivePath,
    allowPreview,
  );
  const temporary = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-runtime-consumer-"),
  );
  const checks = [];
  const check = (name) => {
    checks.push(name);
    process.stdout.write(`Package acceptance: ${name}\n`);
  };
  let runtime;
  try {
    const extracted = join(temporary, "extracted");
    await extractSafeZipArchive(bytes, extracted);
    runtime = join(temporary, "relocated runtime with spaces");
    await rename(extracted, runtime);
    const context = await createConsumerContext(
      temporary,
      runtime,
      execution,
      entries,
      manifest,
      check,
      sourceCli,
    );
    const { before } = context;
    await verifyGuideProvenance(context);
    await verifyReadOnlyRuntime(context);
    await verifyOfflineGuides(context);
    await verifyShippedCore(context);
    const project = await verifyHelpRequests(context);
    assert.match(
      await readFile(join(project, "AGENTS.md"), "utf8"),
      RUNTIME_PROJECT_GUIDE_PATTERN,
    );
    await verifyTemplatesAndNotices({ ...context, project });
    await verifyDrawings({ ...context, project });
    await verifyAgentCommands({ ...context, project });
    assert.deepEqual(await fileInventory(runtime), before);
    check("runtime payload unchanged after use");
    return runtimeVerificationReport(
      archivePath,
      digest,
      manifest,
      execution,
      checks,
    );
  } finally {
    // Restore permissions so cleanup also works when the invoking user is not root.
    if (runtime)
      for (const file of await listFiles(runtime).catch(() => []))
        await chmod(join(runtime, file), 0o644);
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const allowPreview = args.includes("--allow-preview");
  const paths = args.filter((arg) => arg !== "--allow-preview");
  if (paths.length !== 1 || args.length > 2)
    throw new Error(
      "Usage: bun run package:verify <runtime.zip> [--allow-preview] (with .sha256 sidecar)",
    );
  process.stdout.write(
    json(await verifyRuntimeArchive(resolve(paths[0]), { allowPreview })),
  );
}
