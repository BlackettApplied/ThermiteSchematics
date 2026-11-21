import assert from "node:assert/strict";
import { signOffs } from "./repin-signoff.mjs";
import { keys, copy, classCheck, range } from "./repin-primitives.mjs";
import { applyRetirement } from "./repin-retire.mjs";
export function processDecisionFile(context, file) {
  const {
    binding,
    baselines,
    validateBaseline,
    instanceInventory,
    DECISIONS_FORMAT,
  } = context;
  keys(
    file,
    [
      "format",
      "pr",
      "summarySha256",
      "registrySha256",
      "checkerSha256",
      "corpusSha256",
      "evalsVersion",
      "baselineSha256",
      "entries",
      "sheetRenames",
      "notMove",
    ],
    "decisions file",
  );
  assert(file.format === DECISIONS_FORMAT, "Unsupported decisions format");
  assert(
    typeof file.pr === "string" && file.pr.trim(),
    "Name the merged PR/lane",
  );
  for (const [k, v] of Object.entries(binding))
    assert(file[k] === v, `Stale decisions binding: ${k}`);
  assert(Array.isArray(file.entries), "Entries must be an array");
  let baseline, oldInventory;
  if (file.baselineSha256 !== undefined) {
    baseline = baselines.get(file.baselineSha256);
    assert(baseline, "Bound baseline bytes/hash not supplied");
    validateBaseline(baseline);
  }
  const getOld = () => {
    if (oldInventory) return oldInventory;
    assert(
      file.baselineSha256,
      "Rename/instance retirement needs a hash-bound baseline",
    );
    oldInventory = instanceInventory(baseline, file.baselineSha256);
    return oldInventory;
  };
  for (const entry of file.entries) {
    processEntry(context, file, entry, getOld);
  }
}

export function processEntry(context, file, entry, getOld) {
  const common = [
    "action",
    "causeClass",
    "note",
    "classification",
    "reviewed",
    "signOff",
    "counterSignOffs",
    ...(entry.crop ? ["drawingSha256", "sourceVerification"] : []),
  ];
  assert(
    entry.reviewed === true,
    "Unreviewed draft entry; inspect it and set reviewed: true",
  );
  assert(
    typeof entry.causeClass === "string" &&
      entry.causeClass.trim() &&
      typeof entry.note === "string" &&
      entry.note.trim(),
    "Record cause class and review rationale",
  );
  signOffs(entry);
  if (["retire", "rename", "superseded"].includes(entry.action)) {
    applyRetirement(context, file, entry, common, getOld);
  } else if (["new-defect", "scope-added"].includes(entry.action)) {
    applyAddition(context, file, entry, common);
  } else if (entry.action === "font-pair-drift") {
    queuePair(context, file, entry, common);
  } else if (entry.action === "envelope-drift") {
    queueEnvelope(context, file, entry, common);
  } else assert.fail(`Unknown decision action: ${entry.action}`);
}

export function applyAddition(context, file, entry, common) {
  const {
    ensureTarget,
    original,
    claimCrop,
    claim,
    targetClaims,
    markers,
    next,
    definitions,
    recordReceipt,
  } = context;
  const addition = entry.action === "scope-added";
  keys(entry, [...common, "to", "instances", "crop"], "decision");
  const target = ensureTarget(entry.to);
  assert(
    addition
      ? original.has(entry.to.markerId)
      : !original.has(entry.to.markerId),
    addition
      ? "Scope addition requires an existing identity"
      : "Existing identity needs scope-added, not new-defect",
  );
  classCheck(entry, target.g.identity.kind);
  if (!addition || entry.crop !== undefined) {
    claimCrop(entry.crop);
  }
  assert(
    Array.isArray(entry.instances) && entry.instances.length,
    "List each new finding instance",
  );
  for (const token of entry.instances) {
    assert(target.g.tokens.includes(token), "Unknown new-defect instance");
    claim(targetClaims, token, "new-defect instance");
    target.claims.add(token);
  }
  const id = entry.to.markerId;
  if (!markers.has(id)) {
    const i = target.g.identity,
      m = {
        id,
        dq: i.dq,
        family: i.family,
        kind: i.kind,
        locator: i.locator,
        check: i.check,
        coarse: !!i.coarse,
        scopes: [],
        bands: {},
        count: [1, 1],
      };
    markers.set(id, m);
    next.markers.push(m);
    definitions.set(id, "new-defect");
  }
  recordReceipt(entry, {
    pr: file.pr,
    action: entry.action,
    to: entry.to,
    instances: entry.instances.length,
    crop: entry.crop,
  });
}

export function queuePair(context, file, entry, common) {
  const { claim, pairWork } = context;
  keys(
    entry,
    [...common, "fontPair", "from", "to", "observed", "coverage"],
    "pair decision",
  );
  assert(
    entry.coverage === "full" && entry.classification === "drawing",
    "Full drawing pair decision required",
  );
  claim(pairWork, entry.fontPair, "font-pair decision");
  pairWork.set(entry.fontPair, { entry, pr: file.pr });
}

export function queueEnvelope(context, file, entry, common) {
  const { checked, claim, metricWork, recordReceipt } = context;
  keys(
    entry,
    [...common, "markerId", "metric", "from", "to", "observed", "coverage"],
    "decision",
  );
  assert(
    entry.coverage === "full",
    "Partial-scope envelopes cannot replace full references",
  );
  assert(
    !checked.drift.some((d) => d.marker === entry.markerId && d.partialScope),
    "Partial-scope drift cannot replace full references",
  );
  claim(
    metricWork,
    JSON.stringify([entry.markerId, entry.metric]),
    "envelope metric decision",
  );
  range(entry.to, entry.metric === "occurrences" ? 2 : 4, "new envelope");
  range(entry.observed, 2, "observed envelope");
  if (entry.metric === "occurrences")
    assert(entry.to.every(Number.isInteger), "Count envelopes use integers");
  recordReceipt(entry, { pr: file.pr, ...entry });
  metricWork.set(JSON.stringify([entry.markerId, entry.metric]), entry);
}
