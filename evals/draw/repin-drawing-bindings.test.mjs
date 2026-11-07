import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { pngFixture } from "./png-fixture.mjs";
import { hash, json } from "./support.mjs";
import { drawingHash } from "./png-ink.mjs";
import {
  bindDrawingDraft,
  checkCropDrawing,
  checkSignedDrawings,
} from "./repin-drawing-bindings.mjs";
import { recordFor } from "./repin-record-write.mjs";
import { verifyRecord, deterministicReceipt } from "./repin-record.mjs";
import { verifyRecordChain } from "./repin-record-chain.mjs";
import { cliFixture } from "./repin-cli-fixture.mjs";
import { draftDecisions } from "./repin-draft.mjs";
import { A } from "./repin-fixture.mjs";
function fixture({ notMove = false } = {}) {
  const crops = new Map(
    [0, 1, 2].map((n) => [
      `evals/out/draw-samples/binding/${n}.png`,
      pngFixture({ stamped: true, header: n + 1, seed: n === 2 ? 9 : 1 }),
    ]),
  );
  const index = {
    crops: [...crops].map(([path, b]) => ({
      path,
      sha256: hash(b),
      headerPixels: 86,
    })),
  };
  const file = {
    format: "thermite-draw-decisions/1.0",
    pr: "#7",
    summarySha256: hash("report"),
    checkerSha256: hash("checker"),
    registrySha256: hash("before"),
    entries: index.crops.map((c) => ({
      action: "new-defect",
      reviewed: false,
      causeClass: "synthetic",
      note: "Synthetic protocol fixture, not approval",
      signOff: { kind: "", by: "" },
      crop: { path: c.path, sha256: c.sha256 },
      drawingSha256: "",
    })),
  };
  if (notMove) {
    file.notMove = [
      {
        from: "a",
        to: "b",
        reason: "Synthetic distinction",
        crops: file.entries.slice(1).map((e) => e.crop),
      },
    ];
    file.entries = file.entries.slice(0, 1);
  }
  const bound = bindDrawingDraft(file, index, crops);
  return { file, index, crops, bound };
}
function reviewed(c = fixture()) {
  const signed = structuredClone(c.bound);
  for (const e of signed.entries) {
    e.reviewed = true;
    e.signOff = {
      kind: "agent",
      by: "Synthetic protocol fixture, not approval",
    };
  }
  const receipt = {
    format: "thermite-draw-repin-receipt/1.0",
    summarySha256: signed.summarySha256,
    checkerSha256: signed.checkerSha256,
    registryBeforeSha256: signed.registrySha256,
    registryAfterSha256: hash("after"),
    decisions: signed.entries.map((e) => ({
      ...e,
      reviewerJudged: {
        causeClass: e.causeClass,
        note: e.note,
        cause: e.cause,
        drawingSha256: e.drawingSha256,
        signOffs: [e.signOff],
      },
    })),
  };
  const args = {
    pr: 7,
    baseCommit: "1".repeat(40),
    signed: Buffer.from(json(signed)),
    receipt: Buffer.from(json(receipt)),
    cropIndex: Buffer.from(json(c.index)),
    crops: c.crops,
  };
  return { ...c, signed, receipt, args, result: recordFor(args) };
}
function editIndex(r, fn) {
  const i = JSON.parse(r.files.get(r.record.cropIndex));
  fn(i);
  const b = Buffer.from(json(i));
  r.files.set(r.record.cropIndex, b);
  r.record.cropIndexSha256 = hash(b);
  r.record.files[r.record.cropIndex] = hash(b);
}
function forge(r) {
  let stolen;
  editIndex(r, (i) => {
    const a = i.crops[1],
      b = i.crops[2];
    a.retained = b.retained;
    a.drawingSha256 = b.drawingSha256;
    r.record.pathMap[a.path] = b.retained;
    stolen = b.drawingSha256;
  });
  return stolen;
}
it("computes facts before sign-off, preserves review fields, and ignores typed hash claims", () => {
  const c = fixture(),
    before = json(c.file);
  c.file.entries[0].drawingSha256 = hash("signer text");
  const typed = json(c.file),
    bound = bindDrawingDraft(c.file, c.index, c.crops);
  expect(json(c.file)).toBe(typed);
  expect(before).not.toBe(typed);
  for (const e of bound.entries) {
    expect(e.reviewed).toBe(false);
    expect(e.signOff).toEqual({ kind: "", by: "" });
    expect(e.note).toContain("not approval");
    expect(e.drawingSha256).toBe(drawingHash(c.crops.get(e.crop.path), 86));
    expect(e.crop.headerPixels).toBe(86);
  }
});
it.each(["reviewed", "kind", "by", "counter"])(
  "refuses to edit an approved or signed %s draft",
  (part) => {
    const c = fixture();
    if (part === "reviewed") c.file.entries[0].reviewed = true;
    if (part === "kind") c.file.entries[0].signOff.kind = "agent";
    if (part === "by") c.file.entries[0].signOff.by = "Reviewer";
    if (part === "counter") c.file.entries[0].counterSignOffs = [];
    expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(
      /before review\/sign-off/,
    );
  },
);
it("refuses another decisions format", () => {
  const c = fixture();
  c.file.format = "invented";
  expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(
    /unreviewed decisions draft/,
  );
});
it.each(["duplicate", "missing", "extra", "extra buffer", "missing buffer"])(
  "requires exact crop-index coverage: %s",
  (shape) => {
    const c = fixture();
    if (shape === "duplicate") c.index.crops.push(c.index.crops[0]);
    if (shape === "missing") c.index.crops.pop();
    if (shape === "extra")
      c.index.crops.push({ path: "extra", sha256: hash("extra") });
    if (shape === "extra buffer") c.crops.set("extra", Buffer.from("extra"));
    if (shape === "missing buffer") c.crops.delete([...c.crops.keys()][0]);
    expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(
      /Duplicate|exactly cover/,
    );
  },
);
it.each(["both hashes invented", "signed hash differs"])(
  "binds actual crop bytes: %s",
  (shape) => {
    const c = fixture();
    if (shape === "both hashes invented") {
      c.file.entries[0].crop.sha256 = c.index.crops[0].sha256 = hash("fiction");
    } else c.file.entries[0].crop.sha256 = hash("fiction");
    expect(() => bindDrawingDraft(c.file, c.index, c.crops)).toThrow(
      /binding crop hash/,
    );
  },
);
it("requires a bound hash at production sign-off loading", () => {
  const c = fixture(),
    e = c.bound.entries[0],
    b = c.crops.get(e.crop.path);
  checkCropDrawing(e, e.crop, b);
  delete e.drawingSha256;
  expect(() => checkCropDrawing(e, e.crop, b)).toThrow(/Bind drawingSha256/);
});
it("recomputes the signed hash from the crop at preview time", () => {
  const c = fixture(),
    e = c.bound.entries[0];
  e.drawingSha256 = hash("typed value");
  expect(() => checkCropDrawing(e, e.crop, c.crops.get(e.crop.path))).toThrow(
    /differs from crop pixels/,
  );
});
it("L6a refuses an index row regrouped onto a different retained drawing", () => {
  const c = reviewed(),
    r = c.result;
  forge(r);
  expect(() => verifyRecord(r.record, r.files)).toThrow(
    /Signed drawing hash differs from crop index/,
  );
});
it("L6a with the signed entry edited fails the immutable signed hash", () => {
  const c = reviewed(),
    r = c.result,
    stolen = forge(r);
  c.signed.entries[1].drawingSha256 = stolen;
  r.files.set(r.record.signedDecisions, Buffer.from(json(c.signed)));
  expect(() => verifyRecord(r.record, r.files)).toThrow(
    /Immutable canonical signed content changed/,
  );
});
it("L6a with signed hashes and metadata rebound still fails the original pin", () => {
  const c = reviewed(),
    r = c.result,
    pins = {
      format: "thermite-draw-repin-pins/1.0",
      records: [
        {
          pr: 7,
          baseCommit: r.record.baseCommit,
          recordSha256: hash(r.files.get("record.json")),
        },
      ],
    };
  c.signed.entries[1].drawingSha256 = forge(r);
  const s = Buffer.from(json(c.signed));
  r.files.set(r.record.signedDecisions, s);
  r.record.signedDecisionsSha256 = hash(s);
  r.record.files[r.record.signedDecisions] = hash(s);
  c.receipt.decisions[1].reviewerJudged.drawingSha256 =
    c.signed.entries[1].drawingSha256;
  const rb = Buffer.from(json(c.receipt)),
    z = deterministicReceipt(rb);
  r.files.set(r.record.receipt, z);
  r.record.receiptSha256 = hash(rb);
  r.record.files[r.record.receipt] = hash(z);
  r.files.set("record.json", Buffer.from(json(r.record)));
  expect(() =>
    verifyRecordChain(pins, new Map([["7", r]]), r.record.registryAfterSha256),
  ).toThrow(/Pinned record.json hash changed/);
});
it("also binds notMove drawing citations against regrouping", () => {
  const c = reviewed(fixture({ notMove: true })),
    r = c.result;
  expect(verifyRecord(r.record, r.files).crops).toBe(3);
  forge(r);
  expect(() => verifyRecord(r.record, r.files)).toThrow(
    /Signed drawing hash differs/,
  );
});
it.each([undefined, "invented"])(
  "grouped records require signed drawingSha256=%s",
  (value) => {
    const c = reviewed(),
      r = c.result;
    c.signed.entries[0].drawingSha256 = value;
    const b = Buffer.from(json(c.signed));
    r.files.set(r.record.signedDecisions, b);
    r.record.signedDecisionsSha256 = hash(b);
    r.record.files[r.record.signedDecisions] = hash(b);
    c.receipt.decisions[0].reviewerJudged.drawingSha256 = value;
    const rb = Buffer.from(json(c.receipt)),
      z = deterministicReceipt(rb);
    r.files.set(r.record.receipt, z);
    r.record.receiptSha256 = hash(rb);
    r.record.files[r.record.receipt] = hash(z);
    expect(() => verifyRecord(r.record, r.files)).toThrow(
      /Signed crop needs drawingSha256/,
    );
  },
);
it("writer rechecks the signed drawing independently of a supplied index claim", () => {
  const c = reviewed();
  c.signed.entries[1].drawingSha256 = c.signed.entries[2].drawingSha256;
  c.args.signed = Buffer.from(json(c.signed));
  expect(() => recordFor(c.args)).toThrow(/Writer signed drawing hash differs/);
});
it("writer refuses a missing drawing binding before record construction", () => {
  const c = reviewed();
  delete c.signed.entries[0].drawingSha256;
  c.args.signed = Buffer.from(json(c.signed));
  expect(() => recordFor(c.args)).toThrow(
    /Writer signed crop needs drawingSha256/,
  );
});
it("receipt judgment carries the same attested drawing hash", () => {
  const c = reviewed(),
    r = c.result;
  c.receipt.decisions[0].reviewerJudged.drawingSha256 = hash(
    "different attestation",
  );
  const b = Buffer.from(json(c.receipt)),
    z = deterministicReceipt(b);
  r.files.set(r.record.receipt, z);
  r.record.receiptSha256 = hash(b);
  r.record.files[r.record.receipt] = hash(z);
  expect(() => verifyRecord(r.record, r.files)).toThrow(
    /Signed judgments differ/,
  );
});
it("checkSignedDrawings accepts the facts computed from the actual crops", () => {
  const c = fixture(),
    rows = c.index.crops.map((row) => ({
      ...row,
      drawingSha256: drawingHash(c.crops.get(row.path), 86),
    }));
  expect(() => checkSignedDrawings(c.bound, rows)).not.toThrow();
});
it.each([0, 86])(
  "real CLI: draft → bind pixels → mock independent sign-off → preview → archive, header=%s",
  async (header) => {
    const c = await cliFixture();
    try {
      const inventory = JSON.parse(
          await readFile(join(c.out, "inventory.json"), "utf8"),
        ),
        draft = draftDecisions(inventory, { pr: "#7" }),
        entry = draft.entries.find((e) => e.crop),
        png = pngFixture({ stamped: header === 86 }),
        path = "evals/out/draw-samples/bind/crop.png",
        row = { path, sha256: hash(png), headerPixels: header };
      expect(entry.drawingSha256).toBe("");
      entry.crop = { path, sha256: row.sha256 };
      entry.drawingSha256 = hash("signer typed claim");
      await mkdir(join(c.root, "evals/out/draw-samples/bind"), {
        recursive: true,
      });
      await writeFile(join(c.root, path), png);
      const input = join(c.out, "draft.json"),
        index = join(c.out, "index.json"),
        output = join(c.out, "bound.json");
      await writeFile(input, json(draft));
      await writeFile(index, json({ crops: [row] }));
      const run = (dest) =>
        spawnSync(
          "bun",
          [
            join(c.root, "evals/draw/repin-bind-crops.mjs"),
            "--decisions",
            input,
            "--crop-index",
            index,
            "--output",
            dest,
          ],
          { cwd: c.root, encoding: "utf8" },
        );
      const noArgs = spawnSync(
        "bun",
        [join(c.root, "evals/draw/repin-bind-crops.mjs")],
        { cwd: c.root, encoding: "utf8" },
      );
      expect(noArgs.status).toBe(1);
      expect(noArgs.stderr).toMatch(
        /AssertionError(?: \[ERR_ASSERTION\])?: Supply --decisions/,
      );
      const result = run(output);
      expect(result.status, result.stderr).toBe(0);
      const bound = JSON.parse(await readFile(output, "utf8")),
        e = bound.entries.find((e) => e.crop);
      expect(e.drawingSha256).toBe(drawingHash(png, header));
      expect(e.reviewed).toBe(false);
      expect(await readFile(input, "utf8")).toBe(json(draft));
      const existing = run(output);
      expect(existing.status).toBe(1);
      expect(existing.stderr).toContain("EEXIST");
      const outside = run(join(c.root, "outside.json"));
      expect(outside.status).toBe(1);
      expect(outside.stderr).toContain("under");
      for (const item of bound.entries) {
        item.reviewed = true;
        item.signOff = {
          kind: "agent",
          by: "Synthetic independent reviewer fixture, not approval",
        };
        item.causeClass = "synthetic";
        item.note = "Protocol test only";
        if (item.action === "retire") item.cause = "removed";
      }
      const signed = join(c.out, "signed.json"),
        baseline = join(c.out, "baseline.json");
      await writeFile(signed, json(bound));
      await writeFile(baseline, json([...c.context.baselines.values()][0]));
      const preview = c.run(
        "--report",
        join(c.out, "report.json"),
        "--decisions",
        signed,
        "--baseline",
        baseline,
        "--preview",
        join(c.out, "preview.mjs"),
      );
      expect(preview.status, preview.stderr).toBe(0);
      const receipt = JSON.parse(preview.stdout),
        attestation = receipt.decisions.find(
          (d) => d.reviewerJudged.drawingSha256,
        );
      expect(attestation.reviewerJudged.drawingSha256).toBe(e.drawingSha256);
      expect(attestation.toolProved.drawingSha256).toBe(e.drawingSha256);
      const archived = recordFor({
        pr: 7,
        baseCommit: "1".repeat(40),
        signed: await readFile(signed),
        receipt: Buffer.from(preview.stdout),
        cropIndex: Buffer.from(json({ crops: [row] })),
        crops: new Map([[path, png]]),
      });
      expect(verifyRecord(archived.record, archived.files).drawingGroups).toBe(
        1,
      );
      bound.entries.find((e) => e.crop).drawingSha256 = hash(
        "edited after signing",
      );
      await writeFile(signed, json(bound));
      const bad = c.run(
        "--report",
        join(c.out, "report.json"),
        "--decisions",
        signed,
        "--baseline",
        baseline,
        "--preview",
        join(c.out, "bad.mjs"),
      );
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("differs from crop pixels");
      bound.pr = "#92";
      delete bound.entries.find((e) => e.crop).drawingSha256;
      await writeFile(signed, json(bound));
      const fakeLegacy = c.run(
        "--report",
        join(c.out, "report.json"),
        "--decisions",
        signed,
        "--baseline",
        baseline,
        "--preview",
        join(c.out, "fake-legacy.mjs"),
      );
      expect(fakeLegacy.status).toBe(1);
      expect(fakeLegacy.stderr).toContain("Bind drawingSha256");
      await writeFile(input, json(bound));
      const postSign = run(join(c.out, "post-sign.json"));
      expect(postSign.status).toBe(1);
      expect(postSign.stderr).toContain("before review/sign-off");
    } finally {
      await c.cleanup();
    }
  },
);

it("the original signed hash rejects coherent drawing edits even with a matching receipt", () => {
  const c = reviewed(),
    r = c.result;
  c.signed.entries[1].drawingSha256 = forge(r);
  r.files.set(r.record.signedDecisions, Buffer.from(json(c.signed)));
  c.receipt.decisions[1].reviewerJudged.drawingSha256 =
    c.signed.entries[1].drawingSha256;
  const raw = Buffer.from(json(c.receipt)),
    z = deterministicReceipt(raw);
  r.files.set(r.record.receipt, z);
  r.record.receiptSha256 = hash(raw);
  r.record.files[r.record.receipt] = hash(z);
  expect(() => verifyRecord(r.record, r.files)).toThrow(
    /Immutable canonical signed content changed/,
  );
});

it("bind CLI refuses an evals/out symlink outside the workspace even without crops", async () => {
  const c = await cliFixture(),
    outside = await mkdtemp(join(tmpdir(), "thermite-bind-outside-"));
  try {
    const input = join(c.root, "empty.json"),
      index = join(c.root, "empty-index.json");
    await writeFile(
      input,
      json({ format: "thermite-draw-decisions/1.0", pr: "#7", entries: [] }),
    );
    await writeFile(index, json({ crops: [] }));
    await rm(c.out, { recursive: true, force: true });
    await symlink(outside, c.out, "junction");
    const r = spawnSync(
      "bun",
      [
        join(c.root, "evals/draw/repin-bind-crops.mjs"),
        "--decisions",
        input,
        "--crop-index",
        index,
        "--output",
        join(c.out, "escape.json"),
      ],
      { cwd: c.root, encoding: "utf8" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("under");
  } finally {
    await c.cleanup();
    await rm(outside, { recursive: true, force: true });
  }
});
