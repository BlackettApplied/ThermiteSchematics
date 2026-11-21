import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { units, unitKey, compressScopes } from "./marker-scopes.mjs";
import { bands } from "./marker-metrics.mjs";
import { canonical } from "./support.mjs";
import {
  pairDrift,
  applyPairDecision,
  assertPairBounds,
} from "./repin-reconcile.mjs";
import { same, copy, classCheck, referenceFor } from "./repin-primitives.mjs";
export function reconcileScopes(context) {
  const {
    staleWork,
    markers,
    specs,
    targetWork,
    next,
    definitions,
    inventory,
    population,
  } = context;
  for (const [key, work] of staleWork) {
    if (!work.whole)
      same(
        [...work.claims].sort(),
        [...work.tokens].sort(),
        "Unlisted source instances remain after rename/retirement",
      );
    const m = markers.get(work.from.markerId);
    m.scopes = compressScopes(
      units(m).filter((u) => unitKey(u) !== unitKey(work.from.scope)),
      specs,
    );
  }
  for (const { g, claims } of targetWork.values()) {
    same(
      [...claims].sort(),
      g.tokens.slice().sort(),
      "Unlisted target finding instances remain",
    );
    const m = markers.get(g.markerId);
    m.scopes = compressScopes([...units(m), g.scope], specs);
  }
  next.markers = next.markers.filter((m) => m.scopes.length);
  for (const [id, how] of definitions)
    if (how === "new-defect") {
      const m = markers.get(id),
        groups = [...inventory.groups.values()].filter(
          (g) =>
            g.markerId === id &&
            units(m).some((u) => unitKey(u) === unitKey(g.scope)),
        );
      m.bands = canonical(
        bands(
          groups.flatMap((g) => g.findings),
          population,
        ),
      );
      const counts = groups.map((g) => g.occurrences);
      m.count = [Math.min(...counts), Math.max(...counts)];
    }
}

export function reconcileBounds(context) {
  const {
    next,
    markers,
    reassess,
    report,
    specs,
    inventory,
    pairWork,
    registry,
    recordReceipt,
    metricWork,
    population,
    receipts,
  } = context;
  // Reconcile the explicitly listed scopes before comparing complete envelopes.
  // A moved header can retain its defect while literal body cells disappear.
  const beforePairBands = new Map(
    next.markers.map((m) => [m.id, copy(m.bands)]),
  );
  const resolvedDrift = [
    ...reassess(report, next, specs).drift,
    ...pairDrift(next, inventory),
  ];
  for (const { entry, pr } of pairWork.values()) {
    const pairEvidence = resolvedDrift.filter(
      (d) => d.pairDerived && d.fontPair === entry.fontPair,
    );
    assert(pairEvidence.length, `No pair drift evidence: ${entry.fontPair}`);
    const touched = applyPairDecision(next, inventory, entry, registry);
    same(
      pairEvidence.map((d) => d.marker).sort(),
      touched,
      "Pair drift must cover every touched marker",
    );
    recordReceipt(entry, {
      pr,
      action: "font-pair-drift",
      fontPair: entry.fontPair,
      touched,
      derived: { allowed: entry.to, observed: entry.observed },
    });
  }
  for (const entry of metricWork.values()) {
    assert(
      resolvedDrift.some(
        (d) =>
          d.marker === entry.markerId &&
          d.changes.some((c) => c.metric === entry.metric),
      ),
      `No drift for this marker/metric in the bound report after listed scope changes: ${entry.markerId}/${entry.metric}`,
    );
    const m = markers.get(entry.markerId);
    assert(
      m && next.markers.includes(m),
      "Envelope decision on an unknown/retired marker",
    );
    classCheck(entry, m.kind);
    const prior =
      entry.metric === "occurrences"
        ? m.count
        : beforePairBands.get(m.id)[entry.metric];
    same(entry.from, prior, "Envelope old value mismatch");
    const observed = referenceFor(
      next,
      inventory,
      entry.markerId,
      entry.metric,
    );
    same(
      entry.observed,
      observed,
      "Envelope observation differs from exact reviewed values",
    );
    same(
      entry.metric === "occurrences" ? entry.to : entry.to.slice(1, 3),
      observed,
      "New envelope reference must equal full observed range",
    );
    assert(!equal(entry.from, entry.to), "Unused unchanged envelope decision");
    if (entry.metric === "occurrences") m.count = copy(entry.to);
    else {
      const observedFindings = [...inventory.groups.values()]
        .filter(
          (g) =>
            g.markerId === m.id &&
            units(m).some((u) => unitKey(u) === unitKey(g.scope)),
        )
        .flatMap((g) => g.findings);
      const derived = canonical(
        bands(observedFindings, population)[entry.metric],
      );
      same(
        entry.to,
        derived,
        "Allowed bounds must equal the measured range plus documented tolerance",
      );
      m.bands = { ...m.bands, [entry.metric]: copy(entry.to) };
    }
  }
  assertPairBounds(next, inventory);
  for (const r of receipts.filter((r) => r.action === "envelope-drift"))
    r.toolProved.derivedBounds = {
      metric: r.metric,
      allowed: r.to,
      observed: r.observed,
    };
  next.markers.sort((a, b) => a.id.localeCompare(b.id));
}
