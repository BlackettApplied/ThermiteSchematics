import { contributorRealpath } from "../../../agent/contributor-bun.mjs";
import { join } from "node:path";
import { write } from "../../../agent/task-support.mjs";
import {
  bun,
  contributorState,
  focus,
  ownInstall,
  reported,
} from "../support.mjs";
import { completedWorkflow } from "../receipts.mjs";
import { confinedRepair } from "./confinement.mjs";
import { queryProof } from "./query-proof.mjs";

export default function check(ctx) {
  const repository = join(contributorRealpath(ctx.project), "engine");
  const { revision } = contributorState(ctx);
  const checks = {
    confined: confinedRepair(ctx, repository, revision),
    ownInstall: ownInstall(repository),
    report: reported(ctx),
    ...completedWorkflow(ctx, repository, {
      queryRepair: true,
    }),
  };
  if (!Object.values(checks).every(Boolean)) return { pass: false, checks };
  const focused = bun(
    { ...ctx, env: { ...ctx.env, THERMITE_CONTRIBUTOR_BUN: "" } },
    repository,
    "scripts/test.mjs",
    focus,
    "packages/query/test/inspect.test.ts",
  );
  const built = queryProof(ctx, repository);
  checks.independentFocused = focused.exit === 0;
  checks.hidden = built.pass;
  write(join(ctx.evidence, "contributor-check.json"), { focused, built });
  return { pass: Object.values(checks).every(Boolean), checks };
}
