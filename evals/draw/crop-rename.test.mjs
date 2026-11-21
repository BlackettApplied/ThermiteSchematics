import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mixedCropFixture } from "./crop-review-fixture.mjs";
import { cropPlans } from "./crop-index.mjs";
import {
  checkIndexedEntries,
  checkReportedSources,
  verificationFact,
} from "./crop-report.mjs";
import { json, hash } from "./support.mjs";

const changes = [
  [
    "missing pairs",
    (c) => delete c.entry.pairs,
    /List individual rename pairs/,
  ],
  ["empty pairs", (c) => (c.entry.pairs = []), /List individual rename pairs/],
  [
    "non-array pairs",
    (c) => (c.entry.pairs = {}),
    /List individual rename pairs/,
  ],
  ["missing map", (c) => delete c.entry.pairs[1].text, /Literal text/],
  [
    "false old text",
    (c) => (c.entry.pairs[1].text.from = "invented"),
    /Literal text/,
  ],
  [
    "false new text",
    (c) => (c.entry.pairs[1].text.to = "W-C11"),
    /Literal text/,
  ],
  [
    "unused map",
    (c) => (c.entry.pairs[0].text = { from: "W-C11", to: "W-C11" }),
    /Unused rename mapping/,
  ],
  [
    "unused crop",
    (c) => (c.entry.pairs = [c.entry.pairs[0]]),
    /Unused crop on an unchanged-text move/,
  ],
  [
    "extra map field",
    (c) => (c.entry.pairs[1].text.extra = true),
    /Literal text/,
  ],
  [
    "unknown from",
    (c) => (c.entry.pairs[0].from = "unknown"),
    /known baseline\/current/,
  ],
  [
    "swapped token roles",
    (c) =>
      ([c.entry.pairs[0].from, c.entry.pairs[0].to] = [
        c.entry.pairs[0].to,
        c.entry.pairs[0].from,
      ]),
    /known baseline\/current/,
  ],
  ["reused pair", (c) => c.entry.pairs.push(c.entry.pairs[0]), /token reused/],
  [
    "reused across entries",
    (c) => c.file.entries.push(structuredClone(c.entry)),
    /token reused/,
  ],
  [
    "wrong baseline",
    (c) => (c.file.baselineSha256 = c.sha),
    /known baseline\/current/,
  ],
  [
    "missing baseline",
    (c) => c.reports.delete(c.file.baselineSha256),
    /exact baseline/,
  ],
];
it.each(changes)(
  "builder, bind and preview reject %s from report facts",
  (_, edit, error) => {
    const c = mixedCropFixture(),
      index = c.indexFor(c.b);
    c.entry.sourceVerification = verificationFact(
      index.crops[0],
      hash(c.source),
    );
    edit(c);
    expect(() => cropPlans(c.file, c.reports)).toThrow(error);
    expect(() => checkIndexedEntries(c.file, index, c.reports)).toThrow(error);
    expect(() => checkReportedSources(c.file, c.reports)).toThrow(error);
  },
);
it("detects a missing changed-text map even without a supplied crop", () => {
  const c = mixedCropFixture();
  delete c.entry.crop;
  delete c.entry.pairs[1].text;
  expect(() => cropPlans(c.file, c.reports)).toThrow(/Literal text/);
  expect(() => checkIndexedEntries(c.file, { crops: [] }, c.reports)).toThrow(
    /Literal text/,
  );
});
it("needs no crop for a report-proven unchanged rename", () => {
  const c = mixedCropFixture();
  c.entry.pairs = [c.entry.pairs[0]];
  delete c.entry.crop;
  expect(cropPlans(c.file, c.reports)).toEqual([]);
  expect(() =>
    checkIndexedEntries(c.file, { crops: [] }, c.reports),
  ).not.toThrow();
});
it.each(["repin-crop-index.mjs", "repin-bind-crops.mjs"])(
  "%s refuses missing maps before creating evidence or reading crop pixels",
  async (script) => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const dir = await mkdtemp(join(root, "evals/out/rename-guard-"));
    try {
      const c = mixedCropFixture();
      delete c.entry.pairs[1].text;
      Object.assign(c.file, { format: "thermite-draw-decisions/1.0" });
      c.entry.reviewed = false;
      const paths = {};
      for (const [sha, report] of c.reports) {
        paths[sha] = join(dir, sha + ".json");
        await writeFile(paths[sha], json(report));
      }
      await writeFile(join(dir, "draft.json"), json(c.file));
      await writeFile(join(dir, "index.json"), json(c.indexFor(c.b)));
      const output = join(dir, "output.json"),
        samples = join(
          root,
          "evals/out/draw-samples",
          "rename-guard-" + dir.split(/[/\\]/).at(-1),
        );
      const r = spawnSync(
        "bun",
        [
          join(root, "evals/draw", script),
          "--report",
          paths[c.file.summarySha256],
          "--baseline",
          paths[c.file.baselineSha256],
          "--decisions",
          join(dir, "draft.json"),
          "--output",
          output,
          ...(script === "repin-crop-index.mjs"
            ? ["--index", join(dir, "created-index.json"), "--samples", samples]
            : ["--crop-index", join(dir, "index.json")]),
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Literal text rename mapping required");
      await expect(readFile(output)).rejects.toThrow(/ENOENT/);
      await expect(readFile(join(dir, "created-index.json"))).rejects.toThrow(
        /ENOENT/,
      );
      await expect(readFile(join(samples, "entry-0000.png"))).rejects.toThrow(
        /ENOENT/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
