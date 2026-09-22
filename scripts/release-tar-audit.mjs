import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  RELEASE_ARTIFACT,
  RELEASE_OUTPUT_NAMES,
  REPOSITORY_ROOT,
  assertLogicalPath,
  compareCodeUnits,
  ensureDirectory,
  mkdirExclusive,
  parseJsonBytes,
  parseNamedArguments,
  pathExists,
  serializeCanonicalJson,
  sha256,
  writeExclusiveFile,
} from "./release-common.mjs";

function readString(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function readOctal(header, offset, length) {
  const text = readString(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(text))
    throw new Error("TAR001 Invalid ustar numeric field.");
  return Number.parseInt(text, 8);
}

function zeroBlock(bytes) {
  return bytes.every((value) => value === 0);
}

export function parseDeterministicTarball(gzipBytes) {
  if (
    gzipBytes.length < 18 ||
    gzipBytes[0] !== 0x1f ||
    gzipBytes[1] !== 0x8b ||
    gzipBytes[2] !== 8 ||
    gzipBytes[3] !== 0 ||
    gzipBytes.readUInt32LE(4) !== 0 ||
    gzipBytes[8] !== 2 ||
    gzipBytes[9] !== 3
  ) {
    throw new Error(
      "TAR001 Gzip header differs from the deterministic contract.",
    );
  }
  const tar = gunzipSync(gzipBytes);
  const entries = [];
  const files = new Map();
  const seen = new Set();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (zeroBlock(header)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks !== 0)
      throw new Error("TAR001 A nonzero header follows archive termination.");
    const storedChecksum = readOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const checksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (checksum !== storedChecksum)
      throw new Error("TAR001 Ustar header checksum mismatch.");
    if (
      readString(header, 257, 6) !== "ustar" ||
      readString(header, 263, 2) !== "00"
    ) {
      throw new Error("TAR001 Archive is not POSIX ustar.");
    }
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    assertLogicalPath(path, "tar path");
    if (path !== "package" && !path.startsWith("package/")) {
      throw new Error(`TAR001 Archive path is outside package/: ${path}.`);
    }
    if (seen.has(path))
      throw new Error(`TAR001 Duplicate archive path: ${path}.`);
    seen.add(path);
    const typeByte = header[156];
    const type =
      typeByte === 0x35
        ? "directory"
        : typeByte === 0x30 || typeByte === 0
          ? "file"
          : undefined;
    if (type === undefined)
      throw new Error(`TAR001 Forbidden ustar entry type at ${path}.`);
    const mode = readOctal(header, 100, 8);
    const uid = readOctal(header, 108, 8);
    const gid = readOctal(header, 116, 8);
    const size = readOctal(header, 124, 12);
    const mtime = readOctal(header, 136, 12);
    const linkname = readString(header, 157, 100);
    const uname = readString(header, 265, 32);
    const gname = readString(header, 297, 32);
    if (
      uid !== 0 ||
      gid !== 0 ||
      mtime !== 0 ||
      linkname !== "" ||
      uname !== "" ||
      gname !== "" ||
      !zeroBlock(header.subarray(329, 345)) ||
      (type === "directory" && (size !== 0 || mode !== 0o755)) ||
      (type === "file" &&
        mode !== (path === "package/dist/bin.js" ? 0o755 : 0o644))
    ) {
      throw new Error(`TAR001 Ustar metadata differs at ${path}.`);
    }
    if (offset + size > tar.length)
      throw new Error(`TAR001 Truncated archive entry at ${path}.`);
    const bytes = Buffer.from(tar.subarray(offset, offset + size));
    offset += size;
    const padding = size % 512 === 0 ? 0 : 512 - (size % 512);
    if (!zeroBlock(tar.subarray(offset, offset + padding))) {
      throw new Error(`TAR001 Nonzero entry padding at ${path}.`);
    }
    offset += padding;
    entries.push({
      path,
      type,
      mode: mode === 0o755 ? "0755" : "0644",
      uid,
      gid,
      size,
      mtime,
      linkname,
    });
    if (type === "file") files.set(path, bytes);
  }
  if (zeroBlocks !== 2 || !zeroBlock(tar.subarray(offset))) {
    throw new Error(
      "TAR001 Archive termination blocks or trailing data are invalid.",
    );
  }
  return { entries, files };
}

export async function safeExtractTarball(gzipBytes, destination) {
  if (await pathExists(destination))
    throw new Error("Safe extraction destination must be absent.");
  await mkdirExclusive(destination);
  const parsed = parseDeterministicTarball(gzipBytes);
  for (const entry of parsed.entries) {
    const target = join(destination, ...entry.path.split("/"));
    if (entry.type === "directory") await ensureDirectory(target);
    else
      await writeExclusiveFile(
        target,
        parsed.files.get(entry.path),
        entry.mode === "0755" ? 0o755 : 0o644,
      );
  }
  return parsed;
}

function assertExactKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) {
    throw new Error(`${label} has unknown, missing, or reordered keys.`);
  }
}

function retainedStageFilePaths(firstPartyInventory, stageInventory) {
  return new Set([
    "package/THIRD_PARTY_LICENSES.json",
    ...firstPartyInventory.packages.flatMap((package_) => [
      package_.stagedManifest.path,
      ...package_.files.map(({ stagePath }) => stagePath),
    ]),
    ...stageInventory.packages.flatMap((package_) => [
      package_.manifest.path,
      ...package_.files.map(({ path }) => path),
    ]),
  ]);
}

function assertExactRetainedStageFileSet(
  fileBytes,
  firstPartyInventory,
  stageInventory,
  label,
) {
  if (!(fileBytes instanceof Map)) {
    throw new Error(`TAR002 ${label} bytes are invalid.`);
  }
  const expectedPaths = [
    ...retainedStageFilePaths(firstPartyInventory, stageInventory),
  ].sort(compareCodeUnits);
  const observedPaths = [...fileBytes.keys()].sort(compareCodeUnits);
  if (JSON.stringify(observedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `TAR002 ${label} file set differs from the retained inventories.`,
    );
  }
}

export function assertRetainedStageFileSet(
  stageBytes,
  committedAuthorityBytes,
) {
  if (!(committedAuthorityBytes instanceof Map)) {
    throw new Error("TAR002 Retained committed authority bytes are invalid.");
  }
  const firstPartyBytes = committedAuthorityBytes.get(
    "scripts/release-first-party-files.json",
  );
  const stageInventoryBytes = committedAuthorityBytes.get(
    "scripts/release-third-party-stage-files.json",
  );
  if (firstPartyBytes === undefined || stageInventoryBytes === undefined) {
    throw new Error("TAR002 A retained committed inventory is missing.");
  }
  assertExactRetainedStageFileSet(
    stageBytes,
    parseJsonBytes(
      Buffer.from(firstPartyBytes),
      "scripts/release-first-party-files.json",
    ),
    parseJsonBytes(
      Buffer.from(stageInventoryBytes),
      "scripts/release-third-party-stage-files.json",
    ),
    "Stage",
  );
}

export async function auditReleaseOutputs(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "stageRoot")) {
    throw new Error("TAR002 Path-backed stage audit is forbidden.");
  }
  const {
    outputRoot,
    outputBytes,
    stageBytes,
    committedAuthorityBytes,
    capturedOutputMaps,
    declarationClosure,
    fileReader = readFile,
  } = options;
  const inProcess =
    outputBytes !== undefined ||
    stageBytes !== undefined ||
    committedAuthorityBytes !== undefined ||
    capturedOutputMaps !== undefined ||
    declarationClosure !== undefined;
  if (inProcess && stageBytes === undefined) {
    throw new Error("TAR002 In-process stage audit requires stageBytes.");
  }
  if (
    stageBytes !== undefined &&
    (!(outputBytes instanceof Map) || !(committedAuthorityBytes instanceof Map))
  ) {
    throw new Error(
      "TAR002 In-process stage audit requires retained output and authority bytes.",
    );
  }
  const values = {};
  for (const name of RELEASE_OUTPUT_NAMES) {
    const bytes =
      outputBytes === undefined
        ? await fileReader(join(outputRoot, name))
        : outputBytes.get(name);
    if (bytes === undefined) {
      throw new Error(`TAR002 Release output is missing: ${name}.`);
    }
    values[name] = Buffer.from(bytes);
  }
  const authorityBytes =
    committedAuthorityBytes ??
    new Map(
      await Promise.all(
        [
          "scripts/release-first-party-files.json",
          "scripts/release-third-party-source-files.json",
          "scripts/release-third-party-stage-files.json",
        ].map(async (path) => [
          path,
          Buffer.from(
            await fileReader(join(REPOSITORY_ROOT, ...path.split("/"))),
          ),
        ]),
      ),
    );
  const firstPartyInventoryBytes = authorityBytes.get(
    "scripts/release-first-party-files.json",
  );
  const sourceInventoryBytes = authorityBytes.get(
    "scripts/release-third-party-source-files.json",
  );
  const stageInventoryBytes = authorityBytes.get(
    "scripts/release-third-party-stage-files.json",
  );
  const packageLockBytes = authorityBytes.get("package-lock.json");
  if (
    firstPartyInventoryBytes === undefined ||
    sourceInventoryBytes === undefined ||
    stageInventoryBytes === undefined
  ) {
    throw new Error("TAR002 A retained committed inventory is missing.");
  }
  if (inProcess && packageLockBytes === undefined) {
    throw new Error("TAR002 Retained package-lock bytes are missing.");
  }
  const packageLock =
    packageLockBytes === undefined
      ? undefined
      : parseJsonBytes(packageLockBytes, "package-lock.json");
  if (packageLock !== undefined && packageLock.lockfileVersion !== 3) {
    throw new Error("TAR002 Retained package-lock format differs.");
  }
  const firstPartyInventory = parseJsonBytes(
    firstPartyInventoryBytes,
    "scripts/release-first-party-files.json",
  );
  const sourceInventory = parseJsonBytes(
    sourceInventoryBytes,
    "scripts/release-third-party-source-files.json",
  );
  const stageInventory = parseJsonBytes(
    stageInventoryBytes,
    "scripts/release-third-party-stage-files.json",
  );
  const artifactBytes = values[RELEASE_ARTIFACT];
  const artifactSha = sha256(artifactBytes);
  const expectedShaLine = `${artifactSha}  ${RELEASE_ARTIFACT}\n`;
  if (
    values[`${RELEASE_ARTIFACT}.sha256`].toString("utf8") !== expectedShaLine
  ) {
    throw new Error("TAR002 Release SHA file differs from the tarball.");
  }
  const parsed = parseDeterministicTarball(artifactBytes);
  const readEvidence = (name) => parseJsonBytes(values[name], name);
  const headers = readEvidence("thermite-cli-0.2.0.tar-headers.json");
  const stageFiles = readEvidence("thermite-cli-0.2.0.stage-files.json");
  const closure = readEvidence("thermite-cli-0.2.0.runtime-closure.json");
  const licenses = readEvidence("thermite-cli-0.2.0.third-party-licenses.json");
  const provenance = readEvidence("thermite-cli-0.2.0.build-provenance.json");
  for (const [name, value] of [
    ["thermite-cli-0.2.0.tar-headers.json", headers],
    ["thermite-cli-0.2.0.stage-files.json", stageFiles],
    ["thermite-cli-0.2.0.runtime-closure.json", closure],
    ["thermite-cli-0.2.0.third-party-licenses.json", licenses],
    ["thermite-cli-0.2.0.build-provenance.json", provenance],
  ]) {
    if (values[name].toString("utf8") !== serializeCanonicalJson(value)) {
      throw new Error(`TAR002 Noncanonical JSON bytes in ${name}.`);
    }
  }
  assertExactKeys(
    headers,
    ["format", "artifact", "sha256", "entries"],
    "Tar header inventory",
  );
  assertExactKeys(
    stageFiles,
    ["format", "artifact", "files"],
    "Stage file inventory",
  );
  assertExactKeys(
    closure,
    ["format", "root", "edges"],
    "Runtime closure inventory",
  );
  assertExactKeys(
    licenses,
    ["format", "packages"],
    "Third-party license inventory",
  );
  assertExactKeys(
    provenance,
    [
      "format",
      "artifact",
      "sha256",
      "source",
      "builder",
      "isolation",
      "inventories",
    ],
    "Build provenance",
  );
  for (const entry of headers.entries ?? []) {
    assertExactKeys(
      entry,
      ["path", "type", "mode", "uid", "gid", "size", "mtime", "linkname"],
      "Tar header entry",
    );
  }
  for (const file of stageFiles.files ?? []) {
    assertExactKeys(
      file,
      ["path", "mode", "size", "sha256"],
      "Stage file entry",
    );
  }
  for (const edge of closure.edges ?? []) {
    assertExactKeys(
      edge,
      ["from", "kind", "specifier", "to", "package"],
      "Runtime closure edge",
    );
  }
  for (const package_ of licenses.packages ?? []) {
    assertExactKeys(
      package_,
      ["name", "version", "license", "packagePath", "licenseFiles"],
      "Third-party license package",
    );
    for (const file of package_.licenseFiles ?? []) {
      assertExactKeys(file, ["path", "sha256"], "Third-party license file");
    }
  }
  assertExactKeys(
    provenance.source,
    ["repository", "commit"],
    "Build provenance source",
  );
  assertExactKeys(
    provenance.builder,
    ["os", "arch", "tools"],
    "Build provenance builder",
  );
  assertExactKeys(
    provenance.builder?.tools,
    ["node", "npm", "typescript"],
    "Build provenance tools",
  );
  assertExactKeys(
    provenance.isolation,
    [
      "policy",
      "inheritedEnvironment",
      "locale",
      "timezone",
      "sourceDateEpoch",
      "commandSearch",
      "npmConfig",
    ],
    "Build provenance isolation",
  );
  assertExactKeys(
    provenance.isolation?.npmConfig,
    [
      "home",
      "cache",
      "userConfig",
      "globalConfig",
      "audit",
      "fund",
      "ignoreScripts",
      "updateNotifier",
    ],
    "Build provenance npm configuration",
  );
  assertExactKeys(
    provenance.inventories,
    ["firstPartySha256", "thirdPartySourceSha256", "thirdPartyStageSha256"],
    "Build provenance inventories",
  );
  if (
    headers.format !== "thermite-schematics-tar-headers/0.1" ||
    headers.artifact !== RELEASE_ARTIFACT ||
    headers.sha256 !== artifactSha ||
    JSON.stringify(headers.entries) !== JSON.stringify(parsed.entries)
  ) {
    throw new Error(
      "TAR002 Tar header inventory differs from parsed ustar bytes.",
    );
  }
  const computedStageFiles = [...parsed.files]
    .map(([path, bytes]) => ({
      path,
      mode: path === "package/dist/bin.js" ? "0755" : "0644",
      size: bytes.length,
      sha256: sha256(bytes),
    }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  if (
    stageFiles.format !== "thermite-schematics-stage-files/0.1" ||
    stageFiles.artifact !== RELEASE_ARTIFACT ||
    JSON.stringify(stageFiles.files) !== JSON.stringify(computedStageFiles)
  ) {
    throw new Error(
      "TAR002 Stage file inventory differs from parsed ustar bytes.",
    );
  }
  const embeddedLicenses = parsed.files.get(
    "package/THIRD_PARTY_LICENSES.json",
  );
  if (
    licenses.format !== "thermite-schematics-third-party-licenses/0.1" ||
    licenses.packages.length !== 26 ||
    embeddedLicenses === undefined ||
    !embeddedLicenses.equals(
      values["thermite-cli-0.2.0.third-party-licenses.json"],
    ) ||
    JSON.stringify(
      parseJsonBytes(embeddedLicenses, "package/THIRD_PARTY_LICENSES.json"),
    ) !== JSON.stringify(licenses)
  ) {
    throw new Error(
      "TAR002 Embedded and standalone third-party license inventories differ.",
    );
  }
  if (
    provenance.format !== "thermite-schematics-build-provenance/0.2" ||
    provenance.artifact !== RELEASE_ARTIFACT ||
    provenance.sha256 !== artifactSha ||
    provenance.source.repository !== "BlackettApplied/ThermiteSchematics" ||
    !/^[0-9a-f]{40}$/u.test(provenance.source.commit) ||
    JSON.stringify(provenance.builder) !==
      JSON.stringify({
        os: "linux",
        arch: "x64",
        tools: {
          node: "24.11.1",
          npm: "11.6.2",
          typescript: "5.9.3",
        },
      })
  ) {
    throw new Error(
      "TAR002 Build provenance does not bind the retained tarball.",
    );
  }
  if (
    JSON.stringify(provenance.inventories) !==
    JSON.stringify({
      firstPartySha256: sha256(firstPartyInventoryBytes),
      thirdPartySourceSha256: sha256(sourceInventoryBytes),
      thirdPartyStageSha256: sha256(stageInventoryBytes),
    })
  ) {
    throw new Error(
      "TAR002 Build provenance does not bind the committed inventories.",
    );
  }
  if (
    JSON.stringify(provenance.isolation) !==
    JSON.stringify({
      policy: "env-i/0.1",
      inheritedEnvironment: "discarded-before-bash-node-npm",
      locale: "C",
      timezone: "UTC",
      sourceDateEpoch: "0",
      commandSearch: [
        "pinned-node-24.11.1-bin",
        "system-usr-bin",
        "system-bin",
      ],
      npmConfig: {
        home: "release-output-home",
        cache: "release-output-cache",
        userConfig: "empty-release-user-config",
        globalConfig: "empty-release-global-config",
        audit: false,
        fund: false,
        ignoreScripts: true,
        updateNotifier: false,
      },
    })
  ) {
    throw new Error("TAR002 Build provenance isolation mapping differs.");
  }
  if (
    closure.format !== "thermite-schematics-runtime-closure/0.1" ||
    closure.root !== "package/dist/bin.js" ||
    !parsed.files.has(closure.root)
  ) {
    throw new Error("TAR002 Runtime closure root is invalid.");
  }
  const sortedEdges = [...closure.edges].sort((left, right) => {
    for (const key of ["from", "kind", "specifier", "to", "package"]) {
      const compared = compareCodeUnits(left[key], right[key]);
      if (compared !== 0) return compared;
    }
    return 0;
  });
  if (
    JSON.stringify(sortedEdges) !== JSON.stringify(closure.edges) ||
    closure.edges.some(
      (edge) =>
        !["asset", "import", "main", "require"].includes(edge.kind) ||
        !parsed.files.has(edge.from) ||
        !parsed.files.has(edge.to),
    )
  ) {
    throw new Error("TAR002 Runtime closure edges are invalid.");
  }
  if (
    firstPartyInventory.format !==
      "thermite-schematics-release-first-party-files/0.1" ||
    sourceInventory.format !==
      "thermite-schematics-release-third-party-source-files/0.1" ||
    stageInventory.format !==
      "thermite-schematics-release-third-party-stage-files/0.1"
  ) {
    throw new Error("TAR002 Committed release inventory format differs.");
  }
  assertExactRetainedStageFileSet(
    parsed.files,
    firstPartyInventory,
    stageInventory,
    "Tar",
  );
  if (stageBytes !== undefined) {
    assertExactRetainedStageFileSet(
      stageBytes,
      firstPartyInventory,
      stageInventory,
      "Stage",
    );
  }
  const assertInventoriedTarByte = (path, expectedSha256, label) => {
    const bytes = parsed.files.get(path);
    if (bytes === undefined || sha256(bytes) !== expectedSha256) {
      throw new Error(`TAR002 ${label} differs at ${path}.`);
    }
  };
  for (const package_ of firstPartyInventory.packages) {
    assertInventoriedTarByte(
      package_.stagedManifest.path,
      package_.stagedManifest.sha256,
      "First-party inventory",
    );
    for (const file of package_.files) {
      assertInventoriedTarByte(
        file.stagePath,
        file.stagedSha256,
        "First-party inventory",
      );
    }
  }
  for (const package_ of stageInventory.packages) {
    assertInventoriedTarByte(
      package_.manifest.path,
      package_.manifest.sha256,
      "Third-party stage inventory",
    );
    for (const file of package_.files) {
      assertInventoriedTarByte(
        file.path,
        file.sha256,
        "Third-party stage inventory",
      );
    }
  }
  if (
    JSON.stringify(
      sourceInventory.packages.map(({ name, version }) => ({ name, version })),
    ) !==
    JSON.stringify(
      stageInventory.packages.map(({ name, version }) => ({ name, version })),
    )
  ) {
    throw new Error("TAR002 Source/stage inventory identities differ.");
  }
  if (
    packageLock !== undefined &&
    sourceInventory.packages.some((package_) => {
      const locked = packageLock.packages?.[package_.lockKey];
      return (
        locked?.version !== package_.version ||
        locked?.integrity !== package_.integrity
      );
    })
  ) {
    throw new Error("TAR002 Retained package-lock identities differ.");
  }
  if (capturedOutputMaps !== undefined) {
    if (
      !Array.isArray(capturedOutputMaps) ||
      capturedOutputMaps.length !== 2 ||
      capturedOutputMaps.some((value) => !(value instanceof Map))
    ) {
      throw new Error("TAR002 Captured compiler output maps are invalid.");
    }
    for (const outputMap of capturedOutputMaps) {
      for (const package_ of firstPartyInventory.packages) {
        for (const file of package_.files.filter(({ role }) =>
          ["declaration", "runtime"].includes(role),
        )) {
          const bytes = outputMap.get(file.stagePath);
          if (bytes === undefined || sha256(bytes) !== file.sourceSha256) {
            throw new Error(
              `TAR002 Captured compiler output differs at ${file.stagePath}.`,
            );
          }
        }
      }
    }
  }
  if (declarationClosure !== undefined) {
    if (
      !Array.isArray(declarationClosure.reached) ||
      !Array.isArray(declarationClosure.edges) ||
      declarationClosure.reached.some((path) => !parsed.files.has(path)) ||
      declarationClosure.edges.some(
        ({ from, to }) => !parsed.files.has(from) || !parsed.files.has(to),
      )
    ) {
      throw new Error("TAR002 Declaration closure edges are invalid.");
    }
  }
  const forbiddenHostBytes = [
    Buffer.from("/home/runner/"),
    Buffer.from("/opt/hostedtoolcache/"),
    Buffer.from("C:\\"),
    Buffer.from("RUNNER_TEMP"),
    Buffer.from("GITHUB_WORKSPACE"),
  ];
  for (const [name, bytes] of Object.entries(values)) {
    if (forbiddenHostBytes.some((token) => bytes.includes(token))) {
      throw new Error(`TAR002 Host path or environment leaked into ${name}.`);
    }
  }
  for (const [path, bytes] of parsed.files) {
    if (bytes.includes(Buffer.from("render/" + "0.2")))
      throw new Error(`TAR002 Stale renderer literal at ${path}.`);
    if (
      /(?:^|\/)(?:test|tests|spec|specs|fixtures|examples|\.git|\.npm-cache)(?:\/|$)/iu.test(
        path,
      ) ||
      /(?:\.map|\.tsbuildinfo|package-lock\.json|\.npmrc)$/u.test(path)
    ) {
      throw new Error(`TAR002 Forbidden release path ${path}.`);
    }
  }
  if (stageBytes !== undefined) {
    const observedPaths = [...stageBytes.keys()].sort(compareCodeUnits);
    const parsedPaths = [...parsed.files.keys()].sort(compareCodeUnits);
    if (JSON.stringify(observedPaths) !== JSON.stringify(parsedPaths)) {
      throw new Error("TAR002 Stage and tar file sets differ.");
    }
    for (const path of observedPaths) {
      const bytes = stageBytes.get(path);
      if (!bytes.equals(parsed.files.get(path))) {
        throw new Error(`TAR002 Stage/tar bytes differ at ${path}.`);
      }
    }
  }
  return {
    artifactSha,
    parsed,
    headers,
    stageFiles,
    closure,
    licenses,
    provenance,
  };
}

async function main(argv) {
  const arguments_ = parseNamedArguments(argv, ["--output"]);
  if (arguments_["--output"] === undefined) {
    throw new Error(
      "Usage: node scripts/release-tar-audit.mjs --output <release-out>",
    );
  }
  await auditReleaseOutputs({
    outputRoot: resolve(REPOSITORY_ROOT, arguments_["--output"]),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
