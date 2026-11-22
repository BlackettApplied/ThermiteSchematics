import assert from "node:assert/strict";
import { signOffs } from "./repin-signoff.mjs";
import { units, unitKey } from "./marker-scopes.mjs";
import { keys, scopeId } from "./repin-primitives.mjs";
export function createRecordReceipt(receipts) {
  const recordReceipt = (entry, r) =>
    receipts.push({
      ...r,
      toolProved: {
        ...(r.measuredScope ? { measuredScope: r.measuredScope } : {}),
        ...(r.moveProofs ? { move: r.moveProofs } : {}),
        ...(r.derived ? { derivedBounds: r.derived } : {}),
        ...(r.crop
          ? {
              cropSha256: r.crop.sha256,
              ...(entry.drawingSha256
                ? {
                    drawingSha256: entry.drawingSha256,
                    sourceVerification: entry.sourceVerification,
                  }
                : {}),
            }
          : {}),
        ...(r.successor ? { successor: r.successor } : {}),
      },
      reviewerJudged: {
        reviewed: entry.reviewed,
        signOffs: signOffs(entry),
        causeClass: entry.causeClass,
        note: entry.note,
        ...(entry.cause ? { cause: entry.cause } : {}),
        ...(entry.crop
          ? {
              crop: entry.crop,
              ...(entry.drawingSha256
                ? {
                    drawingSha256: entry.drawingSha256,
                    sourceVerification: entry.sourceVerification,
                  }
                : {}),
            }
          : {}),
        ...(entry.columnMap ? { columnMap: entry.columnMap } : {}),
        ...(entry.sharedSuccessorReason
          ? { sharedSuccessorReason: entry.sharedSuccessorReason }
          : {}),
      },
    });
  return recordReceipt;
}

export function createTargetResolver(inventory, original, targetWork) {
  const ensureTarget = (ref) => {
    keys(ref, ["markerId", "scope"], "target");
    const key = scopeId(ref.markerId, ref.scope),
      g = inventory.groups.get(key);
    assert(g, "Target finding identity/scope not observed");
    const m = original.get(ref.markerId);
    assert(
      !m || !units(m).some((u) => unitKey(u) === unitKey(ref.scope)),
      "Target scope already pinned; use envelope drift for band changes",
    );
    if (!targetWork.has(key)) targetWork.set(key, { g, claims: new Set() });
    return targetWork.get(key);
  };
  return ensureTarget;
}
