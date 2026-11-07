import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import { createAjv2020 } from "@thermite/schema";
import { renderSchematicPacket, renderSchematicSheets } from "../src/sheets.js";
import type { SchematicPacketRequest } from "../src/sheets.js";
let root: string, ir: ElectricalIr;
// CO's omissions, reduced to a source/load drawing plus four placed devices.
// No functions or conductors are inferred from schedules.
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "thermite-coverage-"));
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Synthetic CO omissions" },
      sources: ["objects.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    }),
  );
  const names = ["PS1", "L1", "S1", "S2", "H1", "CB2"];
  const types = [
    "core:psu-24vdc",
    "core:plc-compact",
    "core:limit-switch-2wire",
    "core:pushbutton-nc",
    "core:plc-compact",
    "core:breaker-3p",
  ];
  const devices = names.map((designation, i) => ({
    kind: "device",
    designation,
    type: types[i],
    uid: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  }));
  const wire = (designation: string, i: number, a: string, b: string) => ({
    kind: "wire",
    designation,
    uid: `00000000-0000-4000-8001-${String(i).padStart(12, "0")}`,
    endpoints: [
      { device: "PS1", terminal: a },
      { device: "L1", terminal: b },
    ],
  });
  await writeFile(
    join(root, "objects.json"),
    JSON.stringify({
      objects: [...devices, wire("W1", 1, "+", "L+"), wire("W2", 2, "-", "M")],
    }),
  );
  expect((await lockProject(root)).ok).toBe(true);
  const c = await compileProject(root);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const drawing = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "PS1" },
  intent: { kind: "loads" },
} as const;
const packet = (reports: boolean): SchematicPacketRequest => ({
  format: "schematic-packet-request/0.1",
  index: reports,
  views: [
    drawing,
    ...(reports
      ? [{ format: "documentation-view-request/0.1", kind: "bom" } as const]
      : []),
  ],
});
describe("packet device coverage", () => {
  it.each([true, false])(
    "warns about all four CO omissions; reports=%s",
    async (reports) => {
      const r = await renderSchematicPacket(ir, packet(reports));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const diagnostics = r.value.coverage.diagnostics!;
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: "W906",
        severity: "warning",
      });
      expect(diagnostics[0]!.devices!.map((d) => d.designation)).toEqual([
        "CB2",
        "H1",
        "S1",
        "S2",
      ]);
      expect(
        new Set(diagnostics[0]!.devices!.map((d) => d.appearance)),
      ).toEqual(new Set([reports ? "reports-only" : "absent"]));
      const schema = JSON.parse(
        await readFile(
          "packages/schema/schemas/diagnostic.schema.json",
          "utf8",
        ),
      );
      expect(createAjv2020().compile(schema)(diagnostics[0])).toBe(true);
    },
  );
  it.each([false, true])(
    "exempts a reports-only packet with index=%s",
    async (index) => {
      const r = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        index,
        views: [
          { format: "documentation-view-request/0.1", kind: "bom" },
          { format: "documentation-view-request/0.1", kind: "wires" },
        ],
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) expect(r.value.coverage.diagnostics ?? []).toEqual([]);
    },
  );
  it("warns once a report packet contains a partial circuit drawing", async () => {
    const source = ir.devices.find((d) => d.designation === "PS1")!;
    const f = ir.functions.find(
      (f) => f.id.deviceUid === source.uid && f.kind === "source",
    )!;
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Source only",
          groups: [
            {
              id: "source",
              conductors: [],
              functions: [
                {
                  device: { by: "designation", value: "PS1" },
                  key: f.id.functionKey,
                },
              ],
            },
          ],
        },
        { format: "documentation-view-request/0.1", kind: "bom" },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok)
      expect(r.value.coverage.diagnostics).toMatchObject([
        {
          code: "W906",
          devices: expect.arrayContaining([
            expect.objectContaining({ designation: "S1" }),
          ]),
        },
      ]);
  });
  it("keeps a partial single view free of packet warnings", async () => {
    const r = await renderSchematicSheets(ir, drawing);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.value.coverage.diagnostics ?? []).toEqual([]);
  });
  it("emits no warning when all devices have schematic appearances", async () => {
    const r = await renderSchematicPacket(ir, {
      ...packet(true),
      views: [
        ...packet(true).views,
        {
          format: "circuit-view-request/0.1",
          title: "Previously omitted devices",
          groups: ir.devices
            .filter((d) => ["S1", "S2", "H1", "CB2"].includes(d.designation))
            .map((d) => ({
              id: d.designation,
              conductors: [],
              functions: [
                {
                  device: { by: "designation", value: d.designation },
                  key: ir.functions.find((f) => f.id.deviceUid === d.uid)!.id
                    .functionKey,
                },
              ],
            })),
        },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.value.coverage.diagnostics ?? []).toEqual([]);
  });
});
