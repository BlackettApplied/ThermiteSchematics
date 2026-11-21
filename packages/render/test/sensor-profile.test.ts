import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { prepareCircuitView } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { renderSchematic } from "../src/renderer.js";
import { circuitMark } from "../src/symbols/circuit.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { materializeTypeFunctions } from "./fixtures.js";
const temporary: string[] = [];
afterAll(async () => {
  await Promise.all(
    temporary.map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function sensorProject(
  local: boolean,
  description = "Three-wire PNP proximity sensor",
): Promise<ElectricalIr> {
  const root = await mkdtemp(join(tmpdir(), "thermite-sensor-profile-"));
  temporary.push(root);
  await mkdir(join(root, "library"));
  const t = JSON.parse(
    await readFile(
      resolve("packages/core-library/library/types/prox-pnp-3wire.json"),
      "utf8",
    ),
  ).types[0];
  const keys = local ? ["z", "a", "q"] : ["1", "3", "4"];
  if (local) {
    t.id = "local:arbitrary";
    t.symbol = "thermite:sensor-3wire";
    t.description = description;
    t.terminals = {
      q: t.terminals["4"],
      a: t.terminals["3"],
      z: t.terminals["1"],
    };
    t.functions = {
      energize: { kind: "load", terminals: ["a", "z"] },
      measurement: { kind: "channel", direction: "output", terminals: ["q"] },
    };
    t.internal_relations = [];
  }
  await writeFile(
    join(root, "library/library.json"),
    JSON.stringify({ name: "local", version: "0.1.0", sources: ["type.json"] }),
  );
  await writeFile(
    join(root, "library/type.json"),
    JSON.stringify({ types: [{ ...t, id: local ? t.id : "local:unused" }] }),
  );
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Sensor profile" },
      sources: ["source.json"],
      libraries: [
        { name: "core", version: "0.1.0" },
        { name: "local", version: "0.1.0", path: "library" },
      ],
    }),
  );
  const device = (n: number, designation: string, type: string) => ({
    uid: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "device",
    designation,
    type,
  });
  const wire = (n: number, from: string, to: string) => ({
    uid: `00000000-0000-4000-8001-${String(n).padStart(12, "0")}`,
    kind: "wire",
    designation: `W${n}`,
    endpoints: [from, to].map((s) => {
      const i = s.indexOf(".");
      return { device: s.slice(0, i), terminal: s.slice(i + 1) };
    }),
  });
  await writeFile(
    join(root, "source.json"),
    JSON.stringify({
      objects: [
        device(1, "PS1", "core:psu-24vdc"),
        device(2, "B1", local ? t.id : "core:prox-pnp-3wire"),
        device(3, "PLC1", "core:plc-compact"),
        wire(1, "PS1.+", `B1.${keys[0]}`),
        wire(2, "PS1.-", `B1.${keys[1]}`),
        wire(3, `B1.${keys[2]}`, "PLC1.X1.0"),
      ],
    }),
  );
  expect((await lockProject(root)).ok).toBe(true);
  const c = await compileProject(root);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  expect(c.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
  return c.ir;
}
describe("three-wire sensor profile", () => {
  for (const local of [false, true])
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      it(`${local ? "renamed local" : "core prox"} preserves supply, output and return in ${flow}`, async () => {
        const ir = await sensorProject(local),
          before = JSON.stringify(ir),
          type = ir.deviceTypes.find(
            (t) => t.id === (local ? "local:arbitrary" : "core:prox-pnp-3wire"),
          )!;
        const mapping = projectDeviceTypeSymbolMappings(ir).find(
          (m) => m.typeId === type.id,
        )!;
        expect(
          mapping.aggregates[0]!.bindings.map((b) => [b.portId, b.terminalKey]),
        ).toEqual([
          ["supply", local ? "z" : "1"],
          ["return", local ? "a" : "3"],
          ["signal", local ? "q" : "4"],
        ]);
        const circuit = await prepareCircuitView(ir, {
          format: "circuit-view-request/0.1",
          title: "Sensor",
          flow,
          groups: [
            {
              id: "sensor",
              label: "Sensor",
              functions: type.functions.map((f) => ({
                device: { by: "designation" as const, value: "B1" },
                key: f.key,
              })),
              conductors: ["W1", "W2", "W3"],
            },
          ],
        });
        const doc = parseHTML(circuit.groups[0]!.content).document;
        expect(
          doc.querySelectorAll('[data-circuit-mark="sensor-3wire"]').length,
        ).toBe(2);
        for (const key of local ? ["z", "a", "q"] : ["1", "3", "4"])
          expect(
            doc.querySelector(`[data-terminal-key="${key}"]`),
          ).not.toBeNull();
        const text = [...doc.querySelectorAll("text")].map(
          (t) => t.textContent,
        );
        expect(text).toEqual(
          expect.arrayContaining(
            local
              ? ["z (+)", "a (-)", "q (OUT)"]
              : ["1 (+)", "3 (-)", "4 (OUT)"],
          ),
        );
        expect(circuit.groups[0]!.content).toContain("PNP");
        const supplyGroup = doc.querySelector(
          `[data-function-key="${local ? "energize" : "supply"}"]`,
        )!;
        const outline = supplyGroup.querySelector(
          'g[data-function-interface="sensor-3wire"] > rect',
        )!;
        const qualifier = [...supplyGroup.querySelectorAll("text")].find(
          (t) => t.textContent === "PNP",
        )!;
        // At print scale the qualifier clears the complete interface mark in both
        // flows, including its enclosure; no smaller text or clipped ink.
        expect(
          Number(qualifier.getAttribute("y")) -
            Number(qualifier.getAttribute("font-size")),
        ).toBeGreaterThanOrEqual(
          Number(outline.getAttribute("y")) +
            Number(outline.getAttribute("height")) +
            0.3,
        );

        if (flow === "top-to-bottom") {
          const outputGroup = doc.querySelector(
            `[data-function-key="${local ? "measurement" : "output"}"]`,
          )!;
          const lead = outputGroup.querySelector(
            'g[data-function-interface="sensor-3wire"] line',
          )!;
          for (const label of outputGroup.querySelectorAll(
            "g[data-channel-line] text",
          )) {
            const conservativeHalfWidth =
              Number(label.getAttribute("font-size")) *
              label.textContent!.length *
              0.5;
            expect(
              Number(label.getAttribute("x")) + conservativeHalfWidth,
            ).toBeLessThan(Number(lead.getAttribute("x1")) - 0.3);
          }
        }

        for (const request of [
          {
            root: { by: "designation", value: "PS1" },
            intent: { kind: "loads" },
          },
          {
            root: { by: "designation", value: "B1" },
            intent: {
              kind: "trace",
              to: { by: "designation", value: "PLC1" },
              includePower: true,
            },
          },
        ] as const) {
          const result = await renderSchematic(ir, {
            format: "schematic-view-request/0.2",
            ...request,
            flow,
          });
          expect(result.ok, JSON.stringify(result)).toBe(true);
          if (result.ok)
            expect(result.value.svg).toContain("ais:switch-sensor-pnp");
        }
        expect(JSON.stringify(ir)).toBe(before);
        const uid = ir.devices.find((d) => d.designation === "B1")!.uid;
        const nets = ir.indexes.netIdByTerminal
          .filter((e) => e.key.deviceUid === uid)
          .map((e) => e.value);
        expect(new Set(nets).size).toBe(3);
      });
    }
  it.each([
    "Undeclared output technology",
    "NPN output sensor",
    "PNP and NPN variants",
    "Not a PNP output sensor",
  ])(
    "prints only unambiguous declared output type: %s",
    async (description) => {
      const ir = await sensorProject(true, description);
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const r = await renderSchematic(ir, {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "PS1" },
          intent: { kind: "loads" },
          flow,
        });
        if (!r.ok) throw new Error(r.error.message);
        const labels = [
          ...parseHTML(r.value.svg).document.querySelectorAll("text"),
        ].map((t) => t.textContent);
        expect(labels.includes("PNP")).toBe(false);
        expect(labels.includes("NPN")).toBe(
          description === "NPN output sensor",
        );
      }
    },
  );
  it("does not draw a partial rooted sensor when the output shape is unsupported", async () => {
    const ir = await sensorProject(true);
    const type = ir.deviceTypes.find((t) => t.id === "local:arbitrary")!;
    const output = type.functions.find((f) => f.kind === "channel")!;
    output.terminalKeys.push("a");
    const uid = ir.devices.find((d) => d.designation === "B1")!.uid;
    ir.functions = ir.functions.filter((f) => f.id.deviceUid !== uid);
    ir.functions.push(...materializeTypeFunctions(type, uid));
    const result = await renderSchematic(ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({
        code: "R003",
        typeId: type.id,
        functionKey: "energize",
        family: "control",
      });
  });

  it("rejects unsupported channel direction/count and supply counts with exact function context", async () => {
    const ir = await sensorProject(true),
      type = ir.deviceTypes.find((t) => t.id === "local:arbitrary")!;
    for (const [kind, count, direction] of [
      ["channel", 1, "input"],
      ["channel", 2, "output"],
      ["load", 3, undefined],
      ["other", 3, undefined],
    ] as const) {
      const changed = structuredClone(type),
        fn = {
          ...changed.functions[0]!,
          key: "bad",
          kind,
          terminalKeys: changed.terminals.slice(0, count).map((t) => t.key),
          ...(direction ? { direction } : {}),
        };
      changed.functions = [fn as (typeof changed.functions)[number]];
      const f = materializeTypeFunctions(changed, "B1")[0]!;
      expect(() => circuitMark(changed, f)).toThrow(
        `Unsupported circuit function local:arbitrary/bad: thermite:sensor-3wire does not map ${kind} with ${count} terminals.`,
      );
      const m = projectDeviceTypeSymbolMappings({
        ...ir,
        deviceTypes: [changed],
      })[0]!;
      expect(m.aggregates).toEqual([]);
      expect(m.omissions).toContainEqual({
        functionKey: "bad",
        families: ["control", "power"],
        reason: "unsupported-v0.1",
      });
    }
  });
});

const roleCases = [
  {
    name: "prox-one-role",
    roles: ["supply_return", "brown_wire"],
    valid: false,
  },
  {
    name: "prox-two-positive",
    roles: ["supply_positive", "supply_positive"],
    valid: false,
  },
  { name: "prox-0v-first", roles: ["0v", "24v"], valid: false },
  { name: "prox-return-first", roles: ["return", "positive"], valid: false },
  {
    name: "prox-dc_negative-first",
    roles: ["dc_negative", "dc_positive"],
    valid: false,
  },
  {
    name: "two returns",
    roles: ["supply_return", "supply_return"],
    valid: false,
  },
  { name: "one positive", roles: ["supply_positive", undefined], valid: false },
  {
    name: "unknown supply role",
    roles: ["supply_common", "brown_wire"],
    valid: false,
  },
  { name: "no roles", roles: [undefined, undefined], valid: true },
  {
    name: "one unrelated role",
    roles: ["brown_wire", undefined],
    valid: false,
  },
  {
    name: "swapped roles",
    roles: ["supply_return", "supply_positive"],
    valid: true,
  },
] as const;

describe("review sensor polarity and distinct terminals", () => {
  for (const c of roleCases)
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      it(`${c.name}: supply polarity in ${flow}`, async () => {
        const ir = await sensorProject(false),
          type = ir.deviceTypes.find((t) => t.id === "core:prox-pnp-3wire")!;
        let roles: readonly (string | undefined)[] = c.roles;
        if (c.name.startsWith("prox-")) {
          // Exact local-type reproductions from the cross-review, vendored for portability.
          const reviewed = JSON.parse(
            await readFile(
              new URL(
                `./fixtures/profile-binding/${c.name}.json`,
                import.meta.url,
              ),
              "utf8",
            ),
          ).types[0];
          roles = reviewed.functions.supply.terminals.map(
            (k: string) => reviewed.terminals[k].role,
          );
        }
        for (const [i, k] of ["1", "3"].entries()) {
          const t = type.terminals.find((t) => t.key === k)!;
          if (roles[i] === undefined) delete t.role;
          else t.role = roles[i];
        }
        const mapping = projectDeviceTypeSymbolMappings(ir).find(
          (m) => m.typeId === type.id,
        )!;
        expect(mapping.aggregates).toHaveLength(c.valid ? 1 : 0);
        const packet = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          views: [
            {
              format: "circuit-view-request/0.1",
              title: "Sensor polarity",
              flow,
              groups: [
                {
                  id: "s",
                  label: "Sensor",
                  functions: ["supply", "output"].map((key) => ({
                    device: { by: "designation", value: "B1" },
                    key,
                  })),
                  conductors: [],
                },
              ],
            },
          ],
        });
        expect(packet.ok, JSON.stringify(packet)).toBe(c.valid);
        if (!packet.ok) {
          expect(packet.error).toMatchObject({ code: "R006" });
          expect(packet.error.message).toContain("supply");
          for (const role of roles)
            if (role) expect(packet.error.message).toContain(role);
        }
        if (packet.ok) {
          const labels = [
            ...parseHTML(packet.value.sheets[0]!.svg).document.querySelectorAll(
              "text",
            ),
          ].map((t) => t.textContent);
          expect(labels).toContain(
            c.name === "swapped roles" ? "3 (+) [+1]" : "1 (+) [+1]",
          );
          expect(labels).toContain(
            c.name === "swapped roles" ? "1 (-) [+1]" : "3 (-) [+1]",
          );
        }
        if (!c.valid) {
          const trace = await renderSchematic(ir, {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "B1" },
            intent: {
              kind: "trace",
              to: { by: "designation", value: "PLC1" },
              includePower: true,
            },
            flow,
          });
          expect(trace.ok).toBe(false);
          if (!trace.ok) expect(trace.error.code).toBe("R001");
        }
      });
    }
  it.each(["1", "3"])(
    "requires the output to be distinct from supply terminal %s",
    async (shared) => {
      const ir = await sensorProject(false),
        type = ir.deviceTypes.find((t) => t.id === "core:prox-pnp-3wire")!,
        device = ir.devices.find((d) => d.designation === "B1")!;
      type.functions.find((f) => f.key === "output")!.terminalKeys = [shared];
      ir.functions = ir.functions.filter((f) => f.id.deviceUid !== device.uid);
      ir.functions.push(...materializeTypeFunctions(type, device.uid));
      const before = JSON.stringify(ir.nets);
      expect(
        projectDeviceTypeSymbolMappings(ir).find((m) => m.typeId === type.id)!
          .aggregates,
      ).toEqual([]);
      const r = await renderSchematic(ir, {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "B1" },
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: true,
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("R001");
      expect(JSON.stringify(ir.nets)).toBe(before);
    },
  );
});
