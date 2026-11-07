import assert from "node:assert/strict";
import { json } from "./support.mjs";
import { drawingReferences } from "./repin-drawing-bindings.mjs";
const judgment = (x) =>
  json({
    causeClass: x.causeClass,
    note: x.note,
    cause: x.cause,
    signOff: x.signOff,
    drawingSha256: x.drawingSha256,
  });
export function crossCheckReceipt(signed, receipt) {
  assert(
    /^[a-f0-9]{64}$/.test(signed.summarySha256 ?? "") &&
      signed.summarySha256 === receipt.summarySha256,
    "Signed summary differs from receipt",
  );
  assert(
    /^[a-f0-9]{64}$/.test(signed.registrySha256 ?? "") &&
      signed.registrySha256 === receipt.registryBeforeSha256,
    "Signed registry differs from receipt",
  );
  assert(
    /^[a-f0-9]{64}$/.test(signed.checkerSha256 ?? "") &&
      signed.checkerSha256 === receipt.checkerSha256,
    "Signed checker differs from receipt",
  );
  const expected = signed.entries.map(judgment).sort();
  const observed = receipt.decisions
    .map((r) => {
      const j = r.reviewerJudged;
      assert(
        j && Array.isArray(j.signOffs) && j.signOffs.length,
        "Receipt reviewer judgment/sign-off missing",
      );
      const { kind, by } = j.signOffs[0];
      return judgment({ ...j, signOff: { kind, by } });
    })
    .sort();
  assert(
    json(expected) === json(observed),
    "Signed judgments differ from receipt",
  );
}
export function citedCrops(signed) {
  return drawingReferences(signed).map(({ entry, crop }) => ({
    ...crop,
    drawingSha256: entry.drawingSha256,
  }));
}
