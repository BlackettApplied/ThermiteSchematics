import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_SYMBOL_BINDINGS,
  SYMBOL_PROFILES,
  type ValidatedDeviceType,
} from "@thermite/schema";
import {
  compileProject,
  loadProject,
  symbolFunctionMatchesShape,
  writeLibraryLock,
  type CompileResult,
} from "../src/index.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

async function plc(): Promise<ValidatedDeviceType> {
  return JSON.parse(
    await readFile(
      join(repo, "packages/core-library/library/types/plc-compact.json"),
      "utf8",
    ),
  ).types[0];
}

async function project(type: ValidatedDeviceType, bytes?: string) {
  const root = await mkdtemp(join(tmpdir(), "thermite-symbol-profile-"));
  temporary.push(root);
  await cp(
    join(repo, "packages/compiler/fixtures/rules/invalid-circuit-symbol"),
    root,
    { recursive: true },
  );
  // Keep the CO clone identical apart from its id; the fixture library uses its namespace.
  const namespace = type.id.split(":")[0]!;
  await writeFile(
    join(root, "library/library.json"),
    JSON.stringify({
      name: namespace,
      version: "0.1.0",
      sources: ["types/*.json"],
    }),
  );
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "profile regression" },
      sources: ["sources/*.json"],
      libraries: [{ name: namespace, version: "0.1.0", path: "library" }],
    }),
  );
  await writeFile(
    join(root, "library/types/module.json"),
    bytes ?? JSON.stringify({ types: [type] }, null, 2) + "\n",
  );
  await writeFile(
    join(root, "sources/objects.json"),
    JSON.stringify({
      objects: [
        {
          uid: "ce33b8c4-b8b2-42ae-a39b-34f06a8312d6",
          kind: "device",
          designation: "PLC1",
          type: type.id,
        },
      ],
    }),
  );
  const loaded = await loadProject(root);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
  await writeLibraryLock(loaded.project);
  return root;
}

describe("validate-time symbol profile warnings", () => {
  it.each([
    "CO byte-identical clone",
    "PU analog PLC",
    "bogus symbol",
    "wrong function shape",
  ])("warns before drawing: %s", async (scenario) => {
    const type = await plc();
    type.id = scenario.startsWith("CO")
      ? "site:plc-clone"
      : "pump:plc-compact-analog";
    if (scenario.startsWith("PU")) {
      type.terminals["AI+"] = {};
      type.terminals["AI-"] = {};
      type.functions.ai0 = {
        kind: "channel",
        direction: "input",
        terminals: ["AI+", "AI-"],
      };
    }
    if (scenario === "bogus symbol") type.symbol = "thermite:controller";
    if (scenario === "wrong function shape")
      type.symbol = "thermite:pushbutton";
    const original = await readFile(
      join(repo, "packages/core-library/library/types/plc-compact.json"),
      "utf8",
    );
    const root = await project(
      type,
      scenario.startsWith("CO")
        ? original.replace("core:plc-compact", type.id)
        : undefined,
    );
    if (scenario.startsWith("CO"))
      expect(
        (
          await readFile(join(root, "library/types/module.json"), "utf8")
        ).replace(type.id, "core:plc-compact"),
      ).toBe(original);
    const result = await compileProject(root);
    expect(result.ok).toBe(true);
    const warnings = result.diagnostics.filter((d) => d.code === "W111");
    if (scenario.startsWith("CO") || scenario.startsWith("PU")) {
      expect(warnings).toEqual([]);
      return;
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      severity: "warning",
      file: "library/types/module.json",
      jsonPointer: "/types/0/symbol",
    });
    expect(warnings[0]!.message).toContain("PLC1");
    expect(warnings[0]!.message).toContain(type.id);
    expect(warnings[0]!.message).toContain(type.symbol);
    expect(warnings[0]!.message).toContain(
      scenario.startsWith("CO") || scenario.startsWith("PU")
        ? "thermite:io-module"
        : "Supported profiles by family",
    );
    const lines = (
      await readFile(join(root, "library/types/module.json"), "utf8")
    ).split("\n");
    const line = lines.findIndex((s) => s.includes('"symbol":'));
    expect(warnings[0]).toMatchObject({
      line: line + 1,
      column: lines[line]!.indexOf(JSON.stringify(type.symbol)) + 1,
    });
    if (scenario === "wrong function shape")
      expect(warnings[0]!.message).toContain(
        'Functions with no cataloged family: "di0" (channel/1), "di1" (channel/1), "do0" (channel/1), "do1" (channel/1), "supply" (load/2).',
      );
    expect((await compileProject(root)).diagnostics).toEqual(
      result.diagnostics,
    );
  });

  it.each(["iec:pushbutton-no", "site:unknown"])(
    "points %s to the supported catalog without inventing an equivalent",
    async (symbol) => {
      const type = await plc();
      type.id = "site:custom";
      type.symbol = symbol;
      const result = await compileProject(await project(type));
      expect(result.ok).toBe(true);
      expect(result.diagnostics.filter((d) => d.code === "W111")).toMatchObject(
        [
          {
            message: expect.stringContaining(
              'circuit: ["thermite:sensor-3wire", "thermite:contactor"]',
            ),
          },
        ],
      );
    },
  );

  it("groups all placed designations deterministically at one type symbol pointer", async () => {
    const type = await plc();
    type.symbol = "site:unknown";
    type.id = "site:clone";
    const root = await project(type);
    const objects = ["Z1", "A1"].map((designation) => ({
      kind: "device",
      designation,
      type: type.id,
      uid: randomUUID(),
    }));
    const source = join(root, "sources/objects.json");
    await writeFile(source, JSON.stringify({ objects }));
    const first = await compileProject(root);
    await writeFile(source, JSON.stringify({ objects: objects.reverse() }));
    expect((await compileProject(root)).diagnostics).toEqual(first.diagnostics);
    expect(first.diagnostics.filter((d) => d.code === "W111")).toMatchObject([
      { message: expect.stringContaining('Devices "A1", "Z1"') },
    ]);
  });

  it.each([undefined, "thermite:io-module"])(
    "keeps absent and compatible symbols clean (%s)",
    async (symbol) => {
      const type = await plc();
      type.id = "site:custom";
      if (symbol) type.symbol = symbol;
      else delete type.symbol;
      assertClean(await compileProject(await project(type)), "local PLC");
    },
  );

  it("does not warn on unused library types", async () => {
    const type = await plc();
    type.id = "site:unused";
    const root = await project(type);
    await writeFile(
      join(root, "sources/objects.json"),
      JSON.stringify({ objects: [] }),
    );
    assertClean(await compileProject(root), "unused library type");
  });

  it("returns W111 from the validate CLI with successful exit status", async () => {
    const type = await plc();
    type.symbol = "site:unknown";
    type.id = "site:cli-clone";
    const root = await project(type);
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [join(repo, "thermite.mjs"), "validate", root, "--json"],
      { cwd: repo },
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject([
      {
        code: "W111",
        severity: "warning",
        message: expect.stringContaining("Supported profiles by family"),
      },
    ]);
  });

  it("warns when a known terminal-only profile cannot fit its renderer role", async () => {
    const type: ValidatedDeviceType = {
      kind: "device_type",
      id: "site:one-pin",
      symbol: "thermite:bulkhead-connector",
      terminals: { "1": {} },
      functions: {},
    };
    const result = await compileProject(await project(type));
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === "W111")).toMatchObject([
      {
        message: expect.stringContaining(
          "signal-loop/intermediate needs at least 2 type terminals",
        ),
      },
    ]);
  });

  it("honors explicit circuitSymbols on a known profile", async () => {
    const type = await plc();
    type.id = "site:explicit";
    type.symbol = "thermite:pushbutton";
    type.circuitSymbols = {
      supply: "load",
      di0: "interface",
      di1: "interface",
      do0: "interface",
      do1: "interface",
    };
    assertClean(
      await compileProject(await project(type)),
      "explicit circuit mark",
    );
  });
});

function assertClean(result: CompileResult, label: string) {
  expect(result.ok, `${label}: ${JSON.stringify(result.diagnostics)}`).toBe(
    true,
  );
  expect(
    result.diagnostics.filter((d) => d.code === "W111"),
    label,
  ).toEqual([]);
}

describe("profile clone conformance", () => {
  it("accepts the complete source-backed PLC alias regression fixture", async () => {
    const root = join(
      repo,
      "packages/compiler/fixtures/rules/symbol-profile-clone",
    );
    const result = await compileProject(root);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual(
      JSON.parse(await readFile(join(root, "expected.json"), "utf8")),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("pins W111 to the source-backed incompatible IEC alias fixture", async () => {
    const root = join(
      repo,
      "packages/compiler/fixtures/rules/symbol-profile-incompatible",
    );
    const result = await compileProject(root);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual(
      JSON.parse(await readFile(join(root, "expected.json"), "utf8")),
    );
    expect(result.diagnostics).toMatchObject([
      {
        code: "W111",
        severity: "warning",
        file: "library/types/plc.json",
        jsonPointer: "/types/0/symbol",
      },
    ]);
  });

  it.each(["site:custom-relay", "iec:contactor", "thermite:pushbutton"])(
    "does not let one explicit mark hide unmarked functions (%s)",
    async (symbol) => {
      const type: ValidatedDeviceType = {
        kind: "device_type",
        id: "site:partial-explicit",
        symbol,
        terminals: { "1": {}, "2": {}, "3": {} },
        functions: {
          good: { kind: "coil", terminals: ["1", "2"] },
          bad: { kind: "other", terminals: ["1", "2", "3"] },
        },
        circuitSymbols: { good: "coil" },
      };
      const result = await compileProject(await project(type));
      expect(result.ok).toBe(true);
      expect(result.diagnostics.filter((d) => d.code === "W111")).toHaveLength(
        1,
      );
      const message = result.diagnostics.find(
        (d) => d.code === "W111",
      )!.message;
      expect(message).toContain(
        symbol !== "site:custom-relay"
          ? 'Functions with no cataloged family: "bad" (other/3).'
          : "1 of 2 functions lack cataloged family support",
      );
      expect(message).not.toContain('"good" (coil/2)');
    },
  );
  it.each(["site:custom-symbol", "iec:contactor", "thermite:pushbutton"])(
    "accepts complete explicit circuit marks independently of %s",
    async (symbol) => {
      const type: ValidatedDeviceType = {
        kind: "device_type",
        id: "site:explicit-relay",
        symbol,
        terminals: { A1: {}, A2: {}, "13": {}, "14": {} },
        functions: {
          coil: { kind: "coil", terminals: ["A1", "A2"] },
          c: { kind: "contact", normal_state: "open", terminals: ["13", "14"] },
        },
        circuitSymbols: { coil: "coil", c: "contact-no" },
      };
      const result = await compileProject(await project(type));
      expect(result.ok).toBe(true);
      expect(result.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
    },
  );

  it.each([
    ["thermite:pushbutton", "lamp", "load", 2],
    ["thermite:io-module", "common", "bus", 4],
    ["thermite:motor-3ph", "thermistor", "other", 2],
  ] as const)(
    "names the unfit %s function %s",
    async (symbol, key, kind, count) => {
      const type: ValidatedDeviceType = {
        kind: "device_type",
        id: "site:partial",
        symbol,
        terminals: { "1": {}, "2": {}, "3": {}, "4": {} },
        functions: {
          good: { kind: "bus", terminals: ["1"] },
          [key]: {
            kind,
            terminals: Array.from({ length: count }, (_, i) => String(i + 1)),
          },
        },
      };
      const result = await compileProject(await project(type));
      expect(result.ok).toBe(true);
      expect(result.diagnostics.filter((d) => d.code === "W111")).toMatchObject(
        [{ message: expect.stringContaining(`"${key}" (${kind}/${count})`) }],
      );
    },
  );

  it("caps naturally sorted device names independent of input order", async () => {
    const type = await plc();
    type.id = "site:many";
    type.symbol = "site:unknown";
    const root = await project(type);
    const objects = Array.from({ length: 15 }, (_, i) => ({
      kind: "device",
      type: type.id,
      uid: randomUUID(),
      designation: `X${15 - i}`,
    }));
    const path = join(root, "sources/objects.json");
    await writeFile(path, JSON.stringify({ objects }));
    const first = await compileProject(root);
    await writeFile(path, JSON.stringify({ objects: objects.reverse() }));
    expect((await compileProject(root)).diagnostics).toEqual(first.diagnostics);
    const warnings = first.diagnostics.filter((d) => d.code === "W111");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain(
      'Devices "X1", "X2", "X3", "X4", "X5", "X6", "X7", "X8", "X9", "X10" and 5 more',
    );
    expect(warnings[0]!.message).not.toContain('"X11"');
  });

  it("accepts a cloned motor through its IEC profile alias", async () => {
    const type: ValidatedDeviceType = JSON.parse(
      await readFile(
        join(repo, "packages/core-library/library/types/motor-3ph.json"),
        "utf8",
      ),
    ).types[0];
    type.id = "site:motor";
    const result = await compileProject(await project(type));
    expect(result.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
  });

  it("groups circuit/rooted replacements apart from signal-loop-only profiles", async () => {
    const type = await plc();
    type.id = "site:bogus";
    type.symbol = "site:unknown";
    const result = await compileProject(await project(type));
    const warning = result.diagnostics.find((d) => d.code === "W111")!;
    expect(warning.message).toContain(
      'circuit: ["thermite:sensor-3wire", "thermite:contactor"]',
    );
    expect(warning.message).toContain(
      'rooted power: ["thermite:contactor", "thermite:breaker"]',
    );
    expect(warning.message).toContain(
      'signal-loop only (not circuit or rooted): ["thermite:pressure-transmitter", "thermite:analog-actuator"] and 1 more',
    );
  });
});

async function projectsBelow(relative: string) {
  return (await readdir(join(repo, relative), { recursive: true }))
    .filter((p) => basename(p) === "system.json")
    .sort()
    .map((p) => join(repo, relative, p));
}

describe("profile alternatives and message bounds", () => {
  it("uses T2 fields for complete alternatives and quotes only ten profile IDs", async () => {
    const type = await plc();
    type.id = "site:alternatives";
    type.symbol = "site:unknown";
    const result = await compileProject(await project(type));
    const warning = result.diagnostics.find((d) => d.code === "W111")!;
    expect(warning.allowed).toEqual(SYMBOL_PROFILES.map((p) => p.id));
    expect(warning.allowedCount).toBe(27);
    expect(warning.allowedLookup).toContain(
      "thermite validate <project> --json",
    );
    const prose = warning.message.split("Supported profiles by family:")[1]!;
    expect([...prose.matchAll(/"thermite:[^"]+"/gu)]).toHaveLength(10);
    expect(prose).toContain("and 22 more");
  });

  it("retains a single structured equivalent for an incompatible IEC alias", async () => {
    const type = await plc();
    type.id = "site:equivalent";
    type.functions.bad = { kind: "bus", terminals: ["L+", "M"] };
    const result = await compileProject(await project(type));
    expect(result.diagnostics.find((d) => d.code === "W111")).toMatchObject({
      allowed: ["thermite:io-module"],
      allowedCount: 1,
      allowedLookup: expect.stringContaining("validate"),
    });
  });
  it.each(["thermite:terminal-strip", "thermite:bulkhead-connector"])(
    "keeps %s auxiliary support specific to other/2",
    async (symbol) => {
      for (const kind of ["contact", "bus", "other"] as const) {
        const type: ValidatedDeviceType = {
          kind: "device_type",
          id: "site:auxiliary",
          symbol,
          terminals: { "1": {}, "2": {} },
          functions: {
            aux: {
              kind,
              terminals: ["1", "2"],
              ...(kind === "contact"
                ? { normal_state: "closed" as const }
                : {}),
            },
          },
        };
        const result = await compileProject(await project(type));
        expect(result.ok).toBe(true);
        expect(
          result.diagnostics.filter((d) => d.code === "W111"),
          kind,
        ).toHaveLength(kind === "other" ? 0 : 1);
        if (kind !== "other") {
          type.circuitSymbols =
            kind === "contact" ? { aux: "fuse" } : undefined;
          if (kind === "contact")
            assertClean(
              await compileProject(await project(type)),
              "explicit fuse mark",
            );
        }
      }
    },
  );

  it("repairs an illuminated pushbutton with an explicit mark before suggesting profile changes", async () => {
    const type: ValidatedDeviceType = {
      kind: "device_type",
      id: "site:illuminated",
      symbol: "thermite:pushbutton",
      terminals: { "1": {}, "2": {}, A1: {}, A2: {} },
      functions: {
        button: {
          kind: "contact",
          normal_state: "open",
          terminals: ["1", "2"],
        },
        lamp: { kind: "load", terminals: ["A1", "A2"] },
      },
    };
    const result = await compileProject(await project(type));
    const warning = result.diagnostics.find((d) => d.code === "W111")!;
    expect(warning.message).toContain('"lamp" (load/2)');
    expect(warning.message).toContain(
      "explicit circuitSymbols mark (E206 checks it)",
    );
    expect(warning.message).toContain("separate device type");
    expect(warning.message).not.toContain("Supported profiles by family");
    expect(warning.message).not.toContain("unsupported symbol metadata");
    type.circuitSymbols = { lamp: "lamp" };
    assertClean(
      await compileProject(await project(type)),
      "illuminated pushbutton mark",
    );
  });

  it("caps naturally sorted function names while keeping the complete source intact", async () => {
    const type: ValidatedDeviceType = {
      kind: "device_type",
      id: "site:many-functions",
      symbol: "thermite:pushbutton",
      terminals: { "1": {}, "2": {} },
      functions: {
        good: { kind: "contact", normal_state: "open", terminals: ["1", "2"] },
        ...Object.fromEntries(
          Array.from({ length: 15 }, (_, i) => [
            `di${14 - i}`,
            { kind: "load" as const, terminals: ["1", "2"] },
          ]),
        ),
      },
    };
    const first = await compileProject(await project(type));
    const message = first.diagnostics.find((d) => d.code === "W111")!.message;
    expect(message).toContain('"di0" (load/2), "di1" (load/2), "di2" (load/2)');
    expect(message).toContain('"di9" (load/2) and 5 more');
    expect(message).not.toContain('"di10"');
    type.functions = Object.fromEntries(
      Object.entries(type.functions).reverse(),
    );
    expect(
      (await compileProject(await project(type))).diagnostics.find(
        (d) => d.code === "W111",
      )!.message,
    ).toBe(message);
  });

  it.each(["iec:plc", "site:unknown"])(
    "summarizes large unfit function sets for %s",
    async (symbol) => {
      const type = await plc();
      type.id = "site:large-plc";
      type.symbol = symbol;
      for (let i = 2; i < 32; i++) {
        type.terminals[`DI${i}`] = {};
        type.functions[`di${i}`] = {
          kind: "channel",
          direction: "input",
          terminals: [`DI${i}`],
        };
      }
      const result = await compileProject(await project(type));
      if (symbol === "iec:plc") {
        expect(result.diagnostics.filter((d) => d.code === "W111")).toEqual([]);
        return;
      }
      const warning = result.diagnostics.find((d) => d.code === "W111")!;
      expect(warning.message).toContain("None of 35 functions");
      expect(warning.message).not.toContain('"di0"');
      expect(warning.message.length).toBeLessThan(800);
      expect(warning.allowedCount).toBe(warning.allowed!.length);
      expect(warning.allowedLookup).toContain("validate");
    },
  );
});

describe("zero new diagnostics across repository authoring inputs", () => {
  it("validates every example and pilot-library example", async () => {
    const examples = await projectsBelow("examples");
    const pilots = await projectsBelow("libraries");
    expect(examples.length).toBeGreaterThan(0);
    expect(pilots.length).toBeGreaterThan(0);
    // These are read-only, independent projects. Overlap filesystem work in
    // pairs while retaining every compile and every diagnostic assertion.
    const paths = [...examples, ...pilots];
    for (let index = 0; index < paths.length; index += 2)
      await Promise.all(
        paths
          .slice(index, index + 2)
          .map(async (path) => assertClean(await compileProject(path), path)),
      );
  });

  it.each(["starter", "cabinets"])(
    "validates the actual init --template %s output",
    async (template) => {
      const root = await mkdtemp(join(tmpdir(), "thermite-profile-init-"));
      temporary.push(root);
      const target = join(root, "project");
      await promisify(execFile)(
        process.execPath,
        [join(repo, "thermite.mjs"), "init", target, "--template", template],
        { cwd: repo },
      );
      assertClean(await compileProject(target), template);
    },
  );

  it.each(["0.1.0", "0.2.0"])(
    "places and validates every device type in every optional/pilot library and core %s",
    async (version) => {
      const root = await mkdtemp(join(tmpdir(), "thermite-profile-libraries-"));
      temporary.push(root);
      const entries = (
        await readdir(join(repo, "libraries"), { withFileTypes: true })
      ).filter((e) => e.isDirectory());
      const libraries = [];
      for (const entry of entries) {
        const path = join(root, entry.name);
        await cp(join(repo, "libraries", entry.name), path, {
          recursive: true,
          filter: (p) => !p.split(/[\\/]/u).includes("examples"),
        });
        const manifest = JSON.parse(
          await readFile(join(path, "library.json"), "utf8"),
        );
        libraries.push({
          name: manifest.name,
          version: manifest.version,
          path: entry.name,
        });
      }
      await cp(
        join(
          repo,
          version === "0.1.0"
            ? "packages/core-library/library"
            : "packages/core-library/versions/0.2.0",
        ),
        join(root, "core"),
        {
          recursive: true,
        },
      );
      libraries.push({ name: "core", version, path: "core" });
      await writeFile(
        join(root, "system.json"),
        JSON.stringify({
          format: "electrical-system/0.1",
          project: { name: "all library types" },
          sources: ["devices.json"],
          libraries,
        }),
      );
      await writeFile(
        join(root, "devices.json"),
        JSON.stringify({ objects: [] }),
      );
      const loaded = await loadProject(root);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.diagnostics));
      const types = loaded.project.libraries
        .flatMap((l) => l.sources.flatMap((s) => s.value.types))
        .filter((t) => t.kind === "device_type");
      expect(types.length).toBeGreaterThan(200);
      const unfit: string[] = [];
      let profiledTypes = 0,
        profiledFunctions = 0;
      for (const type of types) {
        if (
          CORE_SYMBOL_BINDINGS.some((b) => b.typeId === type.id) &&
          !type.symbol?.startsWith("thermite:")
        )
          continue;
        const profile = SYMBOL_PROFILES.find(
          (p) => p.id === type.symbol || p.aliases.includes(type.symbol ?? ""),
        );
        if (!profile) continue;
        profiledTypes++;
        for (const [key, fn] of Object.entries(type.functions)) {
          profiledFunctions++;
          if (
            fn.kind === "mechanism" ||
            Object.hasOwn(type.circuitSymbols ?? {}, key)
          )
            continue;
          if (
            !profile.support.some((s) =>
              s.functions.some((shape) =>
                symbolFunctionMatchesShape(type, fn, shape),
              ),
            )
          )
            unfit.push(`${type.id}/${key}`);
        }
      }
      // Includes the review's 111 types/952 functions and root-file optional models.
      expect(profiledTypes).toBeGreaterThanOrEqual(111);
      expect(profiledFunctions).toBeGreaterThanOrEqual(952);
      expect(unfit).toEqual([]);
      await writeFile(
        join(root, "devices.json"),
        JSON.stringify({
          objects: types.map((type, i) => ({
            kind: "device",
            uid: randomUUID(),
            designation: `D${i}`,
            type: type.id,
          })),
        }),
      );
      const withDevices = await loadProject(root);
      if (!withDevices.ok)
        throw new Error(JSON.stringify(withDevices.diagnostics));
      await writeLibraryLock(withDevices.project);
      assertClean(await compileProject(root), "every placed library type");
    },
  );

  it("keeps compiler and schema independent of render", async () => {
    for (const directory of ["packages/compiler/src", "packages/schema/src"]) {
      for (const path of (
        await readdir(join(repo, directory), { recursive: true })
      ).filter((p) => p.endsWith(".ts"))) {
        expect(
          await readFile(join(repo, directory, path), "utf8"),
          path,
        ).not.toMatch(
          /(?:from\s+|import\s*\()["'][^"']*(?:@thermite\/render|\/render\/)/u,
        );
      }
    }
  });
});

describe("sensor role warning truth", () => {
  it.each([
    "prox-one-role",
    "prox-two-positive",
    "prox-0v-first",
    "prox-return-first",
    "prox-dc_negative-first",
  ])(
    "warns before drawing %s without suggesting a no-op alias",
    async (name) => {
      const type = JSON.parse(
        await readFile(
          join(
            repo,
            "packages/render/test/fixtures/profile-binding",
            `${name}.json`,
          ),
          "utf8",
        ),
      ).types[0];
      const result = await compileProject(await project(type));
      expect(result.ok).toBe(true);
      const warning = result.diagnostics.find((d) => d.code === "W111")!;
      expect(warning).toBeDefined();
      expect(warning.message).toContain("supply");
      expect(warning.message).toContain("supply_positive");
      expect(warning.message).toContain("supply_return");
      expect(warning.message).not.toContain("circuitSymbols");
      expect(warning.message).not.toContain("Declared functions fit");
      for (const key of type.functions.supply.terminals)
        expect(warning.message).toContain(type.terminals[key].role);
      expect(warning.message).not.toContain('Use "thermite:sensor-3wire"');
    },
  );
  it("quotes only actual circuit support for an incomplete sensor", async () => {
    const type: ValidatedDeviceType = {
      kind: "device_type",
      id: "local:incomplete-sensor",
      symbol: "iec:proximity-sensor",
      terminals: { p: {}, r: {}, q: {}, z: {} },
      functions: {
        supply: { kind: "load", terminals: ["p", "r"] },
        input: { kind: "channel", direction: "input", terminals: ["q"] },
        bad: { kind: "bus", terminals: ["q", "z"] },
      },
    };
    const result = await compileProject(await project(type));
    const warning = result.diagnostics.find((d) => d.code === "W111")!;
    expect(warning.message).toContain("circuit");
    expect(warning.message).toContain(
      "No rooted power/control/loads function binding fits",
    );
    expect(warning.message).not.toContain('Use "thermite:sensor-3wire"');
  });
  it("bounds and naturally sorts invalid sensor supply role advice", async () => {
    const type = JSON.parse(
      await readFile(
        join(
          repo,
          "packages/render/test/fixtures/profile-binding/prox-one-role.json",
        ),
        "utf8",
      ),
    ).types[0];
    const load = type.functions.supply;
    delete type.functions.supply;
    type.internal_relations = [];
    for (let i = 12; i >= 1; i--) type.functions[`supply${i}`] = load;
    const first = await compileProject(await project(type));
    const message = first.diagnostics.find((d) => d.code === "W111")!.message;
    expect(message).toContain("2 more invalid supplies");
    expect(message).not.toContain('"supply11"');
    type.functions = Object.fromEntries(
      Object.entries(type.functions).reverse(),
    );
    const second = await compileProject(await project(type));
    expect(second.diagnostics.find((d) => d.code === "W111")!.message).toBe(
      message,
    );
  });
  it("explains the unfit IEC PLC function and pluralizes a single function", async () => {
    const type = await plc();
    type.id = "local:bad-plc";
    type.functions.bad = { kind: "bus", terminals: ["L+", "M"] };
    const result = await compileProject(await project(type));
    const message = result.diagnostics.find((d) => d.code === "W111")!.message;
    expect(message).toContain('"bad" (bus/2)');
    expect(message).not.toContain('Use "thermite:io-module"');
    expect(message).not.toContain("1 functions");
  });
  it("uses singular wording for an unknown profile with one function", async () => {
    const type: ValidatedDeviceType = {
      kind: "device_type",
      id: "site:unknown-switch",
      symbol: "site:unknown-switch",
      terminals: { "1": {}, "2": {} },
      functions: {
        contact: {
          kind: "contact",
          normal_state: "open",
          terminals: ["1", "2"],
        },
      },
    };
    const result = await compileProject(await project(type));
    expect(result.ok).toBe(true);
    const message = result.diagnostics.find((d) => d.code === "W111")!.message;
    expect(message).toContain(
      "The declared function has no cataloged family support.",
    );
    expect(message).not.toContain("1 functions");
  });
});
