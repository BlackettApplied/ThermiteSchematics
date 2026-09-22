import { open, readFile, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { createHash } from "node:crypto";

export const RELEASE_INSTALL_TEST_NAME =
  "shared release candidate offline install > installs the injected downloaded candidate without registry or lifecycle execution";
export const EMPTY_FOLDER_TEST_NAME =
  "installed empty-folder release workflow > runs the complete workflow twice against the injected downloaded candidate";
export const AUTHORITY_ABSENT_REASON =
  "RELEASE-CANDIDATE-AUTHORITY-ABSENT: candidate injection is not available in ordinary CI.";

export type CandidateAuthority =
  | { readonly classifier: "absent" }
  | {
      readonly classifier:
        "local-task6-complete" | "protected-consumer-complete";
      readonly candidate: string;
      readonly sha256: string;
    }
  | { readonly classifier: "partial-or-unknown"; readonly reason: string };

export async function classifyCandidateAuthority(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CandidateAuthority> {
  const mode = environment.THERMITE_SCHEMATICS_RELEASE_AUTHORITY;
  const candidate = environment.THERMITE_SCHEMATICS_RELEASE_CANDIDATE;
  const expectedSha = environment.THERMITE_SCHEMATICS_RELEASE_CANDIDATE_SHA256;
  const protectedAuthority =
    environment.THERMITE_SCHEMATICS_RELEASE_AUTHORITY_JSON;
  if (
    mode === undefined &&
    candidate === undefined &&
    expectedSha === undefined &&
    protectedAuthority === undefined
  ) {
    return { classifier: "absent" };
  }
  if (
    (mode !== "local-task6" && mode !== "protected-consumer") ||
    candidate === undefined ||
    !isAbsolute(candidate) ||
    !/^[0-9a-f]{64}$/u.test(expectedSha ?? "") ||
    (mode === "local-task6" && protectedAuthority !== undefined) ||
    (mode === "protected-consumer" && protectedAuthority === undefined)
  ) {
    return {
      classifier: "partial-or-unknown",
      reason: "candidate authority variables are incomplete",
    };
  }
  try {
    const stats = await lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return {
        classifier: "partial-or-unknown",
        reason: "candidate is not an ordinary file",
      };
    }
    const actualSha = createHash("sha256")
      .update(await readFile(candidate))
      .digest("hex");
    if (actualSha !== expectedSha) {
      return {
        classifier: "partial-or-unknown",
        reason: "candidate hash mismatch",
      };
    }
    if (mode === "protected-consumer") {
      const authority = JSON.parse(protectedAuthority);
      if (
        authority?.candidateArtifact === undefined ||
        authority?.workflow === undefined
      ) {
        return {
          classifier: "partial-or-unknown",
          reason: "protected authority object is incomplete",
        };
      }
    }
    return {
      classifier:
        mode === "local-task6"
          ? "local-task6-complete"
          : "protected-consumer-complete",
      candidate,
      sha256: expectedSha,
    };
  } catch {
    return {
      classifier: "partial-or-unknown",
      reason: "candidate authority could not be verified",
    };
  }
}

export async function writeCandidateBranchSidecar(
  file: "release-install-smoke.branch.json" | "empty-folder-smoke.branch.json",
  testFile:
    | "packages/cli/test/release-install-smoke.test.ts"
    | "packages/cli/test/empty-folder-smoke.test.ts",
  testName: string,
  authority: CandidateAuthority,
): Promise<void> {
  const sidecarRoot =
    process.env.THERMITE_SCHEMATICS_RELEASE_BRANCH_SIDECAR_DIR;
  if (sidecarRoot === undefined || !isAbsolute(sidecarRoot)) {
    throw new Error("Candidate branch sidecar directory is unavailable.");
  }
  if (authority.classifier === "partial-or-unknown") {
    throw new Error(
      `Partial or unknown release candidate authority: ${authority.reason}.`,
    );
  }
  const outcome =
    authority.classifier === "absent"
      ? {
          status: "skipped" as const,
          authorityClassifier: "absent" as const,
          branch: "RELEASE-CANDIDATE-AUTHORITY-ABSENT" as const,
          reason: AUTHORITY_ABSENT_REASON,
        }
      : {
          status: "executed" as const,
          authorityClassifier: authority.classifier,
          branch: "RELEASE-CANDIDATE-INJECTED" as const,
        };
  const record = {
    format: "thermite-schematics-release-test-branch/0.1",
    test: { file: testFile, name: testName },
    outcome,
  };
  const handle = await open(join(sidecarRoot, file), "wx", 0o644);
  try {
    await handle.writeFile(`${JSON.stringify(record, undefined, 2)}\n`);
  } finally {
    await handle.close();
  }
}
