import { hash, json } from "./support.mjs";
import { deterministicReceipt } from "./repin-record.mjs";
import { drawingHash } from "./png-ink.mjs";
import { pngFixture } from "./png-fixture.mjs";
export function recordFixture(canonical = false) {
  const crop = {
    path: "evals/out/draw-samples/fixture.png",
    sha256: hash(pngFixture()),
  };
  const signed = {
    pr: "#7",
    summarySha256: hash("summary"),
    registrySha256: hash("before"),
    checkerSha256: hash("checker"),
    entries: [
      {
        reviewed: true,
        signOff: { kind: "agent", by: "Synthetic fixture, not approval" },
        action: "new-defect",
        causeClass: "synthetic",
        note: "Original signed rationale",
        cause: "synthetic cause",
        crop,
        drawingSha256: drawingHash(pngFixture()),
      },
    ],
  };
  const bytes = Buffer.from(
    canonical ? json(signed) : JSON.stringify(signed) + "\n",
  );
  const receipt = Buffer.from(
    json({
      format: "thermite-draw-repin-receipt/1.0",
      summarySha256: hash("summary"),
      checkerSha256: hash("checker"),
      registryBeforeSha256: hash("before"),
      registryAfterSha256: hash("after"),
      decisions: signed.entries.map((e) => ({
        ...e,
        reviewerJudged: {
          causeClass: e.causeClass,
          note: e.note,
          cause: e.cause,
          drawingSha256: e.drawingSha256,
          signOffs: [{ ...e.signOff, label: "agent review" }],
        },
      })),
    }),
  );
  const index = Buffer.from(
    json({ format: "thermite-d1-real-crops/1.0", crops: [crop] }),
  );
  const files = new Map([
    ["decisions.json", bytes],
    ["receipt.json.gz", deterministicReceipt(receipt)],
    ["crop-index.json", index],
    ["crops/fixture.png", pngFixture()],
  ]);
  const record = {
    format: "thermite-draw-repin-record/1.0",
    pr: 7,
    baseCommit: "1".repeat(40),
    signedDecisions: "decisions.json",
    signedDecisionsSha256: hash(bytes),
    countersignMode: canonical ? "canonical" : "sidecar",
    receipt: "receipt.json.gz",
    receiptSha256: hash(receipt),
    registryBeforeSha256: hash("before"),
    registryAfterSha256: hash("after"),
    cropIndex: "crop-index.json",
    cropIndexSha256: hash(index),
    pathMap: { [crop.path]: "crops/fixture.png" },
    files: Object.fromEntries([...files].map(([p, b]) => [p, hash(b)])),
  };
  return { record, files, signed };
}

export function recordPadding(c, count) {
  const extra = Buffer.from(
    json({
      format: "thermite-draw-countersignatures/1.0",
      signedDecisionsSha256: c.record.signedDecisionsSha256,
      entries: [
        { entryIndex: 0, kind: "person", by: "Synthetic padding fixture" },
      ],
    }),
  );
  c.files.set(
    "countersignatures.json",
    Buffer.concat([extra, Buffer.alloc(count, 32)]),
  );
}
