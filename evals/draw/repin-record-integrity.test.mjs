import { pngFixture } from "./png-fixture.mjs";
import { it, expect } from "vitest";
import { crossCheckReceipt } from "./repin-record-crosscheck.mjs";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { recordFixture } from "./repin-record-fixture.mjs";
import {
  verifyRecord,
  readRecord,
  deterministicReceipt,
} from "./repin-record.mjs";
import { recordFor, writeRecord } from "./repin-record-write.mjs";
import { verifyRecordChain } from "./repin-record-chain.mjs";
import { hash, json } from "./support.mjs";
const signed = (c, fn) => {
  fn(c.signed);
  const b = Buffer.from(
    c.record.countersignMode === "canonical"
      ? json(c.signed)
      : JSON.stringify(c.signed) + "\n",
  );
  c.files.set("decisions.json", b);
  c.record.signedDecisionsSha256 = hash(b);
  c.record.files["decisions.json"] = hash(b);
};
const receipt = (c, fn) => {
  const r = JSON.parse(gunzipSync(c.files.get("receipt.json.gz")));
  fn(r);
  const b = Buffer.from(json(r)),
    z = deterministicReceipt(b);
  c.files.set("receipt.json.gz", z);
  c.record.receiptSha256 = hash(b);
  c.record.files["receipt.json.gz"] = hash(z);
};
const index = (c, fn) => {
  const r = JSON.parse(c.files.get("crop-index.json"));
  fn(r);
  const b = Buffer.from(json(r));
  c.files.set("crop-index.json", b);
  c.record.cropIndexSha256 = hash(b);
  c.record.files["crop-index.json"] = hash(b);
};
const side = (c, fn = () => {}) => {
  const r = {
    format: "thermite-draw-countersignatures/1.0",
    signedDecisionsSha256: c.record.signedDecisionsSha256,
    entries: [{ entryIndex: 0, kind: "person", by: "Person fixture" }],
  };
  fn(r);
  c.files.set("countersignatures.json", Buffer.from(json(r)));
};
it.each(["registryBeforeSha256", "registryAfterSha256"])(
  "binds record %s to receipt",
  (field) => {
    const c = recordFixture();
    c.record[field] = hash("changed");
    expect(() => verifyRecord(c.record, c.files)).toThrow(
      /Registry receipt binding/,
    );
  },
);
it("binds signed crop after manifest/index are both rewritten", () => {
  const c = recordFixture();
  c.files.set("crops/fixture.png", pngFixture({ seed: 2 }));
  c.record.files["crops/fixture.png"] = hash(pngFixture({ seed: 2 }));
  index(c, (i) => (i.crops[0].sha256 = hash(pngFixture({ seed: 2 }))));
  expect(() => verifyRecord(c.record, c.files)).toThrow(/Signed crop differs/);
});
it("binds signed PR to record PR", () => {
  const c = recordFixture();
  c.record.pr = 8;
  expect(() => verifyRecord(c.record, c.files)).toThrow(/PR\/count/);
});
it("checks decision count before cross-binding", () => {
  const c = recordFixture();
  receipt(c, (r) => (r.decisions = []));
  expect(() => verifyRecord(c.record, c.files)).toThrow(/PR\/count/);
});
it("refuses unknown receipt format", () => {
  const c = recordFixture();
  receipt(c, (r) => (r.format = "wrong"));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Unknown receipt format/,
  );
});
it("refuses FNAME even when gzip time is zero", () => {
  const c = recordFixture(),
    z = c.files.get("receipt.json.gz"),
    b = Buffer.concat([z.subarray(0, 10), Buffer.from("x\0"), z.subarray(10)]);
  b[3] = 8;
  c.files.set("receipt.json.gz", b);
  c.record.files["receipt.json.gz"] = hash(b);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /deterministic metadata/,
  );
});
it("refuses unused path mappings", () => {
  const c = recordFixture();
  c.record.pathMap.extra = "crops/extra.png";
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Unused crop path mapping/,
  );
});
it("refuses duplicate indexed paths", () => {
  const c = recordFixture();
  index(c, (i) => i.crops.push({ ...i.crops[0] }));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Duplicate indexed crop path/,
  );
});
it("checks the signed file's independent manifest binding", () => {
  const c = recordFixture();
  c.record.files["decisions.json"] = hash(pngFixture({ seed: 2 }));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Signed manifest binding/,
  );
});
it.each(["format", "empty", "extra"])(
  "refuses malformed sidecar %s",
  (mode) => {
    const c = recordFixture();
    side(c, (s) => {
      if (mode === "format") s.format = "wrong";
      if (mode === "empty") s.entries = [];
      if (mode === "extra") s.note = "override";
    });
    expect(() => verifyRecord(c.record, c.files)).toThrow(
      mode === "format"
        ? /Unknown countersignatures format/
        : mode === "empty"
          ? /List person/
          : /Invalid countersignatures document/,
    );
  },
);
it("sidecars cannot be original manifest files", () => {
  const c = recordFixture();
  side(c);
  c.record.files["countersignatures.json"] = hash(
    c.files.get("countersignatures.json"),
  );
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Invalid original file manifest/,
  );
});
it.each([{ baseCommit: "short" }, { pr: "7" }, { pr: 0 }])(
  "checks PR/base syntax %j",
  (patch) => {
    const c = recordFixture();
    Object.assign(c.record, patch);
    expect(() => verifyRecord(c.record, c.files)).toThrow(/Record PR\/base/);
  },
);
it("checks record format", () => {
  const c = recordFixture();
  c.record.format = "wrong";
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Unknown record format/,
  );
});
it("refuses an empty inline countersign array", () => {
  const c = recordFixture(true);
  c.signed.entries[0].counterSignOffs = [];
  c.files.set("decisions.json", Buffer.from(json(c.signed)));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Empty countersign addition/,
  );
});
it("refuses unknown countersign mode", () => {
  const c = recordFixture();
  c.record.countersignMode = "unknown";
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Unknown countersign mode/,
  );
});
it("refuses a symlink even if it points at an empty directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "repin-record-link-"));
  try {
    const c = recordFixture(),
      dest = join(root, "record"),
      empty = join(root, "empty");
    c.files.set("record.json", Buffer.from(json(c.record)));
    await writeRecord(dest, c);
    await mkdir(empty);
    expect((await readRecord(dest)).entries).toBe(1);
    await symlink(empty, join(dest, "link"), "junction");
    await expect(readRecord(dest)).rejects.toThrow(
      /Record symlinks are refused/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each(["note", "signOff", "causeClass", "cause"])(
  "refuses signed %s edits even after rebinding record hashes",
  (field) => {
    const c = recordFixture();
    signed(c, (s) => {
      if (field === "note") s.entries[0].note = "altered";
      else if (field === "signOff")
        s.entries[0].signOff = { kind: "person", by: "Forged fixture" };
      else s.entries[0][field] = "altered";
    });
    expect(() => verifyRecord(c.record, c.files)).toThrow(
      /Signed judgments differ/,
    );
  },
);
it.each([
  ["summarySha256", "summary"],
  ["registrySha256", "registry"],
  ["checkerSha256", "checker"],
])("cross-binds signed %s", (field, label) => {
  const c = recordFixture();
  signed(c, (s) => (s[field] = hash(pngFixture({ seed: 2 }))));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    new RegExp(`Signed ${label} differs`),
  );
});
it("requires receipt reviewer judgments", () => {
  const c = recordFixture();
  receipt(c, (r) => delete r.decisions[0].reviewerJudged);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /reviewer judgment\/sign-off missing/,
  );
});
it("sidecar cannot repeat the original person signer", () => {
  const c = recordFixture();
  signed(
    c,
    (s) => (s.entries[0].signOff = { kind: "person", by: "Same person" }),
  );
  receipt(
    c,
    (r) =>
      (r.decisions[0].reviewerJudged.signOffs = [
        { kind: "person", by: "Same person", label: "person review" },
      ]),
  );
  side(c, (s) => (s.entries[0].by = "Same person"));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Duplicate person countersign/,
  );
});
function notMove() {
  const c = recordFixture(),
    cs = [1, 2].map((n) => ({
      path: `evals/out/draw-samples/exception${n}.png`,
      sha256: hash(pngFixture({ seed: n + 3 })),
    }));
  signed(
    c,
    (s) =>
      (s.notMove = [
        { from: "a", to: "b", reason: "Synthetic distinction", crops: cs },
      ]),
  );
  return { c, cs };
}
it("requires notMove crops in the retained index", () => {
  const { c } = notMove();
  expect(() => verifyRecord(c.record, c.files)).toThrow(/Signed crop differs/);
});
it("retains all notMove crops as well as entry crops", () => {
  const { c, cs } = notMove();
  cs.forEach((x, n) => {
    const p = `crops/exception${n + 1}.png`;
    c.files.set(p, pngFixture({ seed: n + 4 }));
    c.record.files[p] = x.sha256;
    c.record.pathMap[x.path] = p;
  });
  index(c, (i) => i.crops.push(...cs));
  expect(verifyRecord(c.record, c.files).crops).toBe(3);
});
it("refuses an orphan added to index, map and manifest", () => {
  const c = recordFixture(),
    crop = {
      path: "evals/out/draw-samples/orphan.png",
      sha256: hash(pngFixture({ seed: 8 })),
    };
  c.files.set("crops/orphan.png", pngFixture({ seed: 8 }));
  c.record.files["crops/orphan.png"] = crop.sha256;
  c.record.pathMap[crop.path] = "crops/orphan.png";
  index(c, (i) => i.crops.push(crop));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Uncited crop in retained index/,
  );
});
it("refuses a manifest crop absent from the index and signed citations", () => {
  const c = recordFixture();
  c.files.set("crops/orphan.png", pngFixture({ seed: 8 }));
  c.record.files["crops/orphan.png"] = hash(pngFixture({ seed: 8 }));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Uncited crop or extra file in original manifest/,
  );
});
it("requires path map values to be one-to-one", () => {
  const c = recordFixture(),
    crop = {
      ...c.signed.entries[0].crop,
      path: "evals/out/draw-samples/same.png",
    };
  signed(c, (s) => (s.entries[0].crop = crop));
  signed(
    c,
    (s) =>
      (s.notMove = [
        {
          crops: [
            { path: "evals/out/draw-samples/fixture.png", sha256: crop.sha256 },
            crop,
          ],
        },
      ]),
  );
  index(c, (i) => i.crops.push(crop));
  c.record.pathMap[crop.path] = "crops/fixture.png";
  expect(() => verifyRecord(c.record, c.files)).toThrow(/one-to-one/);
});
function archived() {
  const c = recordFixture();
  return recordFor({
    pr: c.record.pr,
    baseCommit: c.record.baseCommit,
    signed: c.files.get("decisions.json"),
    receipt: c.files.get("receipt.json.gz"),
    cropIndex: c.files.get("crop-index.json"),
    crops: new Map([
      [c.signed.entries[0].crop.path, c.files.get("crops/fixture.png")],
    ]),
  });
}
it("writes a new record without overwriting an existing directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "repin-writer-"));
  try {
    const dest = join(root, "record"),
      r = archived();
    await writeRecord(dest, r);
    expect((await readRecord(dest)).entries).toBe(1);
    await expect(writeRecord(dest, r)).rejects.toThrow(/EEXIST/);
    expect((await readRecord(dest)).entries).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("forces sidecar mode for compressed signed inputs", () => {
  const c = recordFixture(true),
    raw = c.files.get("decisions.json"),
    z = deterministicReceipt(raw);
  c.files.delete("decisions.json");
  delete c.record.files["decisions.json"];
  c.record.signedDecisions = "decisions.json.gz";
  c.files.set(c.record.signedDecisions, z);
  c.record.files[c.record.signedDecisions] = hash(z);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Gzipped signed decisions require sidecar/,
  );
});
it("enforces the default cap and an explicit per-PR size exception", () => {
  const c = recordFixture();
  side(c);
  c.files.set(
    "countersignatures.json",
    Buffer.concat([
      c.files.get("countersignatures.json"),
      Buffer.alloc(3000000, 32),
    ]),
  );
  expect(() => verifyRecord(c.record, c.files)).toThrow(/size cap/);
  expect(
    verifyRecord(c.record, c.files, {
      pin: { pr: 7, maxBytes: 4000000, reason: "Synthetic reviewed exception" },
    }).entries,
  ).toBe(1);
  expect(() =>
    verifyRecord(c.record, c.files, { pin: { pr: 7, maxBytes: 4000000 } }),
  ).toThrow(/explicit larger cap and reason/);
  expect(() => verifyRecord(c.record, c.files, { pin: { pr: 8 } })).toThrow(
    /belongs to another PR/,
  );
});
function pinned(c) {
  c.files.set("record.json", Buffer.from(json(c.record)));
  return {
    pr: c.record.pr,
    recordSha256: hash(c.files.get("record.json")),
    baseCommit: c.record.baseCommit,
  };
}
it.each([
  "missing row",
  "missing directory",
  "hash",
  "base",
  "newest",
  "format",
  "duplicate",
])("checks pinned record chain: %s", (mode) => {
  const c = recordFixture(),
    pin = pinned(c),
    pins = { format: "thermite-draw-repin-pins/1.0", records: [pin] },
    records = new Map([["7", c]]);
  if (mode === "missing row") pins.records = [{ ...pin, pr: 8 }];
  if (mode === "missing directory") records.clear();
  if (mode === "hash") pin.recordSha256 = hash("changed");
  if (mode === "base") pin.baseCommit = "2".repeat(40);
  if (mode === "format") pins.format = "wrong";
  if (mode === "duplicate") pins.records.push({ ...pin });
  expect(() =>
    verifyRecordChain(
      pins,
      records,
      hash(mode === "newest" ? "other" : "after"),
    ),
  ).toThrow(
    mode === "missing row" || mode === "missing directory"
      ? /correspond in both directions/
      : mode === "hash"
        ? /record.json hash changed/
        : mode === "base"
          ? /base changed/
          : mode === "newest"
            ? /Newest retained/
            : mode === "duplicate"
              ? /Duplicate record pin/
              : /Invalid re-pin table/,
  );
});
it("requires registry continuity between two pinned records", () => {
  const a = recordFixture(),
    b = recordFixture();
  b.record.pr = 8;
  signed(b, (s) => (s.pr = "#8"));
  b.record.registryBeforeSha256 = hash("disconnected");
  signed(b, (s) => (s.registrySha256 = b.record.registryBeforeSha256));
  receipt(b, (r) => (r.registryBeforeSha256 = b.record.registryBeforeSha256));
  const pins = {
    format: "thermite-draw-repin-pins/1.0",
    records: [pinned(a), pinned(b)],
  };
  expect(() =>
    verifyRecordChain(
      pins,
      new Map([
        ["7", a],
        ["8", b],
      ]),
      hash("after"),
    ),
  ).toThrow(/chain is broken/);
});
it("reproduces D1 record.json byte-for-byte from tracked inputs", async () => {
  const { fileURLToPath } = await import("node:url"),
    r = await readRecord(
      fileURLToPath(new URL("./repins/92/", import.meta.url)),
    );
  const b = recordFor({
    pr: 92,
    baseCommit: r.record.baseCommit,
    signed: r.files.get(r.record.signedDecisions),
    receipt: r.files.get(r.record.receipt),
    cropIndex: r.files.get(r.record.cropIndex),
    crops: new Map(
      Object.entries(r.record.pathMap).map(([p, v]) => [p, r.files.get(v)]),
    ),
    signedName: r.record.signedDecisions,
    receiptName: r.record.receipt,
    indexName: r.record.cropIndex,
  });
  expect(b.files.get("record.json")).toEqual(r.files.get("record.json"));
});
it("writes synthetic text/PNG scale only; real R4 size is measured separately", async () => {
  const { largeRecordFixture } = await import("./repin-large-fixture.mjs");
  const r = largeRecordFixture();
  expect(r.entries).toBe(2600);
  expect(r.crops).toBe(280);
  expect(r.uncompressed.signed).toBeGreaterThan(256 * 1024);
  expect(r.uncompressed.index).toBeGreaterThan(256 * 1024);
  expect(r.result.record.signedDecisions).toMatch(/\.gz$/);
  expect(r.result.record.cropIndex).toMatch(/\.gz$/);
  expect(r.result.record.countersignMode).toBe("sidecar");
  const root = await mkdtemp(join(tmpdir(), "repin-scale-"));
  try {
    await writeRecord(join(root, "record"), r.result);
    expect(await readRecord(join(root, "record"))).toMatchObject({
      entries: 2600,
      crops: 280,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each(["signed", "index"])(
  "refuses oversized raw %s text outside the D1 exception",
  async (which) => {
    const { largeRecordFixture } = await import("./repin-large-fixture.mjs");
    const { result: r } = largeRecordFixture();
    const field = which === "signed" ? "signedDecisions" : "cropIndex",
      old = r.record[field],
      path = old.slice(0, -3),
      bytes = gunzipSync(r.files.get(old));
    r.files.delete(old);
    delete r.record.files[old];
    r.files.set(path, bytes);
    r.record.files[path] = hash(bytes);
    r.record[field] = path;
    expect(() => verifyRecord(r.record, r.files)).toThrow(
      /over 256 KiB must be gzipped/,
    );
  },
);
it.each([
  ["summarySha256", "summarySha256"],
  ["registrySha256", "registryBeforeSha256"],
  ["checkerSha256", "checkerSha256"],
])("requires a real hash for cross-binding %s", (s, r) => {
  const c = recordFixture();
  signed(c, (x) => delete x[s]);
  receipt(c, (x) => delete x[r]);
  expect(() =>
    crossCheckReceipt(
      c.signed,
      JSON.parse(gunzipSync(c.files.get("receipt.json.gz"))),
    ),
  ).toThrow(/Signed .* differs/);
});
it("allows exactly 256 KiB of raw text and requires gzip above it", async () => {
  const { payloadBytes, TEXT_LIMIT } =
      await import("./repin-record-policy.mjs"),
    r = { pr: 7, signedDecisionsSha256: hash("fixture") },
    b = Buffer.alloc(TEXT_LIMIT);
  expect(TEXT_LIMIT).toBe(256 * 1024);
  expect(payloadBytes(r, "d", new Map([["d", b]]))).toBe(b);
  expect(() =>
    payloadBytes(r, "d", new Map([["d", Buffer.alloc(TEXT_LIMIT + 1)]])),
  ).toThrow(/over 256 KiB/);
});
it("allows exactly 3000000 bytes and refuses one byte more", () => {
  const c = recordFixture();
  side(c);
  c.files.set("record.json", Buffer.from(json(c.record)));
  const base = [...c.files.values()].reduce((n, b) => n + b.length, 0),
    original = c.files.get("countersignatures.json");
  c.files.set(
    "countersignatures.json",
    Buffer.concat([original, Buffer.alloc(3000000 - base, 32)]),
  );
  expect(verifyRecord(c.record, c.files).entries).toBe(1);
  c.files.set(
    "countersignatures.json",
    Buffer.concat([c.files.get("countersignatures.json"), Buffer.from(" ")]),
  );
  expect(() => verifyRecord(c.record, c.files)).toThrow(/size cap/);
});
it("checks the uncompressed hash of a compressed crop index", () => {
  const c = recordFixture(),
    z = deterministicReceipt(c.files.get("crop-index.json"));
  c.files.delete("crop-index.json");
  delete c.record.files["crop-index.json"];
  c.record.cropIndex = "crop-index.json.gz";
  c.files.set(c.record.cropIndex, z);
  c.record.files[c.record.cropIndex] = hash(z);
  c.record.cropIndexSha256 = hash("different logical index");
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Crop index hash mismatch/,
  );
});
it("requires a well-formed after hash even when record and receipt agree", () => {
  const c = recordFixture();
  c.record.registryAfterSha256 = "not-a-sha";
  receipt(c, (r) => (r.registryAfterSha256 = "not-a-sha"));
  expect(() => verifyRecord(c.record, c.files)).toThrow(/Invalid record hash/);
});
