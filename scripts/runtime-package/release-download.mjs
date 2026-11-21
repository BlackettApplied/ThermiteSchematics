import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSafeZipArchive } from "../safe-zip-reader.mjs";
import {
  json,
  manifestName,
  runtimeFilename,
  sha256,
  verifyArchiveIdentity,
} from "./common.mjs";
import {
  assertRuntimePlatform,
  currentTarget,
  runtimeTargets,
} from "./platform.mjs";
import { verifyRuntimeArchive } from "./verify.mjs";

export function selectRuntimeAssets(names, target) {
  assert(runtimeTargets.includes(target), "Unknown runtime target");
  const pattern = new RegExp(
    `^thermite-[0-9A-Za-z.-]+-${target}-bun-[a-f0-9]{8}\\.zip$`,
  );
  const archives = names.filter((name) => pattern.test(name));
  assert.equal(
    archives.length,
    1,
    "Release must contain exactly one clean runtime ZIP for this target",
  );
  const archive = archives[0];
  const checksum = `${archive}.sha256`;
  assert.equal(
    names.filter((name) => name === checksum).length,
    1,
    "Release must contain the ZIP checksum sidecar",
  );
  return [archive, checksum];
}

export function assertReleaseManifest(manifest, archive, target, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/, "Expected a full release-tag commit");
  assert.equal(
    manifest.preview,
    false,
    "Release download must not be a preview",
  );
  assert.equal(
    manifest.commit,
    commit,
    "Release download does not match the checked-out tag commit",
  );
  assert.equal(
    manifest.target,
    target,
    "Release download does not match the requested target",
  );
  assert.equal(
    archive,
    runtimeFilename(manifest),
    "Release archive identity mismatch",
  );
  verifyArchiveIdentity(manifest, archive);
}

async function download(tag, target, directory) {
  assert.equal(
    currentTarget(),
    target,
    "Download on the requested runtime target",
  );
  assert(tag && !tag.startsWith("-"), "A release tag is required");
  const repository = process.env.GITHUB_REPOSITORY;
  assert(repository, "GITHUB_REPOSITORY is required");
  const release = JSON.parse(
    execFileSync(
      "gh",
      [
        "release",
        "view",
        tag,
        "--repo",
        repository,
        "--json",
        "tagName,assets",
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(release.tagName, tag, "GitHub returned a different release tag");
  const [archive, checksum] = selectRuntimeAssets(
    release.assets.map((asset) => asset.name),
    target,
  );
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory); // Refuse stale downloads or overwritten evidence.
  execFileSync(
    "gh",
    [
      "release",
      "download",
      tag,
      "--repo",
      repository,
      "--dir",
      directory,
      "--pattern",
      archive,
      "--pattern",
      checksum,
    ],
    { stdio: "inherit" },
  );
  process.stdout.write(
    `Downloaded ${archive} and its checksum from ${repository} release ${tag}\n`,
  );
}

async function verify(target, commit, directory, requireOffline) {
  assert.equal(
    currentTarget(),
    target,
    "Verify on the requested runtime target",
  );
  const [archive, checksum] = selectRuntimeAssets(
    await readdir(directory),
    target,
  );
  const bytes = await readFile(join(directory, archive));
  assert.equal(
    await readFile(join(directory, checksum), "utf8"),
    `${sha256(bytes)}  ${archive}\n`,
    "Archive SHA-256 mismatch",
  );
  const entries = await readSafeZipArchive(bytes);
  const entry = entries.find((entry) => entry.path === manifestName);
  assert(entry, "Missing runtime manifest");
  // Bind source identity before the verifier can execute any downloaded code.
  assertReleaseManifest(
    JSON.parse(entry.bytes.toString("utf8")),
    archive,
    target,
    commit,
  );
  const report = await verifyRuntimeArchive(join(directory, archive));
  if (requireOffline)
    assert.equal(
      report.networkIsolation,
      "loopback-only-network-namespace",
      "Linux download acceptance requires network isolation",
    );
  await writeFile(
    join(directory, `${archive}.download-verification.json`),
    json(report),
    { flag: "wx" },
  );
  process.stdout.write(json(report));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assertRuntimePlatform();
  const [operation, ...args] = process.argv.slice(2);
  if (operation === "download" && args.length === 3)
    await download(args[0], args[1], resolve(args[2]));
  else if (
    operation === "verify" &&
    (args.length === 3 ||
      (args.length === 4 && args[3] === "--require-offline"))
  )
    await verify(args[0], args[1], resolve(args[2]), args.length === 4);
  else
    throw new Error(
      "Usage: release-download.mjs download <tag> <target> <directory> | verify <target> <commit> <directory> [--require-offline]",
    );
}
