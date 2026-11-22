import { expect, it } from "vitest";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  symlink,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pdfDocumentFixture } from "./pdf-document-fixture.mjs";
import { pdfPolicyFixture } from "./pdf-source-fixture.mjs";
import { loadPdfBytes, pdfText, PDFJS_VERSION } from "./pdf.mjs";
import { pdfPageMetadata } from "./pdf-source-policy.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { cliFixture } from "./repin-cli-fixture.mjs";
import { hash, json, canonical } from "./support.mjs";
import { readVerification } from "./verification-io.mjs";
import { recordFor, writeRecord } from "./repin-record-write.mjs";
import { readRecord, verifyRecord } from "./repin-record.mjs";
it.each(["text-below-minimum-em", "iso-cap-height-policy"])(
  "real PDF builder, bind, stamp and archive preserve %s",
  async (kind) => {
    const c = await cliFixture();
    try {
      await symlink(
        fileURLToPath(new URL("../../packages", import.meta.url)),
        join(c.root, "packages"),
        "junction",
      );
      await mkdir(join(c.root, "scripts"));
      await copyFile(
        new URL("../../scripts/stamp-drawing-crop.mjs", import.meta.url),
        join(c.root, "scripts/stamp-drawing-crop.mjs"),
      );
      for (const name of ["crop-source.mjs", "crop-stamp-check.mjs"])
        await copyFile(
          new URL(name, import.meta.url),
          join(c.root, "evals/draw", name),
        );
      const pdf = await pdfDocumentFixture(),
        doc = await loadPdfBytes(pdf),
        f = pdfPolicyFixture(kind),
        report = f.report;
      let box;
      try {
        const page = await doc.getPage(1);
        box = canonical(
          (await pdfText(page, doc.fontFamilies, doc.fontCaps))[0].bbox,
        );
        report.sourceHashes.sheets[0].pdf = {
          ...f.pin,
          sha256: hash(pdf),
          pdfjsVersion: PDFJS_VERSION,
          page: pdfPageMetadata(page),
        };
      } finally {
        await doc.loadingTask.destroy();
      }
      report.results[0].evidence.findings[0].bbox = box;
      const raw = json(report),
        sha = hash(raw),
        t = instanceInventory(report, sha).instances[0],
        draft = {
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
        };
      await mkdir(join(c.out, "example"));
      await writeFile(join(c.out, "example/packet.pdf"), pdf);
      await writeFile(join(c.out, "report.json"), raw);
      await writeFile(join(c.out, "draft.json"), json(draft));
      const indexPath = join(c.out, "index.json"),
        prepared = join(c.out, "prepared.json"),
        samples = join(c.out, "draw-samples/pdf");
      const run = (script, args) =>
        spawnSync("bun", [join(c.root, "evals/draw", script), ...args], {
          cwd: c.root,
          encoding: "utf8",
          env: {
            ...process.env,
            THERMITE_DRAW_CHROMIUM: "/nonexistent/pdf-needs-no-chromium",
          },
        });
      const built = run("repin-crop-index.mjs", [
        "--report",
        join(c.out, "report.json"),
        "--decisions",
        join(c.out, "draft.json"),
        "--samples",
        samples,
        "--index",
        indexPath,
        "--output",
        prepared,
      ]);
      expect(built.status, built.stderr).toBe(0);
      const index = JSON.parse(await readFile(indexPath));
      expect(index.crops[0]).toMatchObject({
        capture: "fresh-source",
        cropShape: { kind: "pdf-em-ink/1.0" },
        instanceBbox: box,
        classification: t.classification,
        sourceRender: { medium: "pdf", pdfSha256: hash(pdf) },
      });
      const output = join(c.out, "bound.json"),
        boundResult = run("repin-bind-crops.mjs", [
          "--report",
          join(c.out, "report.json"),
          "--decisions",
          prepared,
          "--crop-index",
          indexPath,
          "--output",
          output,
        ]);
      expect(boundResult.status, boundResult.stderr).toBe(0);
      const signed = JSON.parse(await readFile(output));
      expect(signed.entries[0].sourceVerification).toMatchObject({
        medium: "pdf",
        classification: t.classification,
        selectedAttempt: 1,
        pdf: { backend: "pdf.js", pdfjsVersion: PDFJS_VERSION },
      });
      const audit = JSON.parse(await readFile(output + ".audit.json"));
      expect(audit.crops[0].attempts[0].stats.maximum).toBe(0);
      Object.assign(signed, {
        pr: "#7",
        checkerSha256: hash("checker"),
        registrySha256: hash("registry"),
      });
      for (const e of signed.entries)
        Object.assign(e, {
          reviewed: true,
          causeClass: "synthetic",
          note: "Synthetic PDF roundtrip, not approval",
          cause: "synthetic",
          signOff: { kind: "agent", by: "Synthetic PDF archive fixture" },
        });
      const receipt = {
        format: "thermite-draw-repin-receipt/1.0",
        summarySha256: signed.summarySha256,
        checkerSha256: signed.checkerSha256,
        registryBeforeSha256: signed.registrySha256,
        registryAfterSha256: hash("after"),
        decisions: signed.entries.map((e) => ({
          reviewerJudged: {
            causeClass: e.causeClass,
            note: e.note,
            cause: e.cause,
            signOffs: [e.signOff],
            drawingSha256: e.drawingSha256,
            sourceVerification: e.sourceVerification,
          },
        })),
      };
      const r = recordFor({
        pr: 7,
        baseCommit: "1".repeat(40),
        signed: Buffer.from(json(signed)),
        receipt: Buffer.from(json(receipt)),
        cropIndex: await readFile(indexPath),
        crops: new Map(
          await Promise.all(
            index.crops.map(async (r) => [
              r.path,
              await readFile(join(c.root, r.path)),
            ]),
          ),
        ),
        verification: await readVerification(c.root, signed),
      });
      await writeRecord(join(c.out, "record"), r);
      expect((await readRecord(join(c.out, "record"))).sourceVerification).toBe(
        "source-crop/3.0",
      );
      const changed = JSON.parse(r.files.get(r.record.cropIndex));
      changed.crops[0].sourceRender.page.rotation = 180;
      const bytes = Buffer.from(json(changed));
      r.files.set(r.record.cropIndex, bytes);
      r.record.cropIndexSha256 = hash(bytes);
      r.record.files[r.record.cropIndex] = hash(bytes);
      expect(() => verifyRecord(r.record, r.files)).toThrow(
        /PDF archive index/,
      );
    } finally {
      await c.cleanup();
    }
  },
);
