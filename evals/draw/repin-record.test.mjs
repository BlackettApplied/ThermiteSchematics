import { pngFixture } from "./png-fixture.mjs";
import { it, expect } from "vitest";
import { recordFixture } from "./repin-record-fixture.mjs";
import { readRecordChain } from "./repin-record-chain.mjs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  readRecord,
  verifyRecord,
  deterministicReceipt,
} from "./repin-record.mjs";
import { hash, json } from "./support.mjs";
import { strictJsonBytes } from "./repin-io.mjs";
const records = fileURLToPath(new URL("./repins/", import.meta.url));
const pins = strictJsonBytes(await readFile(records + "pins.json"));
for (const pr of (await readdir(records, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()) {
  it(`verifies durable re-pin ${pr}: originals, every crop and path map`, async () => {
    const r = await readRecord(records + pr, {
      pin: pins.records.find((p) => String(p.pr) === pr),
    });
    expect(r.record.pr).toBe(Number(pr));
    if (pr === "92") {
      expect(hash(r.files.get("record.json"))).toBe(
        "c01537abb5a0e2091b5126b53ede2e723068fd7bf5906e11f02c775d266e1ae5",
      );
      expect(r.record.baseCommit).toBe(
        "b1e4038895d0a40bc308cf9c4a8c646e2da4c2e8",
      );
      expect(pins.records[0].pr).toBe(92);
      expect(r.record.signedDecisionsSha256).toBe(
        "b56690d45cae4a53beef6dfe39b68221d00d00842cce36445cd6c175b7094da5",
      );
      expect(r.record.receiptSha256).toBe(
        "fa243c1a3cb8caf5ae3fe7344e70e8650a6bb883c27b116adbcd9f17122e85b5",
      );
      expect(r).toMatchObject({
        entries: 295,
        crops: 60,
        countersignMode: "sidecar",
      });
    }
  });
}
const fixture = recordFixture;
const edit = (c, fn) => {
  fn(c.signed);
  c.files.set(
    "decisions.json",
    Buffer.from(
      c.record.countersignMode === "canonical"
        ? json(c.signed)
        : JSON.stringify(c.signed) + "\n",
    ),
  );
};
function countersign(c, patch = {}) {
  c.files.set(
    "countersignatures.json",
    Buffer.from(
      json({
        format: "thermite-draw-countersignatures/1.0",
        signedDecisionsSha256: c.record.signedDecisionsSha256,
        entries: [
          { entryIndex: 0, kind: "person", by: "Person fixture", ...patch },
        ],
      }),
    ),
  );
}
it.each([false, true])(
  "verifies untouched original, canonical=%s",
  (canonical) => {
    const c = fixture(canonical);
    expect(verifyRecord(c.record, c.files).entries).toBe(1);
  },
);
it("accepts an additive person countersign on canonical signed entries", () => {
  const c = fixture(true);
  edit(c, (s) => {
    s.entries[0].counterSignOffs = [{ kind: "person", by: "Person fixture" }];
  });
  expect(verifyRecord(c.record, c.files).countersignMode).toBe("canonical");
});
it("accepts an additive person sidecar for non-canonical signed bytes", () => {
  const c = fixture();
  countersign(c);
  expect(verifyRecord(c.record, c.files).countersignMode).toBe("sidecar");
});
it.each([false, true])(
  "refuses every immutable signed-field edit, canonical=%s",
  (canonical) => {
    for (const field of [
      "note",
      "cause",
      "causeClass",
      "action",
      "reviewed",
      "crop",
      "signOff",
      "drawingSha256",
      "successor",
      "columnMap",
      "pairs",
      "scope",
      "to",
    ]) {
      const c = fixture(canonical);
      edit(c, (s) => {
        s.entries[0][field] =
          field === "signOff"
            ? { kind: "agent", by: "Changed reviewer" }
            : field === "crop"
              ? { ...s.entries[0].crop, path: "other" }
              : field === "reviewed"
                ? false
                : "changed";
      });
      expect(() => verifyRecord(c.record, c.files), field).toThrow(/Immutable/);
    }
  },
);
it("non-canonical signed files cannot receive inline countersigns", () => {
  const c = fixture();
  edit(c, (s) => {
    s.entries[0].counterSignOffs = [{ kind: "person", by: "Person fixture" }];
  });
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Immutable signed bytes/,
  );
});
it("canonical countersigned files cannot change serialization", () => {
  const c = fixture(true);
  c.files.set("decisions.json", Buffer.from(JSON.stringify(c.signed)));
  expect(() => verifyRecord(c.record, c.files)).toThrow(/stay canonical/);
});
it.each([
  { kind: "agent" },
  { kind: "unknown" },
  { kind: undefined },
  { by: " " },
  { by: 1 },
  { entryIndex: 1 },
  { entryIndex: -1 },
  { note: "overwrite" },
])("refuses invalid person sidecar %j", (patch) => {
  const c = fixture();
  countersign(c, patch);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /person|non-empty|entry|fields/,
  );
});
it("refuses a sidecar bound to another signed file", () => {
  const c = fixture();
  countersign(c);
  const s = JSON.parse(c.files.get("countersignatures.json"));
  s.signedDecisionsSha256 = hash("other");
  c.files.set("countersignatures.json", Buffer.from(json(s)));
  expect(() => verifyRecord(c.record, c.files)).toThrow(/signed hash mismatch/);
});
it("refuses an additional sidecar on a canonical record", () => {
  const c = fixture(true);
  countersign(c);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /cannot have a countersign sidecar/,
  );
});
it.each([
  { kind: "agent", by: "Agent" },
  { kind: "person", by: " " },
])("refuses invalid inline countersign %j", (signOff) => {
  const c = fixture(true);
  edit(c, (s) => {
    s.entries[0].counterSignOffs = [signOff];
  });
  expect(() => verifyRecord(c.record, c.files)).toThrow(/person|non-empty/);
});
it("checks the independent crop index even if the changed crop's file digest is updated", () => {
  const c = fixture();
  c.files.set("crops/fixture.png", pngFixture({ seed: 2 }));
  c.record.files["crops/fixture.png"] = hash(pngFixture({ seed: 2 }));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Indexed crop hash mismatch/,
  );
});
it("checks the uncompressed historical receipt independently of its compressed-file digest", () => {
  const c = fixture(),
    r = JSON.parse(gunzipSync(c.files.get("receipt.json.gz")));
  r.added = "changed";
  const b = deterministicReceipt(Buffer.from(json(r)));
  c.files.set("receipt.json.gz", b);
  c.record.files["receipt.json.gz"] = hash(b);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Historical receipt hash mismatch/,
  );
});
it("requires deterministic gzip metadata and reproduces bytes twice", () => {
  const c = fixture(),
    b = Buffer.from(c.files.get("receipt.json.gz"));
  expect(deterministicReceipt(gunzipSync(b))).toEqual(b);
  b.writeUInt32LE(123, 4);
  c.files.set("receipt.json.gz", b);
  c.record.files["receipt.json.gz"] = hash(b);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /deterministic metadata/,
  );
});
it("refuses missing, changed or unlisted original files", () => {
  const c = fixture();
  c.files.delete("crops/fixture.png");
  expect(() => verifyRecord(c.record, c.files)).toThrow(/file hash mismatch/);
  const d = fixture();
  d.files.set("unlisted.png", Buffer.from("new"));
  expect(() => verifyRecord(d.record, d.files)).toThrow(/Unlisted record file/);
});
it("refuses duplicate person sidecar signatures", () => {
  const c = fixture();
  countersign(c);
  const s = JSON.parse(c.files.get("countersignatures.json"));
  s.entries.push({ ...s.entries[0] });
  c.files.set("countersignatures.json", Buffer.from(json(s)));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Duplicate person countersign/,
  );
});
it("hashes every original file even when it is not an indexed crop", () => {
  const c = fixture();
  c.record.files["context.txt"] = hash("original context");
  c.files.set("context.txt", Buffer.from("changed context"));
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Original file hash mismatch: context.txt/,
  );
});

it("checks every pinned record and the registry chain", async () => {
  expect(
    (
      await readRecordChain(
        records,
        fileURLToPath(new URL("./expectations.mjs", import.meta.url)),
      )
    ).records.size,
  ).toBeGreaterThan(0);
});
