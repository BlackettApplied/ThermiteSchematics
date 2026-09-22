import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { renderSchematicPacket } from "@thermite/render";

const temporary: string[] = [];
afterEach(async () => {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
});

it("compiles sourced analog landing pairs and renders a complete hookup without shorting channel terminals", async () => {
  const p = await mkdtemp(join(tmpdir(), "thermite-industrial-"));
  temporary.push(p);
  await cp(resolve("libraries/industrial-pilot"), join(p, "industrial"), {
    recursive: true,
  });
  await mkdir(join(p, "fixture"));
  const write = (path: string, data: unknown) =>
    writeFile(join(p, path), JSON.stringify(data));
  await write("system.json", {
    format: "electrical-system/0.1",
    project: { name: "Analog hookup fixture" },
    sources: ["source.json"],
    libraries: [
      { name: "industrial-pilot", version: "0.1.0", path: "industrial" },
      { name: "fixture", version: "1.0.0", path: "fixture" },
    ],
  });
  await write("fixture/library.json", {
    name: "fixture",
    version: "1.0.0",
    sources: ["types.json"],
  });
  await write("fixture/types.json", {
    types: [
      {
        kind: "device_type",
        id: "fixture:probe",
        terminals: { "+": {}, "-": {} },
        functions: {},
      },
      {
        kind: "cable_type",
        id: "fixture:pair",
        conductors: [
          { id: "A", color: "Unspecified" },
          { id: "B", color: "Unspecified" },
        ],
      },
    ],
  });
  // Pair expectations were reviewed against Siemens TC Figure 3-1,
  // current-input Figure 3-1 (two-wire mode), and output Table 3-1.
  const selections = [
    ["TCI1", "siemens-ai4tc-hs", "1", "5"],
    ["AI1", "siemens-ai4i-st-2wire", "9", "13"],
    ["AQ1", "siemens-aq4ui-st-current", "1", "5"],
  ];
  const objects = selections.flatMap(([tag, type, positive, negative], i) => [
    {
      kind: "device",
      uid: randomUUID(),
      designation: tag,
      type: `industrial-pilot:${type}`,
      location: "Cabinet",
      io: {
        addressSpace: "PLC1",
        channels: { ch0: { usage: "in-use", signal: `Signal ${i}` } },
      },
    },
    {
      kind: "device",
      uid: randomUUID(),
      designation: `PROBE${i}`,
      type: "fixture:probe",
      location: "Field",
    },
    {
      kind: "cable",
      uid: randomUUID(),
      designation: `CB${i}`,
      type: "fixture:pair",
      fromLocation: "Field",
      toLocation: "Cabinet",
      conductors: [
        {
          id: "A",
          usage: "in-use",
          endpoints: [
            { device: `PROBE${i}`, terminal: "+" },
            { device: tag, terminal: positive },
          ],
        },
        {
          id: "B",
          usage: "in-use",
          endpoints: [
            { device: `PROBE${i}`, terminal: "-" },
            { device: tag, terminal: negative },
          ],
        },
      ],
    },
  ]);
  await write("source.json", { objects });
  expect((await lockProject(p)).ok).toBe(true);
  const c = await compileProject(p);
  expect(c.diagnostics.map((d) => d.code).sort()).toEqual([
    "W903",
    "W903",
    "W903",
    "W904",
    "W904",
    "W904",
  ]);
  expect(c.diagnostics.find((d) => d.code === "W903")!.message).toContain("L+");
  expect(c.diagnostics.find((d) => d.code === "W903")!.message).toContain("M");
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  expect(
    c.ir.deviceTypes.filter((t) => t.id.startsWith("industrial-pilot:")),
  ).toHaveLength(15);
  expect(c.ir.nets.filter((n) => n.terminalIds.length === 2)).toHaveLength(6);
  expect(c.ir.nets.every((n) => n.terminalIds.length <= 2)).toBe(true);
  const io = buildDocumentation(c.ir, {
    format: "documentation-view-request/0.1",
    kind: "io",
  });
  expect(io.rows).toHaveLength(12);
  const packet = await renderSchematicPacket(c.ir, {
    format: "schematic-packet-request/0.1",
    views: selections.map((_, i) => ({
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: `CB${i}` },
      intent: { kind: "conductors" },
      flow: "left-to-right",
    })),
  });
  expect(packet.ok).toBe(true);
  if (!packet.ok) return;
  expect(packet.value.sheets).toHaveLength(3);
  expect(packet.value.sheets[1]!.svg).toContain("AI1.9");
  expect(packet.value.sheets[1]!.svg).toContain("AI1.13");
  // All submitted models expose provenance, even those scoped to inventory/ports.
  for (const t of c.ir.deviceTypes.filter((t) =>
    t.id.startsWith("industrial-pilot:"),
  )) {
    expect(t.catalog?.document.url).toMatch(/^https:\/\//);
    expect(t.catalog?.modelingNotes?.length).toBeGreaterThan(0);
  }
  const bytes = await readFile(
    join(p, "industrial/types/siemens-ai4i-st-2wire.json"),
    "utf8",
  );
  await writeFile(
    join(p, "industrial/types/siemens-ai4i-st-2wire.json"),
    bytes + "\n",
  );
  const stale = await compileProject(p);
  expect(stale.ok).toBe(false);
  expect(stale.diagnostics.some((d) => d.code === "E108")).toBe(true);
});
