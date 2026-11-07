// Candidate deltas only. No cause, approval or discretionary bound is inferred.
import assert from "node:assert/strict";
import { units, unitKey } from "./marker-scopes.mjs";
import { json } from "./support.mjs";
const key = (x) => JSON.stringify([x.markerId, unitKey(x.scope)]);
const group = (xs) => {
  const out = new Map();
  for (const x of xs) {
    const k = key(x);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(x);
  }
  return out;
};
const common = (kind) => ({
  reviewed: false,
  signOff: { kind: "", by: "" },
  causeClass: "",
  note: "",
  classification: kind === "iso-cap-height-policy" ? "policy-gap" : "drawing",
});
const ref = (x) => ({ markerId: x.markerId, scope: x.scope });
export function draftDecisions(
  inventory,
  { pr, baselineSha256, superseded = [], survivors = [] } = {},
) {
  assert(
    inventory.format === "thermite-draw-repin-inventory/1.0",
    "Use a re-pin inventory",
  );
  assert(typeof pr === "string" && pr.trim(), "Name the PR/lane");
  const baselines = inventory.baselines ?? [];
  if (baselineSha256 === undefined && baselines.length === 1)
    baselineSha256 = baselines[0].sha256;
  assert(
    baselines.length <= 1 || baselineSha256 !== undefined,
    "Select --baseline-sha when an inventory contains several baselines",
  );
  const baseline = baselines.find((b) => b.sha256 === baselineSha256);
  assert(
    baselineSha256 === undefined || baseline,
    "Unknown baseline selection",
  );
  const markers = new Map(inventory.markers.map((m) => [m.id, m]));
  const stale = new Map(inventory.stale.map((s) => [key(s), s]));
  const targets = group(
    inventory.current.filter(
      (x) =>
        !markers.get(x.markerId) ||
        !units(markers.get(x.markerId)).some(
          (s) => unitKey(s) === unitKey(x.scope),
        ),
    ),
  );
  const old = group(
    (baseline?.instances ?? []).filter((x) => stale.has(key(x))),
  );
  const facts = (x) =>
    json([
      x.facts.kind,
      x.facts.text,
      x.facts.sourceLocator,
      x.facts.medium,
      x.facts.case,
    ]);
  const bucket = (xs) => {
    const m = new Map();
    for (const x of xs) {
      const k = facts(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  };
  const sources = bucket([...old.values()].flat()),
    dest = bucket([...targets.values()].flat());
  const usedOld = new Set(),
    usedNew = new Set(),
    moves = new Map(),
    entries = [];
  for (const [fact, bs] of dest) {
    const as = sources.get(fact);
    // Duplicate facts or compact aggregates need explicit human matching.
    if (
      as?.length !== 1 ||
      bs.length !== 1 ||
      as[0].multiplicity !== 1 ||
      bs[0].multiplicity !== 1
    )
      continue;
    const a = as[0],
      b = bs[0],
      k = json([key(a), key(b)]);
    if (!moves.has(k))
      moves.set(k, {
        ...common(a.facts.kind),
        action: "rename",
        from: ref(a),
        to: ref(b),
        pairs: [],
      });
    moves.get(k).pairs.push({
      from: a.token,
      to: b.token,
      ...(a.facts.view === b.facts.view
        ? {}
        : { view: { from: a.facts.view, to: b.facts.view } }),
    });
    usedOld.add(a.token);
    usedNew.add(b.token);
  }
  entries.push(...moves.values());
  for (const [k, s] of stale) {
    const xs = old.get(k) ?? [],
      left = xs.filter((x) => !usedOld.has(x.token));
    if (xs.length && left.length === 0) continue;
    entries.push({
      ...common(markers.get(s.markerId).kind),
      action: "retire",
      ...ref(s),
      cause: "",
      ...(left.length && left.length !== xs.length
        ? { instances: left.map((x) => x.token) }
        : {}),
    });
  }
  for (const xs of targets.values()) {
    const left = xs.filter((x) => !usedNew.has(x.token));
    if (!left.length) continue;
    const x = left[0],
      addition = markers.has(x.markerId);
    entries.push({
      ...common(x.facts.kind),
      action: addition ? "scope-added" : "new-defect",
      to: ref(x),
      instances: left.map((i) => i.token),
      ...(addition
        ? {}
        : { crop: { path: "", sha256: "" }, drawingSha256: "" }),
    });
  }
  const envelopes = new Map(inventory.envelopes.map((e) => [e.markerId, e]));
  const templates = new Map(markers);
  for (const move of moves.values())
    if (!templates.has(move.to.markerId))
      templates.set(move.to.markerId, {
        ...markers.get(move.from.markerId),
        id: move.to.markerId,
      });
  for (const [id, m] of templates) {
    const e = envelopes.get(id);
    if (!e) continue;
    for (const metric of ["occurrences", ...Object.keys(m.bands)]) {
      const count = metric === "occurrences",
        from = count ? m.count : m.bands[metric],
        to = count ? e.count : e.bands[metric];
      if (!to) continue;
      const observed = count ? to : to.slice(1, 3),
        prior = count ? from : from.slice(1, 3);
      if (
        observed.every(
          (v, i) =>
            Math.abs(Math.round(v * 1000) - Math.round(prior[i] * 1000)) <= 1,
        )
      )
        continue;
      entries.push({
        ...common(m.kind),
        action: "envelope-drift",
        markerId: id,
        metric,
        from,
        to,
        observed,
        coverage: "full",
      });
    }
  }
  for (const pair of inventory.fontPairs ?? [])
    if (pair.changed)
      entries.push({
        ...common("pdf-svg-advance-difference"),
        action: "font-pair-drift",
        fontPair: pair.fontPair,
        from: pair.from,
        to: pair.to,
        observed: pair.observed,
        coverage: "full",
      });
  entries.sort((a, b) => (json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0));
  // Explicit reviewer choices refer to the default draft's final indices.
  // Never infer identity succession or fill a cause/sign-off.
  const chosen = new Set();
  for (const { entryIndex, successor } of superseded) {
    assert(
      Number.isInteger(entryIndex) && !chosen.has(entryIndex),
      "Invalid or repeated superseded choice",
    );
    assert(
      entries[entryIndex]?.action === "retire",
      "Superseded choice needs a retirement",
    );
    assert(
      Number.isInteger(successor) &&
        ["new-defect", "scope-added"].includes(entries[successor]?.action),
      "Superseded choice needs a new-defect or scope-added successor",
    );
    chosen.add(entryIndex);
    entries[entryIndex] = {
      ...entries[entryIndex],
      action: "superseded",
      successor,
    };
  }
  for (const { entryIndex, token } of survivors) {
    assert(
      Number.isInteger(entryIndex) && !chosen.has(entryIndex),
      "Invalid or repeated survivor choice",
    );
    assert(
      entries[entryIndex]?.action === "retire",
      "Survivor choice needs a retirement",
    );
    const target = inventory.current.find((i) => i.token === token);
    assert(
      target && markers.has(target.markerId),
      "Survivor choice needs an observed existing registry identity token",
    );
    chosen.add(entryIndex);
    entries[entryIndex] = {
      ...entries[entryIndex],
      action: "superseded",
      survivor: ref(target),
    };
  }
  return {
    format: "thermite-draw-decisions/1.0",
    pr,
    ...inventory.binding,
    ...(baselineSha256 === undefined ? {} : { baselineSha256 }),
    entries,
  };
}
