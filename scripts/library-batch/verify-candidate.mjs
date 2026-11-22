import assert from "node:assert/strict";
import { readTypeContract } from "./verify-contracts.mjs";
import {
  recordReviewFlags,
  createCandidateFixture,
} from "./verify-fixture.mjs";
import {
  createVerificationCompiler,
  verifyNegativeChecks,
} from "./verify-checks.mjs";
import { writeVerificationPacket } from "./verify-packet.mjs";
export async function verifyCandidate(context, job, result) {
  const {
    flag,
    report,
    check,
    lockProject,
    diagnostic,
    json,
    assertNetPartition,
  } = context;
  for (const unresolved of result.unresolved)
    flag("unresolved-evidence", unresolved);
  if (result.decision === "needs-evidence") {
    report.status = "needs-evidence";
    flag("needs-evidence", result.summary);
  } else {
    const type = await check("identity-and-conformance", () =>
      readTypeContract({ ...context, job, result }),
    );
    const {
      terminalKeys: keys,
      fixedLinks: links,
      requiredTerminalKeys: required,
      renderKind,
    } = result.conformance;
    const stage = {
      ...context,
      job,
      result,
      type,
      keys,
      links,
      required,
      renderKind,
    };
    recordReviewFlags(stage);
    Object.assign(stage, await createCandidateFixture(stage));
    const { fixture } = stage;
    const compile = createVerificationCompiler(stage);
    const baseline = await check("compile-and-lock", async () => {
      const locked = await lockProject(fixture);
      diagnostic("lock", locked);
      assert.equal(locked.ok, true, json(locked.diagnostics));
      return compile("baseline");
    });
    for (const entry of baseline.diagnostics)
      flag("compiler-diagnostic", `${entry.code}: ${entry.message}`);
    await check("physical-net-partition", () =>
      assertNetPartition(baseline.ir, keys, links),
    );
    await verifyNegativeChecks({ ...stage, compile });
    await writeVerificationPacket({ ...stage, baseline });
    report.status = "verified-candidate";
  }
}
