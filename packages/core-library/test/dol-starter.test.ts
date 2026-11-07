import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { analyzeCompleteness, compileProject } from "@thermite/compiler";
import {
  prepareCircuitView,
  type CircuitViewRequest,
} from "../../render/src/circuit.js";
import { renderSchematic } from "../../render/src/renderer.js";
import { renderSchematicPacket } from "../../render/src/sheets.js";
const starter = "packages/core-library/test/fixtures/dol-starter";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "draws the whole DOL control circuit in %s while pinning the rooted control gap",
  async (flow) => {
    const compiled = await compileProject(starter);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const { ir } = compiled;
    const before = JSON.stringify(ir);
    const request: CircuitViewRequest = {
      ...JSON.parse(
        await readFile(join(starter, "control.circuit.json"), "utf8"),
      ),
      flow,
    };
    // Derive the full control inventory from source, independently of the request.
    // Include the transformer feed, PSU, interlocks, holding contact and indication.
    const controlDevices = new Set(
      ir.devices
        .filter((d) =>
          ["T1", "PS1", "F1", "S0", "S1", "S2", "R1", "H1"].includes(
            d.designation,
          ),
        )
        .map((d) => d.uid),
    );
    const wires = ir.wires
      .filter((w) =>
        w.endpoints.some((e) => controlDevices.has(e.terminal.deviceUid)),
      )
      .map((w) => w.uid)
      .sort();
    const functions = ir.functions
      .filter(
        (f) =>
          f.kind !== "mechanism" &&
          (controlDevices.has(f.id.deviceUid) ||
            f.id.functionKey === "coil" ||
            f.id.functionKey === "aux95"),
      )
      .map((f) => JSON.stringify([f.id.deviceUid, f.id.functionKey]))
      .sort();
    expect(wires).toHaveLength(17);
    expect(functions).toHaveLength(14);
    const circuit = await prepareCircuitView(ir, request);
    expect(
      circuit.groups.flatMap((g) => g.coverage.conductorIds).sort(),
    ).toEqual(wires);
    expect(
      circuit.groups.flatMap((g) => g.coverage.functionIds).sort(),
    ).toEqual(functions);
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "a3", orientation: "landscape", marginMm: 10 },
      views: [request],
    });
    expect(packet.ok, JSON.stringify(packet.ok ? {} : packet)).toBe(true);
    if (packet.ok) {
      expect(
        packet.value.coverage.conductors
          .filter((c) => c.appearances.length)
          .map((c) => c.id)
          .sort(),
      ).toEqual(wires);
      expect(
        packet.value.coverage.functions
          .filter((f) => f.appearances.length)
          .map((f) => f.id)
          .sort(),
      ).toEqual(functions);
    }
    for (const root of ["K1", "R1"]) {
      const rooted = await renderSchematic(ir, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: root },
        family: "control",
        flow,
      });
      expect(rooted).toMatchObject({
        ok: false,
        error: {
          code: "R002",
          reason: "unsupported-symbol-profile",
          unsupported: {
            designation: "F1",
            profile: "thermite:fuse",
            functionKey: "pole1",
            family: "control",
          },
        },
      });
    }
    const power = await renderSchematic(ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
      flow,
    });
    expect(power.ok, JSON.stringify(power.ok ? {} : power)).toBe(true);
    expect(JSON.stringify(ir)).toBe(before);
  },
);

it("validates a DOL starter entirely from core 0.2.0 with zero errors, warnings or I003", async () => {
  const compiled = await compileProject(starter);
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  expect(compiled.diagnostics.map((d) => [d.code, d.severity])).toEqual([
    ["I305", "info"],
  ]);
  if (!compiled.ok) throw Error("starter did not compile");
  const report = analyzeCompleteness(compiled.ir);
  expect(
    report.findings.filter(
      (f) =>
        f.code === "I003" || f.severity === "warning" || f.severity === "error",
    ),
  ).toEqual([]);
  // Same explicit namespace/local-source inventory used by init and dogfood checks.
  expect(
    compiled.ir.devices.filter((d) => !d.typeId.startsWith("core:")),
  ).toEqual([]);
  for (const device of compiled.ir.devices) {
    const type = compiled.ir.deviceTypes.find((t) => t.id === device.typeId)!;
    expect(type.libraryName).toBe("core");
    expect(type.libraryVersion).toBe("0.2.0");
  }
  expect(new Set(compiled.ir.devices.map((d) => d.typeId))).toEqual(
    new Set(
      [
        "supply-480v-3ph",
        "breaker-3p",
        "contactor-3p-1no",
        "overload-3p-1nc",
        "motor-3ph",
        "control-transformer",
        "fuse-1p",
        "psu-24vdc",
        "estop-nc",
        "pushbutton-nc",
        "pushbutton-no",
        "relay-1co",
        "pilot-light",
        "terminal-pe",
      ].map((id) => `core:${id}`),
    ),
  );
});
it("reports an opened required start connection without repairing the circuit", async () => {
  const root = await mkdtemp(join(tmpdir(), "thermite-dol-negative-"));
  try {
    await cp(starter, root, { recursive: true });
    const path = join(root, "source.json"),
      source = JSON.parse(await readFile(path, "utf8"));
    source.objects = source.objects.filter(
      (o: any) =>
        !(
          o.kind === "wire" &&
          o.endpoints.some((e: any) => e.device === "S2" && e.terminal === "14")
        ),
    );
    await writeFile(path, JSON.stringify(source));
    const result = await compileProject(root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    expect(
      analyzeCompleteness(result.ir)
        .findings.filter((f) => f.code === "W903")
        .map((f) => [f.designation, f.key]),
    ).toEqual([["S2", "14"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("joins only two-ended power cable cores; a spare PE end cannot complete the motor bond", async () => {
  const root = await mkdtemp(join(tmpdir(), "thermite-dol-cable-negative-"));
  try {
    await cp(starter, root, { recursive: true });
    const original = await compileProject(root);
    if (!original.ok) throw Error(JSON.stringify(original.diagnostics));
    const path = join(root, "source.json"),
      source = JSON.parse(await readFile(path, "utf8"));
    const cable = source.objects.find((o: any) => o.kind === "cable"),
      pe = cable.conductors.find((c: any) => c.id === "PE");
    pe.endpoints[1] = null;
    pe.usage = "spare";
    await writeFile(path, JSON.stringify(source));
    const result = await compileProject(root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    expect(result.ir.nets.length).toBe(original.ir.nets.length + 1);
    expect(
      analyzeCompleteness(result.ir)
        .findings.filter((f) => f.code === "W903")
        .map((f) => [f.designation, f.key]),
    ).toEqual([["M1", "PE"]]);
    // Removing the required spare disposition is rejected rather than commoning it.
    delete pe.usage;
    await writeFile(path, JSON.stringify(source));
    const invalid = await compileProject(root);
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "E015",
        message:
          'An unterminated cable endpoint requires explicit usage "spare".',
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
