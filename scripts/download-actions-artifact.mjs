import { createHash } from "node:crypto";
import { lstat, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractSafeZipArchive } from "./safe-zip-reader.mjs";

const REPOSITORY = "BlackettApplied/ThermiteSchematics";
const WORKFLOW_NAME = "M8 Release Candidate";
const WORKFLOW_PATH = ".github/workflows/release-candidate.yml";
const CANDIDATE_FILES = Object.freeze([
  "thermite-cli-0.2.0.tgz",
  "thermite-cli-0.2.0.tgz.sha256",
  "thermite-cli-0.2.0.tar-headers.json",
  "thermite-cli-0.2.0.stage-files.json",
  "thermite-cli-0.2.0.runtime-closure.json",
  "thermite-cli-0.2.0.third-party-licenses.json",
  "thermite-cli-0.2.0.build-provenance.json",
]);

function assertUnsignedDecimal(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`ART001 ${label} must be an unsigned nonzero decimal.`);
  }
  return value;
}

export function normalizeArtifactDigest(value, expectedForm = "either") {
  if (
    typeof value !== "string" ||
    !["bare", "prefixed", "either"].includes(expectedForm)
  ) {
    throw new Error("ART002 Artifact digest is absent.");
  }
  const bare = /^[0-9a-f]{64}$/u.test(value);
  const prefixed = /^sha256:[0-9a-f]{64}$/u.test(value);
  if (
    (expectedForm === "bare" && !bare) ||
    (expectedForm === "prefixed" && !prefixed) ||
    (expectedForm === "either" && !bare && !prefixed)
  ) {
    throw new Error("ART002 Artifact digest has an invalid normalized form.");
  }
  return bare ? value : value.slice("sha256:".length);
}

function apiHeaders(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getJson(request, token, path) {
  const response = await request(`https://api.github.com${path}`, {
    headers: apiHeaders(token),
  });
  if (!response.ok) {
    throw new Error(
      `ART003 GitHub API request failed with ${response.status}.`,
    );
  }
  return response.json();
}

function assertArtifactMetadata(
  artifact,
  { artifactId, artifactName, workflowRunId },
) {
  if (
    String(artifact?.id) !== artifactId ||
    artifact?.name !== artifactName ||
    artifact?.expired !== false ||
    String(artifact?.workflow_run?.id) !== workflowRunId ||
    !/^sha256:[0-9a-f]{64}$/u.test(artifact?.digest ?? "")
  ) {
    throw new Error("ART004 Actions artifact metadata differs from authority.");
  }
  return artifact;
}

export async function findRunArtifactByName({
  repository = REPOSITORY,
  workflowRunId,
  artifactName,
  token,
  request = fetch,
}) {
  assertUnsignedDecimal(workflowRunId, "workflow run ID");
  const listing = await getJson(
    request,
    token,
    `/repos/${repository}/actions/runs/${workflowRunId}/artifacts?per_page=100`,
  );
  if (!Array.isArray(listing?.artifacts)) {
    throw new Error("ART004 Actions artifact listing has an invalid shape.");
  }
  const matches = listing.artifacts.filter(
    (artifact) => artifact?.name === artifactName,
  );
  if (matches.length !== 1) {
    throw new Error("ART004 Expected exactly one named Actions artifact.");
  }
  return matches[0];
}

async function streamArchive({ response, archivePath, expectedDigest }) {
  if (!response.ok || response.body === null) {
    throw new Error(
      `ART003 Artifact archive request failed with ${response.status}.`,
    );
  }
  const handle = await open(archivePath, "wx", 0o600);
  const hash = createHash("sha256");
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      await handle.write(bytes);
    }
  } finally {
    await handle.close();
  }
  const stats = await lstat(archivePath, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
    throw new Error("ART005 Downloaded archive is not an ordinary file.");
  }
  const actual = hash.digest("hex");
  if (actual !== expectedDigest) {
    await rm(archivePath, { force: false });
    throw new Error("ART005 Actions artifact archive SHA-256 mismatch.");
  }
  return actual;
}

export async function downloadActionsArtifact({
  repository = REPOSITORY,
  artifactId,
  artifactName,
  artifactDigest,
  artifactDigestForm = "either",
  workflowRunId,
  token,
  archivePath,
  extractDirectory,
  expectedFiles,
  request = fetch,
}) {
  assertUnsignedDecimal(artifactId, "artifact ID");
  assertUnsignedDecimal(workflowRunId, "workflow run ID");
  if (
    repository !== REPOSITORY ||
    typeof token !== "string" ||
    token === "" ||
    typeof artifactName !== "string" ||
    artifactName === "" ||
    !isAbsolute(archivePath) ||
    !isAbsolute(extractDirectory)
  ) {
    throw new Error("ART001 Artifact download arguments are invalid.");
  }
  const artifact = assertArtifactMetadata(
    await getJson(
      request,
      token,
      `/repos/${repository}/actions/artifacts/${artifactId}`,
    ),
    { artifactId, artifactName, workflowRunId },
  );
  const restDigest = normalizeArtifactDigest(artifact.digest, "prefixed");
  if (
    artifactDigest !== undefined &&
    normalizeArtifactDigest(artifactDigest, artifactDigestForm) !== restDigest
  ) {
    throw new Error("ART002 Upload and REST artifact digests differ.");
  }
  const response = await request(
    `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`,
    {
      headers: apiHeaders(token),
      redirect: "follow",
    },
  );
  await streamArchive({ response, archivePath, expectedDigest: restDigest });
  const archiveBytes = await readFile(archivePath);
  await extractSafeZipArchive(archiveBytes, extractDirectory, {
    expectedFiles,
  });
  return { artifact, digest: `sha256:${restDigest}` };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertExactKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) {
    throw new Error(`ART006 ${label} has unknown, missing, or reordered keys.`);
  }
}

export async function verifyExtractedCandidate(
  extractionRoot,
  { sourceCommit } = {},
) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? "")) {
    throw new Error("ART006 Candidate source commit is invalid.");
  }
  const tarPath = join(extractionRoot, CANDIDATE_FILES[0]);
  const shaPath = join(extractionRoot, CANDIDATE_FILES[1]);
  const provenancePath = join(extractionRoot, CANDIDATE_FILES[6]);
  const [tarBytes, shaBytes, provenanceBytes] = await Promise.all([
    readFile(tarPath),
    readFile(shaPath),
    readFile(provenancePath),
  ]);
  const tarSha = sha256(tarBytes);
  if (shaBytes.toString("utf8") !== `${tarSha}  thermite-cli-0.2.0.tgz\n`) {
    throw new Error("ART006 Candidate SHA file differs from the tarball.");
  }
  const provenanceText = provenanceBytes.toString("utf8");
  if (!Buffer.from(provenanceText, "utf8").equals(provenanceBytes)) {
    throw new Error("ART006 Build provenance is not valid UTF-8.");
  }
  const provenance = JSON.parse(provenanceText);
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
  assertExactKeys(provenance.source, ["repository", "commit"], "source");
  if (
    provenance.format !== "thermite-schematics-build-provenance/0.2" ||
    provenance.artifact !== "thermite-cli-0.2.0.tgz" ||
    provenance.sha256 !== tarSha ||
    provenance.source.repository !== REPOSITORY ||
    provenance.source.commit !== sourceCommit
  ) {
    throw new Error(
      "ART006 Build provenance differs from candidate authority.",
    );
  }
  return { tarPath, sha256: tarSha, provenance };
}

export function createCandidateAuthority({
  sourceCommit,
  runId,
  runAttempt,
  artifact,
}) {
  assertUnsignedDecimal(runId, "workflow run ID");
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    throw new Error("ART001 Workflow run attempt is invalid.");
  }
  const expectedName = `m8-cli-candidate-${runId}-${runAttempt}`;
  if (
    !/^[0-9a-f]{40}$/u.test(sourceCommit ?? "") ||
    artifact?.name !== expectedName ||
    !Number.isSafeInteger(artifact?.id) ||
    artifact.id < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(artifact?.digest ?? "")
  ) {
    throw new Error("ART004 Candidate authority fields are invalid.");
  }
  return {
    repository: REPOSITORY,
    sourceCommit,
    workflow: {
      name: WORKFLOW_NAME,
      path: WORKFLOW_PATH,
      runId,
      runAttempt,
      event: "push",
      ref: "refs/heads/dev",
    },
    candidateArtifact: {
      name: artifact.name,
      id: String(artifact.id),
      digest: artifact.digest,
    },
  };
}

function parseArguments(argv) {
  const values = { expectedFiles: [] };
  const repeatable = new Set(["--expect"]);
  const known = new Set([
    "--artifact-id",
    "--artifact-name",
    "--artifact-digest",
    "--workflow-run-id",
    "--run-attempt",
    "--source-commit",
    "--archive",
    "--extract",
    "--expect",
    "--authority-output",
    "--verify-candidate",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!known.has(flag) || value === undefined) {
      throw new Error("ART001 Invalid artifact-download command arguments.");
    }
    if (repeatable.has(flag)) {
      values.expectedFiles.push(value);
    } else {
      if (values[flag] !== undefined) {
        throw new Error("ART001 Duplicate artifact-download command argument.");
      }
      values[flag] = value;
    }
  }
  return values;
}

async function main(argv) {
  const values = parseArguments(argv);
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const workflowRunId = values["--workflow-run-id"];
  const artifactName = values["--artifact-name"];
  if (
    repository !== REPOSITORY ||
    typeof token !== "string" ||
    token === "" ||
    typeof workflowRunId !== "string" ||
    typeof artifactName !== "string" ||
    typeof values["--archive"] !== "string" ||
    typeof values["--extract"] !== "string"
  ) {
    throw new Error("ART001 Required artifact-download authority is absent.");
  }
  let artifactId = values["--artifact-id"];
  let artifactDigest = values["--artifact-digest"];
  let artifactDigestForm = artifactId === undefined ? "prefixed" : "bare";
  if (artifactId === undefined) {
    const found = await findRunArtifactByName({
      repository,
      workflowRunId,
      artifactName,
      token,
    });
    artifactId = String(found.id);
    artifactDigest = found.digest;
    artifactDigestForm = "prefixed";
  }
  const archivePath = resolve(values["--archive"]);
  const extractDirectory = resolve(values["--extract"]);
  const result = await downloadActionsArtifact({
    repository,
    artifactId,
    artifactName,
    artifactDigest,
    artifactDigestForm,
    workflowRunId,
    token,
    archivePath,
    extractDirectory,
    expectedFiles: values.expectedFiles,
  });
  if (values["--verify-candidate"] === "true") {
    const verified = await verifyExtractedCandidate(extractDirectory, {
      sourceCommit: values["--source-commit"],
    });
    if (values["--authority-output"] !== undefined) {
      const runAttempt = Number(values["--run-attempt"]);
      const authority = createCandidateAuthority({
        sourceCommit: values["--source-commit"],
        runId: workflowRunId,
        runAttempt,
        artifact: result.artifact,
      });
      await writeFile(
        resolve(values["--authority-output"]),
        `${JSON.stringify(authority, undefined, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }
    process.stdout.write(`${verified.sha256}\n`);
  } else if (values["--authority-output"] !== undefined) {
    throw new Error("ART001 Authority output requires candidate verification.");
  }
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
