import { it, expect } from "vitest";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { recordFixture } from "./repin-record-fixture.mjs";
import { drawingHash } from "./png-ink.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { recordFor } from "./repin-record-write.mjs";
import { verifyRecord, deterministicReceipt } from "./repin-record.mjs";
import { readRecordChain, verifyRecordChain } from "./repin-record-chain.mjs";
import { payloadBytes, legacyRecord } from "./repin-record-policy.mjs";
import { hash, json } from "./support.mjs";
import { gunzipSync } from "node:zlib";
function grouped() {
  const c = recordFixture(),
    s = c.signed,
    r = JSON.parse(gunzipSync(c.files.get("receipt.json.gz")));
  const crops = new Map(
    [1, 2].map((n) => [
      `evals/out/draw-samples/header-${n}.png`,
      pngFixture({ header: n, stamped: true }),
    ]),
  );
  const rows = [...crops].map(([path, b]) => ({
    path,
    sha256: hash(b),
    headerPixels: 86,
  }));
  s.entries = rows.map((crop) => ({
    ...s.entries[0],
    crop,
    drawingSha256: drawingHash(crops.get(crop.path), crop.headerPixels),
  }));
  r.decisions = s.entries.map((e) => ({
    ...e,
    reviewerJudged: {
      causeClass: e.causeClass,
      note: e.note,
      cause: e.cause,
      drawingSha256: e.drawingSha256,
      signOffs: [e.signOff],
    },
  }));
  const args = {
    pr: 7,
    baseCommit: c.record.baseCommit,
    signed: Buffer.from(json(s)),
    receipt: Buffer.from(json(r)),
    cropIndex: Buffer.from(json({ crops: rows })),
    crops,
  };
  return { args, result: recordFor(args) };
}
function index(r, fn) {
  const i = JSON.parse(r.files.get(r.record.cropIndex));
  fn(i);
  const b = Buffer.from(json(i));
  r.files.set(r.record.cropIndex, b);
  r.record.cropIndexSha256 = hash(b);
  r.record.files[r.record.cropIndex] = hash(b);
}
it("retains one real PNG per drawing and a hash-bound row per signed crop", () => {
  const { args, result: r } = grouped();
  expect(verifyRecord(r.record, r.files)).toMatchObject({
    entries: 2,
    crops: 2,
    drawingGroups: 1,
  });
  expect(
    [...r.files.keys()].filter((p) => p.startsWith("crops/")),
  ).toHaveLength(1);
  const i = JSON.parse(r.files.get(r.record.cropIndex));
  expect(i.crops.map((c) => c.sha256)).toEqual(
    [...args.crops.values()].map(hash),
  );
  expect(i.crops[0].drawingSha256).toBe(i.crops[1].drawingSha256);
  expect(i.crops[0].sha256).not.toBe(i.crops[1].sha256);
  expect(i.crops[0].retained).toBe(i.crops[1].retained);
});
it("writer derives drawing hashes instead of trusting a draft claim", () => {
  const { args } = grouped(),
    i = JSON.parse(args.cropIndex);
  i.crops[0].drawingSha256 = hash("invented");
  i.crops[0].retained = "invented.png";
  args.cropIndex = Buffer.from(json(i));
  const r = recordFor(args),
    actual = JSON.parse(r.files.get(r.record.cropIndex));
  expect(actual.crops[0].drawingSha256).not.toBe(hash("invented"));
  expect(verifyRecord(r.record, r.files).drawingGroups).toBe(1);
});
it.each(["drawing hash", "retained path", "header"])(
  "recomputes grouped crop %s",
  (field) => {
    const { result: r } = grouped();
    index(r, (i) => {
      if (field === "drawing hash") i.crops[1].drawingSha256 = hash("wrong");
      if (field === "retained path") i.crops[1].retained = "crops/wrong.png";
      if (field === "header") i.crops[1].headerPixels = 85;
    });
    expect(() => verifyRecord(r.record, r.files)).toThrow(
      /drawing hash|retained path|header/,
    );
  },
);
it("does not merge distinct drawing ink", () => {
  const { args } = grouped(),
    i = JSON.parse(args.cropIndex),
    [path] = [...args.crops.keys()].slice(1);
  const b = pngFixture({ seed: 9, stamped: true });
  args.crops.set(path, b);
  i.crops[1].sha256 = hash(b);
  args.cropIndex = Buffer.from(json(i));
  const s = JSON.parse(args.signed);
  s.entries[1].crop.sha256 = hash(b);
  s.entries[1].drawingSha256 = drawingHash(b, 86);
  const receipt = JSON.parse(args.receipt);
  receipt.decisions[1].reviewerJudged.drawingSha256 =
    s.entries[1].drawingSha256;
  args.receipt = Buffer.from(json(receipt));
  args.signed = Buffer.from(json(s));
  expect(
    verifyRecord(...Object.values(recordFor(args)).slice(0, 2)).drawingGroups,
  ).toBe(2);
});
it("retained PNG must still match one original signed crop hash", () => {
  const { result: r } = grouped(),
    s = JSON.parse(r.files.get(r.record.signedDecisions));
  const path = Object.values(r.record.pathMap)[0],
    actual = hash(r.files.get(path));
  index(r, (i) =>
    i.crops.forEach((c) => {
      if (c.sha256 === actual) c.sha256 = hash("not an original");
    }),
  );
  s.entries.forEach((e) => {
    if (e.crop.sha256 === actual) e.crop.sha256 = hash("not an original");
  });
  const b = Buffer.from(json(s));
  r.files.set(r.record.signedDecisions, b);
  r.record.signedDecisionsSha256 = hash(b);
  r.record.files[r.record.signedDecisions] = hash(b);
  expect(() => verifyRecord(r.record, r.files)).toThrow(
    /Retained PNG must match/,
  );
});
it.each(["context.txt", "evidence/x.jpg", "x.txt"])(
  "rejects extra manifest payload %s",
  (p) => {
    const c = recordFixture(),
      b = pngFixture();
    c.files.set(p, b);
    c.record.files[p] = hash(b);
    expect(() => verifyRecord(c.record, c.files)).toThrow(/extra file/);
  },
);
it.each([false, true])(
  "empty records cannot claim a registry transition; unchanged=%s",
  (same) => {
    const c = recordFixture();
    c.signed.entries = [];
    const s = Buffer.from(JSON.stringify(c.signed) + "\n");
    c.files.set("decisions.json", s);
    c.record.signedDecisionsSha256 = hash(s);
    c.record.files["decisions.json"] = hash(s);
    const r = JSON.parse(gunzipSync(c.files.get("receipt.json.gz")));
    r.decisions = [];
    if (same)
      r.registryAfterSha256 = c.record.registryAfterSha256 =
        r.registryBeforeSha256;
    const b = Buffer.from(json(r)),
      z = deterministicReceipt(b);
    c.files.set("receipt.json.gz", z);
    c.record.receiptSha256 = hash(b);
    c.record.files["receipt.json.gz"] = hash(z);
    c.files.delete("crops/fixture.png");
    delete c.record.files["crops/fixture.png"];
    c.record.pathMap = {};
    index(c, (i) => (i.crops = []));
    if (same) expect(verifyRecord(c.record, c.files).entries).toBe(0);
    else
      expect(() => verifyRecord(c.record, c.files)).toThrow(/Empty decisions/);
  },
);
it("checks text gzip MTIME independently of FLG", () => {
  const c = recordFixture(),
    name = "crop-index.json.gz",
    z = deterministicReceipt(c.files.get("crop-index.json"));
  z.writeUInt32LE(1, 4);
  c.files.delete("crop-index.json");
  delete c.record.files["crop-index.json"];
  c.record.cropIndex = name;
  c.files.set(name, z);
  c.record.files[name] = hash(z);
  expect(() => verifyRecord(c.record, c.files)).toThrow(/Text gzip/);
});
it("D1 raw-text grandfathering needs its exact signed hash", () => {
  expect(
    legacyRecord(
      92,
      "b56690d45cae4a53beef6dfe39b68221d00d00842cce36445cd6c175b7094da5",
    ),
  ).toBe(true);
  expect(() =>
    payloadBytes(
      { pr: 92, signedDecisionsSha256: hash("another signed file") },
      "index",
      new Map([["index", Buffer.alloc(262145)]]),
    ),
  ).toThrow(/must be gzipped/);
});
it.each(["recordSha256", "baseCommit"])(
  "pins D1's immutable %s even if metadata and row agree",
  async (field) => {
    const { pins, records } = await readRecordChain(
      fileURLToPath(new URL("./repins", import.meta.url)),
      fileURLToPath(new URL("./expectations.mjs", import.meta.url)),
    );
    const p = structuredClone(pins),
      r = records.get("92");
    if (field === "baseCommit") {
      r.record.baseCommit = p.records[0].baseCommit = "3".repeat(40);
      r.files.set("record.json", Buffer.from(json(r.record)));
      p.records[0].recordSha256 = hash(r.files.get("record.json"));
    } else {
      r.record.extra = "rewrite";
      r.files.set("record.json", Buffer.from(json(r.record)));
      p.records[0].recordSha256 = hash(r.files.get("record.json"));
    }
    expect(() =>
      verifyRecordChain(p, records, r.record.registryAfterSha256),
    ).toThrow(/Immutable D1/);
  },
);
it("keeps D1 first even when another record's PR sorts earlier", async () => {
  const { pins, records } = await readRecordChain(
    fileURLToPath(new URL("./repins", import.meta.url)),
    fileURLToPath(new URL("./expectations.mjs", import.meta.url)),
  );
  pins.records.unshift({ ...pins.records[0], pr: 1 });
  records.set("1", records.get("92"));
  expect(() => verifyRecordChain(pins, records, "irrelevant")).toThrow(
    /D1 must be the first/,
  );
});
it("rejects duplicate JSON keys in the pin table", async () => {
  const root = await mkdtemp(join(tmpdir(), "repin-duplicate-pins-"));
  try {
    await writeFile(join(root, "pins.json"), '{"records":[],"records":[]}');
    await expect(readRecordChain(root, join(root, "registry"))).rejects.toThrow(
      /^Duplicate JSON key: records$/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("retained crop roles require PNG filenames even for valid image bytes", () => {
  const c = recordFixture(),
    old = "crops/fixture.png",
    path = "crops/fixture.jpg";
  c.files.set(path, c.files.get(old));
  c.files.delete(old);
  c.record.files[path] = c.record.files[old];
  delete c.record.files[old];
  c.record.pathMap[c.signed.entries[0].crop.path] = path;
  expect(() => verifyRecord(c.record, c.files)).toThrow(/retained crop path/);
});
it("the crop builder refuses repeated paths before constructing an index", async () => {
  const { groupCrops } = await import("./repin-record-crops.mjs"),
    p = "same.png",
    b = pngFixture(),
    row = { path: p, sha256: hash(b) };
  expect(() =>
    groupCrops(
      [row, row],
      new Map([
        [p, b],
        ["unused.png", b],
      ]),
    ),
  ).toThrow(/Duplicate indexed/);
});
it("D1 base pin has its own literal refusal", async () => {
  const { pins, records } = await readRecordChain(
    fileURLToPath(new URL("./repins", import.meta.url)),
    fileURLToPath(new URL("./expectations.mjs", import.meta.url)),
  );
  pins.records[0].baseCommit = "3".repeat(40);
  expect(() =>
    verifyRecordChain(
      pins,
      records,
      records.get("92").record.registryAfterSha256,
    ),
  ).toThrow(/Immutable D1 base pin changed/);
});
it.each([
  undefined,
  "thermite-draw-crop-index/1.0",
  "thermite-draw-crop-index/3.0",
  "invented",
])("refuses unknown legacy crop-index format %s", (format) => {
  const c = recordFixture();
  index(c, (i) => (i.format = format));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Unknown crop index format/,
  );
});
it("decodes even a fully hash-matched crop on the D1-layout path", () => {
  const c = recordFixture(),
    bad = Buffer.from("not a png"),
    sha = hash(bad),
    path = "crops/fixture.png";
  c.files.set(path, bad);
  c.record.files[path] = sha;
  index(c, (i) => (i.crops[0].sha256 = sha));
  c.signed.entries[0].crop.sha256 = sha;
  const s = Buffer.from(JSON.stringify(c.signed) + "\n");
  c.files.set("decisions.json", s);
  c.record.signedDecisionsSha256 = hash(s);
  c.record.files["decisions.json"] = hash(s);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Invalid PNG signature/,
  );
});
it("writer refuses null header declarations instead of treating them as plain crops", () => {
  const { args } = grouped(),
    i = JSON.parse(args.cropIndex);
  i.crops[0].headerPixels = null;
  args.cropIndex = Buffer.from(json(i));
  expect(() => recordFor(args)).toThrow(/Crop header must be 0 or 86/);
});
