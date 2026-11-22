import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { captureAttempts, verificationPath } from "./crop-attempts.mjs";
import {
  sourceVerificationFixture,
  verificationFixtures,
} from "./crop-source-fixture.mjs";
import { recordFixture } from "./repin-record-fixture.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { recordFor, writeRecord } from "./repin-record-write.mjs";
import { readRecord, verifyRecord } from "./repin-record.mjs";
import { RECORD_LIMIT } from "./repin-record-policy.mjs";
import { hash, json } from "./support.mjs";
import { drawingHash } from "./png-ink.mjs";
async function fixture(notMove = false) {
  const c = recordFixture(),
    signed = c.signed,
    crop = pngFixture(),
    attempts = [],
    verification = new Map();
  const selectedAttempt = await captureAttempts(
    crop,
    0,
    async (n) => (n === 3 ? crop : pngFixture({ seed: 10 })),
    verification,
    attempts,
  );
  signed.entries[0].sourceVerification = {
    ...sourceVerificationFixture(crop),
    attempts,
    selectedAttempt,
  };
  const crops = new Map([[signed.entries[0].crop.path, crop]]);
  const rows = [{ ...signed.entries[0].crop, capture: "fresh-source" }];
  if (notMove) {
    const cs = [3, 4].map((seed) => {
      const png = pngFixture({ seed }),
        path = `evals/out/draw-samples/nm-${seed}.png`;
      crops.set(path, png);
      const ref = verificationFixtures(new Map([[path, png]]));
      for (const x of ref) verification.set(...x);
      const crop = {
        path,
        sha256: hash(png),
        drawingSha256: drawingHash(png),
        sourceVerification: sourceVerificationFixture(png),
      };
      rows.push({ ...crop, capture: "fresh-source" });
      return crop;
    });
    signed.notMove = [
      {
        from: "baseline",
        to: "current",
        reason: "Synthetic distinction",
        crops: cs,
      },
    ];
  }
  const receipt = JSON.parse(gunzipSync(c.files.get(c.record.receipt)));
  receipt.decisions[0].reviewerJudged.sourceVerification =
    signed.entries[0].sourceVerification;
  receipt.reviewerJudged = { notMove: signed.notMove ?? [] };
  const args = {
    pr: 7,
    baseCommit: c.record.baseCommit,
    signed: Buffer.from(json(signed)),
    receipt: Buffer.from(json(receipt)),
    cropIndex: Buffer.from(json({ crops: rows })),
    crops,
    verification,
  };
  return { args, signed, receipt, result: recordFor(args) };
}
it("archives every attempt reference once and verifies the integer comparisons after reload", async () => {
  const c = await fixture(),
    r = c.result;
  expect(
    [...r.files.keys()].filter((p) => p.startsWith("verification/")),
  ).toHaveLength(2);
  expect(verifyRecord(r.record, r.files).sourceVerification).toBe(
    "source-crop/2.0",
  );
  const dir = await mkdtemp(join(tmpdir(), "verification-roundtrip-"));
  try {
    await writeRecord(join(dir, "record"), r);
    expect((await readRecord(join(dir, "record"))).drawingGroups).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(["missing", "changed", "extra"])(
  "refuses coherently edited %s verification files",
  async (mode) => {
    const { result: r } = await fixture(),
      path = [...r.files.keys()].find((p) => p.startsWith("verification/"));
    if (mode === "missing") {
      r.files.delete(path);
      delete r.record.files[path];
    }
    if (mode === "changed") {
      const png = pngFixture({ seed: 8 });
      r.files.set(path, png);
      r.record.files[path] = hash(png);
    }
    if (mode === "extra") {
      const png = pngFixture({ seed: 8 }),
        p = verificationPath(hash(png));
      r.files.set(p, png);
      r.record.files[p] = hash(png);
    }
    expect(() => verifyRecord(r.record, r.files)).toThrow(
      mode === "extra" ? /extra file/ : /retained verification PNG/,
    );
  },
);
it("requires exactly the reference buffers when constructing an archive", async () => {
  const { args } = await fixture();
  args.verification.clear();
  expect(() => recordFor(args)).toThrow(/exactly the signed verification/);
});
it("refuses changed writer reference buffers before storage", async () => {
  const { args } = await fixture();
  const sha = [...args.verification.keys()][0];
  args.verification.set(sha, pngFixture({ seed: 11 }));
  expect(() => recordFor(args)).toThrow(
    /Writer verification PNG hash mismatch/,
  );
});
it("refuses pixel-statistic forgery even when the receipt agrees", async () => {
  const c = await fixture(),
    v = c.signed.entries[0].sourceVerification;
  v.attempts = v.attempts.slice(-1);
  v.selectedAttempt = 1;
  v.attempts[0].attempt = 1;
  v.attempts[0].previousSha256 = null;
  v.attempts[0].stats = {
    pixels: 360,
    changed: 1,
    maximum: 1,
    absoluteError: 1,
  };
  c.receipt.decisions[0].reviewerJudged.sourceVerification = v;
  c.args.signed = Buffer.from(json(c.signed));
  c.args.receipt = Buffer.from(json(c.receipt));
  c.args.verification.delete(hash(pngFixture({ seed: 10 })));
  expect(() => recordFor(c.args)).toThrow(/statistics differ/);
});
it("binds every ordered attempt into the receipt judgment", async () => {
  const c = await fixture();
  c.receipt.decisions[0].reviewerJudged.sourceVerification.selectedAttempt = 1;
  // Detach the receipt from the signed object before editing.
  const other = await fixture();
  other.args.receipt = Buffer.from(json(c.receipt));
  expect(() => recordFor(other.args)).toThrow(/Signed judgments differ/);
});
it("retains notMove references and cross-checks their source judgments", async () => {
  const c = await fixture(true);
  expect(verifyRecord(c.result.record, c.result.files).crops).toBe(3);
  c.receipt.reviewerJudged.notMove = [];
  c.args.receipt = Buffer.from(json(c.receipt));
  expect(() => recordFor(c.args)).toThrow(/notMove source judgments/);
});
it("cannot downgrade a new archive by changing the source format to v1", async () => {
  const c = await fixture();
  c.signed.entries[0].sourceVerification.format =
    "thermite-draw-source-crop/1.0";
  c.args.signed = Buffer.from(json(c.signed));
  c.args.receipt = Buffer.from(json(c.receipt));
  expect(() => recordFor(c.args)).toThrow(/Bind crop/);
});
it("counts verification files under the policy cap", async () => {
  const { recordPadding } = await import("./repin-record-fixture.mjs"),
    c = recordFixture();
  const size = [...c.files.values()].reduce((s, b) => s + b.length, 0);
  recordPadding(c, RECORD_LIMIT + 1 - size);
  expect(() => verifyRecord(c.record, c.files)).toThrow(/size cap/);
});

it.each([undefined, "pipeline"])(
  "new archive indexes refuse capture %j",
  async (capture) => {
    const c = await fixture(),
      r = c.result;
    const index = JSON.parse(r.files.get(r.record.cropIndex));
    index.crops[0].capture = capture;
    const bytes = Buffer.from(json(index));
    r.files.set(r.record.cropIndex, bytes);
    r.record.cropIndexSha256 = hash(bytes);
    r.record.files[r.record.cropIndex] = hash(bytes);
    expect(() => verifyRecord(r.record, r.files)).toThrow(
      /capture: "fresh-source"/,
    );
    c.args.cropIndex = bytes;
    expect(() => recordFor(c.args)).toThrow(/capture: "fresh-source"/);
  },
);
