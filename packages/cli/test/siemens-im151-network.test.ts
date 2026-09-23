import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  analyzeCompleteness,
  compileProject,
  lockProject,
} from "@thermite/compiler";
import { buildCommunicationInventory } from "@thermite/query";
import { renderSchematicPacket } from "@thermite/render";

const example = resolve("libraries/siemens-pilot/examples/6es7151-3aa23-0ab0");
const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "thermite-im151-"));
  temporary.push(path);
  await cp(example, path, { recursive: true });
  const read = async (file: string) =>
    JSON.parse(await readFile(join(path, file), "utf8"));
  const write = (file: string, value: unknown) =>
    writeFile(join(path, file), JSON.stringify(value));
  const system = await read("system.json");
  system.libraries.find(
    (library: any) => library.name === "siemens-pilot",
  ).path = relative(path, resolve(example, "../..")).replaceAll("\\", "/");
  await write("system.json", system);
  const boundary = await read("boundary/types.json");
  boundary.types.push({
    kind: "device_type",
    id: "batch-boundary:ethernet-peer",
    description: "Synthetic logical Ethernet peer",
    terminals: {},
    functions: {},
    ports: { ETH: { medium: "ethernet", connector: "RJ45" } },
  });
  await write("boundary/types.json", boundary);
  const source = await read("source.json");
  source.objects.push(
    ...[1, 2].map((number) => ({
      kind: "device",
      uid: randomUUID(),
      designation: `PEER${number}`,
      type: "batch-boundary:ethernet-peer",
    })),
  );
  await write("source.json", source);
  const locked = await lockProject(path);
  expect(locked.ok, JSON.stringify(locked.diagnostics)).toBe(true);
  async function compile(objects = source.objects, valid = true) {
    await write("source.json", { objects });
    const result = await compileProject(path);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(valid);
    return result;
  }
  return { objects: source.objects as any[], compile };
}

const link = (number: number) => ({
  kind: "relation",
  uid: randomUUID(),
  designation: `NET${number}`,
  relation: "associated_with",
  from: { device: "D1" },
  to: { device: `PEER${number}` },
  connection: {
    fromPort: `X1.P${number}`,
    toPort: "ETH",
    medium: "ethernet",
    protocol: "PROFINET",
  },
});

it.each([{ ports: [1] }, { ports: [2] }, { ports: [1, 2] }])(
  "renders IM151 PROFINET ports $ports without electrical continuity",
  async ({ ports }) => {
    const f = await fixture(),
      baseline = await f.compile(),
      connected = await f.compile([...f.objects, ...ports.map(link)]);
    if (!baseline.ok || !connected.ok) return;
    expect(baseline.ir.nets).toHaveLength(20);
    expect(connected.ir.nets).toEqual(baseline.ir.nets);
    const network = buildCommunicationInventory(connected.ir);
    expect(network.links.map((entry) => entry.connection)).toEqual(
      ports.map((number) =>
        expect.objectContaining({
          fromPort: `X1.P${number}`,
          medium: "ethernet",
          protocol: "PROFINET",
        }),
      ),
    );
    const packet = await renderSchematicPacket(connected.ir, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "communication-view-request/0.1", medium: "ethernet" }],
    });
    expect(packet.ok, JSON.stringify(packet)).toBe(true);
    if (!packet.ok) return;
    const svg = packet.value.sheets.map((sheet) => sheet.svg).join("\n");
    expect(svg.match(/data-communication-link=/g) ?? []).toHaveLength(
      ports.length,
    );
    for (const number of ports) expect(svg).toContain(`X1.P${number}`);
    expect(svg).not.toContain("data-net-id=");
  },
);

it.each(["unknown port", "wrong medium", "duplicate occupancy"])(
  "rejects an IM151 connection with %s",
  async (problem) => {
    const f = await fixture(),
      first = link(1),
      second = link(2);
    if (problem === "unknown port") first.connection.fromPort = "MISSING";
    if (problem === "wrong medium") first.connection.medium = "nrg-bus";
    if (problem === "duplicate occupancy") second.connection.fromPort = "X1.P1";
    const result = await f.compile(
      [
        ...f.objects,
        first,
        ...(problem === "duplicate occupancy" ? [second] : []),
      ],
      false,
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "E204",
          severity: "error",
          file: "source.json",
        }),
      ]),
    );
  },
);

it("requires both fixed feed paths when the IM151 is connected through 2L+/2M", async () => {
  const f = await fixture();
  // Remove the direct feeds, retaining the canonical wires at 2L+ and 2M.
  const duplicateFeed = f.objects.filter(
    (object) => !["W1", "W2"].includes(object.designation),
  );
  for (const [removed, missing] of [
    ["", []],
    ["FIXED1", ["1L+"]],
    ["FIXED2", ["1M"]],
  ] as const) {
    const result = await f.compile(
      duplicateFeed.filter((object) => object.designation !== removed),
    );
    if (!result.ok) return;
    const findings = analyzeCompleteness(result.ir).findings.filter(
      (finding) => finding.code === "W903" && finding.designation === "D1",
    );
    expect(findings.map((finding) => finding.key)).toEqual(missing);
  }
});
