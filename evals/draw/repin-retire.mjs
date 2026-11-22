import assert from "node:assert/strict";
import { supersededSuccessor } from "./repin-superseded.mjs";
import { renamedScope } from "./repin-policy.mjs";
import { keys, scopeId, classCheck, measured } from "./repin-primitives.mjs";
import { applyRename } from "./repin-rename.mjs";
export function applyRetirement(context, file, entry, common, getOld) {
  const {
    original,
    stale,
    checked,
    sheetRenames,
    specs,
    inventory,
    fresh,
    retired,
    staleWork,
    recordReceipt,
  } = context;
  const rename = entry.action === "rename",
    superseded = entry.action === "superseded";
  let successor;
  keys(
    entry,
    [
      ...common,
      ...(rename
        ? ["from", "to", "pairs", "crop", "columnMap"]
        : ["markerId", "scope", "cause", "instances"]),
      ...(superseded ? ["successor", "survivor", "sharedSuccessorReason"] : []),
    ],
    "decision",
  );
  const from = rename
    ? entry.from
    : { markerId: entry.markerId, scope: entry.scope };
  keys(from, ["markerId", "scope"], "source");
  const key = scopeId(from.markerId, from.scope),
    old = original.get(from.markerId),
    row = stale.get(key);
  assert(old && row, "Retirement/rename source must be a stale measured scope");
  classCheck(entry, old.kind);
  if (!rename && !superseded) {
    assert(
      ["fixed", "removed", "not-measured"].includes(entry.cause),
      "Retirement cause must be fixed, removed or not-measured",
    );
    const isMeasured = measured(
      checked.rows,
      old,
      renamedScope(from.scope, sheetRenames),
    );
    assert(
      entry.cause !== "not-measured" ? isMeasured : !isMeasured,
      "Retirement cause contradicts measurement availability",
    );
  }
  if (superseded) {
    assert(
      measured(checked.rows, old, renamedScope(from.scope, sheetRenames)),
      "Superseded source must be measured; book an unmeasured scope as not-measured",
    );
    const before = getOld(),
      group = before.groups.get(key);
    assert(group, "Baseline has no superseded source instances");
    const source = (entry.instances ?? group.tokens).map((token) => {
      assert(
        group.tokens.includes(token),
        "Unknown superseded source instance",
      );
      return before.byToken.get(token);
    });
    successor = supersededSuccessor(
      file,
      entry,
      source,
      inventory,
      sheetRenames,
      specs,
      original,
    );
  }
  if (
    !rename &&
    (superseded || entry.cause !== "not-measured") &&
    fresh.some(
      (b) =>
        b.scope.case === from.scope.case &&
        b.scope.medium === from.scope.medium &&
        b.facts.kind === old.kind,
    )
  ) {
    const before = getOld(),
      g = before.groups.get(key);
    assert(g, "Baseline has no retirement instances");
    retired.push(
      ...(entry.instances ?? g.tokens).map((t) => {
        const a = before.byToken.get(t);
        assert(a && g.tokens.includes(t), "Unknown retirement instance");
        return a;
      }),
    );
  }
  if (!staleWork.has(key))
    staleWork.set(key, {
      from,
      baseline: undefined,
      claims: new Set(),
      whole: false,
    });
  const work = staleWork.get(key);
  assert(!work.whole, "Conflicting whole-scope retirement");
  if (!rename && !entry.instances) {
    assert(!work.claims.size, "Conflicting retirement/rename decisions");
    work.whole = true;
    recordReceipt(entry, {
      pr: file.pr,
      action: entry.action,
      ...from,
      cause: entry.cause,
      ...(superseded
        ? { successor }
        : { measuredScope: renamedScope(from.scope, sheetRenames) }),
    });
    return;
  }
  const before = getOld(),
    g = before.groups.get(key);
  assert(g, "Baseline has no source instances");
  if (work.baseline)
    assert(
      work.baseline === file.baselineSha256,
      "Conflicting source baselines",
    );
  work.baseline = file.baselineSha256;
  work.tokens = new Set(g.tokens);
  if (rename) {
    applyRename(context, { file, entry, before, g, old, from, work });
  } else {
    retireInstances(context, {
      file,
      entry,
      g,
      from,
      work,
      superseded,
      successor,
    });
  }
}

export function retireInstances(
  context,
  { file, entry, g, from, work, superseded, successor },
) {
  const { claim, sourceClaims, recordReceipt, sheetRenames } = context;
  assert(
    Array.isArray(entry.instances) && entry.instances.length,
    "Empty instance retirement",
  );
  for (const token of entry.instances) {
    assert(g.tokens.includes(token), "Unknown retirement instance");
    claim(sourceClaims, token, "retirement instance");
    work.claims.add(token);
  }
  recordReceipt(entry, {
    pr: file.pr,
    action: entry.action,
    ...from,
    cause: entry.cause,
    instances: entry.instances.length,
    ...(superseded
      ? { successor }
      : { measuredScope: renamedScope(from.scope, sheetRenames) }),
  });
}
