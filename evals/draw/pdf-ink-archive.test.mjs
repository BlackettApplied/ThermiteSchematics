import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { recordFixture } from "./repin-record-fixture.mjs";
import { pdfPolicyFixture } from "./pdf-source-fixture.mjs";
import {
  sourceVerificationFixture,
  referenceFixture,
} from "./crop-source-fixture.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { drawingHash } from "./png-ink.mjs";
import { hash, json } from "./support.mjs";
import { recordFor, writeRecord } from "./repin-record-write.mjs";
import {
  verifyRecord,
  readRecord,
  deterministicReceipt,
} from "./repin-record.mjs";
function fixture() {
  const c = recordFixture(),
    f = pdfPolicyFixture(),
    row = f.row,
    png = pngFixture({
      width: Math.ceil((row.sourceBbox.w * 300) / 25.4),
      height: Math.ceil((row.sourceBbox.h * 300) / 25.4),
    }),
    e = c.signed.entries[0];
  row.path = e.crop.path;
  row.sha256 = hash(png);
  row.headerPixels = 0;
  e.crop.sha256 = hash(png);
  e.drawingSha256 = drawingHash(png);
  e.sourceVerification = {
    ...f.v,
    ...{ attempts: sourceVerificationFixture(png).attempts },
  };
  const receipt = JSON.parse(gunzipSync(c.files.get(c.record.receipt)));
  Object.assign(receipt.decisions[0].reviewerJudged, {
    drawingSha256: e.drawingSha256,
    sourceVerification: e.sourceVerification,
  });
  const args = {
    pr: 7,
    baseCommit: c.record.baseCommit,
    signed: Buffer.from(json(c.signed)),
    receipt: Buffer.from(json(receipt)),
    cropIndex: Buffer.from(
      json({ format: "thermite-draw-crop-index/3.0", crops: [row] }),
    ),
    crops: new Map([[row.path, png]]),
    verification: new Map([
      [hash(referenceFixture(png)), referenceFixture(png)],
    ]),
  };
  return { args, result: recordFor(args), signed: c.signed, receipt, row };
}
function replace(r, path, bytes) {
  r.files.set(path, bytes);
  r.record.files[path] = hash(bytes);
}
function oldArchive() {
  const c = fixture(),
    r = c.result,
    v = c.signed.entries[0].sourceVerification;
  v.format = "thermite-draw-source-crop/2.0";
  v.capture.implementation = "pdfjs-source/1.0";
  v.sourceBbox = v.instanceBbox;
  delete v.cropShape;
  const idx = JSON.parse(r.files.get(r.record.cropIndex));
  idx.format = "thermite-draw-crop-index/2.0";
  idx.crops[0].sourceBbox = v.instanceBbox;
  delete idx.crops[0].cropShape;
  const signed = Buffer.from(json(c.signed)),
    receipt = Buffer.from(json(c.receipt)),
    index = Buffer.from(json(idx));
  replace(r, r.record.signedDecisions, signed);
  r.record.signedDecisionsSha256 = hash(signed);
  replace(r, r.record.receipt, deterministicReceipt(receipt));
  r.record.receiptSha256 = hash(receipt);
  replace(r, r.record.cropIndex, index);
  r.record.cropIndexSha256 = hash(index);
  r.files.set("record.json", Buffer.from(json(r.record)));
  r.pin = {
    pr: 7,
    recordSha256: hash(r.files.get("record.json")),
    baseCommit: r.record.baseCommit,
  };
  return {
    ...c,
    args: { ...c.args, signed, receipt, cropIndex: index },
    result: r,
  };
}
it("new PDF archives retain and cross-check v3 shape and exact raster dimensions", () => {
  const c = fixture();
  expect(verifyRecord(c.result.record, c.result.files).sourceVerification).toBe(
    "source-crop/3.0",
  );
  const index = JSON.parse(c.result.files.get(c.result.record.cropIndex));
  index.crops[0].cropShape.operators = [9];
  const bytes = Buffer.from(json(index));
  replace(c.result, c.result.record.cropIndex, bytes);
  c.result.record.cropIndexSha256 = hash(bytes);
  expect(() => verifyRecord(c.result.record, c.result.files)).toThrow(
    /archive index/,
  );
});
it("allows em-only PDF v2 only when its archive manifest matches an explicit trusted pin", async () => {
  const c = oldArchive(),
    r = c.result;
  expect(() => verifyRecord(r.record, r.files)).toThrow(/Bind crop/);
  expect(() =>
    verifyRecord(r.record, r.files, {
      pin: { ...r.pin, recordSha256: hash("wrong") },
    }),
  ).toThrow(/Bind crop/);
  expect(
    verifyRecord(r.record, r.files, { pin: r.pin }).sourceVerification,
  ).toBe("source-crop/2.0");
  const dir = await mkdtemp(join(tmpdir(), "pdf-v2-archive-"));
  try {
    for (const [p, b] of r.files) {
      await mkdir(join(dir, p, ".."), { recursive: true });
      await writeFile(join(dir, p), b);
    }
    expect((await readRecord(dir, { pin: r.pin })).entries).toBe(1);
    expect(() => recordFor(c.args)).toThrow(/writer requires index 3.0/);
    await expect(writeRecord(join(dir, "rewrite"), r)).rejects.toThrow(
      /Bind crop/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(["missing", "v2", "v1"])(
  "new PDF writer refuses %s shape/version downgrade",
  (mode) => {
    const c = fixture(),
      v = c.signed.entries[0].sourceVerification;
    if (mode === "missing") delete v.cropShape;
    else v.format = `thermite-draw-source-crop/${mode === "v2" ? 2 : 1}.0`;
    c.args.signed = Buffer.from(json(c.signed));
    c.args.receipt = Buffer.from(json(c.receipt));
    expect(() => recordFor(c.args)).toThrow(/Bind crop|v3 em\+ink/);
  },
);
it("offline v3 verification refuses a coherent raster/shape dimension mismatch", () => {
  const c = fixture(),
    v = c.signed.entries[0].sourceVerification;
  // The field edit is self-consistent with the crop shape, but not its raster.
  v.cropShape.inkBbox.w += 1;
  v.sourceBbox.w += 1;
  c.row.cropShape = v.cropShape;
  c.row.sourceBbox = v.sourceBbox;
  c.args.signed = Buffer.from(json(c.signed));
  c.args.receipt = Buffer.from(json(c.receipt));
  c.args.cropIndex = Buffer.from(
    json({ format: "thermite-draw-crop-index/3.0", crops: [c.row] }),
  );
  expect(() => recordFor(c.args)).toThrow(/reference dimensions/);
});

it("a trusted v2 archive pin cannot authenticate a different in-memory manifest", () => {
  const c = oldArchive(),
    r = c.result;
  r.record.baseCommit = "2".repeat(40);
  expect(() => verifyRecord(r.record, r.files, { pin: r.pin })).toThrow(
    /Bind crop/,
  );
});

it("new writer and pinned archive cannot label v3 PDF evidence with an old index version", () => {
  const c = fixture();
  c.args.cropIndex = Buffer.from(
    json({ format: "thermite-draw-crop-index/2.0", crops: [c.row] }),
  );
  expect(() => recordFor(c.args)).toThrow(/writer requires index 3.0/);
  const r = c.result,
    idx = JSON.parse(r.files.get(r.record.cropIndex));
  idx.format = "thermite-draw-crop-index/2.0";
  const bytes = Buffer.from(json(idx));
  replace(r, r.record.cropIndex, bytes);
  r.record.cropIndexSha256 = hash(bytes);
  r.files.set("record.json", Buffer.from(json(r.record)));
  expect(() =>
    verifyRecord(r.record, r.files, {
      pin: { pr: 7, recordSha256: hash(r.files.get("record.json")) },
    }),
  ).toThrow(/archive requires index 3.0/);
});

it.each(["attestation medium", "index medium", "source medium"])(
  "archive refuses contradictory PDF/SVG %s",
  (mode) => {
    const c = fixture(),
      v = c.signed.entries[0].sourceVerification;
    if (mode !== "index medium") {
      v.format = "thermite-draw-source-crop/2.0";
      v.medium = "svg";
      v.capture = {
        implementation: "chromium-source/1.0",
        browser: "synthetic",
        platform: "synthetic",
        args: [],
        deviceScaleFactor: 300 / 96,
      };
    }
    if (mode !== "attestation medium")
      c.row.scope = { ...c.row.scope, medium: "svg" };
    c.args.signed = Buffer.from(json(c.signed));
    c.args.receipt = Buffer.from(json(c.receipt));
    c.args.cropIndex = Buffer.from(
      json({ format: "thermite-draw-crop-index/3.0", crops: [c.row] }),
    );
    expect(() => recordFor(c.args)).toThrow(/PDF archive index/);
  },
);
