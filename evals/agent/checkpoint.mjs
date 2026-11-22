import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { snapshot, sha256 } from "./snapshot.mjs";
export const evalVersion = "1.20.9";
const rendererDist = fileURLToPath(
  new URL("../../packages/render/dist/", import.meta.url),
);

export function harnessIdentity({ tasksDir, renderDist = rendererDist } = {}) {
  const hash = snapshot(fileURLToPath(new URL("./", import.meta.url)), {
    documents: false,
  }).hash;
  // Take the built tree so transitive imports of the paint and geometry
  // helpers are covered even when no harness source file changes.
  const renderer = snapshot(renderDist, { documents: false });
  assert(
    Object.hasOwn(renderer.files, "packet/navigation-walk.js"),
    "Build packages/render before pinning the checker identity",
  );
  const checkerHarnessHash = sha256(hash + "\n" + renderer.hash);
  return {
    harnessHash: hash,
    checkerHarnessHash,
    checkerHash: tasksDir
      ? sha256(
          checkerHarnessHash +
            "\n" +
            snapshot(tasksDir, { documents: false }).hash,
        )
      : checkerHarnessHash,
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
