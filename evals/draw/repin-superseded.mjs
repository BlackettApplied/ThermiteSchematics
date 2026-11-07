// No repair credit: causal succession is judged; observations and moves are checked.
import assert from "node:assert/strict";
import { moveCandidates } from "./repin-reconcile.mjs";
import { unitKey } from "./marker-scopes.mjs";
import { json } from "./support.mjs";
const sameRef = (a, b) =>
  a?.markerId === b?.markerId &&
  a?.scope &&
  b?.scope &&
  unitKey(a.scope) === unitKey(b.scope);
function survivorTarget(file, entry, inventory, original) {
  const ref = entry.survivor;
  assert(
    ref &&
      Object.keys(ref).sort().join() === "markerId,scope" &&
      ref.scope &&
      Object.keys(ref.scope).sort().join() === "case,medium,sheet",
    "Invalid survivor reference",
  );
  const marker = original?.get(ref.markerId);
  assert(marker, "Survivor must be an existing registry marker");
  const group = inventory.groups.get(
    JSON.stringify([ref.markerId, unitKey(ref.scope)]),
  );
  assert(
    group?.tokens.length,
    "Survivor must be observed at its declared scope",
  );
  assert(
    !file.entries.some(
      (e) =>
        (["retire", "superseded"].includes(e.action) && sameRef(e, ref)) ||
        (e.action === "rename" && (sameRef(e.from, ref) || sameRef(e.to, ref))),
    ),
    "Survivor cannot be retired, moved or superseded in this file",
  );
  return {
    form: "survivor",
    action: "survivor",
    to: ref,
    tokens: group.tokens,
  };
}
function successorTarget(file, entry) {
  assert(
    Number.isInteger(entry.successor) && entry.successor >= 0,
    "Successor must be a zero-based entry index in the same decisions file",
  );
  const next = file.entries[entry.successor];
  assert(next, "Superseded successor does not exist in this decisions file");
  assert(
    ["new-defect", "scope-added"].includes(next.action),
    "Superseded successor must be new-defect or scope-added",
  );
  assert(
    Array.isArray(next.instances) && next.instances.length,
    "Superseded successor must list its observed instances",
  );
  return {
    form: "successor",
    entryIndex: entry.successor,
    action: next.action,
    to: next.to,
    tokens: next.instances,
  };
}
export function supersededSuccessor(
  file,
  entry,
  source,
  inventory,
  map,
  specs,
  original,
) {
  assert(
    typeof entry.cause === "string" && entry.cause.trim(),
    "Superseded retirement requires a non-empty cause",
  );
  assert(
    entry.cause.trim().toLowerCase() !== "fixed",
    "Superseded cannot also claim fixed",
  );
  assert(
    Object.hasOwn(entry, "successor") !== Object.hasOwn(entry, "survivor"),
    "Choose exactly one of successor or survivor",
  );
  const link = Object.hasOwn(entry, "survivor")
    ? survivorTarget(file, entry, inventory, original)
    : successorTarget(file, entry);
  const users = file.entries.filter(
    (e) =>
      e.action === "superseded" &&
      sameRef(e.survivor ?? file.entries[e.successor]?.to, link.to),
  );
  assert(
    users.length === 1 ||
      users.every(
        (e) =>
          typeof e.sharedSuccessorReason === "string" &&
          e.sharedSuccessorReason.trim(),
      ),
    "Every retirement sharing a successor needs sharedSuccessorReason",
  );
  assert(
    users.length > 1 || entry.sharedSuccessorReason === undefined,
    "Unused sharedSuccessorReason on an unshared successor",
  );
  const targets = link.tokens.map((token) => inventory.byToken.get(token));
  assert(targets.every(Boolean), "Unknown superseded successor instance");
  assert(
    source.every((a) =>
      targets.some(
        (b) =>
          a.scope.case === b.scope.case &&
          a.scope.medium === b.scope.medium &&
          a.facts.kind === b.facts.kind &&
          a.facts.dq === b.facts.dq,
      ),
    ),
    "Superseded successor must share case, medium, kind and DQ with its source",
  );
  const candidates = moveCandidates(source, targets, map, specs);
  assert(
    candidates.length === 0,
    "Superseded could be a move; book explicit rename pairs: " +
      json(candidates),
  );
  const { tokens, ...proof } = link;
  return {
    ...proof,
    sourceInstances: source.length,
    targetInstances: targets.length,
  };
}
