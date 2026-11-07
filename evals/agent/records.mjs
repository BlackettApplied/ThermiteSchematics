import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256 } from "./snapshot.mjs";
import { canonical } from "./source-files.mjs";
const withoutJudgement = (r) => {
  const { judges, judgement, adjudication, ...facts } = r;
  return canonical(facts);
};
export function readRun(file) {
  const record = JSON.parse(readFileSync(file, "utf8")),
    decisionPath = join(dirname(file), "infra-adjudication.json");
  if (!existsSync(decisionPath)) return record;
  const originalBytes = readFileSync(join(dirname(file), "manifest.json")),
    original = JSON.parse(originalBytes),
    decision = JSON.parse(readFileSync(decisionPath, "utf8"));
  assert.equal(
    decision.originalManifestHash,
    sha256(originalBytes),
    "Infra adjudication does not match original manifest",
  );
  assert.equal(
    original.status,
    "needs-adjudication",
    "Only an unresolved terminal error can be adjudicated",
  );
  assert.equal(
    withoutJudgement(record),
    withoutJudgement(original),
    "Infra adjudication changes original facts",
  );
  assert(
    ["infrastructure", "agent-failure"].includes(decision.resolution) &&
      decision.reason?.trim() &&
      decision.operator?.trim(),
    "Invalid infra adjudication",
  );
  return {
    ...record,
    infraAdjudication: decision,
    status:
      decision.resolution === "agent-failure"
        ? "complete"
        : "infrastructure-failure",
    infrastructureKind:
      decision.resolution === "infrastructure" ? "adjudicated" : null,
    outcome: { ...record.outcome, pass: false },
    agentFailure: "adjudicated-" + decision.resolution,
  };
}
export function adjudicateRun(
  directory,
  { resolution, reason, operator, now = Date.now() },
) {
  assert(
    ["infrastructure", "agent-failure"].includes(resolution),
    "Use infrastructure or agent-failure",
  );
  assert(
    reason?.trim() && operator?.trim(),
    "Adjudication needs a reason and operator",
  );
  const bytes = readFileSync(join(directory, "manifest.json")),
    record = JSON.parse(bytes);
  assert.equal(
    record.status,
    "needs-adjudication",
    "Only needs-adjudication can be adjudicated",
  );
  const decision = {
    format: "thermite-infra-adjudication/1.0",
    originalManifestHash: sha256(bytes),
    resolution,
    reason,
    operator,
    at: now,
  };
  writeFileSync(
    join(directory, "infra-adjudication.json"),
    JSON.stringify(decision, null, 2) + "\n",
    { flag: "wx" },
  );
  return decision;
}
