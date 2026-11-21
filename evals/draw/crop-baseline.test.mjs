import { expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mixedCropFixture } from "./crop-review-fixture.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { cropPlans, instanceCropRow } from "./crop-index.mjs";
import {
  checkIndexedEntries,
  verificationFact,
  cropHeader,
} from "./crop-report.mjs";
import { json, hash } from "./support.mjs";
import { pinnedSource } from "./source-hashes.mjs";

function fixture(side = 0) {
  const c = mixedCropFixture();
  const baseline = c.reports.get(c.file.baselineSha256);
  // Old captures had geometry but no source hashes. Pin-free bytes own the tokens.
  baseline.results.find(
    (r) => r.evidence.findings.length,
  ).evidence.findings[0].bbox = c.a.bbox;
  if (side === 0) delete baseline.sourceHashes;
  else if (side === 1) delete c.report.sourceHashes;
  const oldSha = hash(json(baseline)),
    currentSha = hash(json(c.report));
  const a = instanceInventory(baseline, oldSha).instances[0],
    b = instanceInventory(c.report, currentSha).instances[0];
  const crops = [
    { path: "old.png", sha256: hash("old") },
    { path: "new.png", sha256: hash("new") },
  ];
  const file = {
    format: "thermite-draw-decisions/1.0",
    summarySha256: currentSha,
    baselineSha256: oldSha,
    entries: [],
    notMove: [{ from: a.token, to: b.token, crops }],
  };
  const reports = new Map([
    [oldSha, baseline],
    [currentSha, c.report],
  ]);
  const contexts = new Map([
    [oldSha, { role: "baseline", path: "old/baseline.json", sha256: oldSha }],
    [
      currentSha,
      { role: "report", path: "new/report.json", sha256: currentSha },
    ],
  ]);
  function indexRow(t, sha, crop) {
    return {
      ...c.indexFor(c.a).crops[0],
      path: crop.path,
      sha256: crop.sha256,
      reportSha256: sha,
      token: t.token,
      markerId: t.markerId,
      scope: t.scope,
      row: t.row,
      text: t.facts.text,
      instanceBbox: t.bbox,
      headerLines: cropHeader(t),
      sourceRender: {
        medium: "svg",
        svg: c.indexFor(c.a).crops[0].sourceRender.svg,
        svgSha256: sha === oldSha ? hash("source") : hash(c.source),
      },
    };
  }
  return {
    file,
    reports,
    contexts,
    baseline,
    oldSha,
    currentSha,
    crops,
    index: {
      crops: [indexRow(a, oldSha, crops[0]), indexRow(b, currentSha, crops[1])],
    },
  };
}
const diagnosticPaths = [
  "old/baseline.json",
  "/tmp/space path/baseline.json",
  String.raw`D:\space path\baseline.json`,
];
it.each(diagnosticPaths.flatMap((path) => [0, 1].map((side) => [side, path])))(
  "identifies the unpinned report for notMove crop %s at %s without borrowing pins",
  (side, path) => {
    const c = fixture(side),
      sha = side === 0 ? c.oldSha : c.currentSha;
    const context = c.contexts.get(sha);
    context.path = path;
    const { role } = context;
    for (const check of [
      () => cropPlans(c.file, c.reports, c.contexts),
      () => checkIndexedEntries(c.file, c.index, c.reports, c.contexts),
    ]) {
      expect(check).toThrow(role + ' "' + path + '"');
      expect(check).toThrow(sha);
      expect(check).toThrow(
        /original source revision.*fresh target cannot supply baseline pins/i,
      );
    }
  },
);
it.each(diagnosticPaths)(
  "names the unpinned PDF source at %s verbatim",
  (path) => {
    const c = fixture(2);
    const t = instanceInventory(c.baseline, c.oldSha).instances[0];
    t.scope.medium = "pdf";
    for (const sheet of c.baseline.sourceHashes.sheets) delete sheet.pdf;
    expect(() =>
      pinnedSource(c.baseline, t, { role: "baseline", path, sha256: c.oldSha }),
    ).toThrow(
      `baseline "${path}" (SHA-256 ${c.oldSha}) has no pinned PDF source`,
    );
  },
);
it("keeps diagnostic paths out of successful index and attestation payloads", () => {
  const c = fixture(2),
    unrelated = structuredClone(c.baseline);
  delete unrelated.sourceHashes;
  const unrelatedSha = hash(json(unrelated));
  c.reports.set(unrelatedSha, unrelated);
  c.contexts.set(unrelatedSha, {
    role: "baseline",
    path: "unrelated.json",
    sha256: unrelatedSha,
  });
  // Only the cited baseline needs pins; unrelated older reports are not substituted.
  const plans = cropPlans(c.file, c.reports, c.contexts);
  expect(() =>
    checkIndexedEntries(c.file, c.index, c.reports, c.contexts),
  ).not.toThrow();
  for (const plan of plans) {
    const row = instanceCropRow(
      plan,
      plan.crop.path,
      Buffer.from("png"),
      { x: 0, y: 0, w: 3, h: 3 },
      Buffer.from("source"),
    );
    const payload = json([row, verificationFact(row, hash("source"))]);
    expect(payload).not.toContain("old/baseline.json");
    expect(payload).not.toContain("new/report.json");
  }
});
it.each(["repin-crop-index.mjs", "repin-bind-crops.mjs"])(
  "%s names the exact baseline path and SHA before writing output",
  async (script) => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    await mkdir(join(root, "evals/out"), { recursive: true });
    const dir = await mkdtemp(join(root, "evals/out/baseline guard-"));
    try {
      const c = fixture(),
        baselinePath = join(dir, "baseline.json"),
        reportPath = join(dir, "report.json");
      await writeFile(baselinePath, json(c.baseline));
      await writeFile(reportPath, json(c.reports.get(c.currentSha)));
      await writeFile(join(dir, "draft.json"), json(c.file));
      await writeFile(join(dir, "index.json"), json(c.index));
      const output = join(dir, "output.json");
      const r = spawnSync(
        "bun",
        [
          join(root, "evals/draw", script),
          "--report",
          reportPath,
          "--baseline",
          baselinePath,
          "--decisions",
          join(dir, "draft.json"),
          "--output",
          output,
          ...(script === "repin-crop-index.mjs"
            ? [
                "--index",
                join(dir, "created.json"),
                "--samples",
                join(root, "evals/out/draw-samples/unused-baseline"),
              ]
            : ["--crop-index", join(dir, "index.json")]),
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('baseline "' + baselinePath + '"');
      expect(r.stderr).toContain(c.oldSha);
      await expect(readFile(output)).rejects.toThrow(/ENOENT/);
      await expect(
        readFile(
          script === "repin-crop-index.mjs"
            ? join(dir, "created.json")
            : output + ".audit.json",
        ),
      ).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
