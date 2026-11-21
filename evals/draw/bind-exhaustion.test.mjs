import { expect, it } from "vitest";
import {
  readFile,
  writeFile,
  mkdir,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { cliFixture } from "./repin-cli-fixture.mjs";
import { draftDecisions } from "./repin-draft.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { cropHeader } from "./crop-report.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { hash, json } from "./support.mjs";
import { spawnSync } from "node:child_process";
it.each([0, 2])(
  "real bind capture loop: pass at %s, full audit and no output on exhaustion",
  async (passAt) => {
    const c = await cliFixture();
    try {
      const inventory = JSON.parse(
          await readFile(join(c.out, "inventory.json"), "utf8"),
        ),
        draft = draftDecisions(inventory, { pr: "#7" }),
        entry = draft.entries.find((e) => e.crop);
      const crop = pngFixture(),
        path = "evals/out/draw-samples/retry/crop.png",
        t = instanceInventory(
          c.context.report,
          c.context.reportSha256,
        ).instances.find((t) => entry.instances.includes(t.token));
      entry.crop = { path, sha256: hash(crop) };
      await mkdir(join(c.root, "evals/out/draw-samples/retry"), {
        recursive: true,
      });
      await writeFile(join(c.root, path), crop);
      await mkdir(join(c.out, t.scope.case));
      await writeFile(join(c.out, t.scope.case, "sheet-001.svg"), "source");
      const row = {
        path,
        sha256: hash(crop),
        capture: "fresh-source",
        headerPixels: 0,
        reportSha256: draft.summarySha256,
        token: t.token,
        markerId: t.markerId,
        scope: t.scope,
        row: t.row,
        text: t.facts.text,
        physicalSheet: t.physicalSheet,
        instanceBbox: t.bbox,
        sourceBbox: { x: 0, y: 0, w: 3, h: 3 },
        headerLines: cropHeader(t),
        sourceRender: {
          medium: "svg",
          svg: t.scope.case + "/sheet-001.svg",
          svgSha256: hash("source"),
        },
      };
      await writeFile(join(c.out, "index.json"), json({ crops: [row] }));
      await writeFile(join(c.out, "draft.json"), json(draft));
      await writeFile(
        join(c.root, "evals/draw/crop-source.mjs"),
        await readFile(new URL("./crop-source.mjs", import.meta.url)),
      );
      const pngA = crop.toString("base64"),
        pngB = pngFixture({ seed: 10 }).toString("base64");
      await writeFile(
        join(c.root, "evals/draw/browser.mjs"),
        `import{writeFile}from"node:fs/promises";let n=0;export const drawingLaunchArgs=[];export const drawingContextOptions={deviceScaleFactor:300/96,offline:true,serviceWorkers:"block",javaScriptEnabled:false};export async function openSheet(){}export async function screenshotCrop(){return Buffer.from(++n===${passAt}?"${pngA}":"${pngB}","base64");}export async function launch(){return{version:()=>"synthetic",newContext:async()=>({newPage:async()=>({setContent:async()=>{},evaluate:async()=>({w:100,h:100}),emulateMedia:async()=>{}}),close:async()=>{}}),close:async()=>writeFile(${JSON.stringify(join(c.out, "captures.json"))},JSON.stringify(n))};}`,
      );
      const output = join(c.out, "bound.json"),
        p = spawnSync(
          "bun",
          [
            join(c.root, "evals/draw/repin-bind-crops.mjs"),
            "--report",
            join(c.out, "report.json"),
            "--decisions",
            join(c.out, "draft.json"),
            "--crop-index",
            join(c.out, "index.json"),
            "--output",
            output,
          ],
          { cwd: c.root, encoding: "utf8" },
        );
      expect(p.status, p.stderr).toBe(passAt ? 0 : 1);
      expect(
        JSON.parse(await readFile(join(c.out, "captures.json"), "utf8")),
      ).toBe(passAt || 3);
      const audit = JSON.parse(await readFile(output + ".audit.json", "utf8"));
      expect(audit.crops[0].attempts).toHaveLength(passAt || 3);
      if (passAt) {
        const bound = JSON.parse(await readFile(output, "utf8"));
        expect(
          bound.entries.find((e) => e.crop).sourceVerification,
        ).toMatchObject({
          format: "thermite-draw-source-crop/2.0",
          selectedAttempt: 2,
        });
        expect(bound.entries.every((e) => e.reviewed === false)).toBe(true);
      } else {
        await expect(readFile(output)).rejects.toThrow(/ENOENT/);
        expect(
          audit.crops[0].attempts.every((a) => a.verdict === "refused"),
        ).toBe(true);
      }
      if (!passAt) {
        const auditBytes = await readFile(output + ".audit.json");
        const stale = spawnSync(
          "bun",
          [
            join(c.root, "evals/draw/repin-bind-crops.mjs"),
            "--report",
            join(c.out, "report.json"),
            "--decisions",
            join(c.out, "draft.json"),
            "--crop-index",
            join(c.out, "index.json"),
            "--output",
            output,
          ],
          { cwd: c.root, encoding: "utf8" },
        );
        expect(stale.status).toBe(1);
        expect(stale.stderr).toContain("Bind audit already exists");
        expect(await readFile(output + ".audit.json")).toEqual(auditBytes);
        await expect(readFile(output)).rejects.toThrow(/ENOENT/);
        // The fixture's audit is unsigned and retained above; explicitly remove it to retry.
        await rm(output + ".audit.json");
        const browserPath = join(c.root, "evals/draw/browser.mjs");
        await writeFile(
          browserPath,
          (await readFile(browserPath, "utf8")).replace("++n===0", "++n===1"),
        );
        const runAgain = () =>
          spawnSync(
            "bun",
            [
              join(c.root, "evals/draw/repin-bind-crops.mjs"),
              "--report",
              join(c.out, "report.json"),
              "--decisions",
              join(c.out, "draft.json"),
              "--crop-index",
              join(c.out, "index.json"),
              "--output",
              output,
            ],
            { cwd: c.root, encoding: "utf8" },
          );
        const recovered = runAgain();
        expect(recovered.status, recovered.stderr).toBe(0);
        const boundBytes = await readFile(output),
          bound = JSON.parse(boundBytes);
        expect(
          bound.entries.find((e) => e.crop).sourceVerification.selectedAttempt,
        ).toBe(1);
        expect(bound.entries.every((e) => e.reviewed === false)).toBe(true);
        // Even with the new unsigned audit removed, the existing bound output stays exclusive.
        await rm(output + ".audit.json");
        const existing = runAgain();
        expect(existing.status).toBe(1);
        expect(existing.stderr).toContain("Bound output already exists");
        await expect(readFile(output + ".audit.json")).rejects.toThrow(
          /ENOENT/,
        );
        expect(await readFile(output)).toEqual(boundBytes);
      }
      for (const a of audit.crops[0].attempts)
        expect(
          hash(
            await readFile(
              join(
                c.root,
                `evals/out/draw-samples/verification/${a.referenceSha256}.png`,
              ),
            ),
          ),
        ).toBe(a.referenceSha256);
    } finally {
      await c.cleanup();
    }
  },
);

it.each(["file", "directory", "dangling symlink"])(
  "refuses an existing %s audit before reading inputs or capturing, preserving it",
  async (kind) => {
    const c = await cliFixture();
    try {
      const output = join(c.out, "bound.json"),
        auditPath = output + ".audit.json";
      if (kind === "directory") await mkdir(auditPath);
      else if (kind === "dangling symlink")
        await symlink(join(c.out, "absent.json"), auditPath);
      else await writeFile(auditPath, "retain audit evidence");
      await writeFile(output, "retain signed output");
      const p = spawnSync(
        "bun",
        [
          join(c.root, "evals/draw/repin-bind-crops.mjs"),
          "--decisions",
          join(c.out, "missing-draft.json"),
          "--crop-index",
          join(c.out, "missing-index.json"),
          "--output",
          output,
        ],
        { cwd: c.root, encoding: "utf8" },
      );
      expect(p.status).toBe(1);
      expect(p.stderr).toContain(
        `Bind audit already exists: "${join(await realpath(c.out), "bound.json.audit.json")}"`,
      );
      expect(p.stderr).toContain("Choose a fresh --output");
      expect(p.stderr).toContain("preserve then remove");
      expect(p.stderr).toContain("No captures were started");
      expect(await readFile(output, "utf8")).toBe("retain signed output");
      if (kind === "file")
        expect(await readFile(auditPath, "utf8")).toBe("retain audit evidence");
    } finally {
      await c.cleanup();
    }
  },
);

it.each(["file", "directory", "dangling symlink"])(
  "refuses an existing %s bound output before any capture or audit write",
  async (kind) => {
    const c = await cliFixture();
    try {
      const output = join(c.out, "occupied.json");
      if (kind === "file") await writeFile(output, "retain signed evidence");
      else if (kind === "directory") await mkdir(output);
      else await symlink(join(c.out, "missing-target"), output);
      const p = spawnSync(
        "bun",
        [
          join(c.root, "evals/draw/repin-bind-crops.mjs"),
          "--decisions",
          join(c.out, "missing.json"),
          "--crop-index",
          join(c.out, "missing-index.json"),
          "--output",
          output,
        ],
        { cwd: c.root, encoding: "utf8" },
      );
      expect(p.status).toBe(1);
      expect(p.stderr).toContain(
        `Bound output already exists: "${join(await realpath(c.out), "occupied.json")}"`,
      );
      expect(p.stderr).toContain("Choose a fresh --output");
      expect(p.stderr).toContain("No captures were started");
      await expect(readFile(output + ".audit.json")).rejects.toThrow(/ENOENT/);
      if (kind === "file")
        expect(await readFile(output, "utf8")).toBe("retain signed evidence");
    } finally {
      await c.cleanup();
    }
  },
);

it.each(["audit", "output"])(
  "preserves a synthetic Windows path in an existing %s refusal",
  async (kind) => {
    const c = await cliFixture();
    try {
      const output = String.raw`D:\space path\bound.json`,
        occupied = kind === "audit" ? output + ".audit.json" : output,
        probe = join(c.root, "evals/draw/windows-bind-probe.mjs");
      // Only path resolution and existence are simulated. Execute the actual
      // CLI assertion without asking the host filesystem to interpret Windows.
      await writeFile(
        probe,
        `
        import { mock } from "bun:test";
        const io = await import("./repin-io.mjs");
        const fs = await import("node:fs/promises");
        mock.module("./repin-io.mjs", () => ({
          ...io, within: async () => ${JSON.stringify(output)},
        }));
        mock.module("node:fs/promises", () => ({
          ...fs,
          lstat: async (path) => {
            if (path === ${JSON.stringify(occupied)}) return {};
            throw Object.assign(new Error("missing"), { code: "ENOENT" });
          },
        }));
        await import("./repin-bind-crops.mjs");
      `,
      );
      const p = spawnSync(
        "bun",
        [
          probe,
          "--decisions",
          "unused.json",
          "--crop-index",
          "unused.json",
          "--output",
          "unused.json",
        ],
        { cwd: c.root, encoding: "utf8" },
      );
      expect(p.status).toBe(1);
      const label = kind === "audit" ? "Bind audit" : "Bound output";
      expect(p.stderr).toContain(`${label} already exists: "${occupied}"`);
      expect(p.stderr).toContain("No captures were started");
    } finally {
      await c.cleanup();
    }
  },
);
