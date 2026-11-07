// Re-pin-only derived checks. C1's measured statuses/references remain historical.
import assert from "node:assert/strict";
import { isDeepStrictEqual as equal } from "node:util";
import { sourceRow, proveMove, moveError } from "./repin-policy.mjs";
import { canonical, json } from "./support.mjs";

export function fontPairs(registry, inventory) {
  const ranges = new Map();
  for (const g of inventory.groups.values())
    for (const f of g.findings) {
      if (f.kind !== "pdf-svg-advance-difference" || !f.fontPair) continue;
      assert(Number.isFinite(f.advanceRatio), "Missing font-pair ratio");
      const r = ranges.get(f.fontPair) ?? [Infinity, -Infinity];
      r[0] = Math.min(r[0], f.advanceRatio);
      r[1] = Math.max(r[1], f.advanceRatio);
      ranges.set(f.fontPair, r);
    }
  return [...ranges]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([fontPair, observed]) => {
      const markers = registry.markers.filter(
        (m) =>
          m.kind === "pdf-svg-advance-difference" &&
          m.locator.startsWith(`font-pair/${fontPair}/`),
      );
      const from = [
        ...new Map(
          markers.map((m) => {
            const b = m.bands.advanceRatio;
            assert(b, `Missing advanceRatio: ${m.id}`);
            const ends = [b[0], b[3]];
            return [json(ends), ends];
          }),
        ).values(),
      ].sort((a, b) => (json(a) < json(b) ? -1 : 1));
      const to = canonical([
        Math.max(0, observed[0] - 0.05),
        observed[1] + 0.05,
      ]);
      return {
        fontPair,
        observed: canonical(observed),
        from,
        to,
        markers: markers.map((m) => m.id).sort(),
        changed: from.some((b) => !equal(b, to)),
      };
    });
}
export function pairDrift(registry, inventory) {
  return fontPairs(registry, inventory)
    .filter((p) => p.changed)
    .flatMap((p) =>
      p.markers.map((marker) => ({
        marker,
        dq: "DQ-21",
        pairDerived: true,
        fontPair: p.fontPair,
        changes: [
          {
            metric: "advanceRatioBounds",
            reference: registry.markers
              .find((m) => m.id === marker)
              .bands.advanceRatio.filter((_, i) => i === 0 || i === 3),
            observed: p.to,
          },
        ],
      })),
    );
}
export function applyPairDecision(
  registry,
  inventory,
  entry,
  prior = registry,
) {
  const p = fontPairs(registry, inventory).find(
    (p) => p.fontPair === entry.fontPair,
  );
  assert(p?.changed, `No pair drift: ${entry.fontPair}/advanceRatioBounds`);
  assert(
    equal(
      entry.from,
      fontPairs(prior, inventory).find((x) => x.fontPair === entry.fontPair)
        ?.from,
    ) &&
      equal(entry.to, p.to) &&
      equal(entry.observed, p.observed),
    `Pair bounds must equal full measured range ±0.05: ${entry.fontPair}`,
  );
  for (const id of p.markers) {
    const m = registry.markers.find((m) => m.id === id),
      b = m.bands.advanceRatio;
    m.bands = { ...m.bands, advanceRatio: [p.to[0], b[1], b[2], p.to[1]] };
  }
  return p.markers;
}
export function assertPairBounds(registry, inventory) {
  for (const p of fontPairs(registry, inventory))
    assert(
      !p.changed,
      `Inconsistent font-pair advanceRatio bounds: ${p.fontPair}; markers ${p.markers.join(", ")}; book font-pair-drift to ${json(p.to)}`,
    );
}

export function checkColumnMap(entry, before, current) {
  if (!entry.columnMap) return;
  const c = entry.columnMap;
  assert(
    Object.keys(c).sort().join(",") === "from,to" &&
      typeof c.from === "string" &&
      typeof c.to === "string" &&
      c.from &&
      c.to &&
      c.from !== c.to,
    "Invalid literal columnMap",
  );
  for (const pair of entry.pairs) {
    const a = before.byToken.get(pair.from),
      b = current.byToken.get(pair.to);
    assert(a && b, "Unknown column-map instance");
    const ar = sourceRow(a.facts.sourceLocator, a.facts.column),
      br = sourceRow(b.facts.sourceLocator, b.facts.column);
    assert(
      ar?.column === c.from && br?.column === c.to,
      moveError("inconsistent columnMap across entry"),
    );
    assert(
      !current.instances.some(
        (x) =>
          x.scope.case === b.scope.case &&
          x.scope.medium === b.scope.medium &&
          x.facts.view === b.facts.view &&
          sourceRow(x.facts.sourceLocator, x.facts.column)?.column === c.from,
      ),
      moveError("old column still exists in target view"),
    );
  }
}
// Deliberately conservative: a column mapping could be declared by a reviewer.
// Include all structurally compatible candidates, not just the draft's choices.
export function moveCandidates(retired, fresh, map, specs) {
  const pairs = [];
  for (const a of retired)
    for (const b of fresh) {
      if (a.scope.case !== b.scope.case || a.scope.medium !== b.scope.medium)
        continue;
      const ar = sourceRow(a.facts.sourceLocator, a.facts.column),
        br = sourceRow(b.facts.sourceLocator, b.facts.column);
      const columnMap =
        ar?.column === br?.column
          ? undefined
          : { from: ar?.column, to: br?.column };
      try {
        proveMove(a, b, map, specs, columnMap);
      } catch {
        continue;
      }
      pairs.push({
        from: a.token,
        to: b.token,
        fromMarker: a.markerId,
        toMarker: b.markerId,
      });
    }
  return pairs.sort((a, b) => (json(a) < json(b) ? -1 : 1));
}
export function checkNotMoves(candidates, declarations, claimCrop) {
  const pending = new Map(candidates.map((p) => [json([p.from, p.to]), p])),
    judgments = [];
  for (const d of declarations) {
    assert(
      d &&
        Object.keys(d).every((k) =>
          ["from", "to", "reason", "crops"].includes(k),
        ),
      "Invalid notMove declaration",
    );
    const key = json([d.from, d.to]);
    assert(pending.has(key), "Unused, duplicate or unknown notMove pair");
    assert(
      typeof d.reason === "string" &&
        d.reason.trim() &&
        !/[\r\n]/.test(d.reason),
      "notMove needs a one-line reason",
    );
    assert(
      Array.isArray(d.crops) && d.crops.length === 2,
      "notMove requires two distinct crops",
    );
    d.crops.forEach(claimCrop);
    judgments.push({ ...pending.get(key), reason: d.reason, crops: d.crops });
    pending.delete(key);
  }
  assert(
    !pending.size,
    `Retirement could be a move; book a move or declare each pair notMove: ${json([...pending.values()])}`,
  );
  return judgments;
}
