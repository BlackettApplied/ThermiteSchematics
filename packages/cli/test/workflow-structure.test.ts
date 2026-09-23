import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  downloadActionsArtifact,
  normalizeArtifactDigest,
} from "../../../scripts/download-actions-artifact.mjs";
import {
  assertCompletedReleaseJobsMatchReceipt,
  parsePublisherArguments,
  publishRelease,
  publishVerifiedReleaseAssets,
} from "../../../scripts/release-publish.mjs";
import {
  RELEASE_JOB_NAMES,
  queryInProgressReleaseGateAuthority,
  queryReleaseWorkflowJobs,
} from "../../../scripts/release-evidence-audit.mjs";
import {
  crc32,
  extractSafeZipArchive,
  readSafeZipArchive,
} from "../../../scripts/safe-zip-reader.mjs";
import {
  defaultAuditAuthority,
  verifyProtectedConsumerArtifactAuthority,
} from "../../../scripts/run-vitest-and-audit.mjs";
import { assertPortableEvidenceValue } from "../../../scripts/scan-release-evidence-leaks.mjs";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const candidatePath = join(
  repositoryRoot,
  ".github",
  "workflows",
  "release-candidate.yml",
);
const publisherPath = join(
  repositoryRoot,
  ".github",
  "workflows",
  "release-publish.yml",
);
const workflowHeader = `name: M8 Release Candidate
on:
  push:
    branches: [dev]
permissions:
  actions: read
  contents: read
  pull-requests: read
`;
const publisherHeader = `name: M8 Private Release Publisher
on:
  workflow_dispatch:
    inputs:
      gate_run_id:
        description: Successful M8 Release Candidate workflow run ID
        required: true
        type: string
permissions: {}

jobs:
  publish:
    environment: m8-private-release
    permissions:
      actions: read
      contents: write
`;

function mappingKeys(text: string, spaces: number) {
  const expression = new RegExp(
    `^ {${spaces}}([A-Za-z_][A-Za-z0-9_-]*):`,
    "gmu",
  );
  return [...text.matchAll(expression)].map((match) => match[1]);
}

function block(text: string, key: string, spaces: number) {
  const prefix = `${" ".repeat(spaces)}${key}:`;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === prefix);
  if (start < 0) throw new Error(`Missing YAML key ${key}.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== "" && !line.startsWith(" ".repeat(spaces + 1))) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function stepNames(job: string) {
  return [...job.matchAll(/^      - name: (.+)$/gmu)].map((match) => match[1]);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createStoredZip(
  files: readonly { name: string; bytes: Buffer; mode?: number }[],
) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.bytes.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, file.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.bytes.length, 20);
    central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.bytes.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

describe("frozen release workflow topology", () => {
  it("promotes injected full checks to zero-accommodation task authority", () => {
    expect(defaultAuditAuthority({})).toBe("ordinary");
    expect(
      defaultAuditAuthority({
        THERMITE_SCHEMATICS_RELEASE_AUTHORITY: "local-task6",
      }),
    ).toBe("task");
    expect(
      defaultAuditAuthority({
        THERMITE_SCHEMATICS_RELEASE_AUTHORITY: "protected-consumer",
      }),
    ).toBe("task");
    expect(
      defaultAuditAuthority({
        THERMITE_SCHEMATICS_RELEASE_AUTHORITY: "unknown",
      }),
    ).toBe("ordinary");
  });

  it("independently re-queries protected consumer artifact identity", async () => {
    const authority = {
      repository: "BlackettApplied/ThermiteSchematics",
      sourceCommit: "c".repeat(40),
      workflow: {
        name: "M8 Release Candidate",
        path: ".github/workflows/release-candidate.yml",
        runId: "123",
        runAttempt: 1,
        event: "push",
        ref: "refs/heads/dev",
      },
      candidateArtifact: {
        name: "m8-cli-candidate-123-1",
        id: "456",
        digest: `sha256:${"a".repeat(64)}`,
      },
    };
    const environment = {
      GITHUB_REPOSITORY: "BlackettApplied/ThermiteSchematics",
      GITHUB_TOKEN: "token",
    };
    const response = {
      id: 456,
      name: "m8-cli-candidate-123-1",
      expired: false,
      digest: `sha256:${"a".repeat(64)}`,
      workflow_run: { id: 123 },
    };
    await expect(
      verifyProtectedConsumerArtifactAuthority(authority, {
        environment,
        request: async () => Response.json(response),
      }),
    ).resolves.toMatchObject(response);
    await expect(
      verifyProtectedConsumerArtifactAuthority(authority, {
        environment,
        request: async () =>
          Response.json({ ...response, workflow_run: { id: 124 } }),
      }),
    ).rejects.toThrow(/API identity differs/u);
  });

  it("keeps ordinary pull-request CI byte-identical to its authority", async () => {
    const [workflow, authority] = await Promise.all([
      readFile(join(repositoryRoot, ".github", "workflows", "ci.yml")),
      readFile(join(repositoryRoot, "scripts", "ordinary-ci.authority.yml")),
    ]);
    expect(workflow.equals(authority)).toBe(true);
    const text = workflow.toString("utf8");
    expect(text).toContain("pull_request:");
    expect(text).toContain("push:\n    branches: [dev]");
    expect(text).toContain("permissions:\n  contents: read");
    expect(text).toContain("persist-credentials: false");
    expect(text).toContain("runs-on: macos-14");
    expect(text).toContain("oven-sh/setup-bun@v2");
    expect(text).toContain("bun-version-file: .bun-version");
    expect(text).toContain("run: bun install --frozen-lockfile");
    expect(text).toContain("run: bun run check");
    expect(text).not.toMatch(/artifact|candidate|pull_request_target/u);
  });

  it("parses the exact protected producer, consumer, and gate graph", async () => {
    const text = await readFile(candidatePath, "utf8");
    expect(text.startsWith(workflowHeader)).toBe(true);
    expect(mappingKeys(text, 0)).toEqual(["name", "on", "permissions", "jobs"]);
    expect(mappingKeys(block(text, "jobs", 0), 2)).toEqual([
      "release_candidate",
      "acceptance",
      "release_gate",
    ]);
    const producer = block(text, "release_candidate", 2);
    const acceptance = block(text, "acceptance", 2);
    const gate = block(text, "release_gate", 2);
    const privateTarget =
      "github.repository == 'BlackettApplied/ThermiteSchematics' && github.event.repository.private == true && github.event.repository.fork == false && vars.THERMITE_LEGACY_RELEASE == 'true'";
    expect(producer).toContain(`if: ${privateTarget}`);
    expect(gate).toContain(`if: always() && ${privateTarget}`);
    expect(producer).toContain("runs-on: ubuntu-24.04");
    expect(producer).toContain("fetch-depth: 0");
    expect(producer).toContain("node-version: 24.11.1");
    expect(producer.indexOf("--mode candidate")).toBeLessThan(
      producer.indexOf("scripts/release-pack.sh"),
    );
    expect(producer.indexOf("npm run check")).toBeLessThan(
      producer.indexOf("Upload exact candidate files"),
    );
    const producerAuditLine = producer
      .split("\n")
      .find((line) =>
        line.includes(
          "node scripts/run-vitest-and-audit.mjs --manifest release-out/evidence/producer-ubuntu-24.04-node-24.11.1.tests.json",
        ),
      );
    expect(producerAuditLine).toBeDefined();
    const producerTestMarker = " -- packages/";
    const producerTestStart = producerAuditLine?.indexOf(producerTestMarker);
    expect(producerTestStart).toBeGreaterThan(0);
    expect(producerAuditLine?.slice(0, producerTestStart)).toContain(
      "--require task4-ledger,package-smoke,release-install,empty-folder",
    );
    expect(
      producerAuditLine
        ?.slice((producerTestStart ?? 0) + " -- ".length)
        .trim()
        .split(/\s+/u),
    ).toEqual([
      "packages/render/test",
      "packages/agent-tools/test/create-view.test.ts",
      "packages/cli/test/render-cli.test.ts",
      "packages/cli/test/render-motor-starter-golden.test.ts",
      "packages/cli/test/agent-motor-starter-golden.test.ts",
      "packages/compiler/test/package-smoke.test.ts",
      "packages/cli/test/release-package.test.ts",
      "packages/cli/test/release-install-smoke.test.ts",
      "packages/cli/test/empty-folder-smoke.test.ts",
      "packages/cli/test/init.test.ts",
    ]);
    expect(producer).toContain(
      "name: m8-cli-candidate-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(producer).toContain("compression-level: 0");
    expect(producer).toContain(
      "name: m8-cli-producer-evidence-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(stepNames(producer).slice(-4)).toEqual([
      "Upload exact candidate files",
      "Bind producer evidence to queried artifact identity",
      "Scan exact producer evidence upload",
      "Upload producer evidence only",
    ]);

    expect(acceptance).toContain("needs: release_candidate");
    expect(acceptance).toContain("os: [ubuntu-24.04, windows-2022]");
    expect(acceptance).toContain("node: [22.12.0, 24.11.1]");
    expect(acceptance.indexOf("download-actions-artifact.mjs")).toBeLessThan(
      acceptance.indexOf("npm ci"),
    );
    expect(acceptance.indexOf("--verify-candidate true")).toBeLessThan(
      acceptance.indexOf("npm ci"),
    );
    expect(acceptance).toContain(
      "--source downloaded-m8-cli-candidate -- packages/render/test/determinism.test.ts",
    );
    expect(acceptance).toContain(
      "m8-cli-acceptance-${{ matrix.os }}-node-${{ matrix.node }}",
    );
    expect(acceptance).not.toMatch(
      /release-pack\.sh|release:pack|THERMITE_SCHEMATICS_RELEASE_AUTHORITY = "local-task6"/u,
    );

    expect(gate).toContain("needs: [release_candidate, acceptance]");
    expect(gate).toContain("if: always()");
    expect(gate).toContain(
      'test "${{ needs.release_candidate.result }}" = success',
    );
    expect(gate).toContain('test "${{ needs.acceptance.result }}" = success');
    expect(gate).toContain('--evidence-files "producer-ubuntu-24.04');
    expect(gate).toContain('payload_root="$root/payload"');
    expect(gate).toContain(
      'cp "$evidence_root/release-gate.evidence.json" "$payload_root/release-gate.evidence.json"',
    );
    const payloadUpload = gate.slice(
      gate.indexOf("- name: Upload exact gate payload"),
      gate.indexOf("- name: Create queried gate receipt"),
    );
    expect(payloadUpload).toContain(
      "${{ env.root }}/payload/thermite-cli-0.2.0.tgz",
    );
    expect(payloadUpload).toContain(
      "${{ env.root }}/payload/release-gate.evidence.json",
    );
    expect(payloadUpload).not.toContain("${{ env.root }}/candidate/");
    expect(payloadUpload).not.toContain("${{ env.root }}/evidence/");
    expect(gate.indexOf("Upload exact gate payload")).toBeLessThan(
      gate.indexOf("Create queried gate receipt"),
    );
    expect(stepNames(gate).slice(-4)).toEqual([
      "Upload exact gate payload",
      "Create queried gate receipt",
      "Scan exact receipt upload",
      "Upload gate receipt only",
    ]);
    expect(text).not.toMatch(
      /^\s*(?:pull_request|pull_request_target|workflow_call|workflow_run|workflow_dispatch|tags|tags-ignore):/gmu,
    );
    expect(text).not.toMatch(/contents:\s*write|id-token:|secrets\./u);
    expect(
      (text.match(/uses: actions\/upload-artifact@v4/gu) ?? []).length,
    ).toBe(5);
    expect(text).not.toContain("actions/download-artifact");
  });

  it("parses the exact protected-environment publisher", async () => {
    const text = await readFile(publisherPath, "utf8");
    expect(text.startsWith(publisherHeader)).toBe(true);
    expect(mappingKeys(text, 0)).toEqual(["name", "on", "permissions", "jobs"]);
    expect(mappingKeys(block(text, "jobs", 0), 2)).toEqual(["publish"]);
    expect(text).toContain("runs-on: ubuntu-24.04");
    expect(text).toContain("node-version: 24.11.1");
    expect(text).toContain(
      'run: node scripts/release-publish.mjs --gate-run-id "${{ inputs.gate_run_id }}"',
    );
    expect(text).not.toMatch(
      /pull_request|workflow_call|workflow_run|tags:|packages:|id-token:|--tar|--sha|--commit|artifact[_-](?:id|name|digest)/u,
    );
    expect(text.match(/contents: write/gu)).toHaveLength(1);
    expect(text.match(/actions: read/gu)).toHaveLength(1);
    expect(text).not.toContain("upload-artifact");
  });
});

describe("hard-verified Actions ZIP ingestion", () => {
  it("normalizes only the exact bare and prefixed digest forms", () => {
    const digest = "a".repeat(64);
    expect(normalizeArtifactDigest(digest, "bare")).toBe(digest);
    expect(normalizeArtifactDigest(`sha256:${digest}`, "prefixed")).toBe(
      digest,
    );
    for (const invalid of [
      digest.toUpperCase(),
      `SHA256:${digest}`,
      `sha512:${digest}`,
      ` ${digest}`,
      `${digest} `,
      "a".repeat(63),
    ]) {
      expect(() => normalizeArtifactDigest(invalid)).toThrow(/ART002/u);
    }
  });

  it("rejects escaping, duplicate, extra, and link ZIP entries", async () => {
    await expect(
      readSafeZipArchive(
        createStoredZip([{ name: "../escape", bytes: Buffer.from("x") }]),
      ),
    ).rejects.toThrow(/ZIP001/u);
    await expect(
      readSafeZipArchive(
        createStoredZip([
          { name: "same", bytes: Buffer.from("a") },
          { name: "same", bytes: Buffer.from("b") },
        ]),
      ),
    ).rejects.toThrow(/ZIP001/u);
    await expect(
      readSafeZipArchive(
        createStoredZip([{ name: "extra", bytes: Buffer.from("x") }]),
        { expectedFiles: ["expected"] },
      ),
    ).rejects.toThrow(/ZIP001/u);
    await expect(
      readSafeZipArchive(
        createStoredZip([
          { name: "link", bytes: Buffer.from("target"), mode: 0o120777 },
        ]),
      ),
    ).rejects.toThrow(/ZIP001/u);
  });

  it("hashes the complete archive before creating the extraction root", async () => {
    const root = await mkdtemp(join(tmpdir(), "m8-artifact-hash-"));
    const archive = join(root, "artifact.zip");
    const extraction = join(root, "extracted");
    const zip = createStoredZip([
      { name: "evidence.json", bytes: Buffer.from("{}\n") },
    ]);
    const wrong = "b".repeat(64);
    const request = async (url: string) => {
      if (url.endsWith("/zip")) return new Response(zip);
      return Response.json({
        id: 7,
        name: "evidence",
        expired: false,
        digest: `sha256:${wrong}`,
        workflow_run: { id: 9 },
      });
    };
    try {
      await expect(
        downloadActionsArtifact({
          artifactId: "7",
          artifactName: "evidence",
          artifactDigest: wrong,
          workflowRunId: "9",
          token: "token",
          archivePath: archive,
          extractDirectory: extraction,
          expectedFiles: ["evidence.json"],
          request,
        }),
      ).rejects.toThrow("ART005 Actions artifact archive SHA-256 mismatch.");
      await expect(lstat(archive)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(extraction)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("extracts the exact ordinary file set after a matching archive hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "m8-artifact-valid-"));
    const archive = join(root, "artifact.zip");
    const extraction = join(root, "extracted");
    const bytes = Buffer.from("verified\n");
    const zip = createStoredZip([{ name: "evidence.json", bytes }]);
    const digest = sha256(zip);
    const request = async (url: string) => {
      if (url.endsWith("/zip")) return new Response(zip);
      return Response.json({
        id: 7,
        name: "evidence",
        expired: false,
        digest: `sha256:${digest}`,
        workflow_run: { id: 9 },
      });
    };
    try {
      await downloadActionsArtifact({
        artifactId: "7",
        artifactName: "evidence",
        artifactDigest: digest,
        workflowRunId: "9",
        token: "token",
        archivePath: archive,
        extractDirectory: extraction,
        expectedFiles: ["evidence.json"],
        request,
      });
      expect(await readFile(join(extraction, "evidence.json"))).toEqual(bytes);
      await expect(
        extractSafeZipArchive(zip, extraction, {
          expectedFiles: ["evidence.json"],
        }),
      ).rejects.toThrow(/ZIP002/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects timing, raw reporter, and absolute host-path evidence", () => {
    expect(() => assertPortableEvidenceValue({ startTime: 1 })).toThrow(
      /Raw Vitest\/timing/u,
    );
    expect(() =>
      assertPortableEvidenceValue({ file: "C:\\checkout\\test.ts" }),
    ).toThrow(/Absolute or non-POSIX/u);
    expect(() => assertPortableEvidenceValue({ root: "/runner/temp" })).toThrow(
      /Absolute or non-POSIX/u,
    );
  });
});

function validCandidateRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    name: "M8 Release Candidate",
    path: ".github/workflows/release-candidate.yml",
    event: "push",
    head_branch: "dev",
    head_sha: "c".repeat(40),
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    head_repository: { full_name: "BlackettApplied/ThermiteSchematics" },
    ...overrides,
  };
}

type WorkflowJob = {
  id: number;
  name: string;
  run_attempt: number;
  status: string;
  conclusion: string | null;
};

function workflowJobs({
  runAttempt = 1,
  gateStatus = "completed",
  gateConclusion = "success",
}: {
  runAttempt?: number;
  gateStatus?: string;
  gateConclusion?: string | null;
} = {}): WorkflowJob[] {
  return RELEASE_JOB_NAMES.map((name, index) => ({
    id: 1000 + index,
    name,
    run_attempt: runAttempt,
    status: name === "release_gate" ? gateStatus : "completed",
    conclusion: name === "release_gate" ? gateConclusion : "success",
  }));
}

function jobObservations(jobs: readonly WorkflowJob[]) {
  return jobs
    .map((job) => ({
      name: job.name,
      id: String(job.id),
      status: job.status,
      conclusion: job.conclusion,
    }))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
}

function gateRunObservation(conclusion: string | null = null) {
  return {
    event: "push",
    headBranch: "dev",
    headSha: "c".repeat(40),
    path: ".github/workflows/release-candidate.yml",
    runAttempt: 1,
    status: "in_progress",
    conclusion,
  };
}

function releaseAuthority(runAttempt = 1) {
  return {
    repository: "BlackettApplied/ThermiteSchematics",
    sourceCommit: "c".repeat(40),
    workflow: {
      name: "M8 Release Candidate",
      path: ".github/workflows/release-candidate.yml",
      runId: "123",
      runAttempt,
      event: "push",
      ref: "refs/heads/dev",
    },
    candidateArtifact: {
      name: "m8-cli-candidate-123-" + runAttempt,
      id: "456",
      digest: "sha256:" + "a".repeat(64),
    },
  };
}

const publisherEnvironment = {
  GITHUB_REPOSITORY: "BlackettApplied/ThermiteSchematics",
  GITHUB_TOKEN: "test-token",
};
const privateRepository = {
  full_name: "BlackettApplied/ThermiteSchematics",
  private: true,
  visibility: "private",
  fork: false,
  permissions: { push: true },
};

describe("Amendment C2 run and job authority", () => {
  it("paginates all attempts and records the required unfiltered mid-run conclusion", async () => {
    const authority = releaseAuthority(2);
    const priorAttempt = Array.from({ length: 100 }, (_, index) => ({
      id: 2000 + index,
      name: "prior-attempt-" + index,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
    }));
    const currentAttempt = workflowJobs({
      runAttempt: 2,
      gateStatus: "in_progress",
      gateConclusion: null,
    });
    const urls: string[] = [];
    const authorizations: Array<string | null> = [];
    const request = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      urls.push(url);
      authorizations.push(new Headers(init?.headers).get("Authorization"));
      if (url.endsWith("/actions/runs/123")) {
        return Response.json({
          ...validCandidateRun({
            run_attempt: 2,
            status: "in_progress",
            conclusion: "failure",
          }),
        });
      }
      if (
        url.endsWith("/actions/runs/123/jobs?filter=all&per_page=100&page=1")
      ) {
        return Response.json({ total_count: 106, jobs: priorAttempt });
      }
      if (
        url.endsWith("/actions/runs/123/jobs?filter=all&per_page=100&page=2")
      ) {
        return Response.json({ total_count: 106, jobs: currentAttempt });
      }
      if (url.endsWith("/actions/artifacts/456")) {
        return Response.json({
          id: 456,
          name: "m8-cli-candidate-123-2",
          expired: false,
          digest: "sha256:" + "a".repeat(64),
          workflow_run: { id: 123 },
        });
      }
      throw new Error("Unexpected request " + url);
    };
    const observations = await queryInProgressReleaseGateAuthority(authority, {
      token: "token",
      request,
    });
    expect(observations.gateRun).toEqual({
      ...gateRunObservation("failure"),
      runAttempt: 2,
    });
    expect(observations.gateJobs).toEqual(jobObservations(currentAttempt));
    expect(urls.filter((url) => url.includes("/jobs?"))).toHaveLength(2);
    expect(authorizations).toEqual(Array(urls.length).fill("Bearer token"));
  });

  it("rejects a missing run conclusion and every non-successful sibling topology", async () => {
    const authority = releaseAuthority();
    const runWithoutConclusion = validCandidateRun({
      status: "in_progress",
    }) as Record<string, unknown>;
    delete runWithoutConclusion.conclusion;
    await expect(
      queryInProgressReleaseGateAuthority(authority, {
        token: "token",
        request: async () => Response.json(runWithoutConclusion),
      }),
    ).rejects.toThrow(/in-progress gate authority/u);

    const failedSibling = workflowJobs();
    failedSibling[0] = { ...failedSibling[0], conclusion: "failure" };
    await expect(
      queryReleaseWorkflowJobs({
        runId: "123",
        runAttempt: 1,
        token: "token",
        request: async () =>
          Response.json({
            total_count: failedSibling.length,
            jobs: failedSibling,
          }),
      }),
    ).rejects.toThrow(/job observations/u);

    const extra = [
      ...workflowJobs(),
      {
        id: 9999,
        name: "unexpected",
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
      },
    ];
    await expect(
      queryReleaseWorkflowJobs({
        runId: "123",
        runAttempt: 1,
        token: "token",
        request: async () =>
          Response.json({ total_count: extra.length, jobs: extra }),
      }),
    ).rejects.toThrow(/job observation|job topology/u);
  });

  it("requires completed job success while preserving the receipt name and ID mapping", () => {
    const recorded = jobObservations(
      workflowJobs({ gateStatus: "in_progress", gateConclusion: null }),
    );
    const completed = jobObservations(workflowJobs());
    expect(assertCompletedReleaseJobsMatchReceipt(completed, recorded)).toEqual(
      completed,
    );
    const mismatched = recorded.map((row) =>
      row.name === "release_gate" ? { ...row, id: "9999" } : row,
    );
    expect(() =>
      assertCompletedReleaseJobsMatchReceipt(completed, mismatched),
    ).toThrow(/differs from the gate receipt/u);
    const failedGate = completed.map((row) =>
      row.name === "release_gate" ? { ...row, conclusion: "failure" } : row,
    );
    expect(() =>
      assertCompletedReleaseJobsMatchReceipt(failedGate, recorded),
    ).toThrow(/job observations/u);
  });
});

describe("publisher API authority retrieval", () => {
  it("accepts only the run ID and optional dry-run flag", () => {
    expect(parsePublisherArguments(["--gate-run-id", "123"])).toEqual({
      gateRunId: "123",
      dryRun: false,
    });
    expect(
      parsePublisherArguments(["--gate-run-id", "123", "--dry-run"]),
    ).toEqual({ gateRunId: "123", dryRun: true });
    for (const flag of [
      "--tar",
      "--sha",
      "--commit",
      "--tag",
      "--artifact-id",
      "--artifact-name",
      "--artifact-digest",
    ]) {
      expect(() =>
        parsePublisherArguments(["--gate-run-id", "123", flag]),
      ).toThrow(/Usage:/u);
    }
  });

  it.each([
    ["status", { status: "in_progress" }],
    ["conclusion", { conclusion: "failure" }],
    ["path", { path: ".github/workflows/other.yml" }],
    ["event", { event: "workflow_dispatch" }],
    ["branch", { head_branch: "main" }],
    ["commit", { head_sha: "not-a-commit" }],
    ["attempt", { run_attempt: 0 }],
    ["repository", { head_repository: { full_name: "other/repo" } }],
  ])(
    "rejects candidate run %s drift before artifact access",
    async (_label, drift) => {
      const urls: string[] = [];
      const request = async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/repos/BlackettApplied/ThermiteSchematics")) {
          return Response.json(privateRepository);
        }
        if (url.endsWith("/actions/runs/123")) {
          return Response.json(validCandidateRun(drift));
        }
        throw new Error(`Unexpected request ${url}`);
      };
      await expect(
        publishRelease({
          gateRunId: "123",
          environment: publisherEnvironment,
          request,
        }),
      ).rejects.toThrow(/successful protected candidate run/u);
      expect(urls.some((url) => url.includes("/artifacts"))).toBe(false);
    },
  );

  it("rejects incomplete completed-job topology before artifact access", async () => {
    const urls: string[] = [];
    const jobs = workflowJobs().slice(0, -1);
    const request = async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/repos/BlackettApplied/ThermiteSchematics")) {
        return Response.json(privateRepository);
      }
      if (url.endsWith("/actions/runs/123")) {
        return Response.json(validCandidateRun());
      }
      if (url.includes("/actions/runs/123/jobs?")) {
        return Response.json({ total_count: jobs.length, jobs });
      }
      throw new Error("Unexpected request " + url);
    };
    await expect(
      publishRelease({
        gateRunId: "123",
        environment: publisherEnvironment,
        request,
      }),
    ).rejects.toThrow(/job topology/u);
    expect(urls.some((url) => url.includes("/artifacts"))).toBe(false);
  });

  it("binds the receipt to the numeric payload artifact and hard-fails digest drift", async () => {
    const receipt = {
      format: "thermite-schematics-release-gate-receipt/0.1",
      repository: "BlackettApplied/ThermiteSchematics",
      sourceCommit: "c".repeat(40),
      workflow: {
        name: "M8 Release Candidate",
        path: ".github/workflows/release-candidate.yml",
        runId: "123",
        runAttempt: 1,
        event: "push",
        ref: "refs/heads/dev",
      },
      gateRun: gateRunObservation(),
      gateJobs: jobObservations(
        workflowJobs({ gateStatus: "in_progress", gateConclusion: null }),
      ),
      payloadArtifact: {
        name: "m8-release-gate-payload-123-1",
        id: "22",
        digest: `sha256:${"a".repeat(64)}`,
      },
      aggregateEvidence: {
        file: "release-gate.evidence.json",
        sha256: "d".repeat(64),
      },
    };
    const receiptZip = createStoredZip([
      {
        name: "release-gate-receipt.json",
        bytes: Buffer.from(`${JSON.stringify(receipt, undefined, 2)}\n`),
      },
    ]);
    const receiptDigest = sha256(receiptZip);
    const methods: string[] = [];
    const request = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      methods.push(init?.method ?? "GET");
      if (url.endsWith("/repos/BlackettApplied/ThermiteSchematics")) {
        return Response.json(privateRepository);
      }
      if (url.endsWith("/actions/runs/123")) {
        return Response.json(validCandidateRun());
      }
      if (
        url.endsWith("/actions/runs/123/jobs?filter=all&per_page=100&page=1")
      ) {
        return Response.json({ total_count: 6, jobs: workflowJobs() });
      }
      if (url.includes("/actions/runs/123/artifacts?")) {
        return Response.json({
          artifacts: [
            {
              id: 11,
              name: "m8-release-gate-receipt-123-1",
              expired: false,
              digest: `sha256:${receiptDigest}`,
              workflow_run: { id: 123 },
            },
          ],
        });
      }
      if (url.endsWith("/actions/artifacts/11")) {
        return Response.json({
          id: 11,
          name: "m8-release-gate-receipt-123-1",
          expired: false,
          digest: `sha256:${receiptDigest}`,
          workflow_run: { id: 123 },
        });
      }
      if (url.endsWith("/actions/artifacts/11/zip")) {
        return new Response(receiptZip);
      }
      if (url.endsWith("/actions/artifacts/22")) {
        return Response.json({
          id: 22,
          name: "m8-release-gate-payload-123-1",
          expired: false,
          digest: `sha256:${"b".repeat(64)}`,
          workflow_run: { id: 123 },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };
    await expect(
      publishRelease({
        gateRunId: "123",
        environment: publisherEnvironment,
        request,
      }),
    ).rejects.toThrow("ART002 Upload and REST artifact digests differ.");
    expect(methods.every((method) => method === "GET")).toBe(true);
  });
});

const sourceCommit = "c".repeat(40);
const gateRunId = "123";
const payloadArtifactId = "456";
const tarBytes = Buffer.from("deterministic tar bytes");
const tarDigest = sha256(tarBytes);
const shaBytes = Buffer.from(`${tarDigest}  thermite-cli-0.2.0.tgz\n`);
const expectedAssets = [
  {
    name: "thermite-cli-0.2.0.tgz",
    bytes: tarBytes,
    size: tarBytes.length,
    sha256: tarDigest,
  },
  {
    name: "thermite-cli-0.2.0.tgz.sha256",
    bytes: shaBytes,
    size: shaBytes.length,
    sha256: sha256(shaBytes),
  },
] as const;

type ExpectedAsset = (typeof expectedAssets)[number];
type AssetState = "starter" | "uploaded";
type Asset = {
  id: number;
  name: string;
  state: AssetState;
  label: string;
  size: number;
  digest: string;
  url: string;
  bytes: Buffer;
};
type PublisherHarness = {
  draft: boolean;
  publishedAt: string | null;
  assets: Asset[];
  mutations: string[];
  uploadCalls: number;
  publishCalls: number;
  nextId: number;
  releaseUrl: string;
  tagCommit: string;
  client: {
    getRelease(id: number): Promise<object>;
    getTagCommit(tag: string): Promise<string>;
    listReleaseAssets(id: number): Promise<Asset[]>;
    getReleaseAsset(id: number): Promise<Asset>;
    downloadReleaseAsset(id: number): Promise<Buffer>;
    deleteReleaseAsset(id: number): Promise<number>;
    uploadReleaseAsset(
      id: number,
      input: { name: string; label: string; bytes: Buffer },
    ): Promise<object>;
    publishRelease(id: number, body: { draft: false }): Promise<object>;
  };
};
type HarnessOptions = {
  draft?: boolean;
  assets?: Asset[];
  releaseUrl?: string;
  tagCommit?: string;
  releaseOverrides?: Record<string, unknown>;
  deleteStatus?: number;
  upload?: (
    harness: PublisherHarness,
    name: string,
    call: number,
  ) => Promise<void> | void;
  publish?: (harness: PublisherHarness, call: number) => Promise<void> | void;
  getAsset?: (asset: Asset) => Asset;
};

function expectedAsset(name: string) {
  const expected = expectedAssets.find((asset) => asset.name === name);
  if (expected === undefined) throw new Error("Unknown expected asset.");
  return expected;
}

function releaseAsset(
  expected: ExpectedAsset,
  id: number,
  state: AssetState = "uploaded",
  overrides: Partial<Asset> = {},
): Asset {
  return {
    id,
    name: expected.name,
    state,
    label:
      `m8-gate-run=${gateRunId};payload-artifact=${payloadArtifactId};` +
      `sha256=${expected.sha256}`,
    size: expected.size,
    digest: `sha256:${expected.sha256}`,
    url:
      "https://api.github.com/repos/BlackettApplied/ThermiteSchematics/" +
      `releases/assets/${id}`,
    bytes: Buffer.from(expected.bytes),
    ...overrides,
  };
}

function createPublisherHarness(
  options: HarnessOptions = {},
): PublisherHarness {
  const harness = {
    draft: options.draft ?? true,
    publishedAt: options.draft === false ? "2026-08-28T00:00:00Z" : null,
    assets: [...(options.assets ?? [])],
    mutations: [],
    uploadCalls: 0,
    publishCalls: 0,
    nextId: 100,
    releaseUrl:
      options.releaseUrl ??
      "https://api.github.com/repos/BlackettApplied/ThermiteSchematics/releases/77",
    tagCommit: options.tagCommit ?? sourceCommit,
    client: undefined,
  } as unknown as PublisherHarness;
  harness.client = {
    async getRelease(id) {
      return {
        id,
        url: harness.releaseUrl,
        tag_name: "v0.2.0",
        prerelease: false,
        draft: harness.draft,
        published_at: harness.publishedAt,
        ...options.releaseOverrides,
      };
    },
    async getTagCommit() {
      return harness.tagCommit;
    },
    async listReleaseAssets() {
      return harness.assets.map((asset) => ({ ...asset }));
    },
    async getReleaseAsset(id) {
      const asset = harness.assets.find((candidate) => candidate.id === id);
      if (asset === undefined) throw new Error("Missing fake asset.");
      return { ...(options.getAsset?.(asset) ?? asset) };
    },
    async downloadReleaseAsset(id) {
      const asset = harness.assets.find((candidate) => candidate.id === id);
      if (asset === undefined) throw new Error("Missing fake asset.");
      return Buffer.from(asset.bytes);
    },
    async deleteReleaseAsset(id) {
      harness.mutations.push(`delete:${id}`);
      if ((options.deleteStatus ?? 204) === 204) {
        harness.assets = harness.assets.filter((asset) => asset.id !== id);
      }
      return options.deleteStatus ?? 204;
    },
    async uploadReleaseAsset(_id, input) {
      harness.uploadCalls += 1;
      harness.mutations.push(`upload:${input.name}`);
      if (options.upload !== undefined) {
        await options.upload(harness, input.name, harness.uploadCalls);
      } else {
        const expected = expectedAsset(input.name);
        harness.assets.push(
          releaseAsset(expected, harness.nextId, "uploaded", {
            label: input.label,
            bytes: Buffer.from(input.bytes),
          }),
        );
        harness.nextId += 1;
      }
      return {};
    },
    async publishRelease(_id, body) {
      harness.publishCalls += 1;
      harness.mutations.push(`publish:${JSON.stringify(body)}`);
      if (options.publish !== undefined) {
        await options.publish(harness, harness.publishCalls);
      } else {
        harness.draft = false;
        harness.publishedAt = "2026-08-28T00:00:00Z";
      }
      return {};
    },
  };
  return harness;
}

async function publishHarness(harness: PublisherHarness, dryRun = false) {
  return publishVerifiedReleaseAssets({
    client: harness.client,
    releaseId: 77,
    sourceCommit,
    gateRunId,
    payloadArtifactId,
    expectedAssets: [...expectedAssets],
    dryRun,
  });
}

describe("idempotent draft Release publisher state machine", () => {
  it.each([
    ["none", []],
    ["tar only", [releaseAsset(expectedAssets[0], 1)]],
    ["SHA only", [releaseAsset(expectedAssets[1], 2)]],
    [
      "both",
      [releaseAsset(expectedAssets[0], 1), releaseAsset(expectedAssets[1], 2)],
    ],
  ])("publishes a valid %s uploaded-asset draft", async (_label, assets) => {
    const harness = createPublisherHarness({ assets });
    const result = await publishHarness(harness);
    expect(result.status).toBe("published");
    expect(harness.assets.map((asset) => asset.name).sort()).toEqual(
      expectedAssets.map((asset) => asset.name).sort(),
    );
    expect(
      harness.mutations.filter((entry) => entry.startsWith("upload:")),
    ).toEqual(
      expectedAssets
        .filter(
          (expected) => !assets.some((asset) => asset.name === expected.name),
        )
        .map((expected) => `upload:${expected.name}`),
    );
    expect(harness.mutations.at(-1)).toBe('publish:{"draft":false}');
    expect(harness.draft).toBe(false);
  });

  it("accepts an exact already-published release as a zero-mutation retry", async () => {
    const harness = createPublisherHarness({
      draft: false,
      assets: [
        releaseAsset(expectedAssets[0], 1),
        releaseAsset(expectedAssets[1], 2),
      ],
    });
    await expect(publishHarness(harness)).resolves.toMatchObject({
      status: "already-published",
      mutated: false,
    });
    expect(harness.mutations).toEqual([]);
  });

  it.each(["draft", "published"])(
    "rejects an extra asset on %s entry without mutation",
    async (state) => {
      const harness = createPublisherHarness({
        draft: state === "draft",
        assets: [
          releaseAsset(expectedAssets[0], 1),
          releaseAsset(expectedAssets[1], 2),
          releaseAsset(expectedAssets[0], 3, "uploaded", {
            name: "unexpected.bin",
          }),
        ],
      });
      await expect(publishHarness(harness)).rejects.toThrow(/unrelated asset/u);
      expect(harness.mutations).toEqual([]);
    },
  );

  it("rejects duplicate names and every uploaded tuple mismatch without mutation", async () => {
    const cases = [
      [releaseAsset(expectedAssets[0], 1), releaseAsset(expectedAssets[0], 2)],
      [releaseAsset(expectedAssets[0], 1, "uploaded", { label: "wrong" })],
      [
        releaseAsset(expectedAssets[0], 1, "uploaded", {
          size: expectedAssets[0].size + 1,
        }),
      ],
      [
        releaseAsset(expectedAssets[0], 1, "uploaded", {
          digest: `sha256:${"0".repeat(64)}`,
        }),
      ],
      [
        releaseAsset(expectedAssets[0], 1, "uploaded", {
          bytes: Buffer.from("wrong"),
        }),
      ],
      [
        releaseAsset(expectedAssets[0], 1, "uploaded", {
          url: "https://example.invalid/asset",
        }),
      ],
    ];
    for (const assets of cases) {
      const harness = createPublisherHarness({ assets });
      await expect(publishHarness(harness)).rejects.toThrow(/PUB003|PUB005/u);
      expect(harness.mutations).toEqual([]);
    }
  });

  it("rejects a hash-valid SHA asset whose text does not bind the tar name", async () => {
    const wrongShaBytes = Buffer.from(`${tarDigest}  wrong-name.tgz\n`);
    const wrongSha = {
      name: "thermite-cli-0.2.0.tgz.sha256",
      bytes: wrongShaBytes,
      size: wrongShaBytes.length,
      sha256: sha256(wrongShaBytes),
    };
    const harness = createPublisherHarness({
      assets: [releaseAsset(expectedAssets[0], 1), releaseAsset(wrongSha, 2)],
    });
    await expect(
      publishVerifiedReleaseAssets({
        client: harness.client,
        releaseId: 77,
        sourceCommit,
        gateRunId,
        payloadArtifactId,
        expectedAssets: [expectedAssets[0], wrongSha],
      }),
    ).rejects.toThrow(/SHA asset content differs/u);
    expect(harness.mutations).toEqual([]);
  });

  it.each([
    ["tar", expectedAssets[0], undefined],
    ["SHA", expectedAssets[1], undefined],
    ["tar beside SHA", expectedAssets[0], expectedAssets[1]],
    ["SHA beside tar", expectedAssets[1], expectedAssets[0]],
  ])(
    "recovers one verified %s starter and uploads only the missing tuples",
    async (_label, starter, peer) => {
      const assets = [
        releaseAsset(starter, 5, "starter"),
        ...(peer === undefined ? [] : [releaseAsset(peer, 6)]),
      ];
      const harness = createPublisherHarness({ assets });
      await expect(publishHarness(harness)).resolves.toMatchObject({
        status: "published",
      });
      expect(harness.mutations).toContain("delete:5");
      expect(harness.mutations).toContain(`upload:${starter.name}`);
      expect(harness.assets.every((asset) => asset.state === "uploaded")).toBe(
        true,
      );
    },
  );

  it("requires DELETE 204 and full starter identity before recovery", async () => {
    const badDelete = createPublisherHarness({
      assets: [releaseAsset(expectedAssets[0], 5, "starter")],
      deleteStatus: 202,
    });
    await expect(publishHarness(badDelete)).rejects.toThrow(
      /did not return 204/u,
    );
    expect(badDelete.mutations).toEqual(["delete:5"]);

    const badIdentity = createPublisherHarness({
      assets: [releaseAsset(expectedAssets[0], 5, "starter")],
      getAsset: (asset) => ({
        ...asset,
        url: "https://example.invalid/asset",
      }),
    });
    await expect(publishHarness(badIdentity)).rejects.toThrow(
      /identity differs/u,
    );
    expect(badIdentity.mutations).toEqual([]);
  });

  it.each([
    ["tar", expectedAssets[0], []],
    ["SHA", expectedAssets[1], [releaseAsset(expectedAssets[0], 1)]],
  ])(
    "recovers a %s starter observed after an indeterminate upload",
    async (_label, targetAsset, initialAssets) => {
      const harness = createPublisherHarness({
        assets: initialAssets,
        upload(target, name, call) {
          const expected = expectedAsset(name);
          if (call === 1) {
            target.assets.push(releaseAsset(expected, 8, "starter"));
            const error = new Error("connection reset") as Error & {
              indeterminate: boolean;
            };
            error.indeterminate = true;
            throw error;
          }
          target.assets.push(releaseAsset(expected, target.nextId++));
        },
      });
      await expect(publishHarness(harness)).resolves.toMatchObject({
        status: "published",
      });
      expect(harness.mutations.slice(0, 3)).toEqual([
        `upload:${targetAsset.name}`,
        "delete:8",
        `upload:${targetAsset.name}`,
      ]);
    },
  );

  it("fails when the one starter recovery repeats", async () => {
    const harness = createPublisherHarness({
      assets: [releaseAsset(expectedAssets[0], 5, "starter")],
      upload(target, name) {
        target.assets.push(
          releaseAsset(expectedAsset(name), target.nextId++, "starter"),
        );
      },
    });
    await expect(publishHarness(harness)).rejects.toThrow(/repeated/u);
    expect(harness.publishCalls).toBe(0);
  });

  it("accepts an uploaded tuple discovered after an indeterminate upload", async () => {
    const harness = createPublisherHarness({
      upload(target, name, call) {
        target.assets.push(releaseAsset(expectedAsset(name), target.nextId++));
        if (call === 1) {
          const error = new Error("connection reset") as Error & {
            indeterminate: boolean;
          };
          error.indeterminate = true;
          throw error;
        }
      },
    });
    await expect(publishHarness(harness)).resolves.toMatchObject({
      status: "published",
    });
    expect(harness.uploadCalls).toBe(2);
  });

  it.each([1, 2])(
    "rejects a concurrent extra asset after upload %i and never publishes",
    async (extraAfter) => {
      const harness = createPublisherHarness({
        upload(target, name, call) {
          target.assets.push(
            releaseAsset(expectedAsset(name), target.nextId++),
          );
          if (call === extraAfter) {
            target.assets.push(
              releaseAsset(expectedAssets[0], target.nextId++, "uploaded", {
                name: "race.bin",
              }),
            );
          }
        },
      });
      await expect(publishHarness(harness)).rejects.toThrow(/unrelated asset/u);
      expect(harness.publishCalls).toBe(0);
    },
  );

  it("requires every fixed Release and peeled-tag identity before mutation", async () => {
    for (const harness of [
      createPublisherHarness({
        releaseUrl: "https://example.invalid/release",
      }),
      createPublisherHarness({ tagCommit: "d".repeat(40) }),
      createPublisherHarness({ releaseOverrides: { id: 78 } }),
      createPublisherHarness({
        releaseOverrides: { tag_name: "v0.2.1" },
      }),
      createPublisherHarness({ releaseOverrides: { prerelease: true } }),
      createPublisherHarness({
        releaseOverrides: { draft: "not-boolean" },
      }),
      createPublisherHarness({
        draft: false,
        releaseOverrides: { published_at: null },
      }),
    ]) {
      await expect(publishHarness(harness)).rejects.toThrow(
        /authority changed/u,
      );
      expect(harness.mutations).toEqual([]);
    }
  });

  it("requires explicit successful publication and preserves rejection", async () => {
    const harness = createPublisherHarness({
      assets: [
        releaseAsset(expectedAssets[0], 1),
        releaseAsset(expectedAssets[1], 2),
      ],
      publish() {
        throw new Error("rejected");
      },
    });
    await expect(publishHarness(harness)).rejects.toThrow("rejected");
    expect(harness.draft).toBe(true);
    expect(harness.publishCalls).toBe(1);
  });

  it.each(["published", "draft"])(
    "recovers an indeterminate publish observed %s",
    async (observed) => {
      const harness = createPublisherHarness({
        assets: [
          releaseAsset(expectedAssets[0], 1),
          releaseAsset(expectedAssets[1], 2),
        ],
        publish(target, call) {
          if (call === 1) {
            if (observed === "published") {
              target.draft = false;
              target.publishedAt = "2026-08-28T00:00:00Z";
            }
            const error = new Error("connection reset") as Error & {
              indeterminate: boolean;
            };
            error.indeterminate = true;
            throw error;
          }
          target.draft = false;
          target.publishedAt = "2026-08-28T00:00:00Z";
        },
      });
      await expect(publishHarness(harness)).resolves.toMatchObject({
        status: "published",
      });
      expect(harness.publishCalls).toBe(observed === "published" ? 1 : 2);
    },
  );

  it("rejects an extra asset appearing after PATCH", async () => {
    const harness = createPublisherHarness({
      assets: [
        releaseAsset(expectedAssets[0], 1),
        releaseAsset(expectedAssets[1], 2),
      ],
      publish(target) {
        target.draft = false;
        target.publishedAt = "2026-08-28T00:00:00Z";
        target.assets.push(
          releaseAsset(expectedAssets[0], 9, "uploaded", {
            name: "post-patch-race.bin",
          }),
        );
      },
    });
    await expect(publishHarness(harness)).rejects.toThrow(/unrelated asset/u);
    expect(harness.publishCalls).toBe(1);
  });

  it("treats published missing, starter, and mismatched tuples as zero-mutation failures", async () => {
    const states = [
      [releaseAsset(expectedAssets[0], 1)],
      [
        releaseAsset(expectedAssets[0], 1, "starter"),
        releaseAsset(expectedAssets[1], 2),
      ],
      [
        releaseAsset(expectedAssets[0], 1),
        releaseAsset(expectedAssets[1], 2, "uploaded", {
          size: expectedAssets[1].size + 1,
        }),
      ],
    ];
    for (const assets of states) {
      const harness = createPublisherHarness({
        draft: false,
        assets,
      });
      await expect(publishHarness(harness)).rejects.toThrow(/PUB003|PUB005/u);
      expect(harness.mutations).toEqual([]);
    }
  });

  it("dry-run validates present assets and performs no mutation", async () => {
    const harness = createPublisherHarness({
      assets: [releaseAsset(expectedAssets[0], 1)],
    });
    await expect(publishHarness(harness, true)).resolves.toMatchObject({
      status: "dry-run",
      mutated: false,
      missing: [expectedAssets[1].name],
    });
    expect(harness.mutations).toEqual([]);
  });
});
