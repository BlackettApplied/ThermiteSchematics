import { assemble, it0 } from "./repin-fixture.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { cropHeader } from "./crop-report.mjs";
import { expect, it } from "vitest";
import { mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { pngFixture } from "./png-fixture.mjs";
import { hash, json } from "./support.mjs";
import { drawingHash } from "./png-ink.mjs";
import { cliFixture } from "./repin-cli-fixture.mjs";
import { draftDecisions } from "./repin-draft.mjs";
import { loadRepinInputs } from "./repin-io.mjs";
import { recordFixture } from "./repin-record-fixture.mjs";
import { verifyRecord, deterministicReceipt } from "./repin-record.mjs";
import { sourceGeometryFixture } from "./crop-source-fixture.mjs";
it("production preview loading refuses missing source facts", async () => {
  const c = await cliFixture();
  try {
    const draft = draftDecisions(
      JSON.parse(await readFile(join(c.out, "inventory.json"), "utf8")),
      { pr: "#7" },
    );
    const png = pngFixture(),
      path = "evals/out/draw-samples/source/crop.png";
    await mkdir(join(c.root, "evals/out/draw-samples/source"), {
      recursive: true,
    });
    await writeFile(join(c.root, path), png);
    const e = draft.entries.find((e) => e.crop);
    e.crop = { path, sha256: hash(png) };
    e.drawingSha256 = drawingHash(png);
    const decisionPath = join(c.out, "no-source.json");
    await writeFile(decisionPath, json(draft));
    await expect(
      loadRepinInputs({
        root: c.root,
        reportPath: join(c.out, "report.json"),
        decisionPaths: [decisionPath],
        specs: c.context.specs,
      }),
    ).rejects.toThrow(/source with Chromium/);
  } finally {
    await c.cleanup();
  }
});
it("archive verification requires new source facts even after coherent rebinding", () => {
  const c = recordFixture(),
    e = c.signed.entries[0];
  delete e.sourceVerification;
  const signed = Buffer.from(json(c.signed));
  c.files.set(c.record.signedDecisions, signed);
  c.record.signedDecisionsSha256 = hash(signed);
  c.record.files[c.record.signedDecisions] = hash(signed);
  const r = JSON.parse(gunzipSync(c.files.get(c.record.receipt)));
  delete r.decisions[0].reviewerJudged.sourceVerification;
  const raw = Buffer.from(json(r)),
    zip = deterministicReceipt(raw);
  c.files.set(c.record.receipt, zip);
  c.record.receiptSha256 = hash(raw);
  c.record.files[c.record.receipt] = hash(zip);
  expect(() => verifyRecord(c.record, c.files)).toThrow(/source with Chromium/);
});
it("real bind CLI refuses missing Chromium and creates no apparently verified output", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url)),
    outDir = join(root, "evals/out");
  await mkdir(outDir, { recursive: true });
  const dir = await mkdtemp(join(outDir, "source-bind-"));
  const samples = join(root, "evals/out/draw-samples");
  await mkdir(samples, { recursive: true });
  const sample = await mkdtemp(join(samples, "source-bind-"));
  try {
    const png = pngFixture(),
      path = sample.slice(root.length).replaceAll("\\", "/") + "/crop.png";
    await writeFile(join(root, path), png);
    const ctx = assemble({
      registryItems: [],
      currentItems: [it0("new", { bbox: { x: 1, y: 1, w: 1, h: 1 } })],
      entries: ({ add }) => [add(it0("new"))],
    });
    const sha = hash(json(ctx.report)),
      t = instanceInventory(ctx.report, sha).instances[0];
    await writeFile(join(dir, "report.json"), json(ctx.report));
    const row = {
      path,
      sha256: hash(png),
      ...sourceGeometryFixture(),
      capture: "fresh-source",
      scope: t.scope,
      markerId: t.markerId,
      token: t.token,
      reportSha256: sha,
      physicalSheet: t.physicalSheet,
      row: t.row,
      text: t.facts.text,
      sourceRender: {
        medium: "svg",
        svg: `${t.scope.case}/sheet-001.svg`,
        svgSha256: hash("source"),
      },
    };
    await writeFile(join(dir, "index.json"), json({ crops: [row] }));
    await writeFile(
      join(dir, "draft.json"),
      json({
        format: "thermite-draw-decisions/1.0",
        summarySha256: sha,
        entries: [
          {
            action: "new-defect",
            to: { markerId: t.markerId, scope: t.scope },
            instances: [t.token],
            reviewed: false,
            crop: { path, sha256: row.sha256 },
          },
        ],
      }),
    );
    await mkdir(join(dir, t.scope.case));
    await writeFile(join(dir, row.sourceRender.svg), "source");
    const output = join(dir, "output.json");
    const r = spawnSync(
      "bun",
      [
        join(root, "evals/draw/repin-bind-crops.mjs"),
        "--decisions",
        join(dir, "draft.json"),
        "--crop-index",
        join(dir, "index.json"),
        "--source-root",
        dir,
        "--report",
        join(dir, "report.json"),
        "--output",
        output,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          THERMITE_DRAW_CHROMIUM: "/nonexistent/thermite-source-chromium",
        },
      },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not name an accessible executable");
    expect(r.stderr).toContain("No checks were skipped");
    await expect(readFile(output)).rejects.toThrow(/ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(sample, { recursive: true, force: true });
  }
});
it("source attestations cannot change without the receipt judgment", () => {
  const c = recordFixture();
  c.signed.entries[0].sourceVerification.sourceSha256 = hash("another SVG");
  const bytes = Buffer.from(json(c.signed));
  c.files.set(c.record.signedDecisions, bytes);
  c.record.signedDecisionsSha256 = hash(bytes);
  c.record.files[c.record.signedDecisions] = hash(bytes);
  expect(() => verifyRecord(c.record, c.files)).toThrow(
    /Signed judgments differ/,
  );
});
it("production builder refuses W-C11 to W-C17 in a substituted source root before needing Chromium", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url)),
    outDir = join(root, "evals/out");
  await mkdir(outDir, { recursive: true });
  const dir = await mkdtemp(join(outDir, "pinned-builder-")),
    samplesRoot = join(outDir, "draw-samples");
  await mkdir(samplesRoot, { recursive: true });
  const parent = await mkdtemp(join(samplesRoot, "pinned-builder-"));
  try {
    const c = assemble({
      registryItems: [],
      currentItems: [
        it0("wire", { text: "W-C11", bbox: { x: 1, y: 1, w: 1, h: 1 } }),
      ],
      entries: () => [],
    });
    const r = c.report,
      row = r.results.find((r) => r.evidence?.findings?.length);
    row.evidence.crop = "row.png";
    row.evidence.cropBbox = { x: 0, y: 0, w: 3, h: 3 };
    const original = "<svg><text>W-C11</text></svg>",
      pin = r.sourceHashes.sheets[0].svg;
    pin.sha256 = hash(original);
    const raw = json(r),
      sha = hash(raw),
      t = instanceInventory(r, sha).instances[0];
    await mkdir(join(dir, t.scope.case));
    await writeFile(join(dir, pin.path), original.replace("W-C11", "W-C17"));
    await writeFile(join(dir, "row.png"), pngFixture());
    await writeFile(join(dir, "report.json"), raw);
    await writeFile(
      join(dir, "draft.json"),
      json({
        format: "thermite-draw-decisions/1.0",
        summarySha256: sha,
        entries: [
          {
            reviewed: false,
            action: "new-defect",
            to: { markerId: t.markerId, scope: t.scope },
            instances: [t.token],
          },
        ],
      }),
    );
    const output = join(dir, "prepared.json"),
      p = spawnSync(
        "bun",
        [
          join(root, "evals/draw/repin-crop-index.mjs"),
          "--report",
          join(dir, "report.json"),
          "--decisions",
          join(dir, "draft.json"),
          "--output",
          output,
          "--index",
          join(dir, "index.json"),
          "--samples",
          join(parent, "crops"),
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            THERMITE_DRAW_CHROMIUM: "/nonexistent/pinned-builder",
          },
        },
      );
    expect(p.status).toBe(1);
    expect(p.stderr).toContain("Source render hash differs from C1 report");
    await expect(readFile(output)).rejects.toThrow(/ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});
