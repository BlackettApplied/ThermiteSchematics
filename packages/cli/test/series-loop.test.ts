import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  seriesFixture,
  request,
  coreSupply,
} from "../../render/test/series-loop-fixture.js";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "refuses a series drawing through the CLI in %s",
  async (flow) => {
    const f = await seriesFixture();
    try {
      const input = join(f.root, "packet.json"),
        output = join(f.root, "diagram.html");
      await writeFile(
        input,
        JSON.stringify({
          format: "schematic-packet-request/0.1",
          views: [request({ flow })],
        }),
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
          "--output",
          output,
        ],
        { encoding: "utf8" },
      );
      expect(run.error).toBeUndefined();
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(JSON.parse(run.stderr)).toMatchObject({
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message:
            'Packet view[0] "TX1 - signal loop": Series loop drawing is not available in this increment; use an explicit circuit view.',
        },
      });
      await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await f.dispose();
    }
  },
);

it("explains the series drawing gate in the public symbol catalog", () => {
  const run = spawnSync(
    process.execPath,
    [resolve("thermite.mjs"), "guide", "symbols", "--json"],
    { encoding: "utf8" },
  );
  expect(run.error).toBeUndefined();
  expect(run.status).toBe(0);
  const profile = JSON.parse(run.stdout).find(
    (p: any) => p.id === "thermite:dc-supply",
  );
  expect(
    profile.support.find(
      (s: any) => s.family === "signal-loop" && s.role === "series-power",
    ).notes,
  ).toBe(
    "Selection and polarity are checked; series loop drawing is not available yet.",
  );
});

it("discloses the signal-loop family in W111 for an unfit legacy alias clone", async () => {
  const f = await seriesFixture(async (m) => {
    await coreSupply(m, "0.1.0");
    m.types[0].functions.dc_ok = {
      kind: "contact",
      normal_state: "open",
      terminals: ["+", "-"],
    };
  });
  try {
    const run = spawnSync(
      process.execPath,
      [resolve("thermite.mjs"), "validate", f.root, "--json"],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    const diagnostics = JSON.parse(run.stdout);
    expect(diagnostics.find((d: any) => d.code === "W111").message).toContain(
      "Declared functions fit: power, control, loads, circuit, signal-loop.",
    );
    expect(
      JSON.parse(await readFile(join(f.root, "library/types.json"), "utf8"))
        .types[0].symbol,
    ).toBe("iec:dc-power-supply");
  } finally {
    await f.dispose();
  }
});
