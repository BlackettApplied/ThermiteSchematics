import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  downloadActionsArtifact,
  findRunArtifactByName,
} from "./download-actions-artifact.mjs";
import {
  RELEASE_ARTIFACT,
  RELEASE_GATE_FILE,
  RELEASE_GATE_RECEIPT_FILE,
  RELEASE_NON_TAR_OUTPUT_NAMES,
  RELEASE_OUTPUT_NAMES,
  RELEASE_REPOSITORY,
  RELEASE_WORKFLOW_NAME,
  RELEASE_WORKFLOW_PATH,
  assertReleaseGateJobObservations,
  assertReleaseGateReceipt,
  evidenceSha256,
  parseCanonicalEvidence,
  queryReleaseWorkflowJobs,
  verifyReleaseGatePayload,
} from "./release-evidence-audit.mjs";
import { scanReleaseEvidenceFiles } from "./scan-release-evidence-leaks.mjs";
import { verifyPrivateReleaseTarget } from "./verify-private-release-target.mjs";

const RELEASE_TAG = "v0.2.0";
const ALLOWED_ASSET_NAMES = Object.freeze([
  RELEASE_ARTIFACT,
  `${RELEASE_ARTIFACT}.sha256`,
]);

function assertDecimal(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`PUB001 ${label} must be an unsigned nonzero decimal.`);
  }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assetLabel(gateRunId, payloadArtifactId, sha256) {
  return `m8-gate-run=${gateRunId};payload-artifact=${payloadArtifactId};sha256=${sha256}`;
}

function assertReleaseIdentity(release, releaseId, sourceCommit, tagCommit) {
  if (
    !Number.isSafeInteger(release?.id) ||
    release.id !== releaseId ||
    release.url !==
      `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/${releaseId}` ||
    release.tag_name !== RELEASE_TAG ||
    release.prerelease !== false ||
    (release.draft !== true && release.draft !== false) ||
    tagCommit !== sourceCommit ||
    (release.draft === false &&
      (typeof release.published_at !== "string" || release.published_at === ""))
  ) {
    throw new Error("PUB002 Release or peeled tag authority changed.");
  }
  return release;
}

function validateAssetNameSet(assets, draft) {
  if (!Array.isArray(assets)) {
    throw new Error("PUB003 Release asset list is invalid.");
  }
  const names = assets.map((asset) => asset?.name);
  if (new Set(names).size !== names.length) {
    throw new Error("PUB003 Duplicate Release asset name.");
  }
  if (names.some((name) => !ALLOWED_ASSET_NAMES.includes(name))) {
    throw new Error("PUB003 Release contains an unrelated asset.");
  }
  if (!draft && names.length !== ALLOWED_ASSET_NAMES.length) {
    throw new Error("PUB003 Published Release asset set is incomplete.");
  }
  return assets;
}

function expectedByName(expectedAssets) {
  if (
    !Array.isArray(expectedAssets) ||
    expectedAssets.length !== 2 ||
    expectedAssets.some(
      (asset, index) =>
        asset.name !== ALLOWED_ASSET_NAMES[index] ||
        !Buffer.isBuffer(asset.bytes) ||
        asset.size !== asset.bytes.length ||
        digest(asset.bytes) !== asset.sha256,
    )
  ) {
    throw new Error("PUB004 Expected Release asset tuple is invalid.");
  }
  return new Map(expectedAssets.map((asset) => [asset.name, asset]));
}

function assertAssetIdentity(asset, expectedName) {
  if (
    !Number.isSafeInteger(asset?.id) ||
    asset.id < 1 ||
    asset.name !== expectedName ||
    asset.url !==
      `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/assets/${asset.id}`
  ) {
    throw new Error("PUB005 Release asset identity differs.");
  }
}

async function verifyUploadedAsset({
  client,
  releaseId,
  asset,
  expected,
  gateRunId,
  payloadArtifactId,
  tarSha256,
}) {
  assertAssetIdentity(asset, expected.name);
  const current = await client.getReleaseAsset(asset.id);
  assertAssetIdentity(current, expected.name);
  const expectedLabel = assetLabel(
    gateRunId,
    payloadArtifactId,
    expected.sha256,
  );
  if (
    current.state !== "uploaded" ||
    current.label !== expectedLabel ||
    current.size !== expected.size ||
    current.digest !== `sha256:${expected.sha256}` ||
    current.id !== asset.id
  ) {
    throw new Error("PUB005 Uploaded Release asset metadata differs.");
  }
  const downloaded = await client.downloadReleaseAsset(current.id);
  if (digest(downloaded) !== expected.sha256) {
    throw new Error("PUB005 Uploaded Release asset bytes differ.");
  }
  if (
    expected.name.endsWith(".sha256") &&
    downloaded.toString("utf8") !== `${tarSha256}  ${RELEASE_ARTIFACT}\n`
  ) {
    throw new Error(
      "PUB005 Uploaded SHA asset content differs from tar authority.",
    );
  }
  return current;
}

async function refetchReleaseState({ client, releaseId, sourceCommit }) {
  const [release, tagCommit] = await Promise.all([
    client.getRelease(releaseId),
    client.getTagCommit(RELEASE_TAG),
  ]);
  assertReleaseIdentity(release, releaseId, sourceCommit, tagCommit);
  const assets = validateAssetNameSet(
    await client.listReleaseAssets(releaseId),
    release.draft,
  );
  return { release, assets };
}

async function recoverStarter({
  client,
  releaseId,
  sourceCommit,
  expectedName,
  starterId,
}) {
  let state = await refetchReleaseState({ client, releaseId, sourceCommit });
  if (!state.release.draft) {
    throw new Error("PUB006 Starter recovery is forbidden after publication.");
  }
  const matches = state.assets.filter((asset) => asset.name === expectedName);
  if (matches.length !== 1 || matches[0].id !== starterId) {
    throw new Error("PUB006 Starter asset changed before recovery.");
  }
  const current = await client.getReleaseAsset(starterId);
  assertAssetIdentity(current, expectedName);
  if (current.state !== "starter") {
    throw new Error("PUB006 Expected draft asset is not in starter state.");
  }
  const status = await client.deleteReleaseAsset(starterId);
  if (status !== 204) {
    throw new Error("PUB006 Starter deletion did not return 204.");
  }
  state = await refetchReleaseState({ client, releaseId, sourceCommit });
  if (
    !state.release.draft ||
    state.assets.some(
      (asset) => asset.id === starterId || asset.name === expectedName,
    )
  ) {
    throw new Error("PUB006 Starter asset remains after deletion.");
  }
  return state;
}

async function verifyCompleteAssetSet({
  client,
  state,
  expected,
  releaseId,
  gateRunId,
  payloadArtifactId,
  tarSha256,
}) {
  validateAssetNameSet(state.assets, false);
  for (const name of ALLOWED_ASSET_NAMES) {
    const asset = state.assets.find((candidate) => candidate.name === name);
    await verifyUploadedAsset({
      client,
      releaseId,
      asset,
      expected: expected.get(name),
      gateRunId,
      payloadArtifactId,
      tarSha256,
    });
  }
}

async function inspectDraftAsset({
  client,
  asset,
  expected,
  releaseId,
  gateRunId,
  payloadArtifactId,
  tarSha256,
}) {
  if (asset.state === "uploaded") {
    await verifyUploadedAsset({
      client,
      releaseId,
      asset,
      expected,
      gateRunId,
      payloadArtifactId,
      tarSha256,
    });
    return "uploaded";
  }
  if (asset.state === "starter") {
    assertAssetIdentity(asset, expected.name);
    const current = await client.getReleaseAsset(asset.id);
    assertAssetIdentity(current, expected.name);
    if (current.state !== "starter") {
      throw new Error("PUB006 Starter asset state changed.");
    }
    return "starter";
  }
  throw new Error("PUB005 Expected draft asset has an unsupported state.");
}

export async function publishVerifiedReleaseAssets({
  client,
  releaseId,
  sourceCommit,
  gateRunId,
  payloadArtifactId,
  expectedAssets,
  dryRun = false,
}) {
  assertDecimal(gateRunId, "gate run ID");
  assertDecimal(payloadArtifactId, "payload artifact ID");
  const expected = expectedByName(expectedAssets);
  const tarSha256 = expected.get(RELEASE_ARTIFACT).sha256;
  let state = await refetchReleaseState({ client, releaseId, sourceCommit });
  if (!state.release.draft) {
    await verifyCompleteAssetSet({
      client,
      state,
      expected,
      releaseId,
      gateRunId,
      payloadArtifactId,
      tarSha256,
    });
    return { status: "already-published", releaseId, mutated: false };
  }

  const starterRecoveries = new Set();
  if (dryRun) {
    for (const asset of state.assets) {
      await inspectDraftAsset({
        client,
        asset,
        expected: expected.get(asset.name),
        releaseId,
        gateRunId,
        payloadArtifactId,
        tarSha256,
      });
    }
    return {
      status: "dry-run",
      releaseId,
      mutated: false,
      missing: ALLOWED_ASSET_NAMES.filter(
        (name) => !state.assets.some((asset) => asset.name === name),
      ),
    };
  }

  for (const name of ALLOWED_ASSET_NAMES) {
    const expectedAsset = expected.get(name);
    let current = state.assets.find((asset) => asset.name === name);
    if (current !== undefined) {
      const observed = await inspectDraftAsset({
        client,
        asset: current,
        expected: expectedAsset,
        releaseId,
        gateRunId,
        payloadArtifactId,
        tarSha256,
      });
      if (observed === "uploaded") continue;
      starterRecoveries.add(name);
      state = await recoverStarter({
        client,
        releaseId,
        sourceCommit,
        expectedName: name,
        starterId: current.id,
      });
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let indeterminate = false;
      try {
        await client.uploadReleaseAsset(releaseId, {
          name,
          label: assetLabel(gateRunId, payloadArtifactId, expectedAsset.sha256),
          bytes: expectedAsset.bytes,
        });
      } catch (error) {
        if (error?.indeterminate !== true) throw error;
        indeterminate = true;
      }
      state = await refetchReleaseState({ client, releaseId, sourceCommit });
      current = state.assets.find((asset) => asset.name === name);
      if (current?.state === "uploaded") {
        await verifyUploadedAsset({
          client,
          releaseId,
          asset: current,
          expected: expectedAsset,
          gateRunId,
          payloadArtifactId,
          tarSha256,
        });
        break;
      }
      if (current?.state === "starter") {
        if (starterRecoveries.has(name)) {
          throw new Error(
            "PUB006 Starter recovery repeated in one invocation.",
          );
        }
        starterRecoveries.add(name);
        state = await recoverStarter({
          client,
          releaseId,
          sourceCommit,
          expectedName: name,
          starterId: current.id,
        });
        continue;
      }
      if (indeterminate || attempt === 1) {
        throw new Error("PUB007 Uploaded asset state is indeterminate.");
      }
      throw new Error("PUB007 Upload returned without the expected asset.");
    }
  }

  state = await refetchReleaseState({ client, releaseId, sourceCommit });
  if (!state.release.draft) {
    throw new Error(
      "PUB008 Release was published outside the authorized transition.",
    );
  }
  await verifyCompleteAssetSet({
    client,
    state,
    expected,
    releaseId,
    gateRunId,
    payloadArtifactId,
    tarSha256,
  });

  let publishIndeterminate = false;
  try {
    await client.publishRelease(releaseId, { draft: false });
  } catch (error) {
    if (error?.indeterminate !== true) throw error;
    publishIndeterminate = true;
  }
  state = await refetchReleaseState({ client, releaseId, sourceCommit });
  if (!state.release.draft) {
    await verifyCompleteAssetSet({
      client,
      state,
      expected,
      releaseId,
      gateRunId,
      payloadArtifactId,
      tarSha256,
    });
    return { status: "published", releaseId, mutated: true };
  }
  if (!publishIndeterminate) {
    throw new Error(
      "PUB008 Publish response did not publish the fixed Release.",
    );
  }
  await verifyCompleteAssetSet({
    client,
    state,
    expected,
    releaseId,
    gateRunId,
    payloadArtifactId,
    tarSha256,
  });
  try {
    await client.publishRelease(releaseId, { draft: false });
  } catch {
    // The final full re-fetch below is the sole authority after a retry result.
  }
  state = await refetchReleaseState({ client, releaseId, sourceCommit });
  if (state.release.draft) {
    throw new Error(
      "PUB008 Publish state remains indeterminate after one retry.",
    );
  }
  await verifyCompleteAssetSet({
    client,
    state,
    expected,
    releaseId,
    gateRunId,
    payloadArtifactId,
    tarSha256,
  });
  return { status: "published", releaseId, mutated: true };
}

function githubHeaders(token, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function createGitHubReleaseClient({ token, request = fetch }) {
  if (typeof token !== "string" || token === "") {
    throw new Error("PUB001 GITHUB_TOKEN is required.");
  }
  const api = async (path, options = {}) => {
    const { accept, ...requestOptions } = options;
    const url = path.startsWith("https://")
      ? path
      : `https://api.github.com${path}`;
    const response = await request(url, {
      ...requestOptions,
      headers: {
        ...githubHeaders(token, accept),
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `PUB009 GitHub API request failed with ${response.status}.`,
      );
    }
    return response;
  };
  const json = async (path, options) => (await api(path, options)).json();
  const mutation = async (path, options) => {
    try {
      return await api(path, options);
    } catch (error) {
      if (error instanceof TypeError) error.indeterminate = true;
      throw error;
    }
  };
  return {
    getWorkflowRun(runId) {
      return json(`/repos/${RELEASE_REPOSITORY}/actions/runs/${runId}`);
    },
    async getTagCommit(tag) {
      let object = (
        await json(
          `/repos/${RELEASE_REPOSITORY}/git/ref/tags/${encodeURIComponent(tag)}`,
        )
      ).object;
      const seen = new Set();
      while (object?.type === "tag") {
        if (seen.has(object.sha))
          throw new Error("PUB002 Annotated tag cycle.");
        seen.add(object.sha);
        object = (
          await json(`/repos/${RELEASE_REPOSITORY}/git/tags/${object.sha}`)
        ).object;
      }
      if (
        object?.type !== "commit" ||
        !/^[0-9a-f]{40}$/u.test(object.sha ?? "")
      ) {
        throw new Error("PUB002 Release tag does not peel to a commit.");
      }
      return object.sha;
    },
    getRelease(releaseId) {
      return json(`/repos/${RELEASE_REPOSITORY}/releases/${releaseId}`);
    },
    getReleaseByTag(tag) {
      return json(
        `/repos/${RELEASE_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
      );
    },
    async listReleaseAssets(releaseId) {
      const assets = await json(
        `/repos/${RELEASE_REPOSITORY}/releases/${releaseId}/assets?per_page=100`,
      );
      if (!Array.isArray(assets))
        throw new Error("PUB003 Asset list is invalid.");
      return assets;
    },
    getReleaseAsset(assetId) {
      return json(`/repos/${RELEASE_REPOSITORY}/releases/assets/${assetId}`);
    },
    async downloadReleaseAsset(assetId) {
      const response = await api(
        `/repos/${RELEASE_REPOSITORY}/releases/assets/${assetId}`,
        { accept: "application/octet-stream", redirect: "follow" },
      );
      return Buffer.from(await response.arrayBuffer());
    },
    async deleteReleaseAsset(assetId) {
      const response = await mutation(
        `/repos/${RELEASE_REPOSITORY}/releases/assets/${assetId}`,
        { method: "DELETE" },
      );
      return response.status;
    },
    async uploadReleaseAsset(releaseId, asset) {
      const release = await this.getRelease(releaseId);
      const uploadBase = release.upload_url?.replace(/\{[^}]+\}$/u, "");
      if (typeof uploadBase !== "string") {
        throw new Error("PUB009 Release upload URL is absent.");
      }
      const query = new URLSearchParams({
        name: asset.name,
        label: asset.label,
      });
      const response = await mutation(`${uploadBase}?${query}`, {
        method: "POST",
        accept: "application/vnd.github+json",
        headers: { "Content-Type": "application/octet-stream" },
        body: asset.bytes,
      });
      return response.json();
    },
    async publishRelease(releaseId, body) {
      const response = await mutation(
        `/repos/${RELEASE_REPOSITORY}/releases/${releaseId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return response.json();
    },
  };
}

function assertCandidateRun(run, gateRunId) {
  const path = run?.path;
  if (
    String(run?.id) !== gateRunId ||
    run?.name !== RELEASE_WORKFLOW_NAME ||
    path !== RELEASE_WORKFLOW_PATH ||
    run?.event !== "push" ||
    run?.head_branch !== "dev" ||
    !/^[0-9a-f]{40}$/u.test(run?.head_sha ?? "") ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    !Number.isSafeInteger(run?.run_attempt) ||
    run.run_attempt < 1 ||
    run?.head_repository?.full_name !== RELEASE_REPOSITORY
  ) {
    throw new Error(
      "PUB010 Selected run is not a successful protected candidate run.",
    );
  }
  return run;
}

export function assertCompletedReleaseJobsMatchReceipt(
  completedJobs,
  recordedJobs,
) {
  assertReleaseGateJobObservations(completedJobs, {
    requireGateSuccess: true,
  });
  assertReleaseGateJobObservations(recordedJobs);
  const completedMapping = completedJobs.map(({ name, id }) => ({ name, id }));
  const recordedMapping = recordedJobs.map(({ name, id }) => ({ name, id }));
  if (JSON.stringify(completedMapping) !== JSON.stringify(recordedMapping)) {
    throw new Error(
      "PUB010 Completed job topology differs from the gate receipt.",
    );
  }
  return completedJobs;
}

function assertCompletedRunMatchesReceipt(run, receipt) {
  if (
    receipt.gateRun.event !== run.event ||
    receipt.gateRun.headBranch !== run.head_branch ||
    receipt.gateRun.headSha !== run.head_sha ||
    receipt.gateRun.path !== run.path ||
    receipt.gateRun.runAttempt !== run.run_attempt
  ) {
    throw new Error("PUB010 Completed run identity differs from gate receipt.");
  }
}

export async function publishRelease({
  gateRunId,
  dryRun = false,
  environment = process.env,
  request = fetch,
} = {}) {
  assertDecimal(gateRunId, "gate run ID");
  if (
    environment.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
    typeof environment.GITHUB_TOKEN !== "string" ||
    environment.GITHUB_TOKEN === ""
  ) {
    throw new Error("PUB001 Publisher repository/token authority is absent.");
  }
  await verifyPrivateReleaseTarget({ mode: "publisher", environment, request });
  const client = createGitHubReleaseClient({
    token: environment.GITHUB_TOKEN,
    request,
  });
  const run = assertCandidateRun(
    await client.getWorkflowRun(gateRunId),
    gateRunId,
  );
  const completedJobs = await queryReleaseWorkflowJobs({
    runId: gateRunId,
    runAttempt: run.run_attempt,
    token: environment.GITHUB_TOKEN,
    request,
    requireGateSuccess: true,
  });
  const receiptName = `m8-release-gate-receipt-${gateRunId}-${run.run_attempt}`;
  const receiptArtifact = await findRunArtifactByName({
    repository: RELEASE_REPOSITORY,
    workflowRunId: gateRunId,
    artifactName: receiptName,
    token: environment.GITHUB_TOKEN,
    request,
  });
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-release-publisher-"),
  );
  const captured = await lstat(temporaryRoot, { bigint: true });
  try {
    const receiptRoot = join(temporaryRoot, "receipt");
    await downloadActionsArtifact({
      repository: RELEASE_REPOSITORY,
      artifactId: String(receiptArtifact.id),
      artifactName: receiptName,
      artifactDigest: receiptArtifact.digest,
      artifactDigestForm: "prefixed",
      workflowRunId: gateRunId,
      token: environment.GITHUB_TOKEN,
      archivePath: join(temporaryRoot, "receipt.zip"),
      extractDirectory: receiptRoot,
      expectedFiles: [RELEASE_GATE_RECEIPT_FILE],
      request,
    });
    const receiptPath = join(receiptRoot, RELEASE_GATE_RECEIPT_FILE);
    const receipt = assertReleaseGateReceipt(
      parseCanonicalEvidence(
        await readFile(receiptPath),
        RELEASE_GATE_RECEIPT_FILE,
      ),
    );
    if (
      receipt.sourceCommit !== run.head_sha ||
      receipt.workflow.runId !== gateRunId ||
      receipt.workflow.runAttempt !== run.run_attempt
    ) {
      throw new Error("PUB010 Receipt differs from selected candidate run.");
    }
    assertCompletedRunMatchesReceipt(run, receipt);
    assertCompletedReleaseJobsMatchReceipt(completedJobs, receipt.gateJobs);
    const payloadRoot = join(temporaryRoot, "payload");
    await downloadActionsArtifact({
      repository: RELEASE_REPOSITORY,
      artifactId: receipt.payloadArtifact.id,
      artifactName: receipt.payloadArtifact.name,
      artifactDigest: receipt.payloadArtifact.digest,
      artifactDigestForm: "prefixed",
      workflowRunId: gateRunId,
      token: environment.GITHUB_TOKEN,
      archivePath: join(temporaryRoot, "payload.zip"),
      extractDirectory: payloadRoot,
      expectedFiles: [...RELEASE_OUTPUT_NAMES, RELEASE_GATE_FILE],
      request,
    });
    await scanReleaseEvidenceFiles(
      [
        ...RELEASE_NON_TAR_OUTPUT_NAMES.map((name) => join(payloadRoot, name)),
        join(payloadRoot, RELEASE_GATE_FILE),
        receiptPath,
      ],
      { sensitive: [temporaryRoot] },
    );
    const verified = await verifyReleaseGatePayload({ payloadRoot, receipt });
    const { auditReleaseOutputs } = await import("./release-tar-audit.mjs");
    const tarAudit = await auditReleaseOutputs({ outputRoot: payloadRoot });
    if (
      tarAudit.artifactSha !== verified.gate.candidate.sha256 ||
      tarAudit.provenance.source.commit !== receipt.sourceCommit
    ) {
      throw new Error(
        "PUB011 Structural tar audit differs from gate authority.",
      );
    }
    const [release, tagCommit] = await Promise.all([
      client.getReleaseByTag(RELEASE_TAG),
      client.getTagCommit(RELEASE_TAG),
    ]);
    if (!Number.isSafeInteger(release?.id) || release.id < 1) {
      throw new Error("PUB002 Pre-created v0.2.0 Release is absent.");
    }
    assertReleaseIdentity(release, release.id, receipt.sourceCommit, tagCommit);
    const expectedAssets = [];
    for (const row of verified.gate.releaseAssets) {
      const bytes = await readFile(join(payloadRoot, row.file));
      if (evidenceSha256(bytes) !== row.sha256) {
        throw new Error("PUB004 Release asset differs from gate evidence.");
      }
      expectedAssets.push({
        name: row.file,
        bytes,
        size: bytes.length,
        sha256: row.sha256,
      });
    }
    return await publishVerifiedReleaseAssets({
      client,
      releaseId: release.id,
      sourceCommit: receipt.sourceCommit,
      gateRunId,
      payloadArtifactId: receipt.payloadArtifact.id,
      expectedAssets,
      dryRun,
    });
  } finally {
    const observed = await lstat(temporaryRoot, { bigint: true });
    if (
      !observed.isDirectory() ||
      observed.isSymbolicLink() ||
      observed.dev !== captured.dev ||
      observed.ino !== captured.ino
    ) {
      throw new Error("PUB012 Publisher temporary-root identity changed.");
    }
    await rm(temporaryRoot, { recursive: true, force: false });
  }
}

export function parsePublisherArguments(argv) {
  if (
    (argv.length !== 2 && argv.length !== 3) ||
    argv[0] !== "--gate-run-id" ||
    (argv.length === 3 && argv[2] !== "--dry-run")
  ) {
    throw new Error(
      "Usage: node scripts/release-publish.mjs --gate-run-id <unsigned-decimal> [--dry-run]",
    );
  }
  return { gateRunId: argv[1], dryRun: argv[2] === "--dry-run" };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await publishRelease(
      parsePublisherArguments(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
