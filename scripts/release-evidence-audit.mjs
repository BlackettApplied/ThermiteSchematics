import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  createCandidateAuthority,
  normalizeArtifactDigest,
} from "./download-actions-artifact.mjs";

export const RELEASE_REPOSITORY = "BlackettApplied/ThermiteSchematics";
export const RELEASE_WORKFLOW_NAME = "M8 Release Candidate";
export const RELEASE_WORKFLOW_PATH = ".github/workflows/release-candidate.yml";
export const RELEASE_ARTIFACT = "thermite-cli-0.2.0.tgz";
export const RELEASE_OUTPUT_NAMES = Object.freeze([
  RELEASE_ARTIFACT,
  `${RELEASE_ARTIFACT}.sha256`,
  "thermite-cli-0.2.0.tar-headers.json",
  "thermite-cli-0.2.0.stage-files.json",
  "thermite-cli-0.2.0.runtime-closure.json",
  "thermite-cli-0.2.0.third-party-licenses.json",
  "thermite-cli-0.2.0.build-provenance.json",
]);
export const RELEASE_NON_TAR_OUTPUT_NAMES = Object.freeze(
  RELEASE_OUTPUT_NAMES.slice(1),
);
export const RELEASE_JOB_NAMES = Object.freeze([
  "release_candidate",
  "acceptance (ubuntu-24.04, 22.12.0)",
  "acceptance (ubuntu-24.04, 24.11.1)",
  "acceptance (windows-2022, 22.12.0)",
  "acceptance (windows-2022, 24.11.1)",
  "release_gate",
]);

function identifier(file, name) {
  return Object.freeze({ file, name });
}

export const TASK2_REQUIRED_TEST_LEDGERS = Object.freeze({
  "package-smoke": Object.freeze([
    identifier(
      "packages/compiler/test/package-smoke.test.ts",
      "packed schema, core-library, compiler, query, render, agent-tools, and CLI packages > install together and expose initial agent contracts plus existing APIs and CLI commands",
    ),
  ]),
  "agent-motor-starter": Object.freeze([
    identifier(
      "packages/cli/test/agent-motor-starter-golden.test.ts",
      "M7 Task 8 motor-starter agent product workflow > repeats every frozen workflow step through fresh built CLI processes",
    ),
  ]),
  "task4-ledger": Object.freeze([
    identifier(
      "packages/render/test/determinism.test.ts",
      "D8 end-to-end determinism > matches both complete source-state matrices in two fresh Node processes",
    ),
    identifier(
      "packages/cli/test/render-cli.test.ts",
      "M5 Task 8 render warnings, expected failures, and tool boundaries > locks the Tier 2 view CLI human and JSON R004 product bytes end to end",
    ),
    identifier(
      "packages/cli/test/render-cli.test.ts",
      "M6 Task 6 view subprocess stream and exit matrix > preserves every D9 row in a fresh process",
    ),
    identifier(
      "packages/cli/test/render-cli.test.ts",
      "M5 Task 8 subprocess boundaries > preserves every Q/R stream shape and raw-code-unit identity in a fresh process",
    ),
    identifier(
      "packages/cli/test/render-cli.test.ts",
      "M5 Task 8 subprocess boundaries > preserves compiler failures and end-of-options parsing in fresh processes",
    ),
    identifier(
      "packages/cli/test/render-motor-starter-golden.test.ts",
      "M5 Task 8 and M6 Task 6 reviewed schematic CLI goldens > matches both split-stream goldens across repeated fresh CLI processes",
    ),
    identifier(
      "packages/cli/test/render-motor-starter-golden.test.ts",
      "M6 amended Task 7 reviewed PNP schematic CLI goldens > matches the four PNP split-stream goldens across repeated fresh CLI processes",
    ),
    identifier(
      "packages/cli/test/agent-motor-starter-golden.test.ts",
      "M7 Task 8 motor-starter agent product workflow > repeats every frozen workflow step through fresh built CLI processes",
    ),
  ]),
  "release-install": Object.freeze([
    identifier(
      "packages/cli/test/release-install-smoke.test.ts",
      "shared release candidate offline install > installs the injected downloaded candidate without registry or lifecycle execution",
    ),
  ]),
  "empty-folder": Object.freeze([
    identifier(
      "packages/cli/test/empty-folder-smoke.test.ts",
      "installed empty-folder release workflow > runs the complete workflow twice against the injected downloaded candidate",
    ),
  ]),
});

export function requiredTestsForLedgers(names) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error("At least one release-evidence ledger is required.");
  }
  const seen = new Set();
  const rows = [];
  for (const name of names) {
    if (typeof name !== "string" || name === "" || seen.has(name)) {
      throw new Error(
        `Invalid or duplicate release-evidence ledger ${JSON.stringify(name)}.`,
      );
    }
    seen.add(name);
    const ledger = TASK2_REQUIRED_TEST_LEDGERS[name];
    if (ledger === undefined) {
      throw new Error(
        `Unknown release-evidence ledger ${JSON.stringify(name)}.`,
      );
    }
    rows.push(...ledger);
  }
  return Object.freeze(rows);
}

export const RELEASE_REQUIRED_TESTS = Object.freeze(
  requiredTestsForLedgers([
    "task4-ledger",
    "package-smoke",
    "release-install",
    "empty-folder",
  ]),
);

export const PRODUCER_TEST_FILE =
  "producer-ubuntu-24.04-node-24.11.1.tests.json";
export const PRODUCER_EVIDENCE_FILE =
  "producer-ubuntu-24.04-node-24.11.1.evidence.json";
export const RELEASE_GATE_FILE = "release-gate.evidence.json";
export const RELEASE_GATE_RECEIPT_FILE = "release-gate-receipt.json";
export const ACCEPTANCE_LEGS = Object.freeze(
  [
    ["ubuntu-24.04", "22.12.0"],
    ["ubuntu-24.04", "24.11.1"],
    ["windows-2022", "22.12.0"],
    ["windows-2022", "24.11.1"],
  ].map(([os, node]) =>
    Object.freeze({
      os,
      node,
      tests: `acceptance-${os}-node-${node}.tests.json`,
      evidence: `acceptance-${os}-node-${node}.evidence.json`,
    }),
  ),
);
export const RELEASE_EVIDENCE_PAIR_FILES = Object.freeze([
  PRODUCER_TEST_FILE,
  PRODUCER_EVIDENCE_FILE,
  ...ACCEPTANCE_LEGS.flatMap((leg) => [leg.tests, leg.evidence]),
]);

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function evidenceSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function serializeEvidence(value) {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

function assertExactKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) {
    throw new Error(
      `EVID001 ${label} has unknown, missing, or reordered keys.`,
    );
  }
}

function assertDecimal(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`EVID001 ${label} must be an unsigned nonzero decimal.`);
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertReleaseGateRunObservation(observation) {
  assertExactKeys(
    observation,
    [
      "event",
      "headBranch",
      "headSha",
      "path",
      "runAttempt",
      "status",
      "conclusion",
    ],
    "release gate run observation",
  );
  if (
    observation.event !== "push" ||
    observation.headBranch !== "dev" ||
    !/^[0-9a-f]{40}$/u.test(observation.headSha ?? "") ||
    observation.path !== RELEASE_WORKFLOW_PATH ||
    !Number.isSafeInteger(observation.runAttempt) ||
    observation.runAttempt < 1 ||
    observation.status !== "in_progress" ||
    (observation.conclusion !== null &&
      typeof observation.conclusion !== "string")
  ) {
    throw new Error("EVID004 Release gate run observation is invalid.");
  }
  return observation;
}

export function assertReleaseGateJobObservations(
  observations,
  { requireGateSuccess = false } = {},
) {
  if (!Array.isArray(observations)) {
    throw new Error("EVID004 Release gate job observations are invalid.");
  }
  const expectedNames = [...RELEASE_JOB_NAMES].sort(compareCodeUnits);
  const names = [];
  const ids = new Set();
  let previousName;
  for (const observation of observations) {
    assertExactKeys(
      observation,
      ["name", "id", "status", "conclusion"],
      "release gate job observation",
    );
    assertDecimal(observation.id, "release gate job ID");
    if (
      !RELEASE_JOB_NAMES.includes(observation.name) ||
      ids.has(observation.id) ||
      typeof observation.status !== "string" ||
      (observation.conclusion !== null &&
        typeof observation.conclusion !== "string") ||
      (previousName !== undefined &&
        compareCodeUnits(previousName, observation.name) >= 0) ||
      ((requireGateSuccess || observation.name !== "release_gate") &&
        (observation.status !== "completed" ||
          observation.conclusion !== "success"))
    ) {
      throw new Error("EVID004 Release gate job observations are invalid.");
    }
    names.push(observation.name);
    ids.add(observation.id);
    previousName = observation.name;
  }
  if (!same(names, expectedNames)) {
    throw new Error("EVID004 Release gate job topology differs.");
  }
  return observations;
}

function assertGateObservationsMatchAuthority(gateRun, authority) {
  assertReleaseGateRunObservation(gateRun);
  if (
    gateRun.event !== authority.workflow.event ||
    gateRun.headBranch !== "dev" ||
    gateRun.headSha !== authority.sourceCommit ||
    gateRun.path !== authority.workflow.path ||
    gateRun.runAttempt !== authority.workflow.runAttempt
  ) {
    throw new Error("EVID004 Gate run and release authority differ.");
  }
}

export function parseCanonicalEvidence(bytes, label) {
  const text = Buffer.from(bytes).toString("utf8");
  if (
    !Buffer.from(text, "utf8").equals(Buffer.from(bytes)) ||
    !text.endsWith("\n") ||
    text.endsWith("\n\n") ||
    text.includes("\r")
  ) {
    throw new Error(`EVID001 ${label} is not canonical UTF-8 JSON.`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`EVID001 ${label} is invalid JSON.`);
  }
  if (serializeEvidence(value) !== text) {
    throw new Error(`EVID001 ${label} has noncanonical JSON bytes.`);
  }
  return value;
}

export async function readCanonicalEvidence(path, label = path) {
  return parseCanonicalEvidence(await readFile(path), label);
}

export function assertReleaseAuthority(authority) {
  assertExactKeys(
    authority,
    ["repository", "sourceCommit", "workflow", "candidateArtifact"],
    "release authority",
  );
  assertExactKeys(
    authority.workflow,
    ["name", "path", "runId", "runAttempt", "event", "ref"],
    "release workflow authority",
  );
  assertExactKeys(
    authority.candidateArtifact,
    ["name", "id", "digest"],
    "candidate artifact authority",
  );
  assertDecimal(authority.workflow.runId, "workflow run ID");
  assertDecimal(authority.candidateArtifact.id, "candidate artifact ID");
  if (
    authority.repository !== RELEASE_REPOSITORY ||
    !/^[0-9a-f]{40}$/u.test(authority.sourceCommit ?? "") ||
    authority.workflow.name !== RELEASE_WORKFLOW_NAME ||
    authority.workflow.path !== RELEASE_WORKFLOW_PATH ||
    !Number.isSafeInteger(authority.workflow.runAttempt) ||
    authority.workflow.runAttempt < 1 ||
    authority.workflow.event !== "push" ||
    authority.workflow.ref !== "refs/heads/dev" ||
    authority.candidateArtifact.name !==
      `m8-cli-candidate-${authority.workflow.runId}-${authority.workflow.runAttempt}` ||
    !/^sha256:[0-9a-f]{64}$/u.test(authority.candidateArtifact.digest ?? "")
  ) {
    throw new Error(
      "EVID001 Release authority differs from the frozen contract.",
    );
  }
  return authority;
}

function identifierKey(row) {
  return `${row.file}\u0000${row.name}`;
}

const REQUIRED_KEYS = new Set(RELEASE_REQUIRED_TESTS.map(identifierKey));
const CANDIDATE_KEYS = new Set(
  requiredTestsForLedgers(["release-install", "empty-folder"]).map(
    identifierKey,
  ),
);

export function assertCanonicalTestManifest(manifest, mode) {
  assertExactKeys(manifest, ["format", "tests"], "canonical test manifest");
  if (
    manifest.format !== "thermite-schematics-audited-tests/0.1" ||
    !Array.isArray(manifest.tests) ||
    (mode !== "producer" && mode !== "consumer")
  ) {
    throw new Error("EVID002 Canonical test manifest has an invalid shape.");
  }
  const seen = new Set();
  let previous;
  for (const row of manifest.tests) {
    assertExactKeys(row, ["identifier", "outcome"], "canonical test row");
    assertExactKeys(row.identifier, ["file", "name"], "test identifier");
    const key = identifierKey(row.identifier);
    if (
      typeof row.identifier.file !== "string" ||
      typeof row.identifier.name !== "string" ||
      !REQUIRED_KEYS.has(key) ||
      seen.has(key) ||
      (previous !== undefined && compareCodeUnits(previous, key) >= 0)
    ) {
      throw new Error(
        "EVID002 Canonical test identifiers are incomplete or unordered.",
      );
    }
    seen.add(key);
    previous = key;
    if (CANDIDATE_KEYS.has(key)) {
      assertExactKeys(
        row.outcome,
        ["status", "authorityClassifier", "branch"],
        "candidate test outcome",
      );
      const expectedClassifier =
        mode === "producer"
          ? "local-task6-complete"
          : "protected-consumer-complete";
      if (
        row.outcome.status !== "passed" ||
        row.outcome.authorityClassifier !== expectedClassifier ||
        row.outcome.branch !== "RELEASE-CANDIDATE-INJECTED"
      ) {
        throw new Error("EVID002 Candidate runtime branch proof is invalid.");
      }
    } else {
      assertExactKeys(row.outcome, ["status"], "test outcome");
      if (row.outcome.status !== "passed") {
        throw new Error("EVID002 A required release test did not pass.");
      }
    }
  }
  if (seen.size !== REQUIRED_KEYS.size) {
    throw new Error(
      "EVID002 Canonical test manifest is missing a required row.",
    );
  }
  return manifest;
}

function expectedLegFiles(os, node) {
  const leg = ACCEPTANCE_LEGS.find(
    (candidate) => candidate.os === os && candidate.node === node,
  );
  if (leg === undefined) throw new Error("EVID003 Unknown release matrix leg.");
  return leg;
}

export function createReleaseAcceptanceEvidence({
  authority,
  os,
  node,
  candidateSha256,
  source,
  testManifestFile,
  testManifestBytes,
}) {
  assertReleaseAuthority(authority);
  const producer = source === "pinned-producer";
  const expected = producer
    ? { tests: PRODUCER_TEST_FILE }
    : expectedLegFiles(os, node);
  if (
    (source !== "pinned-producer" &&
      source !== "downloaded-m8-cli-candidate") ||
    !/^[0-9a-f]{64}$/u.test(candidateSha256 ?? "") ||
    basename(testManifestFile) !== expected.tests
  ) {
    throw new Error("EVID003 Acceptance evidence inputs are invalid.");
  }
  assertCanonicalTestManifest(
    parseCanonicalEvidence(testManifestBytes, expected.tests),
    producer ? "producer" : "consumer",
  );
  return {
    format: "thermite-schematics-release-acceptance-evidence/0.2",
    authority,
    leg: { os, node },
    candidate: {
      file: RELEASE_ARTIFACT,
      sha256: candidateSha256,
      source,
    },
    testManifest: {
      file: expected.tests,
      sha256: evidenceSha256(testManifestBytes),
    },
    denied: [],
  };
}

export function assertReleaseAcceptanceEvidence(
  evidence,
  { manifestBytes, producer = false } = {},
) {
  assertExactKeys(
    evidence,
    ["format", "authority", "leg", "candidate", "testManifest", "denied"],
    "acceptance evidence",
  );
  assertReleaseAuthority(evidence.authority);
  assertExactKeys(evidence.leg, ["os", "node"], "acceptance leg");
  assertExactKeys(
    evidence.candidate,
    ["file", "sha256", "source"],
    "acceptance candidate",
  );
  assertExactKeys(
    evidence.testManifest,
    ["file", "sha256"],
    "acceptance test manifest",
  );
  const expected = producer
    ? { os: "ubuntu-24.04", node: "24.11.1", tests: PRODUCER_TEST_FILE }
    : expectedLegFiles(evidence.leg.os, evidence.leg.node);
  if (
    evidence.format !== "thermite-schematics-release-acceptance-evidence/0.2" ||
    evidence.leg.os !== expected.os ||
    evidence.leg.node !== expected.node ||
    evidence.candidate.file !== RELEASE_ARTIFACT ||
    !/^[0-9a-f]{64}$/u.test(evidence.candidate.sha256 ?? "") ||
    evidence.candidate.source !==
      (producer ? "pinned-producer" : "downloaded-m8-cli-candidate") ||
    evidence.testManifest.file !== expected.tests ||
    !/^[0-9a-f]{64}$/u.test(evidence.testManifest.sha256 ?? "") ||
    !Array.isArray(evidence.denied) ||
    evidence.denied.length !== 0
  ) {
    throw new Error(
      "EVID003 Acceptance evidence differs from the frozen schema.",
    );
  }
  if (manifestBytes !== undefined) {
    assertCanonicalTestManifest(
      parseCanonicalEvidence(manifestBytes, evidence.testManifest.file),
      producer ? "producer" : "consumer",
    );
    if (evidenceSha256(manifestBytes) !== evidence.testManifest.sha256) {
      throw new Error("EVID003 Acceptance test-manifest hash differs.");
    }
  }
  return evidence;
}

async function readEvidencePair(root, tests, evidenceFile, producer) {
  const [testBytes, evidenceBytes] = await Promise.all([
    readFile(join(root, tests)),
    readFile(join(root, evidenceFile)),
  ]);
  const evidence = assertReleaseAcceptanceEvidence(
    parseCanonicalEvidence(evidenceBytes, evidenceFile),
    { manifestBytes: testBytes, producer },
  );
  return { testBytes, evidenceBytes, evidence };
}

function payloadManifestSha(contentFiles) {
  return evidenceSha256(Buffer.from(serializeEvidence(contentFiles), "utf8"));
}

async function readContentFiles(root) {
  const files = [];
  for (const path of RELEASE_OUTPUT_NAMES) {
    const bytes = await readFile(join(root, path));
    files.push({
      path,
      size: bytes.length,
      sha256: evidenceSha256(bytes),
    });
  }
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  return files;
}

export async function createReleaseGateEvidence({
  productRoot,
  evidenceRoot,
  payloadArtifactName,
  evidenceFiles = RELEASE_EVIDENCE_PAIR_FILES,
  gateRun,
  gateJobs,
}) {
  if (!same(evidenceFiles, RELEASE_EVIDENCE_PAIR_FILES)) {
    throw new Error("EVID004 Gate evidence input manifest differs.");
  }
  const producerPair = await readEvidencePair(
    evidenceRoot,
    PRODUCER_TEST_FILE,
    PRODUCER_EVIDENCE_FILE,
    true,
  );
  const authority = producerPair.evidence.authority;
  const candidateSha256 = producerPair.evidence.candidate.sha256;
  assertGateObservationsMatchAuthority(gateRun, authority);
  assertReleaseGateJobObservations(gateJobs);
  const acceptanceEvidence = [];
  for (const leg of ACCEPTANCE_LEGS) {
    const pair = await readEvidencePair(
      evidenceRoot,
      leg.tests,
      leg.evidence,
      false,
    );
    if (
      !same(pair.evidence.authority, authority) ||
      pair.evidence.candidate.sha256 !== candidateSha256
    ) {
      throw new Error(
        "EVID004 Matrix evidence does not share one authority and tar.",
      );
    }
    acceptanceEvidence.push({
      os: leg.os,
      node: leg.node,
      file: leg.evidence,
      sha256: evidenceSha256(pair.evidenceBytes),
    });
  }
  const expectedPayloadName =
    `m8-release-gate-payload-${authority.workflow.runId}-` +
    `${authority.workflow.runAttempt}`;
  if (payloadArtifactName !== expectedPayloadName) {
    throw new Error("EVID004 Gate payload artifact name is invalid.");
  }
  const contentFiles = await readContentFiles(productRoot);
  const contentByName = new Map(contentFiles.map((file) => [file.path, file]));
  if (contentByName.get(RELEASE_ARTIFACT)?.sha256 !== candidateSha256) {
    throw new Error(
      "EVID004 Gate payload tar differs from acceptance evidence.",
    );
  }
  const provenanceBytes = await readFile(
    join(productRoot, "thermite-cli-0.2.0.build-provenance.json"),
  );
  const provenance = parseCanonicalEvidence(
    provenanceBytes,
    "thermite-cli-0.2.0.build-provenance.json",
  );
  if (
    provenance?.source?.repository !== RELEASE_REPOSITORY ||
    provenance?.source?.commit !== authority.sourceCommit ||
    provenance?.sha256 !== candidateSha256
  ) {
    throw new Error("EVID004 Build provenance differs from release authority.");
  }
  const shaFile = contentByName.get(`${RELEASE_ARTIFACT}.sha256`);
  return {
    format: "thermite-schematics-release-gate-evidence/0.1",
    authority,
    gateRun,
    gateJobs,
    candidate: {
      file: RELEASE_ARTIFACT,
      sha256: candidateSha256,
      buildProvenanceSha256: evidenceSha256(provenanceBytes),
    },
    producerEvidence: {
      file: PRODUCER_EVIDENCE_FILE,
      sha256: evidenceSha256(producerPair.evidenceBytes),
    },
    acceptanceEvidence,
    releaseAssets: [
      { file: RELEASE_ARTIFACT, sha256: candidateSha256 },
      { file: `${RELEASE_ARTIFACT}.sha256`, sha256: shaFile.sha256 },
    ],
    payload: {
      artifactName: payloadArtifactName,
      contentFiles,
      manifestSha256: payloadManifestSha(contentFiles),
    },
  };
}

export function assertReleaseGateEvidence(gate) {
  assertExactKeys(
    gate,
    [
      "format",
      "authority",
      "gateRun",
      "gateJobs",
      "candidate",
      "producerEvidence",
      "acceptanceEvidence",
      "releaseAssets",
      "payload",
    ],
    "release gate evidence",
  );
  assertReleaseAuthority(gate.authority);
  assertGateObservationsMatchAuthority(gate.gateRun, gate.authority);
  assertReleaseGateJobObservations(gate.gateJobs);
  assertExactKeys(
    gate.candidate,
    ["file", "sha256", "buildProvenanceSha256"],
    "gate candidate",
  );
  assertExactKeys(
    gate.producerEvidence,
    ["file", "sha256"],
    "gate producer evidence",
  );
  assertExactKeys(
    gate.payload,
    ["artifactName", "contentFiles", "manifestSha256"],
    "gate payload",
  );
  if (
    gate.format !== "thermite-schematics-release-gate-evidence/0.1" ||
    gate.candidate.file !== RELEASE_ARTIFACT ||
    gate.producerEvidence.file !== PRODUCER_EVIDENCE_FILE ||
    !/^[0-9a-f]{64}$/u.test(gate.candidate.sha256 ?? "") ||
    !/^[0-9a-f]{64}$/u.test(gate.candidate.buildProvenanceSha256 ?? "") ||
    !/^[0-9a-f]{64}$/u.test(gate.producerEvidence.sha256 ?? "") ||
    gate.payload.artifactName !==
      `m8-release-gate-payload-${gate.authority.workflow.runId}-${gate.authority.workflow.runAttempt}` ||
    !Array.isArray(gate.payload.contentFiles) ||
    gate.payload.manifestSha256 !==
      payloadManifestSha(gate.payload.contentFiles)
  ) {
    throw new Error("EVID004 Release gate evidence is invalid.");
  }
  const expectedPaths = [...RELEASE_OUTPUT_NAMES].sort(compareCodeUnits);
  const observedPaths = [];
  for (const file of gate.payload.contentFiles) {
    assertExactKeys(file, ["path", "size", "sha256"], "payload content file");
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[0-9a-f]{64}$/u.test(file.sha256 ?? "")
    ) {
      throw new Error("EVID004 Payload content-file record is invalid.");
    }
    observedPaths.push(file.path);
  }
  if (!same(observedPaths, expectedPaths)) {
    throw new Error("EVID004 Payload content-file set differs.");
  }
  if (
    !Array.isArray(gate.acceptanceEvidence) ||
    gate.acceptanceEvidence.length !== ACCEPTANCE_LEGS.length
  ) {
    throw new Error("EVID004 Acceptance evidence list is absent.");
  }
  for (let index = 0; index < ACCEPTANCE_LEGS.length; index += 1) {
    const row = gate.acceptanceEvidence[index];
    const leg = ACCEPTANCE_LEGS[index];
    assertExactKeys(
      row,
      ["os", "node", "file", "sha256"],
      "gate acceptance row",
    );
    if (
      row.os !== leg.os ||
      row.node !== leg.node ||
      row.file !== leg.evidence ||
      !/^[0-9a-f]{64}$/u.test(row.sha256 ?? "")
    ) {
      throw new Error("EVID004 Gate acceptance matrix differs.");
    }
  }
  if (!Array.isArray(gate.releaseAssets) || gate.releaseAssets.length !== 2) {
    throw new Error("EVID004 Release asset tuple is invalid.");
  }
  for (let index = 0; index < gate.releaseAssets.length; index += 1) {
    const asset = gate.releaseAssets[index];
    assertExactKeys(asset, ["file", "sha256"], "release asset");
    const expectedName =
      index === 0 ? RELEASE_ARTIFACT : `${RELEASE_ARTIFACT}.sha256`;
    if (
      asset.file !== expectedName ||
      !/^[0-9a-f]{64}$/u.test(asset.sha256 ?? "")
    ) {
      throw new Error("EVID004 Release asset tuple differs.");
    }
  }
  return gate;
}

export function createReleaseGateReceipt({ gateBytes, gate, artifact }) {
  assertReleaseGateEvidence(gate);
  if (
    artifact?.name !== gate.payload.artifactName ||
    !Number.isSafeInteger(artifact?.id) ||
    artifact.id < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(artifact?.digest ?? "")
  ) {
    throw new Error("EVID005 Payload artifact metadata is invalid.");
  }
  return {
    format: "thermite-schematics-release-gate-receipt/0.1",
    repository: RELEASE_REPOSITORY,
    sourceCommit: gate.authority.sourceCommit,
    workflow: gate.authority.workflow,
    gateRun: gate.gateRun,
    gateJobs: gate.gateJobs,
    payloadArtifact: {
      name: artifact.name,
      id: String(artifact.id),
      digest: artifact.digest,
    },
    aggregateEvidence: {
      file: RELEASE_GATE_FILE,
      sha256: evidenceSha256(gateBytes),
    },
  };
}

export function assertReleaseGateReceipt(receipt) {
  assertExactKeys(
    receipt,
    [
      "format",
      "repository",
      "sourceCommit",
      "workflow",
      "gateRun",
      "gateJobs",
      "payloadArtifact",
      "aggregateEvidence",
    ],
    "release gate receipt",
  );
  assertReleaseGateRunObservation(receipt.gateRun);
  assertReleaseGateJobObservations(receipt.gateJobs);
  assertExactKeys(
    receipt.workflow,
    ["name", "path", "runId", "runAttempt", "event", "ref"],
    "receipt workflow",
  );
  assertExactKeys(
    receipt.payloadArtifact,
    ["name", "id", "digest"],
    "receipt payload artifact",
  );
  assertExactKeys(
    receipt.aggregateEvidence,
    ["file", "sha256"],
    "receipt aggregate evidence",
  );
  assertDecimal(receipt.workflow?.runId, "receipt workflow run ID");
  assertDecimal(receipt.payloadArtifact.id, "payload artifact ID");
  if (
    receipt.format !== "thermite-schematics-release-gate-receipt/0.1" ||
    receipt.repository !== RELEASE_REPOSITORY ||
    !/^[0-9a-f]{40}$/u.test(receipt.sourceCommit ?? "") ||
    receipt.workflow?.name !== RELEASE_WORKFLOW_NAME ||
    receipt.workflow?.path !== RELEASE_WORKFLOW_PATH ||
    !Number.isSafeInteger(receipt.workflow?.runAttempt) ||
    receipt.workflow.runAttempt < 1 ||
    receipt.workflow.event !== "push" ||
    receipt.workflow.ref !== "refs/heads/dev" ||
    receipt.gateRun.event !== receipt.workflow.event ||
    receipt.gateRun.headBranch !== "dev" ||
    receipt.gateRun.headSha !== receipt.sourceCommit ||
    receipt.gateRun.path !== receipt.workflow.path ||
    receipt.gateRun.runAttempt !== receipt.workflow.runAttempt ||
    receipt.payloadArtifact.name !==
      `m8-release-gate-payload-${receipt.workflow.runId}-${receipt.workflow.runAttempt}` ||
    !/^sha256:[0-9a-f]{64}$/u.test(receipt.payloadArtifact.digest ?? "") ||
    receipt.aggregateEvidence.file !== RELEASE_GATE_FILE ||
    !/^[0-9a-f]{64}$/u.test(receipt.aggregateEvidence.sha256 ?? "")
  ) {
    throw new Error(
      "EVID005 Release gate receipt differs from the frozen schema.",
    );
  }
  return receipt;
}

export async function verifyReleaseGatePayload({ payloadRoot, receipt }) {
  assertReleaseGateReceipt(receipt);
  const gateBytes = await readFile(join(payloadRoot, RELEASE_GATE_FILE));
  if (evidenceSha256(gateBytes) !== receipt.aggregateEvidence.sha256) {
    throw new Error("EVID006 Aggregate evidence hash differs from receipt.");
  }
  const gate = assertReleaseGateEvidence(
    parseCanonicalEvidence(gateBytes, RELEASE_GATE_FILE),
  );
  if (
    gate.authority.repository !== receipt.repository ||
    gate.authority.sourceCommit !== receipt.sourceCommit ||
    !same(gate.authority.workflow, receipt.workflow) ||
    !same(gate.gateRun, receipt.gateRun) ||
    !same(gate.gateJobs, receipt.gateJobs) ||
    gate.payload.artifactName !== receipt.payloadArtifact.name
  ) {
    throw new Error("EVID006 Gate evidence and receipt authority differ.");
  }
  const contentFiles = await readContentFiles(payloadRoot);
  if (!same(contentFiles, gate.payload.contentFiles)) {
    throw new Error(
      "EVID006 Gate payload bytes differ from its content manifest.",
    );
  }
  const tarBytes = await readFile(join(payloadRoot, RELEASE_ARTIFACT));
  const shaBytes = await readFile(
    join(payloadRoot, `${RELEASE_ARTIFACT}.sha256`),
  );
  if (
    evidenceSha256(tarBytes) !== gate.candidate.sha256 ||
    shaBytes.toString("utf8") !==
      `${gate.candidate.sha256}  ${RELEASE_ARTIFACT}\n`
  ) {
    throw new Error("EVID006 Gate tar and SHA file differ.");
  }
  const provenanceBytes = await readFile(
    join(payloadRoot, "thermite-cli-0.2.0.build-provenance.json"),
  );
  const provenance = parseCanonicalEvidence(
    provenanceBytes,
    "thermite-cli-0.2.0.build-provenance.json",
  );
  if (
    evidenceSha256(provenanceBytes) !== gate.candidate.buildProvenanceSha256 ||
    provenance?.source?.repository !== RELEASE_REPOSITORY ||
    provenance?.source?.commit !== receipt.sourceCommit ||
    provenance?.sha256 !== gate.candidate.sha256
  ) {
    throw new Error("EVID006 Gate build provenance differs.");
  }
  return { gate, gateBytes, contentFiles, tarBytes, shaBytes, provenance };
}

async function githubJson(path, token, request = fetch) {
  const response = await request(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(
      `EVID007 GitHub API request failed with ${response.status}.`,
    );
  }
  return response.json();
}

async function queryArtifact({
  artifactId,
  artifactName,
  digest,
  runId,
  token,
  request = fetch,
}) {
  assertDecimal(artifactId, "artifact ID");
  const artifact = await githubJson(
    `/repos/${RELEASE_REPOSITORY}/actions/artifacts/${artifactId}`,
    token,
    request,
  );
  if (
    String(artifact?.id) !== artifactId ||
    artifact?.name !== artifactName ||
    artifact?.expired !== false ||
    String(artifact?.workflow_run?.id) !== runId ||
    !/^sha256:[0-9a-f]{64}$/u.test(artifact?.digest ?? "") ||
    normalizeArtifactDigest(digest) !==
      normalizeArtifactDigest(artifact.digest, "prefixed")
  ) {
    throw new Error(
      "EVID007 Uploaded artifact differs from its REST authority.",
    );
  }
  return artifact;
}

function createReleaseGateRunObservation(run, authority) {
  if (
    String(run?.id) !== authority.workflow.runId ||
    run?.name !== RELEASE_WORKFLOW_NAME ||
    run?.path !== RELEASE_WORKFLOW_PATH ||
    run?.event !== "push" ||
    run?.head_branch !== "dev" ||
    run?.head_sha !== authority.sourceCommit ||
    run?.run_attempt !== authority.workflow.runAttempt ||
    run?.status !== "in_progress" ||
    !Object.hasOwn(run ?? {}, "conclusion") ||
    (run.conclusion !== null && typeof run.conclusion !== "string")
  ) {
    throw new Error(
      "EVID007 Candidate workflow run is not in-progress gate authority.",
    );
  }
  return assertReleaseGateRunObservation({
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    path: run.path,
    runAttempt: run.run_attempt,
    status: run.status,
    conclusion: run.conclusion,
  });
}

function currentAttemptJobObservations(jobs, runAttempt, requireGateSuccess) {
  const observations = jobs
    .filter((job) => job?.run_attempt === runAttempt)
    .map((job) => {
      if (!Number.isSafeInteger(job?.id) || job.id < 1) {
        throw new Error("EVID007 Actions job ID is not a positive integer.");
      }
      return {
        name: job.name,
        id: String(job.id),
        status: job.status,
        conclusion: job.conclusion,
      };
    })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  return assertReleaseGateJobObservations(observations, {
    requireGateSuccess,
  });
}

export async function queryReleaseWorkflowJobs({
  runId,
  runAttempt,
  token,
  request = fetch,
  requireGateSuccess = false,
}) {
  assertDecimal(runId, "workflow run ID");
  if (
    !Number.isSafeInteger(runAttempt) ||
    runAttempt < 1 ||
    typeof token !== "string" ||
    token === ""
  ) {
    throw new Error("EVID007 Workflow jobs query authority is invalid.");
  }
  const jobs = [];
  let totalCount;
  for (let page = 1; ; page += 1) {
    const path =
      "/repos/" +
      RELEASE_REPOSITORY +
      "/actions/runs/" +
      runId +
      "/jobs?filter=all&per_page=100&page=" +
      page;
    const result = await githubJson(path, token, request);
    if (
      !Number.isSafeInteger(result?.total_count) ||
      result.total_count < 0 ||
      !Array.isArray(result.jobs) ||
      (totalCount !== undefined && result.total_count !== totalCount)
    ) {
      throw new Error("EVID007 Actions jobs response is invalid.");
    }
    totalCount = result.total_count;
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
  }
  if (jobs.length !== totalCount) {
    throw new Error("EVID007 Actions jobs pagination is incomplete.");
  }
  return currentAttemptJobObservations(jobs, runAttempt, requireGateSuccess);
}

export async function queryInProgressReleaseGateAuthority(
  authority,
  { token, request = fetch } = {},
) {
  assertReleaseAuthority(authority);
  if (typeof token !== "string" || token === "") {
    throw new Error("EVID007 GitHub token is required for gate authority.");
  }
  const run = await githubJson(
    `/repos/${RELEASE_REPOSITORY}/actions/runs/${authority.workflow.runId}`,
    token,
    request,
  );
  const gateRun = createReleaseGateRunObservation(run, authority);
  const gateJobs = await queryReleaseWorkflowJobs({
    runId: authority.workflow.runId,
    runAttempt: authority.workflow.runAttempt,
    token,
    request,
  });
  await queryArtifact({
    artifactId: authority.candidateArtifact.id,
    artifactName: authority.candidateArtifact.name,
    digest: authority.candidateArtifact.digest,
    runId: authority.workflow.runId,
    token,
    request,
  });
  return { gateRun, gateJobs };
}

async function writeCanonical(path, value) {
  await writeFile(path, serializeEvidence(value), {
    encoding: "utf8",
    flag: "wx",
  });
}

async function createProducerEvidence(values) {
  const runId = values["--run-id"];
  const runAttempt = Number(values["--run-attempt"]);
  const artifactName = `m8-cli-candidate-${runId}-${runAttempt}`;
  const artifact = await queryArtifact({
    artifactId: values["--artifact-id"],
    artifactName,
    digest: values["--artifact-digest"],
    runId,
    token: process.env.GITHUB_TOKEN,
  });
  const authority = createCandidateAuthority({
    sourceCommit: values["--source-commit"],
    runId,
    runAttempt,
    artifact,
  });
  const candidateBytes = await readFile(resolve(values["--candidate"]));
  const manifestPath = resolve(values["--manifest"]);
  const manifestBytes = await readFile(manifestPath);
  const evidence = createReleaseAcceptanceEvidence({
    authority,
    os: "ubuntu-24.04",
    node: "24.11.1",
    candidateSha256: evidenceSha256(candidateBytes),
    source: "pinned-producer",
    testManifestFile: manifestPath,
    testManifestBytes: manifestBytes,
  });
  await Promise.all([
    writeCanonical(resolve(values["--authority-output"]), authority),
    writeCanonical(resolve(values["--evidence"]), evidence),
  ]);
}

async function createGateEvidenceCommand(values) {
  const evidenceFiles = values["--evidence-files"].split(",");
  const producerPair = await readEvidencePair(
    resolve(values["--evidence-root"]),
    PRODUCER_TEST_FILE,
    PRODUCER_EVIDENCE_FILE,
    true,
  );
  const observations = await queryInProgressReleaseGateAuthority(
    producerPair.evidence.authority,
    { token: process.env.GITHUB_TOKEN },
  );
  const gate = await createReleaseGateEvidence({
    productRoot: resolve(values["--product-root"]),
    evidenceRoot: resolve(values["--evidence-root"]),
    payloadArtifactName: values["--payload-artifact-name"],
    evidenceFiles,
    ...observations,
  });
  await writeCanonical(resolve(values["--output"]), gate);
}

async function createReceiptCommand(values) {
  const gatePath = resolve(values["--gate"]);
  const gateBytes = await readFile(gatePath);
  const gate = assertReleaseGateEvidence(
    parseCanonicalEvidence(gateBytes, RELEASE_GATE_FILE),
  );
  const artifact = await queryArtifact({
    artifactId: values["--artifact-id"],
    artifactName: gate.payload.artifactName,
    digest: values["--artifact-digest"],
    runId: gate.authority.workflow.runId,
    token: process.env.GITHUB_TOKEN,
  });
  await writeCanonical(
    resolve(values["--output"]),
    createReleaseGateReceipt({ gateBytes, gate, artifact }),
  );
}

function parseCommandArguments(argv) {
  const command = argv[0];
  const required = {
    producer: [
      "--manifest",
      "--evidence",
      "--authority-output",
      "--candidate",
      "--artifact-id",
      "--artifact-digest",
      "--run-id",
      "--run-attempt",
      "--source-commit",
    ],
    aggregate: [
      "--product-root",
      "--evidence-root",
      "--evidence-files",
      "--payload-artifact-name",
      "--output",
    ],
    receipt: ["--gate", "--artifact-id", "--artifact-digest", "--output"],
  }[command];
  if (required === undefined || (argv.length - 1) % 2 !== 0) {
    throw new Error("EVID000 Invalid release-evidence command.");
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !required.includes(flag) ||
      values[flag] !== undefined ||
      value === ""
    ) {
      throw new Error("EVID000 Invalid release-evidence command arguments.");
    }
    values[flag] = value;
  }
  if (required.some((flag) => values[flag] === undefined)) {
    throw new Error("EVID000 Missing release-evidence command argument.");
  }
  return { command, values };
}

async function main(argv) {
  const { command, values } = parseCommandArguments(argv);
  if (process.env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY) {
    throw new Error(
      "EVID007 Repository context differs from release authority.",
    );
  }
  if (
    typeof process.env.GITHUB_TOKEN !== "string" ||
    process.env.GITHUB_TOKEN === ""
  ) {
    throw new Error("EVID007 GitHub token is required for artifact authority.");
  }
  if (command === "producer") await createProducerEvidence(values);
  else if (command === "aggregate") await createGateEvidenceCommand(values);
  else await createReceiptCommand(values);
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
