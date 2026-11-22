import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  seriesFixture,
  request,
  coreSupply,
} from "../../render/test/series-loop-fixture.js";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "draws a clean series loop with --strict through the CLI in %s",
  async (flow) => {
    const f = await seriesFixture((m) => {
      m.objects = m.objects.filter(
        (o) =>
          o.kind !== "device" || ["TX1", "AI1", "PS1"].includes(o.designation),
      );
    });
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
        "Three separate loop nets; loop power from PS1 terminals p–n as wired.",
      );
      expect(html).toContain("Loop power: PS1");
      expect(html).not.toContain("Two separate signal nets");
    } finally {
      await f.dispose();
    }
  },
);

it("explains the series drawing assessment limits in the public symbol catalog", () => {
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
    "Three-net series loop drawing with authored polarity checks; input mode, isolation and loop voltage budget are not assessed.",
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

it.each([false, true])(
  "paints source labels and the exact engine note in direct PDF, high side %s",
  async (high) => {
    const { renderSchematicPacket } =
      await import("../../render/src/sheets.js");
    const { packetPdf } = await import("../src/alpha-pdf.js");
    const raster = await import("./helpers/pdf-raster.js");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const note =
      "Three separate loop nets; loop power from PS1 terminals p–n as wired. Not assessed: input mode (passive/active), isolation, loop voltage budget.";
    const f = await seriesFixture(undefined, high);
    try {
      for (const flow of ["left-to-right", "top-to-bottom"]) {
        const result = await renderSchematicPacket(f.ir, {
          format: "schematic-packet-request/0.1",
          index: false,
          views: [request({ flow })],
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) continue;
        const pdf = await packetPdf(result.value, "Series loop");
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        const task = getDocument({
          data: new Uint8Array(pdf),
          useSystemFonts: false,
        });
        try {
          const doc = await task.promise;
          expect(doc.numPages).toBe(1);
          const page = await doc.getPage(1),
            content = await page.getTextContent();
          const printed = content.items
            .map((i: any) => i.str ?? "")
            .join(" ")
            .replace(/\s+/g, " ");
          expect(printed).toContain(note);
          expect(printed).toContain("Loop power: PS1");
          expect(printed).not.toContain("Two separate signal nets");
        } finally {
          await task.destroy();
        }
        for (const value of [note, "Loop power: PS1"])
          for (const crop of await raster.svgTextCrops(
            result.value.sheets[0]!.svg,
            value,
          )) {
            const ink = raster.inkBounds(
              await raster.pdfCrop(pdf, { ...crop, width: crop.width + 25 }),
            );
            expect(ink.count).toBeGreaterThan(100);
          }
      }
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps the existing W906 strict failure when the authored PE connection has no other sheet in %s",
  async (flow) => {
    const f = await seriesFixture(async (m) => {
      const pe = JSON.parse(
        await readFile(
          new URL(
            "../../core-library/versions/0.2.0/types/terminal-pe.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ).types[0];
      m.types[3] = { ...pe, id: "series:strip" };
      m.objects.find((o) => o.designation === "TB1").designation = "PE1";
      m.objects = m.objects.filter((o) => o.designation !== "PLC1");
      m.objects.push({
        kind: "jumper",
        uid: "74000000-0000-4000-8000-000000000099",
        endpoints: [
          { device: "PS1", terminal: "n" },
          { device: "PE1", terminal: "PE" },
        ],
      });
    });
    try {
      const input = join(f.root, "packet.json");
      await writeFile(
        input,
        JSON.stringify({
          format: "schematic-packet-request/0.1",
          index: false,
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
          "--strict",
          "--output",
          join(f.root, "pe.html"),
        ],
        { encoding: "utf8" },
      );
      expect(run.status, run.stderr).toBe(1);
      const report = JSON.parse(run.stderr);
      expect(report.error).toBeNull();
      expect(report.diagnostics).toHaveLength(1);
      expect(report.diagnostics[0]).toMatchObject({
        code: "W906",
        severity: "warning",
        devices: [{ designation: "PE1", appearance: "absent" }],
      });
    } finally {
      await f.dispose();
    }
  },
);

for (const c of [
  {
    name: "auxiliary pair and supply as transmitter",
    extra: {
      from: { device: "PS1", function: "output" },
      auxiliary: [{ from: request().from, to: request().to }],
    },
    message:
      "Series loop power source PS1 cannot also be the transmitter; use an explicit circuit view.",
  },
  {
    name: "a supply as transmitter",
    extra: { from: { device: "PS1", function: "output" } },
    message:
      "Series loop power source PS1 cannot also be the transmitter; use an explicit circuit view.",
  },
  {
    name: "a genuine auxiliary pair",
    extra: { auxiliary: [{ from: request().from, to: request().to }] },
    message:
      "Series loop power is supported only for input views without auxiliary pairs.",
  },
  {
    name: "a non-transmitter from function",
    extra: { from: { device: "PLC1", function: "supply" } },
    message:
      "Series loop from PLC1.supply is not a supported two-wire transmitter; use an explicit circuit view.",
  },
  {
    name: "a non-input to function",
    extra: { to: { device: "PLC1", function: "supply" } },
    message:
      "Series loop to PLC1.supply is not an input channel; use an explicit circuit view.",
  },
  {
    name: "a supply as input",
    extra: { to: { device: "PS1", function: "output" } },
    message:
      "Series loop power source PS1 cannot also be the input channel; use an explicit circuit view.",
  },
])
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `refuses ${c.name} through the CLI in %s`,
    async (flow) => {
      const f = await seriesFixture();
      try {
        const input = join(f.root, "refusal.json"),
          output = join(f.root, "refusal.html");
        const view = request({
          flow,
          ...c.extra,
        });
        await writeFile(
          input,
          JSON.stringify({
            format: "schematic-packet-request/0.1",
            views: [view],
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
        expect(run.status, run.stderr).toBe(1);
        expect(run.stdout).toBe("");
        expect(JSON.parse(run.stderr).error).toMatchObject({
          code: "R006",
          reason: "unprintable-layout",
          message: `Packet view[0] "Untitled view": ${c.message}`,
        });
        await expect(readFile(output)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await f.dispose();
      }
    },
  );
