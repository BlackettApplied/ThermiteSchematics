import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_SYMBOL_BINDINGS } from "@thermite/schema";
import {
  compileProject,
  lockProject,
  serializeIr,
  type ElectricalIr,
} from "@thermite/compiler";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocumentation } from "@thermite/query";
import { renderSchematicPacket } from "../src/sheets.js";
import { renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { compileCoreFixture, pnpTraceFixture } from "./fixtures.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  projectDeviceTypeSymbolMappings,
} from "../src/symbols/mappings.js";
import { createHash } from "node:crypto";

function renderingWithoutSnapshot(
  result: Awaited<ReturnType<typeof renderSchematicPacket>>,
  source: ElectricalIr,
) {
  if (!result.ok) return result;
  const navigation = result.value.navigation!;
  const snapshot = createHash("sha256")
    .update(JSON.stringify(serializeIr(source)))
    .digest("hex");
  const unbind = <T extends { snapshotDigest: string }>(record: T) => {
    expect(record.snapshotDigest).toBe(snapshot);
    return { ...record, snapshotDigest: undefined };
  };
  const normalized = {
    ...result,
    value: {
      ...result.value,
      navigation: {
        ...unbind(navigation),
        documents: navigation.documents?.map(unbind),
        dependencies: navigation.dependencies?.map(unbind),
      },
    },
  };
  // BOM row identities contain type IDs. Verify their native-key hash before
  // normalizing only that document prefix in the SVG, HTML and locators.
  const bom = buildDocumentation(source, {
    format: "documentation-view-request/0.1",
    kind: "bom",
  });
  const prefix = `document/1/${createHash("sha256")
    .update(
      JSON.stringify([
        bom.kind,
        bom.rows.map((r) => r.key),
        bom.selection ?? null,
      ]),
    )
    .digest("hex")}/`;
  const documents = navigation.documents!.filter((d) => d.kind === "bom");
  expect(documents).toHaveLength(1);
  expect(documents[0]!.id.startsWith(prefix)).toBe(true);
  return JSON.parse(
    JSON.stringify(normalized).replaceAll(prefix, "document/1/type-clone-bom/"),
  );
}
let core: ElectricalIr;
let core02: ElectricalIr;
let core02Root: string;
beforeAll(async () => {
  core = await compileCoreFixture();
  core02Root = await mkdtemp(join(tmpdir(), "thermite-core02-render-"));
  await cp("examples/motor-starter", core02Root, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(core02Root, "system.json"), "utf8"),
  );
  manifest.libraries[0].version = "0.2.0";
  await writeFile(join(core02Root, "system.json"), JSON.stringify(manifest));
  expect((await lockProject(core02Root)).ok).toBe(true);
  const compiled = await compileProject(core02Root);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  core02 = compiled.ir;
});
afterAll(async () => {
  if (core02Root) await rm(core02Root, { recursive: true, force: true });
});
function normalizeVersion(json: string) {
  return json.replaceAll(
    "@thermite/core-library/versions/0.2.0",
    "@thermite/core-library",
  );
}
// Preserve instance UUIDs, designations and every electrical object. Only the type
// ID changes. Normalize that ID in serialized drawings; no geometry/labels removed.
function clone(ir: ElectricalIr, id: string, symbol?: string) {
  const v = structuredClone(ir),
    t = v.deviceTypes.find((t) => t.id === id)!;
  t.id = id.replace("core:", "local:");
  if (symbol) t.symbol = symbol;
  for (const d of v.devices) if (d.typeId === id) d.typeId = t.id;
  v.indexes.instanceRefsByTypeId.find((e) => e.key === id)!.key = t.id;
  return v;
}
const requests = [
  // The thirteenth type is a cable, with physical conductor views rather than
  // a device profile. Compare its actual 0.2.0 rendering in the same matrix.
  {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "CBL1" },
    intent: { kind: "conductors" },
  },
  {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "PS1" },
    family: "power",
  },
  {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "M1" },
    family: "power",
  },
  {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "K1" },
    family: "control",
  },
  {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "PS1" },
    intent: { kind: "loads" },
  },
  {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS1" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower: true,
    },
  },
] as const;
describe("core profile clone matrix", () => {
  for (const binding of CORE_SYMBOL_BINDINGS)
    for (const variant of [
      "IEC",
      "profile",
      "core 0.2.0",
      "core 0.2.0 clone",
    ] as const) {
      it(`${binding.typeId} / ${variant} matches every supported family and flow`, async () => {
        const symbol =
          variant === "profile"
            ? (binding.equivalent ?? "thermite:sensor-3wire")
            : undefined;
        const originalIr =
          binding.typeId === "core:prox-pnp-3wire"
            ? pnpTraceFixture(core)
            : core;
        const nextIr =
          binding.typeId === "core:prox-pnp-3wire"
            ? pnpTraceFixture(core02)
            : core02;
        const changed =
          variant === "core 0.2.0"
            ? nextIr
            : variant === "core 0.2.0 clone"
              ? clone(nextIr, binding.typeId)
              : clone(originalIr, binding.typeId, symbol);
        for (const flow of ["left-to-right", "top-to-bottom"] as const) {
          for (const request of requests) {
            const original = await renderSchematic(originalIr, {
              ...request,
              flow,
            });
            expect(original.ok, JSON.stringify(original)).toBe(true);
            const actual = await renderSchematic(changed, { ...request, flow });
            expect(actual.ok, JSON.stringify(actual)).toBe(true);
            if (original.ok && actual.ok)
              expect(
                normalizeVersion(JSON.stringify(actual.value)).replaceAll(
                  binding.typeId.replace("core:", "local:"),
                  binding.typeId,
                ),
              ).toBe(JSON.stringify(original.value));
          }
          const instances = originalIr.devices.filter(
            (d) => d.typeId === binding.typeId,
          );
          for (const device of instances) {
            const type = originalIr.deviceTypes.find(
              (t) => t.id === binding.typeId,
            )!;
            const request = {
              format: "circuit-view-request/0.1" as const,
              title: "Clone matrix",
              flow,
              groups: [
                {
                  id: "g",
                  label: "Device",
                  functions: type.functions
                    .filter((f) => f.kind !== "mechanism")
                    .map((f) => ({
                      device: {
                        by: "designation" as const,
                        value: device.designation!,
                      },
                      key: f.key,
                    })),
                  conductors: [],
                },
              ],
            };
            const original = await prepareCircuitView(originalIr, request);
            const actual = await prepareCircuitView(changed, request);
            expect(
              normalizeVersion(JSON.stringify(actual)).replaceAll(
                binding.typeId.replace("core:", "local:"),
                binding.typeId,
              ),
            ).toBe(JSON.stringify(original));
          }
        }
      }, 30000);
    }
  it("preserves rooted core bindings with only PSU input and breaker control additions", () => {
    const mappings = projectDeviceTypeSymbolMappings(core);
    expect(mappings).toHaveLength(12);
    for (const expected of CORE_DEVICE_TYPE_SYMBOL_MAPPINGS) {
      const actual = mappings.find((m) => m.typeId === expected.typeId)!;
      const addedControl = actual.functions.filter(
        (f) =>
          expected.typeId === "core:breaker-3p" &&
          f.families.includes("control"),
      );
      expect(addedControl).toEqual(
        expected.typeId === "core:breaker-3p"
          ? expected.functions.map((f) => ({
              ...f,
              families: ["control"],
              traversalRole: "protection-contact",
            }))
          : [],
      );
      expect(
        actual.functions.filter(
          (f) => f.functionKey !== "ac_input" && !addedControl.includes(f),
        ),
      ).toEqual(expected.functions);
      expect(actual.aggregates).toEqual(expected.aggregates);
      expect(actual.boundaryTerminals).toEqual(expected.boundaryTerminals);
      const omissions = (m: typeof expected) =>
        m.omissions
          .filter((f) => f.functionKey !== "ac_input")
          .toSorted((a, b) =>
            a.functionKey < b.functionKey
              ? -1
              : a.functionKey > b.functionKey
                ? 1
                : 0,
          );
      expect(omissions(actual)).toEqual(
        omissions(expected).filter(
          (f) =>
            !addedControl.some(
              (c) =>
                c.functionKey === f.functionKey &&
                f.reason === "outside-family" &&
                f.families.every((family) => c.families.includes(family)),
            ),
        ),
      );
    }
  });
});

describe("automatic terminal-plan profile clones", () => {
  let baseline: Extract<
    Awaited<ReturnType<typeof compileProject>>,
    { ok: true }
  >;
  let before: Awaited<ReturnType<typeof renderSchematicPacket>>;
  let packet: Parameters<typeof renderSchematicPacket>[1];
  beforeAll(async () => {
    const c = await compileProject("examples/machine-demo");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    baseline = c;
    packet = JSON.parse(
      await readFile("examples/machine-demo/packet.request.json", "utf8"),
    );
    before = await renderSchematicPacket(c.ir, packet, c.presentation);
    expect(before.ok, JSON.stringify(before)).toBe(true);
  });
  it.each(["IEC", "profile"] as const)(
    "preserves the complete machine-demo packet and eight references per strip for %s",
    async (variant) => {
      const c = baseline;
      let changed = structuredClone(c.ir);
      for (const id of CORE_SYMBOL_BINDINGS.map((b) => b.typeId))
        changed = clone(
          changed,
          id,
          variant === "profile"
            ? CORE_SYMBOL_BINDINGS.find((b) => b.typeId === id)!.equivalent
            : undefined,
        );
      const request = {
        format: "documentation-view-request/0.1" as const,
        kind: "terminals" as const,
      };
      const original = buildDocumentation(c.ir, request),
        actual = buildDocumentation(changed, request);
      for (const id of ["core:terminal-block-8", "core:junction-box-8"]) {
        const d = c.ir.devices.find((d) => d.typeId === id)!;
        expect(
          original.rows.filter((r) => JSON.parse(r.key)[0] === d.uid),
        ).toHaveLength(8);
        expect(
          actual.rows.filter((r) => JSON.parse(r.key)[0] === d.uid),
        ).toHaveLength(8);
      }
      expect(actual).toEqual(original);
      const after = await renderSchematicPacket(
        changed,
        packet,
        c.presentation,
      );
      expect(before.ok, JSON.stringify(before)).toBe(true);
      expect(after.ok, JSON.stringify(after)).toBe(true);
      // Type IDs are source facts, so their snapshot digest changes. Keep every
      // occurrence, location and rendered byte in the equality comparison.
      if (before.ok && after.ok)
        expect(after.value.navigation!.snapshotDigest).not.toBe(
          before.value.navigation!.snapshotDigest,
        );
      const normalized = CORE_SYMBOL_BINDINGS.reduce(
        (json, b) =>
          json.replaceAll(b.typeId.replace("core:", "local:"), b.typeId),
        JSON.stringify(renderingWithoutSnapshot(after, changed)),
      );
      // A boolean comparison keeps a failure from dumping the entire packet.
      expect(
        normalized === JSON.stringify(renderingWithoutSnapshot(before, c.ir)),
      ).toBe(true);
    },
    30000,
  );
});
