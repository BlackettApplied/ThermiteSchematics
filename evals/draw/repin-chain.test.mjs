import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFixture, recordPadding } from "./repin-record-fixture.mjs";
import { writeRecord } from "./repin-record-write.mjs";
import { verifyRecord } from "./repin-record.mjs";
import { verifyRecordChain, readRecordChain } from "./repin-record-chain.mjs";
import { hash, json } from "./support.mjs";
function fixture() {
  const r = recordFixture();
  r.files.set("record.json", Buffer.from(json(r.record)));
  const pin = {
    pr: 7,
    recordSha256: hash(r.files.get("record.json")),
    baseCommit: r.record.baseCommit,
  };
  return {
    r,
    pin,
    pins: { format: "thermite-draw-repin-pins/1.0", records: [pin] },
    records: new Map([["7", r]]),
  };
}
it("a valid one-record chain is accepted", () => {
  const c = fixture();
  expect(verifyRecordChain(c.pins, c.records, hash("after"))).toEqual(["7"]);
});
it.each([{ extra: "not allowed" }, { pr: "7" }, { recordSha256: "invalid" }])(
  "checks pin row shape %j",
  (patch) => {
    const c = fixture();
    Object.assign(c.pin, patch);
    expect(() => verifyRecordChain(c.pins, c.records, hash("after"))).toThrow(
      /Invalid record pin/,
    );
  },
);
it("binds the pin issue number to the record", () => {
  const c = fixture();
  c.pin.pr = 8;
  c.records = new Map([["8", c.r]]);
  expect(() => verifyRecordChain(c.pins, c.records, hash("after"))).toThrow(
    /Pinned record PR changed/,
  );
});
it("pins metadata even when an attacker rebinds the signed file and receipt", () => {
  const c = fixture();
  c.r.record.baseCommit = "2".repeat(40);
  c.r.files.set("record.json", Buffer.from(json(c.r.record)));
  expect(() => verifyRecordChain(c.pins, c.records, hash("after"))).toThrow(
    /Pinned record.json hash changed/,
  );
});
it("the pin's explicit size exception reaches record verification", () => {
  const c = fixture(),
    b = Buffer.alloc(3000000);
  recordPadding(c.r, b.length);
  c.r.files.set("record.json", Buffer.from(json(c.r.record)));
  c.pin.recordSha256 = hash(c.r.files.get("record.json"));
  c.pin.maxBytes = 4000000;
  c.pin.reason = "Synthetic reviewed exception";
  expect(verifyRecordChain(c.pins, c.records, hash("after"))).toEqual(["7"]);
});
it("keeps .DS_Store failing closed", () => {
  const c = fixture();
  c.r.files.set(".DS_Store", Buffer.from("finder"));
  expect(() => verifyRecord(c.r.record, c.r.files)).toThrow(
    /Unlisted record file/,
  );
});
it("refuses a symlinked record directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "repin-chain-link-"));
  try {
    const c = fixture(),
      records = join(root, "records"),
      target = join(root, "target"),
      registry = join(root, "expectations");
    await mkdir(records);
    await writeRecord(target, c.r);
    await writeFile(registry, "after");
    await writeFile(join(records, "pins.json"), json(c.pins));
    await symlink(target, join(records, "7"), "junction");
    await expect(readRecordChain(records, registry)).rejects.toThrow(
      /Record directories cannot be symlinks/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses unlisted files beside the pin table", async () => {
  const root = await mkdtemp(join(tmpdir(), "repin-chain-extra-"));
  try {
    const c = fixture();
    await writeFile(join(root, "pins.json"), json(c.pins));
    await writeFile(join(root, "unexpected"), "extra");
    await expect(readRecordChain(root, join(root, "registry"))).rejects.toThrow(
      /Unlisted record table file/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("directory reader forwards explicit per-PR size exceptions", async () => {
  const root = await mkdtemp(join(tmpdir(), "repin-chain-budget-"));
  try {
    const c = fixture(),
      b = Buffer.alloc(3000000);
    recordPadding(c.r, b.length);
    c.r.files.set("record.json", Buffer.from(json(c.r.record)));
    c.pin.recordSha256 = hash(c.r.files.get("record.json"));
    c.pin.maxBytes = 4000000;
    c.pin.reason = "Synthetic reviewed larger record";
    await writeRecord(join(root, "7"), { ...c.r, pin: c.pin });
    await writeFile(join(root, "pins.json"), json(c.pins));
    const registry = join(root, "registry");
    await writeFile(registry, "after");
    const recordsDir = join(root, "records");
    await mkdir(recordsDir);
    const { rename } = await import("node:fs/promises");
    await rename(join(root, "7"), join(recordsDir, "7"));
    await rename(join(root, "pins.json"), join(recordsDir, "pins.json"));
    expect((await readRecordChain(recordsDir, registry)).records.size).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
