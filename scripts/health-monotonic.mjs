import { SECTIONS, fallbackOf, valuesOf, sizeKey } from "./health-budget.mjs";
import { exactMove, moveProof } from "./health-continuity.mjs";
import { renameRegressions } from "./health-renames.mjs";

function priorValue(section, key, reference) {
  const before = reference.budget;
  const inherited = ["files", "functions"].includes(section)
    ? Object.entries(before.locations[section]).find(
        ([, path]) => path === key,
      )?.[0]
    : undefined;
  return (
    before[section]?.[key] ??
    (inherited ? before.grandfathered[section][inherited] : undefined) ??
    (section === "typeAssertions"
      ? (reference.metrics.files[key]?.typeAssertions ?? 0)
      : fallbackOf(before, section))
  );
}
function identityExists(section, key, reference) {
  return (
    Object.hasOwn(valuesOf(reference.metrics, section), key) ||
    Object.hasOwn(reference.budget[section] ?? {}, key)
  );
}
function newIdentityLimit(section, budget) {
  return ["files", "functions"].includes(section)
    ? budget.ceilings[sizeKey(section)]
    : fallbackOf(budget, section);
}
// An absent source has zero remaining allowance, unless a stale record retained it.
// A shared credit ledger prevents reusing the same reduction for several targets.
export function monotoneRegressions(current, budget, reference) {
  if (!reference) return [];
  const errors = [],
    credits = new Map();
  for (const section of SECTIONS) {
    const entries =
      budget[section] ??
      (section === "typeAssertions" ? valuesOf(current, section) : {});
    for (const [key, value] of Object.entries(entries)) {
      const old = priorValue(section, key, reference);
      if (identityExists(section, key, reference) && value <= old) continue;
      const proof = moveProof(section, key, budget);
      if (
        !identityExists(section, key, reference) &&
        !proof &&
        value <= newIdentityLimit(section, budget)
      )
        continue;
      if (
        !identityExists(section, key, reference) &&
        exactMove(section, key, budget, reference.metrics, current)
      ) {
        const source = priorValue(section, proof.from, reference);
        const reduction = source - (budget[section]?.[proof.from] ?? 0);
        const credit = section + ":" + proof.from;
        const spent = (credits.get(credit) ?? 0) + value;
        credits.set(credit, spent);
        if (spent <= reduction) continue;
      }
      errors.push(
        `Allowance cannot rise: ${section}:${key} ${old} -> ${value}; only a new identity within policy or a source-funded verbatim move is permitted`,
      );
    }
  }
  return [...errors, ...renameRegressions(current, budget, reference)];
}
