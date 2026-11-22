import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { consumerExecution, currentTarget } from "./platform.mjs";
import { sha256, verifyEntries, verifyArchiveIdentity } from "./common.mjs";
import { readSafeZipArchive } from "../safe-zip-reader.mjs";

export function prepareConsumerExecution(sourceCli) {
  const execution = consumerExecution();
  // Consumer CLI processes cannot consult this checkout or the isolated source
  // build used for parity. The verifier itself may read build-only references.
  if (process.platform === "darwin") {
    const denied = [
      fileURLToPath(new URL("../../", import.meta.url)),
      ...(sourceCli ? [dirname(sourceCli)] : []),
    ];
    execution.prefix[1] += denied
      .map(
        (path) =>
          `(deny file-read* (subpath ${JSON.stringify(resolve(path))}))`,
      )
      .join("");
  }
  return execution;
}

function verifyMetricPayload(entries) {
  const metrics = entries.filter((entry) =>
    /(?:^|\/)text-metrics-data\./u.test(entry.path),
  );
  assert.deepEqual(
    metrics.map((entry) => entry.path).sort(),
    [
      "node_modules/@thermite/render/dist/text-metrics-data.d.ts",
      "node_modules/@thermite/render/dist/text-metrics-data.js",
    ],
    "Ship compact generated data without duplicate source or maps",
  );
  assert(
    metrics.reduce((bytes, entry) => bytes + entry.bytes.length, 0) <= 100000,
    "Generated runtime metric data exceeds 100 KB",
  );
  assert(
    !entries.some((entry) =>
      /node_modules\/(?:dejavu-fonts-ttf|pdfjs-dist|playwright-core|@napi-rs\/canvas)\//u.test(
        entry.path,
      ),
    ),
    "Generator/raster dependencies must remain development-only",
  );
}

export async function readRuntimeArchive(archivePath, allowPreview) {
  const bytes = await readFile(archivePath);
  const digest = sha256(bytes);
  assert.equal(
    await readFile(`${archivePath}.sha256`, "utf8"),
    `${digest}  ${basename(archivePath)}\n`,
    "Archive SHA-256 mismatch",
  );
  const entries = await readSafeZipArchive(bytes);
  const manifest = verifyEntries(entries);
  const buildCommit = JSON.parse(
    entries
      .find(
        (entry) =>
          entry.path === "node_modules/@thermite/cli/assets/guide/source.json",
      )
      .bytes.toString("utf8"),
  ).commit;
  assert.equal(
    buildCommit,
    manifest.commit,
    "Packaging must bind guide build and runtime manifest to the same commit",
  );
  verifyMetricPayload(entries);
  verifyArchiveIdentity(manifest, basename(archivePath), { allowPreview });
  assert.equal(
    manifest.target,
    currentTarget(),
    "Verify on the archive target platform",
  );
  return { bytes, digest, entries, manifest };
}

export function runtimeVerificationReport(
  archivePath,
  digest,
  manifest,
  execution,
  checks,
) {
  return {
    format: "thermite-runtime-verification/0.1",
    archive: basename(archivePath),
    sha256: digest,
    version: manifest.version,
    commit: manifest.commit,
    sourceDigest: manifest.sourceDigest,
    preview: manifest.preview,
    runtime: `Bun ${Bun.version}`,
    target: currentTarget(),
    networkIsolation: execution.networkIsolation,
    checks,
  };
}
