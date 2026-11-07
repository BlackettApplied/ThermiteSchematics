import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { hash, json } from "./support.mjs";
import { readRecord, verifyRecord } from "./repin-record.mjs";
import { strictJsonBytes } from "./repin-io.mjs";
export function verifyRecordChain(pins, records, registrySha256) {
  assert(
    pins.format === "thermite-draw-repin-pins/1.0" &&
      Array.isArray(pins.records) &&
      pins.records.length,
    "Invalid re-pin table",
  );
  const ids = pins.records.map((p) => String(p.pr));
  assert(new Set(ids).size === ids.length, "Duplicate record pin");
  assert(
    json([...records.keys()].sort()) === json([...ids].sort()),
    "Record directories and pins must correspond in both directions",
  );
  assert(
    !ids.includes("92") || ids[0] === "92",
    "D1 must be the first retained pin",
  );
  let previous;
  for (const pin of pins.records) {
    assert(
      Object.keys(pin).every((k) =>
        ["pr", "recordSha256", "baseCommit", "maxBytes", "reason"].includes(k),
      ) &&
        Number.isSafeInteger(pin.pr) &&
        pin.pr > 0 &&
        /^[a-f0-9]{64}$/.test(pin.recordSha256),
      "Invalid record pin",
    );
    if (pin.pr === 92) {
      assert(
        pin.recordSha256 ===
          "c01537abb5a0e2091b5126b53ede2e723068fd7bf5906e11f02c775d266e1ae5",
        "Immutable D1 record pin changed",
      );
      assert(
        pin.baseCommit === "b1e4038895d0a40bc308cf9c4a8c646e2da4c2e8",
        "Immutable D1 base pin changed",
      );
    }
    const r = records.get(String(pin.pr));
    assert(
      hash(r.files.get("record.json")) === pin.recordSha256,
      "Pinned record.json hash changed",
    );
    assert(
      pin.baseCommit === r.record.baseCommit,
      "Pinned record base changed",
    );
    assert(pin.pr === r.record.pr, "Pinned record PR changed");
    verifyRecord(r.record, r.files, { pin });
    assert(
      previous === undefined || r.record.registryBeforeSha256 === previous,
      "Re-pin registry chain is broken",
    );
    previous = r.record.registryAfterSha256;
  }
  assert(
    previous === registrySha256,
    "Newest retained re-pin must bind the current registry",
  );
  return ids;
}
export async function readRecordChain(directory, registryPath) {
  const pins = strictJsonBytes(await readFile(join(directory, "pins.json")));
  const rows = new Map((pins.records ?? []).map((p) => [String(p.pr), p]));
  const records = new Map();
  for (const e of await readdir(directory, { withFileTypes: true })) {
    assert(!e.isSymbolicLink(), "Record directories cannot be symlinks");
    if (e.isDirectory())
      records.set(
        e.name,
        await readRecord(join(directory, e.name), { pin: rows.get(e.name) }),
      );
    else assert(e.name === "pins.json", "Unlisted record table file");
  }
  verifyRecordChain(pins, records, hash(await readFile(registryPath)));
  return { pins, records };
}
