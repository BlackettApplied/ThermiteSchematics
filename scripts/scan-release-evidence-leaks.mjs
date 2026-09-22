import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ACCEPTANCE_LEGS,
  PRODUCER_EVIDENCE_FILE,
  PRODUCER_TEST_FILE,
  RELEASE_GATE_FILE,
  RELEASE_GATE_RECEIPT_FILE,
  RELEASE_NON_TAR_OUTPUT_NAMES,
  assertCanonicalTestManifest,
  assertReleaseAcceptanceEvidence,
  assertReleaseGateEvidence,
  assertReleaseGateReceipt,
  parseCanonicalEvidence,
} from "./release-evidence-audit.mjs";

const RAW_NAMES = Object.freeze([
  "vitest.json",
  "release-install-smoke.branch.json",
  "empty-folder-smoke.branch.json",
]);
const CONSUMER_NAMES = ACCEPTANCE_LEGS.flatMap(({ tests, evidence }) => [
  tests,
  evidence,
]);
const PRODUCER_PREUPLOAD = Object.freeze([
  PRODUCER_TEST_FILE,
  ...RELEASE_NON_TAR_OUTPUT_NAMES,
]);
const PRODUCER_PAIR = Object.freeze([
  PRODUCER_TEST_FILE,
  PRODUCER_EVIDENCE_FILE,
]);
const GATE_NAMES = Object.freeze([
  ...PRODUCER_PAIR,
  ...CONSUMER_NAMES,
  ...RELEASE_NON_TAR_OUTPUT_NAMES,
  RELEASE_GATE_FILE,
]);
const PUBLISHER_NAMES = Object.freeze([
  ...RELEASE_NON_TAR_OUTPUT_NAMES,
  RELEASE_GATE_FILE,
  RELEASE_GATE_RECEIPT_FILE,
]);

function sorted(values) {
  return [...values].sort();
}

function sameSet(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function assertClosedFilenameList(names) {
  if (
    names.length === 0 ||
    new Set(names).size !== names.length ||
    names.some((name) => RAW_NAMES.includes(name))
  ) {
    throw new Error(
      "LEAK001 Evidence filename list is empty, duplicate, or ephemeral.",
    );
  }
  const permitted =
    sameSet(names, PRODUCER_PREUPLOAD) ||
    sameSet(names, PRODUCER_PAIR) ||
    ACCEPTANCE_LEGS.some((leg) => sameSet(names, [leg.tests, leg.evidence])) ||
    sameSet(names, GATE_NAMES) ||
    sameSet(names, [RELEASE_GATE_RECEIPT_FILE]) ||
    sameSet(names, PUBLISHER_NAMES);
  if (!permitted) {
    throw new Error(
      "LEAK001 Evidence files do not equal a frozen upload/gate list.",
    );
  }
}

function assertD8Evidence(name, bytes) {
  if (name.endsWith(".sha256")) {
    if (
      !/^[0-9a-f]{64}  thermite-cli-0\.2\.0\.tgz\n$/u.test(
        bytes.toString("utf8"),
      )
    ) {
      throw new Error("LEAK002 Release SHA evidence is malformed.");
    }
    return undefined;
  }
  const value = parseCanonicalEvidence(bytes, name);
  const expectedFormats = {
    "thermite-cli-0.2.0.tar-headers.json":
      "thermite-schematics-tar-headers/0.1",
    "thermite-cli-0.2.0.stage-files.json":
      "thermite-schematics-stage-files/0.1",
    "thermite-cli-0.2.0.runtime-closure.json":
      "thermite-schematics-runtime-closure/0.1",
    "thermite-cli-0.2.0.third-party-licenses.json":
      "thermite-schematics-third-party-licenses/0.1",
    "thermite-cli-0.2.0.build-provenance.json":
      "thermite-schematics-build-provenance/0.2",
  };
  if (value?.format !== expectedFormats[name]) {
    throw new Error(`LEAK002 D8 evidence schema differs for ${name}.`);
  }
  const exactKeys = (record, keys, label) => {
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      JSON.stringify(Object.keys(record)) !== JSON.stringify(keys)
    ) {
      throw new Error(
        `LEAK002 ${label} has unknown, missing, or reordered keys.`,
      );
    }
  };
  const hex = (digest) => /^[0-9a-f]{64}$/u.test(digest ?? "");
  const array = (candidate, label) => {
    if (!Array.isArray(candidate)) {
      throw new Error(`LEAK002 ${label} must be an array.`);
    }
    return candidate;
  };
  if (name.endsWith(".tar-headers.json")) {
    exactKeys(
      value,
      ["format", "artifact", "sha256", "entries"],
      "tar inventory",
    );
    if (value.artifact !== "thermite-cli-0.2.0.tgz" || !hex(value.sha256)) {
      throw new Error("LEAK002 Tar inventory authority differs.");
    }
    for (const row of array(value.entries, "tar entries")) {
      exactKeys(
        row,
        ["path", "type", "mode", "uid", "gid", "size", "mtime", "linkname"],
        "tar entry",
      );
      if (
        !["directory", "file"].includes(row.type) ||
        !["0644", "0755"].includes(row.mode) ||
        row.uid !== 0 ||
        row.gid !== 0 ||
        !Number.isSafeInteger(row.size) ||
        row.size < 0 ||
        row.mtime !== 0 ||
        row.linkname !== ""
      ) {
        throw new Error("LEAK002 Tar entry differs from the frozen schema.");
      }
    }
  } else if (name.endsWith(".stage-files.json")) {
    exactKeys(value, ["format", "artifact", "files"], "stage inventory");
    if (value.artifact !== "thermite-cli-0.2.0.tgz") {
      throw new Error("LEAK002 Stage inventory artifact differs.");
    }
    for (const row of array(value.files, "stage files")) {
      exactKeys(row, ["path", "mode", "size", "sha256"], "stage file");
      if (
        !["0644", "0755"].includes(row.mode) ||
        !Number.isSafeInteger(row.size) ||
        row.size < 0 ||
        !hex(row.sha256)
      ) {
        throw new Error("LEAK002 Stage file differs from the frozen schema.");
      }
    }
  } else if (name.endsWith(".runtime-closure.json")) {
    exactKeys(value, ["format", "root", "edges"], "runtime closure");
    if (value.root !== "package/dist/bin.js") {
      throw new Error("LEAK002 Runtime closure root differs.");
    }
    for (const row of array(value.edges, "runtime edges")) {
      exactKeys(
        row,
        ["from", "kind", "specifier", "to", "package"],
        "runtime edge",
      );
      if (!["asset", "import", "main", "require"].includes(row.kind)) {
        throw new Error("LEAK002 Runtime edge kind differs.");
      }
    }
  } else if (name.endsWith(".third-party-licenses.json")) {
    exactKeys(value, ["format", "packages"], "license inventory");
    for (const package_ of array(value.packages, "license packages")) {
      exactKeys(
        package_,
        ["name", "version", "license", "packagePath", "licenseFiles"],
        "license package",
      );
      for (const file of array(package_.licenseFiles, "license files")) {
        exactKeys(file, ["path", "sha256"], "license file");
        if (!hex(file.sha256)) {
          throw new Error("LEAK002 License-file hash differs.");
        }
      }
    }
  } else {
    exactKeys(
      value,
      [
        "format",
        "artifact",
        "sha256",
        "source",
        "builder",
        "isolation",
        "inventories",
      ],
      "build provenance",
    );
    exactKeys(value.source, ["repository", "commit"], "provenance source");
    exactKeys(value.builder, ["os", "arch", "tools"], "provenance builder");
    exactKeys(
      value.builder.tools,
      ["node", "npm", "typescript"],
      "builder tools",
    );
    exactKeys(
      value.isolation,
      [
        "policy",
        "inheritedEnvironment",
        "locale",
        "timezone",
        "sourceDateEpoch",
        "commandSearch",
        "npmConfig",
      ],
      "provenance isolation",
    );
    exactKeys(
      value.isolation.npmConfig,
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
      "provenance npm config",
    );
    exactKeys(
      value.inventories,
      ["firstPartySha256", "thirdPartySourceSha256", "thirdPartyStageSha256"],
      "provenance inventories",
    );
    if (
      value.artifact !== "thermite-cli-0.2.0.tgz" ||
      !hex(value.sha256) ||
      value.source.repository !== "BlackettApplied/ThermiteSchematics" ||
      !/^[0-9a-f]{40}$/u.test(value.source.commit ?? "") ||
      value.builder.os !== "linux" ||
      value.builder.arch !== "x64" ||
      value.builder.tools.node !== "24.11.1" ||
      value.builder.tools.npm !== "11.6.2" ||
      value.builder.tools.typescript !== "5.9.3" ||
      Object.values(value.inventories).some((digest) => !hex(digest))
    ) {
      throw new Error("LEAK002 Build provenance authority differs.");
    }
  }
  return value;
}

function validateSchema(name, bytes) {
  if (RELEASE_NON_TAR_OUTPUT_NAMES.includes(name)) {
    return assertD8Evidence(name, bytes);
  }
  const value = parseCanonicalEvidence(bytes, name);
  if (name.endsWith(".tests.json")) {
    assertCanonicalTestManifest(
      value,
      name === PRODUCER_TEST_FILE ? "producer" : "consumer",
    );
  } else if (name.endsWith(".evidence.json") && name !== RELEASE_GATE_FILE) {
    assertReleaseAcceptanceEvidence(value, {
      producer: name === PRODUCER_EVIDENCE_FILE,
    });
  } else if (name === RELEASE_GATE_FILE) {
    assertReleaseGateEvidence(value);
  } else if (name === RELEASE_GATE_RECEIPT_FILE) {
    assertReleaseGateReceipt(value);
  } else {
    throw new Error(`LEAK002 Unknown evidence schema for ${name}.`);
  }
  return value;
}

const RAW_KEYS =
  /^(?:startTime|endTime|duration|timing|testResults|assertionResults|failureMessages|perfStats)$/u;
const PATH_KEY =
  /(?:^|_)(?:file|path|root|from|to|sourceRoot|stagePath|packagePath)$/iu;

export function assertPortableEvidenceValue(
  value,
  key = "",
  label = "evidence",
) {
  if (typeof value === "string") {
    if (
      /^file:/iu.test(value) ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      /^\\\\/u.test(value) ||
      value.startsWith("/") ||
      (PATH_KEY.test(key) && value.includes("\\"))
    ) {
      throw new Error(
        `LEAK003 Absolute or non-POSIX path leaked into ${label}.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertPortableEvidenceValue(entry, key, label);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      if (RAW_KEYS.test(childKey)) {
        throw new Error(`LEAK003 Raw Vitest/timing key leaked into ${label}.`);
      }
      assertPortableEvidenceValue(child, childKey, label);
    }
  }
}

function sensitiveTokens(additional) {
  const values = [
    process.cwd(),
    ...[
      "GITHUB_WORKSPACE",
      "RUNNER_TEMP",
      "RUNNER_TOOL_CACHE",
      "HOME",
      "USERPROFILE",
      "NPM_CONFIG_CACHE",
      "NPM_CONFIG_USERCONFIG",
      "NPM_CONFIG_GLOBALCONFIG",
      "THERMITE_SCHEMATICS_RELEASE_CANDIDATE",
    ].map((key) => process.env[key]),
    ...additional,
  ].filter((value) => typeof value === "string" && value.length >= 3);
  const tokens = new Set();
  for (const value of values) {
    tokens.add(value);
    tokens.add(value.replaceAll("\\", "/"));
    tokens.add(JSON.stringify(value).slice(1, -1));
    tokens.add(JSON.stringify(value.replaceAll("\\", "/")).slice(1, -1));
  }
  return [...tokens].filter((value) => value.length >= 3);
}

export async function scanReleaseEvidenceFiles(files, { sensitive = [] } = {}) {
  const names = files.map((file) => basename(file));
  assertClosedFilenameList(names);
  const records = new Map();
  for (let index = 0; index < files.length; index += 1) {
    const stats = await lstat(files[index], { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw new Error(
        `LEAK001 Evidence path is not ordinary: ${names[index]}.`,
      );
    }
    const bytes = await readFile(files[index]);
    records.set(names[index], {
      bytes,
      value: validateSchema(names[index], bytes),
    });
  }
  for (const [name, record] of records) {
    if (!name.endsWith(".evidence.json") || name === RELEASE_GATE_FILE)
      continue;
    const tests =
      name === PRODUCER_EVIDENCE_FILE
        ? PRODUCER_TEST_FILE
        : name.replace(".evidence.json", ".tests.json");
    const testRecord = records.get(tests);
    if (testRecord !== undefined) {
      assertReleaseAcceptanceEvidence(record.value, {
        manifestBytes: testRecord.bytes,
        producer: name === PRODUCER_EVIDENCE_FILE,
      });
    }
  }
  const gateRecord = records.get(RELEASE_GATE_FILE);
  if (gateRecord !== undefined) {
    for (const name of RELEASE_NON_TAR_OUTPUT_NAMES) {
      const evidence = records.get(name);
      if (evidence === undefined) continue;
      const content = gateRecord.value.payload.contentFiles.find(
        (file) => file.path === name,
      );
      if (
        content?.size !== evidence.bytes.length ||
        content.sha256 !==
          createHash("sha256").update(evidence.bytes).digest("hex")
      ) {
        throw new Error(`LEAK002 Gate content-file hash differs for ${name}.`);
      }
    }
    const producer = records.get(PRODUCER_EVIDENCE_FILE);
    if (
      producer !== undefined &&
      gateRecord.value.producerEvidence.sha256 !==
        createHash("sha256").update(producer.bytes).digest("hex")
    ) {
      throw new Error("LEAK002 Gate producer-evidence hash differs.");
    }
    for (const row of gateRecord.value.acceptanceEvidence) {
      const acceptance = records.get(row.file);
      if (
        acceptance !== undefined &&
        row.sha256 !==
          createHash("sha256").update(acceptance.bytes).digest("hex")
      ) {
        throw new Error("LEAK002 Gate acceptance-evidence hash differs.");
      }
    }
  }
  const receipt = records.get(RELEASE_GATE_RECEIPT_FILE)?.value;
  if (
    receipt !== undefined &&
    gateRecord !== undefined &&
    receipt.aggregateEvidence.sha256 !==
      createHash("sha256").update(gateRecord.bytes).digest("hex")
  ) {
    throw new Error("LEAK002 Receipt aggregate-evidence hash differs.");
  }
  const tokens = sensitiveTokens(sensitive);
  for (const [name, record] of records) {
    if (record.value !== undefined)
      assertPortableEvidenceValue(record.value, "", name);
    const text = record.bytes.toString("utf8");
    if (
      RAW_NAMES.some((raw) => text.includes(raw)) ||
      /(?:\/opt\/hostedtoolcache|RUNNER_TEMP|GITHUB_WORKSPACE|NODE_OPTIONS|NODE_PATH)/u.test(
        text,
      ) ||
      tokens.some((token) => text.includes(token))
    ) {
      throw new Error(
        `LEAK003 Runtime path, environment, or raw evidence leaked into ${name}.`,
      );
    }
  }
  return names;
}

function parseArguments(argv) {
  if (argv.length < 2 || argv[0] !== "--files") {
    throw new Error(
      "Usage: node scripts/scan-release-evidence-leaks.mjs --files <exact-files...> [--sensitive-value <value>]...",
    );
  }
  const files = [];
  const sensitive = [];
  let index = 1;
  while (index < argv.length && argv[index] !== "--sensitive-value") {
    files.push(argv[index]);
    index += 1;
  }
  while (index < argv.length) {
    if (argv[index] !== "--sensitive-value" || argv[index + 1] === undefined) {
      throw new Error("LEAK000 Invalid sensitive-value argument.");
    }
    sensitive.push(argv[index + 1]);
    index += 2;
  }
  return { files, sensitive };
}

async function main(argv) {
  const arguments_ = parseArguments(argv);
  await scanReleaseEvidenceFiles(arguments_.files, arguments_);
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
