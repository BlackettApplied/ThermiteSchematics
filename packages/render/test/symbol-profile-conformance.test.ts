import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileProject,
  lockProject,
  symbolFunctionMatchesShape,
  type ElectricalIr,
  type IrDeviceType,
  type IrDeviceTypeFunction,
} from "@thermite/compiler";
import { CORE_SYMBOL_BINDINGS, SYMBOL_PROFILES } from "@thermite/schema";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import {
  CIRCUIT_PROFILES,
  circuitMark,
  circuitProfile,
  emitCircuitMark,
} from "../src/symbols/circuit.js";
import {
  CORE_DEVICE_TYPE_SYMBOL_MAPPINGS,
  ROOTED_SYMBOL_PROFILES,
  projectDeviceTypeSymbolMappings,
} from "../src/symbols/mappings.js";
import {
  ROOTED_CONTRACTS,
  contractType,
  contractProject,
} from "./rooted-profile-contracts.js";
import {
  isFunctionTraversable,
  validateDeviceTypeSymbolMappings,
} from "../src/symbols/validate.js";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { compileCoreFixture, materializeTypeFunctions } from "./fixtures.js";

let core: ElectricalIr;
const temporary: string[] = [];
beforeAll(async () => {
  core = await compileCoreFixture();
});
afterAll(async () => {
  await Promise.all(
    temporary.map((p) => rm(p, { recursive: true, force: true })),
  );
});

function fixture(
  profile: string,
  kind: IrDeviceTypeFunction["kind"],
  count: number,
  variant = "plain",
): IrDeviceType {
  const source = { file: "fixture.json", line: 1, column: 1, jsonPointer: "" };
  return {
    kind: "device_type",
    id: "fixture:custom",
    libraryName: "fixture",
    libraryVersion: "0.1.0",
    aliases: [],
    symbol: profile,
    source,
    internalRelations: [],
    terminals: Array.from({ length: count }, (_, i) => ({
      key: String(i),
      source,
      ...(variant === "DC" ? { rating: { voltage_type: "DC" as const } } : {}),
      ...(variant === "earth" ? { role: "protective_earth" } : {}),
      ...(variant === "power"
        ? { role: i === 0 ? "power_input" : "power_output" }
        : {}),
      ...(variant === "aux" ? { role: "aux" } : {}),
      ...(variant === "phase" ? { role: `phase_${i + 1}_source` } : {}),
      ...(variant === "roles"
        ? { role: i === 0 ? "dc_positive_output" : "dc_return_output" }
        : {}),
    })),
    functions: [
      {
        key: "f",
        kind,
        terminalKeys: Array.from({ length: count }, (_, i) => String(i)),
        source,
        ...(kind === "contact"
          ? { normal_state: variant === "closed" ? "closed" : "open" }
          : {}),
        ...(kind === "channel"
          ? { direction: variant === "output" ? "output" : "input" }
          : {}),
      } as IrDeviceTypeFunction,
    ],
  };
}

describe("schema/render symbol profile conformance", () => {
  it("catalogs every circuit and rooted binding, with exact core-ID compatibility aliases", async () => {
    expect(
      SYMBOL_PROFILES.filter((p) =>
        p.support.some((s) => s.family === "circuit"),
      )
        .map((p) => p.id)
        .sort(),
    ).toEqual([...CIRCUIT_PROFILES].sort());
    for (const family of ["power", "control", "loads"] as const) {
      expect(
        SYMBOL_PROFILES.filter((p) =>
          p.support.some((s) => s.family === family),
        )
          .map((p) => p.id)
          .sort(),
      ).toEqual(
        Object.entries(ROOTED_CONTRACTS)
          .filter(([, v]) => v[family].length > 0)
          .map(([id]) => id)
          .sort(),
      );
    }
    expect(CORE_SYMBOL_BINDINGS.map((b) => b.typeId).sort()).toEqual(
      CORE_DEVICE_TYPE_SYMBOL_MAPPINGS.map((m) => m.typeId).sort(),
    );
    for (const binding of CORE_SYMBOL_BINDINGS) {
      const type = core.deviceTypes.find((t) => t.id === binding.typeId)!;
      expect(type.symbol).toBe(binding.symbol);
      expect(binding.binding).toBe("symbol-alias");
      if (binding.equivalent) {
        expect(circuitProfile(type)).toBe(binding.equivalent);
        expect(
          SYMBOL_PROFILES.find((p) => p.id === binding.equivalent)!.coreAliases,
        ).toContainEqual(binding);
      } else
        expect(() => circuitProfile(type)).toThrow(
          "Unsupported circuit symbol profile",
        );
    }
    expect(JSON.parse(JSON.stringify(SYMBOL_PROFILES))).toEqual(
      SYMBOL_PROFILES,
    );
    const ids = SYMBOL_PROFILES.flatMap((p) => [p.id, ...p.aliases]);
    expect(new Set(ids).size).toBe(ids.length);
    // Profile gates also live outside the central mappings and signal-loop module.
    const root = new URL("../src/", import.meta.url);
    const gates = new Set<string>();
    for (const path of (await readdir(root, { recursive: true })).filter((p) =>
      p.endsWith(".ts"),
    )) {
      const source = await readFile(
        new URL(path.replaceAll("\\", "/"), root),
        "utf8",
      );
      for (const [, id] of source.matchAll(
        /["'`](thermite:[a-z0-9-]+)["'`]/gu,
      )) {
        expect(ids, `${path}: ${id}`).toContain(id);
        gates.add(path.replaceAll("\\", "/"));
      }
    }
    for (const path of [
      "circuit.ts",
      "signal-loop.ts",
      "signal-loop-enclosures.ts",
      "symbols/field-device.ts",
    ])
      expect(gates.has(path), path).toBe(true);
  });

  it("audits every shipped 0.2.0 device and its advertised circuit support", async () => {
    const compiled = await compileProject(
      "packages/core-library/test/fixtures/dol-starter",
    );
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const inventory = JSON.parse(
      await readFile(
        "packages/core-library/versions/0.2.0/library.json",
        "utf8",
      ),
    );
    expect(inventory.version).toBe("0.2.0");
    const directory = "packages/core-library/versions/0.2.0/types";
    const sources = (
      await Promise.all(
        (await readdir(directory))
          .filter((p) => p.endsWith(".json"))
          .map(
            async (p) =>
              JSON.parse(await readFile(`${directory}/${p}`, "utf8")).types,
          ),
      )
    ).flat();
    const devices = sources.filter((t) => t.kind === "device_type");
    expect(devices.length).toBeGreaterThan(CORE_SYMBOL_BINDINGS.length);
    for (const source of devices) {
      const type = compiled.ir.deviceTypes.find((t) => t.id === source.id)!;
      expect(type, source.id).toBeDefined();
      const profile = SYMBOL_PROFILES.find(
        (p) =>
          p.id === source.symbol || p.aliases.some((a) => a === source.symbol),
      )!;
      expect(profile, source.id).toBeDefined();
      // L2 includes signal-loop-only profiles; inventory coverage must not invent
      // circuit bindings for a profile that does not advertise them.
      if (!profile.support.some((s) => s.family === "circuit")) {
        expect(() => circuitProfile(type)).toThrow(
          "Unsupported circuit symbol profile",
        );
        continue;
      }
      expect(circuitProfile(type)).toBe(profile.id);
      for (const [key, fn] of Object.entries(source.functions) as [
        string,
        any,
      ][]) {
        if (fn.kind === "mechanism") continue;
        expect(
          profile.support.some((s) =>
            s.functions.some((shape) =>
              symbolFunctionMatchesShape(source, fn, shape),
            ),
          ),
          `${source.id}/${key}`,
        ).toBe(true);
        const f = materializeTypeFunctions(type, "device").find(
          (f) => f.id.functionKey === key,
        )!;
        const mark = circuitMark(type, f);
        for (const vertical of [false, true])
          expect(emitCircuitMark(mark, vertical)).toContain(
            `data-circuit-mark="${mark}"`,
          );
      }
    }
  });

  it("renders every advertised circuit/function shape and rejects every unadvertised shape", () => {
    for (const profile of SYMBOL_PROFILES) {
      const support = profile.support.find((s) => s.family === "circuit");
      for (const kind of [
        "contact",
        "coil",
        "load",
        "source",
        "bus",
        "channel",
        "other",
        "mechanism",
      ] as const) {
        for (let count = 0; count <= 33; count++) {
          for (const variant of kind === "contact"
            ? ["plain", "closed"]
            : ["plain"]) {
            const type = fixture(
              profile.id,
              kind,
              count,
              profile.id === "thermite:sensor-3wire" && kind === "channel"
                ? "output"
                : variant,
            );
            const f = materializeTypeFunctions(type, "device")[0]!;
            const fits =
              support?.functions.some((shape) =>
                symbolFunctionMatchesShape(type, type.functions[0]!, shape),
              ) ?? false;
            const label = `${profile.id}/${kind}/${count}/${variant}`;
            if (fits) {
              const mark = circuitMark(type, f);
              for (const vertical of [false, true])
                expect(emitCircuitMark(mark, vertical), label).toContain(
                  `data-circuit-mark="${mark}"`,
                );
            } else expect(() => circuitMark(type, f), label).toThrow();
          }
        }
      }
    }
  });

  it.each(["site:custom-relay", "iec:contactor", "thermite:pushbutton"])(
    "explicit circuit marks bypass the %s profile gate",
    async (symbol) => {
      const ir = structuredClone(core);
      const type = ir.deviceTypes.find(
        (t) => t.id === "core:contactor-3p-1no",
      )!;
      const oldId = type.id;
      type.id = "fixture:explicit-relay";
      type.symbol = symbol;
      type.circuitSymbols = Object.fromEntries(
        type.functions.map((f) => [
          f.key,
          f.kind === "coil"
            ? "coil"
            : f.kind === "contact" && f.normal_state === "closed"
              ? "contact-nc"
              : "contact-no",
        ]),
      );
      for (const device of ir.devices.filter((d) => d.typeId === oldId))
        device.typeId = type.id;
      ir.indexes.instanceRefsByTypeId.find((e) => e.key === oldId)!.key =
        type.id;
      if (symbol === "site:custom-relay")
        expect(() => circuitProfile(type)).toThrow();
      for (const fn of materializeTypeFunctions(type, "device"))
        expect(emitCircuitMark(circuitMark(type, fn))).toContain(
          `data-circuit-mark="${type.circuitSymbols[fn.id.functionKey]}"`,
        );
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const drawing = await prepareCircuitView(ir, {
          format: "circuit-view-request/0.1",
          title: "Explicit marks",
          flow,
          groups: [
            {
              id: "explicit",
              label: "Relay",
              functions: type.functions.map((f) => ({
                device: { by: "designation", value: "K1" },
                key: f.key,
              })),
              conductors: [],
            },
          ],
        });
        expect(drawing.groups[0]!.content).toContain(
          'data-circuit-mark="coil"',
        );
        expect(drawing.groups[0]!.content).toContain(
          'data-circuit-mark="contact-no"',
        );
      }
    },
  );

  it("records io-module interface layout limits separately from mark binding", () => {
    const shape = SYMBOL_PROFILES.find((p) => p.id === "thermite:io-module")!
      .support.find((s) => s.family === "circuit")!
      .functions.find((s) => s.kind === "other")!;
    expect(shape).toMatchObject({ minTerminals: 1, maxTerminals: 32 });
    expect(shape.notes).toContain(
      "Measured 2026-11-04 on base 7a7c1fb plus P1",
    );
    expect(shape.notes).toContain("24 terminals on tabloid and 12 on A4");
    expect(shape.notes).toContain("not guaranteed paper limits");
    expect(shape.notes).toContain("top-to-bottom");
    expect(
      SYMBOL_PROFILES.flatMap((p) => p.support.flatMap((s) => s.functions)).map(
        (s) => s.kind,
      ),
    ).not.toContain("mechanism");
  });

  it.each(["thermite:terminal-strip", "thermite:bulkhead-connector"])(
    "claims only other/2 auxiliary functions for %s",
    (profile) => {
      const support = SYMBOL_PROFILES.find(
        (p) => p.id === profile,
      )!.support.find((s) => s.role === "auxiliary")!;
      expect(support.functions).toEqual([
        { kind: "other", minTerminals: 2, maxTerminals: 2 },
      ]);
      for (const kind of ["contact", "bus", "other"] as const) {
        const type = fixture(profile, kind, 2, "closed");
        const fn = type.functions[0]!;
        expect(
          support.functions.some((shape) =>
            symbolFunctionMatchesShape(type, fn, shape),
          ),
          kind,
        ).toBe(kind === "other");
        const materialized = materializeTypeFunctions(type, "device")[0]!;
        expect(() => circuitMark(type, materialized)).toThrow();
        if (kind === "contact") {
          type.circuitSymbols = { f: "fuse" };
          expect(emitCircuitMark(circuitMark(type, materialized))).toContain(
            'data-circuit-mark="fuse"',
          );
        }
      }
    },
  );

  it.each([
    ["thermite:pushbutton", "lamp", "load", "lamp", "pushbutton-no"],
    ["thermite:motor-3ph", "ptc", "other", "interface", "motor"],
  ] as const)(
    "an explicit mark repairs %s/%s while preserving the main profile",
    async (symbol, key, kind, mark, mainMark) => {
      const root = await mkdtemp(join(tmpdir(), "thermite-profile-repair-"));
      temporary.push(root);
      await cp(
        resolve("packages/compiler/fixtures/rules/invalid-circuit-symbol"),
        root,
        { recursive: true },
      );
      const type = {
        kind: "device_type",
        id: "fixture:module",
        symbol,
        terminals: { "1": {}, "2": {}, "3": {}, A1: {}, A2: {} },
        functions: {
          main:
            symbol === "thermite:pushbutton"
              ? { kind: "contact", normal_state: "open", terminals: ["1", "2"] }
              : { kind: "load", terminals: ["1", "2", "3"] },
          [key]: { kind, terminals: ["A1", "A2"] },
        },
        circuitSymbols: {} as Record<string, string>,
      };
      const compile = async () => {
        await writeFile(
          join(root, "library/types/module.json"),
          JSON.stringify({ types: [type] }),
        );
        expect((await lockProject(root)).ok).toBe(true);
        const result = await compileProject(root);
        if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
        return result;
      };
      const before = await compile();
      expect(before.diagnostics.filter((d) => d.code === "W111")).toHaveLength(
        1,
      );
      const request = {
        format: "circuit-view-request/0.1" as const,
        title: "Explicit repair",
        groups: [
          {
            id: "repair",
            label: "Repair",
            functions: ["main", key].map((key) => ({
              device: { by: "designation" as const, value: "IO1" },
              key,
            })),
            conductors: [],
          },
        ],
      };
      await expect(prepareCircuitView(before.ir, request)).rejects.toThrow(
        "Unsupported circuit function",
      );
      type.circuitSymbols[key] = mark;
      const after = await compile();
      expect(after.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const drawing = await prepareCircuitView(after.ir, {
          ...request,
          flow,
        });
        expect(drawing.groups[0]!.content).toContain(
          `data-circuit-mark="${mainMark}"`,
        );
        expect(drawing.groups[0]!.content).toContain(
          `data-circuit-mark="${mark}"`,
        );
      }
    },
  );

  it("materializes every advertised rooted binding, including role/rating constraints and loads' control bindings", () => {
    for (const profile of SYMBOL_PROFILES) {
      for (const kind of [
        "contact",
        "coil",
        "load",
        "source",
        "bus",
        "channel",
        "other",
        "mechanism",
      ] as const) {
        for (const count of [0, 1, 2, 3, 4]) {
          for (const variant of [
            "plain",
            "DC",
            "roles",
            "earth",
            "output",
            "power",
            "aux",
            "phase",
            "closed",
          ]) {
            const type = fixture(profile.id, kind, count, variant);
            if (profile.id === "thermite:sensor-3wire") {
              const f = type.functions[0]!;
              if (kind === "channel" && variant === "output") {
                type.terminals.push(
                  { key: "s", source: type.source },
                  { key: "r", source: type.source },
                );
                type.functions.push({
                  key: "supply",
                  kind: "load",
                  terminalKeys: ["s", "r"],
                  source: type.source,
                });
              } else if (kind === "load" && count === 2) {
                type.terminals.push({ key: "q", source: type.source });
                type.functions.push({
                  key: "output",
                  kind: "channel",
                  direction: "output",
                  terminalKeys: ["q"],
                  source: type.source,
                });
              }
            }
            type.terminals.reverse();
            const mapping = projectDeviceTypeSymbolMappings({
              ...core,
              deviceTypes: [type],
            }).find((m) => m.typeId === type.id);
            const declaredRoles = type.functions[0]!.terminalKeys.map(
              (key) => type.terminals.find((t) => t.key === key)!.role,
            );
            // Independent oracle: any authored supply role requires the exact pair.
            const sensorSupplyFits =
              declaredRoles.every((role) => role === undefined) ||
              (declaredRoles.length === 2 &&
                declaredRoles.includes("supply_positive") &&
                declaredRoles.includes("supply_return"));
            for (const family of ["power", "control"] as const) {
              const fits =
                (profile.id !== "thermite:sensor-3wire" ||
                  kind !== "channel" ||
                  variant === "output") &&
                (profile.id !== "thermite:sensor-3wire" ||
                  kind !== "load" ||
                  sensorSupplyFits) &&
                profile.support
                  .filter((s) => s.family === family)
                  .some((s) =>
                    s.functions.some((shape) =>
                      symbolFunctionMatchesShape(
                        type,
                        type.functions[0]!,
                        shape,
                      ),
                    ),
                  );
              const actual =
                [
                  ...(mapping?.functions ?? []).map((f) => ({
                    ...f,
                    functionKeys: [f.functionKey],
                  })),
                  ...(mapping?.aggregates ?? []),
                ].some(
                  (f) =>
                    f.functionKeys.includes("f") && f.families.includes(family),
                ) ?? false;
              expect(
                actual,
                `${profile.id}/${kind}/${count}/${variant}/${family}`,
              ).toBe(fits);
            }
            if (
              mapping &&
              (mapping.functions.length || mapping.aggregates.length)
            ) {
              expect(() =>
                validateDeviceTypeSymbolMappings(
                  [type],
                  [mapping],
                  SYMBOL_CATALOG,
                ),
              ).not.toThrow();
            }
          }
        }
      }
    }
  });

  it.each(["left-to-right", "top-to-bottom"] as const)(
    "draws rooted control, loads, and power with the reusable bindings in %s",
    async (flow) => {
      const ir = structuredClone(core);
      for (const binding of CORE_SYMBOL_BINDINGS.filter((b) =>
        ROOTED_SYMBOL_PROFILES.includes(
          b.equivalent as (typeof ROOTED_SYMBOL_PROFILES)[number],
        ),
      )) {
        const type = ir.deviceTypes.find((t) => t.id === binding.typeId)!;
        type.id = type.id.replace("core:", "fixture:");
        type.symbol = binding.equivalent!;
        for (const device of ir.devices.filter(
          (d) => d.typeId === binding.typeId,
        ))
          device.typeId = type.id;
        ir.indexes.instanceRefsByTypeId.find(
          (entry) => entry.key === binding.typeId,
        )!.key = type.id;
      }
      for (const [root, family] of [
        ["K1", "control"],
        ["PS1", "loads"],
        ["M1", "power"],
      ] as const) {
        const result = await renderSchematic(ir, {
          root: { by: "designation", value: root },
          ...(family === "loads"
            ? ({
                format: "schematic-view-request/0.2",
                intent: { kind: "loads" },
              } as const)
            : ({ format: "schematic-view-request/0.1", family } as const)),
          flow,
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (result.ok) expect(result.value.svg).toContain("data-symbol-id");
      }
    },
  );

  it("draws terminal-only circuit boundaries without inventing bus functions", async () => {
    const compiled = await compileProject(
      resolve("libraries/abb-pilot/examples/1saj240100r0003"),
    );
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const boundary = compiled.ir.devices.find((d) => d.designation === "B1")!;
    const type = compiled.ir.deviceTypes.find((t) => t.id === boundary.typeId)!;
    expect(type.functions).toEqual([]);
    expect(type.terminals).toHaveLength(1);
    const support = SYMBOL_PROFILES.find(
      (p) => p.id === type.symbol,
    )!.support.find((s) => s.family === "circuit" && s.role === "boundary")!;
    expect(support.terminalOnly).toEqual({ minTerminals: 1 });
    for (const flow of ["left-to-right", "top-to-bottom"] as const) {
      const drawing = await prepareCircuitView(compiled.ir, {
        format: "circuit-view-request/0.1",
        title: "Boundary conformance",
        flow,
        groups: [
          {
            id: "g",
            label: "Boundary",
            functions: [
              { device: { by: "designation", value: "D1" }, key: "IN.1" },
            ],
            conductors: ["W1"],
          },
        ],
      });
      expect(drawing.groups[0]!.content).toContain(boundary.uid);
    }
  });

  it.each(["signal-loop", "analog-output"])(
    "draws the existing %s-only profiles and aliases in both flows",
    async (name) => {
      const root = await mkdtemp(join(tmpdir(), "thermite-profile-loop-"));
      temporary.push(root);
      for (const library of ["field-interfaces", "industrial-pilot"])
        await cp(resolve("libraries", library), join(root, library), {
          recursive: true,
        });
      await writeFile(
        join(root, "system.json"),
        JSON.stringify({
          format: "electrical-system/0.1",
          project: { name: "conformance" },
          sources: ["source.json"],
          libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
            name,
            version: "0.1.0",
            path: name,
          })),
        }),
      );
      await cp(
        resolve("packages/cli/fixtures", name, "source.json"),
        join(root, "source.json"),
      );
      expect((await lockProject(root)).ok).toBe(true);
      const compiled = await compileProject(root);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const ir = compiled.ir;
      const request =
        name === "signal-loop"
          ? {
              format: "signal-loop-view-request/0.1",
              from: { device: "PT1", function: "signal" },
              to: { device: "AI1", function: "ch0" },
            }
          : JSON.parse(
              await readFile(
                resolve(
                  "packages/cli/fixtures/analog-output/packet.request.json",
                ),
                "utf8",
              ),
            ).views[0];
      const exercised = new Set(
        ir.devices.map(
          (d) => ir.deviceTypes.find((t) => t.id === d.typeId)!.symbol,
        ),
      );
      // Explicit series power is selected and refused at the drawing gate in its own suite.
      for (const profile of SYMBOL_PROFILES.filter((p) =>
        p.support.some(
          (s) => s.family === "signal-loop" && s.role !== "series-power",
        ),
      )) {
        if (
          profile.id !==
          (name === "signal-loop"
            ? "thermite:analog-actuator"
            : "thermite:pressure-transmitter")
        )
          expect(exercised.has(profile.id), profile.id).toBe(true);
      }
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const drawing = await prepareSignalLoopDrawing(ir, {
          ...request,
          flow,
        });
        expect(drawing.content).toContain("<");
        expect(drawing.width).toBeGreaterThan(0);
        expect(drawing.height).toBeGreaterThan(0);
      }
      const primary = name === "signal-loop" ? request.from : request.to;
      const endpoints = [
        primary,
        ...(request.auxiliary ?? []).flatMap(
          (pair: { from: typeof primary; to: typeof primary }) => [
            pair.from,
            pair.to,
          ],
        ),
      ];
      for (const endpoint of endpoints) {
        const device = ir.devices.find(
          (d) => d.designation === endpoint.device,
        )!;
        const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
        const support = SYMBOL_PROFILES.find(
          (p) => p.id === type.symbol,
        )?.support.find(
          (s) => s.family === "signal-loop" && s.functions.length > 0,
        );
        if (!support) continue;
        for (const shape of support.functions) {
          const variant = structuredClone(ir);
          const variantType = variant.deviceTypes.find(
            (t) => t.id === type.id,
          )!;
          const old = variantType.functions.find(
            (f) => f.key === endpoint.function,
          )!;
          const declaration = {
            key: old.key,
            kind: shape.kind,
            terminalKeys: old.terminalKeys,
            source: old.source,
            ...(shape.kind === "channel"
              ? { direction: "input" as const }
              : {}),
            ...(shape.kind === "contact"
              ? { normal_state: "closed" as const }
              : {}),
          } as IrDeviceTypeFunction;
          variantType.functions[variantType.functions.indexOf(old)] =
            declaration;
          const replacement = materializeTypeFunctions(
            variantType,
            device.uid,
          ).find((f) => f.id.functionKey === old.key)!;
          const index = variant.functions.findIndex(
            (f) =>
              f.id.deviceUid === device.uid && f.id.functionKey === old.key,
          );
          variant.functions[index] = replacement;
          for (const flow of ["left-to-right", "top-to-bottom"] as const)
            expect(
              (await prepareSignalLoopDrawing(variant, { ...request, flow }))
                .content,
            ).toContain("<");
        }
      }
      const primaryDevice = ir.devices.find(
        (d) => d.designation === primary.device,
      )!;
      const type = ir.deviceTypes.find((t) => t.id === primaryDevice.typeId)!;
      for (const alias of SYMBOL_PROFILES.find((p) => p.id === type.symbol)!
        .aliases) {
        const aliasIr = structuredClone(ir);
        aliasIr.deviceTypes.find((t) => t.id === type.id)!.symbol = alias;
        expect(
          (await prepareSignalLoopDrawing(aliasIr, request)).content,
        ).toContain("<");
      }
    },
  );
});

describe("independent rooted profile contracts", () => {
  const families = ["power", "control", "loads"] as const;
  const normalized = (shape: import("@thermite/schema").SymbolFunctionShape) =>
    JSON.stringify([
      shape.kind,
      shape.minTerminals,
      shape.maxTerminals,
      shape.terminalRoles ?? [],
      shape.firstTerminalVoltageType ?? null,
    ]);
  it("pins every catalog family and function shape to the authored contract table", () => {
    const actual = SYMBOL_PROFILES.filter((p) =>
      p.support.some((s) =>
        families.includes(s.family as (typeof families)[number]),
      ),
    )
      .map((p) => p.id)
      .sort();
    expect(actual).toEqual(Object.keys(ROOTED_CONTRACTS).sort());
    for (const [profile, expected] of Object.entries(ROOTED_CONTRACTS))
      for (const family of families) {
        const functions = SYMBOL_PROFILES.find((p) => p.id === profile)!
          .support.filter((s) => s.family === family)
          .flatMap((s) => s.functions);
        expect(
          [...new Set(functions.map(normalized))].sort(),
          `${profile}/${family}`,
        ).toEqual(
          [...new Set(expected[family].map((c) => normalized(c.shape)))].sort(),
        );
      }
  });
  it("pins symbols, series traversal and boundaries independently of the catalog", () => {
    for (const [profile, expected] of Object.entries(ROOTED_CONTRACTS))
      for (const family of families)
        for (const contract of expected[family]) {
          const doc = contractType(profile, contract.mode),
            source = {
              file: "contract.json",
              line: 1,
              column: 1,
              jsonPointer: "",
            };
          const type = {
            kind: "device_type" as const,
            id: doc.id,
            symbol: doc.symbol,
            libraryName: "local",
            libraryVersion: "0.1.0",
            aliases: [],
            source,
            internalRelations: [],
            terminals: Object.entries(doc.terminals).map(([key, t]) => ({
              key,
              ...t,
              source,
            })),
            functions: Object.entries(doc.functions).map(([key, f]) => {
              const { terminals, ...facts } = f;
              return { key, ...facts, terminalKeys: terminals, source };
            }),
          } as IrDeviceType;
          const mapping = projectDeviceTypeSymbolMappings({
            ...core,
            deviceTypes: [type],
          })[0];
          const engineFamily = family === "loads" ? "control" : family;
          const bound = [
            ...(mapping?.functions ?? []).filter(
              (f) => f.functionKey === "function",
            ),
            ...(mapping?.aggregates ?? []).filter((f) =>
              f.functionKeys.includes("function"),
            ),
          ].filter((f) => f.families.includes(engineFamily));
          expect(bound, `${profile}/${family}/${contract.mode}`).toHaveLength(
            1,
          );
          expect(bound[0]).toMatchObject({
            symbolId: contract.symbol,
            traversalRole: contract.role,
          });
          expect(
            isFunctionTraversable(engineFamily, bound[0]!.traversalRole),
          ).toBe(contract.series);
          expect(
            mapping!.boundaryTerminals.map((b) => b.boundaryKind).sort(),
          ).toEqual([...contract.boundary].sort());
          expect(() =>
            validateDeviceTypeSymbolMappings(
              [type],
              [mapping!],
              SYMBOL_CATALOG,
            ),
          ).not.toThrow();
        }
  });
  for (const [profile, expected] of Object.entries(ROOTED_CONTRACTS))
    for (const family of families) {
      const contract = expected[family][0];
      if (!contract) continue;
      it(`${profile}/${family} reaches a real boundary in both flows`, async () => {
        const fixture = await contractProject(profile, contract.mode, family);
        try {
          for (const flow of ["left-to-right", "top-to-bottom"] as const) {
            const result = await renderSchematic(fixture.ir, {
              ...(fixture.request as object),
              flow,
            });
            expect(result.ok, JSON.stringify(result)).toBe(true);
            if (result.ok) {
              expect(result.value.summary.deviceUids).toContain(
                fixture.ir.devices.find((d) => d.designation === "DUT")!.uid,
              );
              if (contract.mode === "dc-source" && family === "control") {
                expect(result.value.svg).toContain("DUT.P");
                expect(result.value.svg).toContain("DUT.N");
              } else
                expect(result.value.svg).toContain(
                  `data-symbol-id="${contract.symbol}"`,
                );
            }
          }
        } finally {
          await fixture.dispose();
        }
      });
    }
});
