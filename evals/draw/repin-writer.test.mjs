import { pngFixture } from "./png-fixture.mjs";
import { it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFor, writeRecord } from "./repin-record-write.mjs";
import { recordFixture } from "./repin-record-fixture.mjs";
import { verifyRecord, deterministicReceipt } from "./repin-record.mjs";
import { recordBudget } from "./repin-record-policy.mjs";
import { hash, json } from "./support.mjs";
function args() {
  const c = recordFixture();
  return {
    pr: 7,
    baseCommit: c.record.baseCommit,
    signed: c.files.get("decisions.json"),
    receipt: c.files.get("receipt.json.gz"),
    cropIndex: c.files.get("crop-index.json"),
    crops: new Map([
      [c.signed.entries[0].crop.path, c.files.get("crops/fixture.png")],
    ]),
  };
}
it.each(["missing", "extra", "changed"])(
  "writer rejects %s crop input",
  (mode) => {
    const a = args();
    if (mode === "missing") a.crops.clear();
    if (mode === "extra") a.crops.set("extra", Buffer.from("other"));
    if (mode === "changed")
      a.crops.set([...a.crops.keys()][0], Buffer.from("changed"));
    expect(() => recordFor(a)).toThrow(
      mode === "changed" ? /Writer crop hash/ : /exactly the indexed/,
    );
  },
);
it("writer requires byte-buffer inputs", () => {
  const a = args();
  a.signed = "not bytes";
  expect(() => recordFor(a)).toThrow(/byte buffers/);
});
it("writer checks pre-compressed input metadata", () => {
  const a = args(),
    z = Buffer.from(a.receipt);
  z.writeUInt32LE(123, 4);
  a.receipt = z;
  expect(() => recordFor(a)).toThrow(/Input gzip metadata/);
});
it("reader checks compressed text flags independently of the file manifest", () => {
  const c = recordFixture(),
    raw = c.files.get("crop-index.json"),
    z = deterministicReceipt(raw),
    named = Buffer.concat([
      z.subarray(0, 10),
      Buffer.from("name\0"),
      z.subarray(10),
    ]);
  named[3] = 8;
  c.files.delete("crop-index.json");
  delete c.record.files["crop-index.json"];
  c.record.cropIndex = "crop-index.json.gz";
  c.files.set(c.record.cropIndex, named);
  c.record.files[c.record.cropIndex] = hash(named);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Text gzip must have deterministic/,
  );
});
it.each([
  { maxBytes: 3000001 },
  { maxBytes: 3000000, reason: "not a raise" },
  { maxBytes: Infinity, reason: "invalid" },
  { reason: "unused" },
])("requires a meaningful explicit cap exception %j", (pin) => {
  expect(() => recordBudget(pin)).toThrow(/exception|Unused/);
});
it("writer refuses mismatched manifest bytes before writing", async () => {
  const r = recordFor(args());
  r.files.set("record.json", Buffer.from("different"));
  const root = await mkdtemp(join(tmpdir(), "repin-write-"));
  try {
    await expect(writeRecord(join(root, "record"), r)).rejects.toThrow(
      /manifest bytes differ/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("writer cleans up its new directory after an IO failure", async () => {
  const r = recordFor(args());
  const old = r.record.receipt,
    next = r.record.signedDecisions + "/receipt.gz";
  r.files.set(next, r.files.get(old));
  r.files.delete(old);
  r.record.files[next] = r.record.files[old];
  delete r.record.files[old];
  r.record.receipt = next;
  r.files.set("record.json", Buffer.from(json(r.record)));
  const root = await mkdtemp(join(tmpdir(), "repin-write-fail-")),
    dest = join(root, "record");
  try {
    await expect(writeRecord(dest, r)).rejects.toThrow();
    await expect(access(dest)).rejects.toThrow(/ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("writer verifies payloads again before IO", async () => {
  const r = recordFor(args());
  r.files.set(
    [...r.files.keys()].find((p) => p.startsWith("crops/")),
    Buffer.from("changed"),
  );
  const root = await mkdtemp(join(tmpdir(), "repin-corrupt-"));
  try {
    await expect(writeRecord(join(root, "record"), r)).rejects.toThrow(
      /Original file hash mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("builder cross-checks the incoming signed judgments against the receipt", () => {
  const a = args();
  const r = JSON.parse(gunzipSync(a.receipt));
  r.decisions[0].reviewerJudged.note = "Changed judgment";
  a.receipt = Buffer.from(json(r));
  expect(() => recordFor(a)).toThrow(/Signed judgments differ/);
});
it("writer identifies an ambiguous crop filename collision", () => {
  const a = args(),
    first = "evals/out/draw-samples/A/same.png",
    last = "evals/out/draw-samples/B/same.png",
    middle = `evals/out/draw-samples/${hash(last).slice(0, 16)}-same.png`,
    rows = [first, middle, last].map((path, n) => ({
      path,
      sha256: hash(pngFixture({ seed: n + 2 })),
    })),
    s = JSON.parse(a.signed);
  s.entries[0].crop = rows[0];
  s.notMove = [{ crops: rows.slice(1) }];
  a.signed = Buffer.from(JSON.stringify(s) + "\n");
  a.cropIndex = Buffer.from(json({ crops: rows }));
  a.crops = new Map(rows.map((c, n) => [c.path, pngFixture({ seed: n + 2 })]));
  expect(() => recordFor(a)).toThrow(/Writer crop name collision/);
});
