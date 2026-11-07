import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { snapshot, sha256 } from "./snapshot.mjs";
export const evalVersion = "1.8.0";
export function harnessIdentity({ tasksDir } = {}) {
  const hash = snapshot(fileURLToPath(new URL("./", import.meta.url)), {
    documents: false,
  }).hash;
  return {
    harnessHash: hash,
    checkerHarnessHash: hash,
    checkerHash: tasksDir
      ? sha256(hash + "\n" + snapshot(tasksDir, { documents: false }).hash)
      : hash,
    evalVersion,
  };
}
const identityOf = (r) =>
  Object.fromEntries(
    ["harnessHash", "checkerHarnessHash", "checkerHash", "evalVersion"].map(
      (k) => [k, r?.[k] ?? null],
    ),
  );
export function pinCheckpoint(
  prior,
  current,
  { allowMismatch = false, now = Date.now() } = {},
) {
  if (!prior)
    return { ...current, createdIdentity: current, identityOverrides: [] };
  const previous = identityOf(prior);
  const changed = Object.keys(current).some((k) => previous[k] !== current[k]);
  assert(
    !changed || allowMismatch,
    "Checkpoint harness/checker/evalVersion mismatch; use --allow-harness-mismatch to record an override",
  );
  return {
    ...current,
    createdIdentity: prior.createdIdentity ?? previous,
    identityOverrides: [
      ...(prior.identityOverrides ?? []),
      ...(changed ? [{ previous, current, at: now, explicit: true }] : []),
    ],
  };
}
