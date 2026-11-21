import assert from "node:assert/strict";
import { mapped, renameTextChanged } from "./repin-mappings.mjs";
import { proveMove, sourceRow, moveError } from "./repin-policy.mjs";
import { checkColumnMap } from "./repin-reconcile.mjs";
import { copy, same, keys } from "./repin-primitives.mjs";
export function applyRename(
  context,
  { file, entry, before, g, old, from, work },
) {
  const {
    ensureTarget,
    inventory,
    sheetRenames,
    specs,
    claim,
    sourceClaims,
    targetClaims,
    claimCrop,
    markers,
    next,
    definitions,
    original,
    recordReceipt,
  } = context;
  const target = ensureTarget(entry.to);
  assert(
    target.g.identity.kind === old.kind,
    moveError("Rename defect kind changed"),
  );
  assert(
    Array.isArray(entry.pairs) && entry.pairs.length,
    "List individual rename pairs",
  );
  checkColumnMap(entry, before, inventory);
  const moveProofs = [];
  let changedText = false,
    changedHeader = false;
  for (const pair of entry.pairs) {
    keys(pair, ["from", "to", "sourceLocator", "view", "text"], "rename pair");
    const a = before.byToken.get(pair.from),
      b = inventory.byToken.get(pair.to);
    assert(
      a &&
        b &&
        g.tokens.includes(pair.from) &&
        target.g.tokens.includes(pair.to),
      "Rename pair is not in its declared scopes",
    );
    moveProofs.push(proveMove(a, b, sheetRenames, specs, entry.columnMap));
    changedHeader ||=
      a.facts.text !== b.facts.text &&
      sourceRow(a.facts.sourceLocator)?.kind.startsWith("header/");
    assert(
      a.multiplicity === 1 && b.multiplicity === 1,
      "Compact aggregates need exported instances; cannot prove rename",
    );
    same(
      [a.facts.kind, a.facts.medium, a.facts.case],
      [b.facts.kind, b.facts.medium, b.facts.case],
      "Rename kind/text/medium/case mismatch",
    );
    changedText = renameTextChanged(pair, a, b) || changedText;
    mapped(pair, "sourceLocator", a.facts.sourceLocator, b.facts.sourceLocator);
    mapped(pair, "view", a.facts.view, b.facts.view);
    claim(sourceClaims, pair.from, "source instance pair");
    claim(targetClaims, pair.to, "target instance pair");
    work.claims.add(pair.from);
    target.claims.add(pair.to);
  }
  if (changedText) claimCrop(entry.crop);
  else
    assert(entry.crop === undefined, "Unused crop on an unchanged-text move");
  const id = entry.to.markerId;
  if (!markers.has(id)) {
    const i = target.g.identity,
      m = { ...copy(old), ...i, id, scopes: [] };
    delete m.medium;
    delete m.sheet;
    markers.set(id, m);
    next.markers.push(m);
    definitions.set(id, "rename");
  } else if (!original.has(id)) {
    const m = markers.get(id);
    if (definitions.get(id) === "new-defect") {
      m.bands = copy(old.bands);
      m.count = copy(old.count);
      definitions.set(id, "rename");
    } else {
      same(m.bands, old.bands, "Conflicting renamed marker bands");
      same(m.count, old.count, "Conflicting renamed marker counts");
    }
  }
  recordReceipt(entry, {
    pr: file.pr,
    action: "rename",
    from,
    to: entry.to,
    pairs: entry.pairs.length,
    changedText,
    changedHeader,
    ...(entry.crop ? { crop: entry.crop } : {}),
    ...(entry.columnMap ? { columnMap: entry.columnMap } : {}),
    moveProofs,
  });
}
