import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  analyzeCompleteness,
  compileProject,
  type ElectricalIr,
} from "@thermite/compiler";
import {
  buildCableSchedule,
  buildCommunicationInventory,
  buildDocumentation,
} from "@thermite/query";
import { renderSchematic } from "../../render/src/renderer.js";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { rm3CircuitViews, rm3LoopView } from "./rm3-drawings.js";

const root = "packages/core-library/test/fixtures/rm3";
let ir: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject(root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  expect(compiled.diagnostics.map((d) => [d.code, d.severity])).toEqual([
    ["I304", "info"],
    ["I305", "info"],
  ]);
  ir = compiled.ir;
});

it("contains every RM3 interface, with no local types or missing required connections", () => {
  const required = [
    "supply-480v-3ph",
    "disconnect-3p",
    "breaker-1p",
    "breaker-2p",
    "breaker-3p",
    "fuse-1p",
    "fuse-2p",
    "fuse-3p",
    "control-transformer",
    "psu-24vdc",
    "contactor-3p-1no",
    "overload-3p-1nc",
    "motor-3ph",
    "pushbutton-no",
    "pushbutton-nc",
    "estop-nc",
    "selector-2pos",
    "pilot-light",
    "relay-1co",
    "plc-8di-8do-2ai",
    "prox-pnp-3wire",
    "limit-switch-2wire",
    "transmitter-2wire-4-20ma",
    "level-switch-no",
    "hmi",
    "terminal-block-8",
    "terminal-pe",
    "junction-box-8",
    "cable-power-4core",
    "cordset-sensor-4core",
    "cable-instrumentation-1pair",
  ].map((name) => `core:${name}`);
  expect(new Set([...ir.devices, ...ir.cables].map((d) => d.typeId))).toEqual(
    new Set(required),
  );
  expect(ir.libraries.map((l) => [l.name, l.version])).toEqual([
    ["core", "0.2.0"],
  ]);
  const report = analyzeCompleteness(ir);
  expect(
    report.findings.filter((f) => f.code === "I003" || f.severity !== "info"),
  ).toEqual([]);
});

it("retains all 18 I/O addresses, signals, explicit spares and separate Ethernet metadata", async () => {
  const source = JSON.parse(
    await readFile(join(root, "automation.json"), "utf8"),
  );
  const authored = source.objects.find((o: any) => o.designation === "PLC1");
  const plc = ir.devices.find((d) => d.designation === "PLC1");
  expect(plc?.io).toEqual(authored.io);
  expect(Object.keys(authored.io.channels)).toHaveLength(18);
  expect(
    Object.values(authored.io.channels).filter((c: any) => c.usage === "spare"),
  ).toHaveLength(11);
  const io = JSON.stringify(
    buildDocumentation(ir, {
      format: "documentation-view-request/0.1",
      kind: "io",
    }),
  );
  for (const channel of Object.values(authored.io.channels) as any[]) {
    expect(io).toContain(channel.address);
    if (channel.signal) expect(io).toContain(channel.signal);
  }
  const network = buildCommunicationInventory(ir);
  expect(network.ports).toHaveLength(2);
  expect(network.links).toHaveLength(1);
  expect(network.links[0]?.connection).toEqual({
    fromPort: "ETH",
    toPort: "ETH",
    medium: "ethernet",
    protocol: "unspecified",
    status: "planned",
  });
  expect(ir.relations.find((r) => r.designation === "CTRL1")?.verb).toBe(
    "controls",
  );
  const cables = ir.cables.map((c) => buildCableSchedule(ir, c.uid));
  expect(JSON.stringify(cables)).toContain('"spare"');
  expect(
    ir.cables
      .find((c) => c.designation === "CBL2")
      ?.assignments?.find((c) => c.id === "4")?.endpoints[0],
  ).toBeNull();
  const cordset = cables.find((c) => c.designation === "CBL2");
  expect(cordset?.shield).toBeNull();
  expect(cordset?.cores.find((c) => c.id === "4")).toMatchObject({
    usage: "spare",
    status: "partially-terminated",
    netId: null,
  });
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "renders every circuit-supported function, the loop, cables and network in %s",
  async (flow) => {
    const before = JSON.stringify(ir);
    const circuit = await rm3CircuitViews(ir, flow);
    const views: any[] = circuit.views;
    const expected = circuit.expected;
    views.push(await rm3LoopView(ir, root, flow));
    views.push(
      JSON.parse(await readFile(join(root, "network.request.json"), "utf8")),
    );
    for (const cable of ir.cables)
      views.push({
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: cable.designation },
        intent: { kind: "conductors" },
        flow,
      });
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "a3", orientation: "landscape", marginMm: 10 },
      views,
    });
    expect(packet.ok, JSON.stringify(packet.ok ? {} : packet)).toBe(true);
    if (!packet.ok) throw Error(packet.error.message);
    const tx = ir.devices.find((d) => d.designation === "TX1");
    if (!tx) throw Error("Missing transmitter");
    // The packet audit currently covers circuit/wiring views, not signal loops.
    // Prove the loop's actual output above and pin its unaudited function here.
    expect(
      packet.value.coverage.functions.find(
        (f) => f.id === JSON.stringify([tx.uid, "signal"]),
      )?.appearances,
    ).toEqual([]);
    expect(
      packet.value.coverage.functions
        .filter((f) => f.appearances.length)
        .map((f) => f.id)
        .sort(),
    ).toEqual(expected.sort());
    // Conductor inventory sheets also lie outside the circuit/wiring audit.
    // Check their actual per-core SVG records, including the loose spare end.
    for (const cable of ir.cables)
      for (const core of buildCableSchedule(ir, cable.uid).cores)
        expect(packet.value.html).toContain(
          `data-cable-uid="${cable.uid}" data-conductor-id="${core.id}" data-usage="${core.usage}" data-status="${core.status}"`,
        );
    const link = ir.relations.find((r) => r.designation === "NET1");
    expect(packet.value.html).toContain(
      `data-communication-link="${link?.uid}"`,
    );
    const power = await renderSchematic(ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
      flow,
    });
    expect(power.ok, JSON.stringify(power.ok ? {} : power)).toBe(true);
    expect(JSON.stringify(ir)).toBe(before);
  },
  60000,
);

it("keeps a missing PLC supply visible and relations non-conductive", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "thermite-rm3-negative-"));
  try {
    await cp(root, scratch, { recursive: true });
    const path = join(scratch, "automation.json");
    const source = JSON.parse(await readFile(path, "utf8"));
    source.objects = source.objects.filter((o: any) => o.kind !== "relation");
    await writeFile(path, JSON.stringify(source));
    const withoutRelations = await compileProject(scratch);
    if (!withoutRelations.ok)
      throw Error(JSON.stringify(withoutRelations.diagnostics));
    expect(withoutRelations.ir.nets).toEqual(ir.nets);
    source.objects = source.objects.filter(
      (o: any) =>
        !(
          o.kind === "wire" &&
          o.endpoints.some(
            (e: any) => e.device === "PLC1" && e.terminal === "L+",
          )
        ),
    );
    await writeFile(path, JSON.stringify(source));
    const missingSupply = await compileProject(scratch);
    if (!missingSupply.ok)
      throw Error(JSON.stringify(missingSupply.diagnostics));
    expect(
      analyzeCompleteness(missingSupply.ir)
        .findings.filter((f) => f.code === "W903")
        .map((f) => [f.designation, f.key]),
    ).toEqual([["PLC1", "L+"]]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "renders a connected RM3 disconnector extension without changing the inventory specimen in %s",
  async (flow) => {
    const scratch = await mkdtemp(join(tmpdir(), "thermite-rm3-disconnector-"));
    try {
      await cp(root, scratch, { recursive: true });
      const path = join(scratch, "starter.json");
      const source = JSON.parse(await readFile(path, "utf8"));
      for (let phase = 1; phase <= 3; phase++) {
        const wire = source.objects.find(
          (o: any) =>
            o.kind === "wire" &&
            o.endpoints.some(
              (e: any) => e.device === "SRC1" && e.terminal === `L${phase}`,
            ) &&
            o.endpoints.some((e: any) => e.device === "Q1"),
        );
        expect(wire, `phase ${phase}`).toBeDefined();
        wire.endpoints = [
          { device: "DS1", terminal: `${phase * 2}/T${phase}` },
          wire.endpoints.find((e: any) => e.device === "Q1"),
        ];
        source.objects.push({
          kind: "wire",
          uid: `75000000-0000-4000-8000-00000000000${phase}`,
          designation: `WDS${phase}`,
          endpoints: [
            { device: "SRC1", terminal: `L${phase}` },
            { device: "DS1", terminal: `${phase * 2 - 1}/L${phase}` },
          ],
        });
      }
      await writeFile(path, JSON.stringify(source));
      const compiled = await compileProject(scratch);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const before = JSON.stringify(compiled.ir);
      const request = JSON.parse(
        await readFile(join(root, "disconnector-power.request.json"), "utf8"),
      );
      const result = await renderSchematic(compiled.ir, { ...request, flow });
      expect(result.ok, JSON.stringify(result.ok ? {} : result)).toBe(true);
      if (!result.ok) throw Error(result.error.message);
      expect(
        result.value.svg.match(/data-symbol-id="ais:disconnector"/g),
      ).toHaveLength(3);
      if (flow === "left-to-right") {
        const segments = [
          ...parseHTML(result.value.svg).document.querySelectorAll(
            'line[data-mechanical-association="ganged"]',
          ),
        ];
        expect(segments).toHaveLength(4);
        for (const designation of ["DS1", "Q1"]) {
          const uid = compiled.ir.devices.find(
            (d) => d.designation === designation,
          )!.uid;
          expect(
            segments.filter((s) =>
              s.getAttribute("data-ganged-functions")!.includes(uid),
            ),
          ).toHaveLength(2);
        }
        for (const segment of segments) {
          const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((a) =>
            Number(segment.getAttribute(a)),
          );
          expect(Math.hypot(x2! - x1!, y2! - y1!)).toBeGreaterThan(0);
        }
      }
      expect(compiled.ir.wires).toHaveLength(ir.wires.length + 3);
      expect(JSON.stringify(compiled.ir)).toBe(before);
      expect(
        ir.wires.some((w) =>
          w.endpoints.some(
            (e) =>
              e.deviceUid ===
              ir.devices.find((d) => d.designation === "DS1")!.uid,
          ),
        ),
      ).toBe(false);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
