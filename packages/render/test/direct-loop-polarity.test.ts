import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";

const flows = ["left-to-right", "top-to-bottom"] as const;
let root: string;
const fixtures = new Map<boolean, ElectricalIr>();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "thermite-direct-polarity-85-"));
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Issue 85 core 0.2.0 reproduction" },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    }),
  );
  const uid = (n: number) =>
    `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (const reversed of [false, true]) {
    await writeFile(
      join(root, "source.json"),
      JSON.stringify({
        objects: [
          {
            kind: "device",
            uid: uid(1),
            designation: "TX1",
            type: "core:transmitter-2wire-4-20ma",
          },
          {
            kind: "device",
            uid: uid(2),
            designation: "PLC1",
            type: "core:plc-8di-8do-2ai",
          },
          ...["+", "-"].map((terminal, i) => ({
            kind: "wire",
            uid: uid(3 + i),
            designation: `W${i + 1}`,
            endpoints: [
              { device: "TX1", terminal },
              {
                device: "PLC1",
                terminal: `AI0${reversed ? (i === 0 ? "-" : "+") : terminal}`,
              },
            ],
          })),
        ],
      }),
    );
    const locked = await lockProject(root);
    expect(locked.ok, JSON.stringify(locked.diagnostics)).toBe(true);
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    expect(
      compiled.diagnostics
        .filter((d) => d.severity === "warning")
        .map((d) => d.code),
    ).toEqual(["W903"]);
    fixtures.set(reversed, compiled.ir);
  }
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function packet(flow: (typeof flows)[number]) {
  return {
    format: "schematic-packet-request/0.1" as const,
    page: {
      size: "tabloid" as const,
      orientation:
        flow === "top-to-bottom"
          ? ("portrait" as const)
          : ("landscape" as const),
    },
    views: [
      {
        format: "signal-loop-view-request/0.1" as const,
        from: { device: "TX1", function: "signal" },
        to: { device: "PLC1", function: "ai0" },
        flow,
      },
    ],
  };
}

it.each(flows)(
  "keeps the correctly wired core direct loop printable in %s",
  async (flow) => {
    const ir = fixtures.get(false)!;
    const before = JSON.stringify(ir);
    const result = await renderSchematicPacket(ir, packet(flow));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.value.sheets[0]!.svg).toContain("Two separate signal nets");
      expect(result.value.sheets[0]!.svg).not.toContain(
        "polarity not verified",
      );
      // Pin the reviewed direct-loop output, including its semantic channel caption.
      expect(
        createHash("sha256").update(result.value.sheets[0]!.svg).digest("hex"),
      ).toBe(
        flow === "left-to-right"
          ? "4379101a7f58f7cfcc30b29b25e7508470904d08592c7e656123122f52192098"
          : "8ba4eb7093b4542128cbd482256e0fa4ce9367eb39ee52d54bfe5cd19015ded1",
      );
      // Pin the complete measured-tag drawing independently of ownership metadata.
      expect(
        createHash("sha256")
          .update(
            result.value.sheets[0]!.svg.replace(
              / data-tag-[a-z-]+="[^"]*"/gu,
              "",
            ),
          )
          .digest("hex"),
      ).toBe(
        flow === "left-to-right"
          ? "035d28f4c57626826d56be16f1089aeec3caa5ad8b73d2c507dbfdca11af8244"
          : "6d463a5fdaaf08ae459b60df84664066f10e0df1214589dc3d1703fafed444a7",
      );
    }
    expect(JSON.stringify(ir)).toBe(before);
  },
);

// The issue's actual core 0.2.0 wiring must fail before emitting a sheet.
it.each(flows)(
  "refuses issue 85's reversed core direct loop in %s",
  async (flow) => {
    const ir = fixtures.get(true)!;
    const before = JSON.stringify(ir);
    const result = await renderSchematicPacket(ir, packet(flow));
    expect(JSON.stringify(ir)).toBe(before);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        reason: "unprintable-layout",
        message:
          'Packet view[0] "TX1 - signal loop": Signal loop polarity: TX1.+ (loop_positive) reaches PLC1.AI0- (analog_input_0_negative); correct the wiring or the authored roles.',
      },
    });
    expect(result).not.toHaveProperty("value");
  },
);
