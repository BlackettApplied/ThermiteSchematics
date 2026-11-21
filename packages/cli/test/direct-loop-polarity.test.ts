import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  directFixture,
  directPacket,
  directView,
  flows,
  roleFree,
} from "../../render/test/direct-loop-fixture.js";

it.each(flows)(
  "keeps clean unverified direct loops clean under --strict in %s",
  async (flow) => {
    const f = await directFixture(roleFree);
    try {
      const input = join(f.root, "packet.json"),
        output = join(f.root, "drawing.html");
      await writeFile(
        input,
        JSON.stringify(directPacket(directView({ flow }))),
      );
      const run = spawnSync(
        process.execPath,
        [
          resolve("thermite.mjs"),
          "packet",
          "--project",
          f.root,
          "--input",
          input,
          "--strict",
          "--output",
          output,
        ],
        { encoding: "utf8" },
      );
      expect(run.error).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stderr)).toEqual({ diagnostics: [], error: null });
      const html = await readFile(output, "utf8");
      expect(html).toContain(
        "polarity not verified: AI1 terminals p–n, TX1 terminals p–n.",
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "refuses a reversed direct loop without overwriting an earlier drawing in %s",
  async (flow) => {
    const f = await directFixture((m) => {
      for (const o of m.objects)
        for (const e of o.endpoints ?? [])
          if (e.device === "AI1") e.terminal = e.terminal === "p" ? "n" : "p";
    });
    try {
      const input = join(f.root, "packet.json"),
        output = join(f.root, "drawing.html");
      await writeFile(
        input,
        JSON.stringify(directPacket(directView({ flow }))),
      );
      await writeFile(output, "Earlier drawing");
      const run = spawnSync(
        process.execPath,
        [
          resolve("thermite.mjs"),
          "packet",
          "--project",
          f.root,
          "--input",
          input,
          "--strict",
          "--output",
          output,
        ],
        { encoding: "utf8" },
      );
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(JSON.parse(run.stderr)).toMatchObject({
        diagnostics: [],
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message:
            'Packet view[0] "TX1 - signal loop": Signal loop polarity: TX1.p (loop_positive) reaches AI1.n (analog_input_0_negative); correct the wiring or the authored roles.',
        },
      });
      expect(await readFile(output, "utf8")).toBe("Earlier drawing");
    } finally {
      await f.dispose();
    }
  },
);
