import { describe, it } from "vitest";

import { acceptReleaseCandidate } from "../../../scripts/release-acceptance.mjs";
import {
  AUTHORITY_ABSENT_REASON,
  EMPTY_FOLDER_TEST_NAME,
  classifyCandidateAuthority,
  writeCandidateBranchSidecar,
} from "./release-candidate.js";

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

describe("installed empty-folder release workflow", () => {
  it("runs the complete workflow twice against the injected downloaded candidate", async ({
    skip,
  }) => {
    const authority = await classifyCandidateAuthority();
    await writeCandidateBranchSidecar(
      "empty-folder-smoke.branch.json",
      "packages/cli/test/empty-folder-smoke.test.ts",
      EMPTY_FOLDER_TEST_NAME,
      authority,
    );
    if (authority.classifier === "absent") {
      skip(AUTHORITY_ABSENT_REASON);
      return;
    }
    if (authority.classifier === "partial-or-unknown") {
      throw new Error(authority.reason);
    }
    try {
      await acceptReleaseCandidate({
        tarPath: authority.candidate,
        expectedSha: authority.sha256,
      });
    } catch (error) {
      if (isChildProcessDenied(error)) {
        skip(
          "RELEASE-EVIDENCE-DENIED: installed empty-folder child-process tier is unavailable.",
        );
        return;
      }
      throw error;
    }
  }, 120_000);
});
