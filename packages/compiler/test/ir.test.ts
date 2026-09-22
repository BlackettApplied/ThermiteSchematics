import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  compareConductiveElementId,
  compareSourceRef,
  compileLoadedProject,
  compileProject,
  loadProject,
  serializeIr,
  type ElectricalIr,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const motorStarterRoot = join(repositoryRoot, "examples", "motor-starter");
const cliFixtureRoot = join(repositoryRoot, "packages", "cli", "fixtures");
const temporaryRoots: string[] = [];

let motorIr: ElectricalIr;
let motorBytes: string;

beforeAll(async () => {
  const compiled = await compileProject(motorStarterRoot);

  if (!compiled.ok) {
    throw new Error(
      `Motor-starter compilation failed: ${JSON.stringify(compiled.diagnostics)}`,
    );
  }

  motorIr = compiled.ir;
  motorBytes = serializeIr(compiled.ir);
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { recursive: true, force: true })),
  );
});

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, member]) => [key, reverseObjectKeys(member)]),
  );
}

function shuffleSetLikeArrays(ir: ElectricalIr): void {
  for (const key of [
    "libraries",
    "deviceTypes",
    "cableTypes",
    "devices",
    "terminals",
    "functions",
    "internalRelations",
    "gangedGroups",
    "wires",
    "jumpers",
    "cables",
    "cableConductors",
    "relations",
    "potentials",
    "nets",
  ] as const) {
    ir[key].reverse();
  }

  for (const library of ir.libraries) library.files.reverse();
  for (const type of ir.deviceTypes) {
    type.terminals.reverse();
    type.functions.reverse();
    type.internalRelations.reverse();
    for (const relation of type.internalRelations) {
      relation.sourceOrigins.reverse();
    }
  }
  for (const type of ir.cableTypes) type.conductors.reverse();
  for (const relation of ir.internalRelations) {
    relation.sourceOrigins.reverse();
  }
  for (const group of ir.gangedGroups) group.functionIds.reverse();
  for (const wire of ir.wires) wire.endpoints.reverse();
  for (const jumper of ir.jumpers) jumper.endpoints.reverse();
  for (const conductor of ir.cableConductors) conductor.endpoints.reverse();
  for (const net of ir.nets) {
    net.terminalIds.reverse();
    net.conductiveElementIds.reverse();
    net.potentialUids.reverse();
  }

  const indexes = ir.indexes;
  for (const value of Object.values(indexes)) value.reverse();
  for (const entry of indexes.terminalIdsByDeviceUid) entry.value.reverse();
  for (const entry of indexes.conductiveElementIdsByTerminal) {
    entry.value.reverse();
  }
  for (const entry of indexes.terminalIdsByConductiveElement) {
    entry.value.reverse();
  }
  for (const entry of indexes.conductorIdsByCableUid) entry.value.reverse();
  for (const entry of indexes.instanceRefsByTypeId) entry.value.reverse();
}

function withoutProvenanceAndFingerprints(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutProvenanceAndFingerprints);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "source",
            "manifestSource",
            "fromSource",
            "toSource",
            "terminalSource",
            "sourceOrigins",
            "integrity",
            "files",
          ].includes(key),
      )
      .map(([key, member]) => [key, withoutProvenanceAndFingerprints(member)]),
  );
}

async function copyValidFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "thermite-schematics-ir-"));
  temporaryRoots.push(root);
  const project = join(root, "valid project");
  await cp(join(cliFixtureRoot, "valid project"), project, { recursive: true });
  await cp(
    join(cliFixtureRoot, "shared library"),
    join(root, "shared library"),
    {
      recursive: true,
    },
  );
  return project;
}

describe("D9 electrical IR assembly and serialization", () => {
  it("assembles the complete JSON-safe table surface with dependency fingerprints", () => {
    expect(Object.keys(motorIr)).toEqual([
      "format",
      "project",
      "libraries",
      "deviceTypes",
      "cableTypes",
      "devices",
      "terminals",
      "functions",
      "internalRelations",
      "gangedGroups",
      "wires",
      "jumpers",
      "cables",
      "cableConductors",
      "relations",
      "potentials",
      "nets",
      "indexes",
    ]);
    expect(motorIr.format).toBe("electrical-ir/0.1");
    expect(motorIr.project).toMatchObject({
      name: "Motor Starter Reference System",
      source: { file: "system.json", jsonPointer: "/project" },
    });
    expect(motorIr.libraries[0]).toMatchObject({
      name: "core",
      version: "0.1.0",
      path: "ais-shipped:core@0.1.0",
      resolutionKind: "shipped",
      integrity: expect.stringMatching(/^sha256-/u),
      source: { file: "system.json", jsonPointer: "/libraries/0" },
      manifestSource: {
        file: "@thermite/core-library/library.json",
        jsonPointer: "",
      },
    });
    expect(motorIr.libraries[0]?.files[0]?.path).toBe("library.json");
    expect(JSON.parse(motorBytes)).toEqual(motorIr);
  });

  it("is byte-identical after table traversal, SourceRef, and object-key insertion order shuffles", () => {
    const shuffled = reverseObjectKeys(motorIr) as ElectricalIr;
    shuffleSetLikeArrays(shuffled);
    expect(serializeIr(shuffled)).toBe(motorBytes);
  });

  it("orders connectionPolicy explicitly in both terminal record tables", () => {
    const extended = structuredClone(motorIr);
    const plc = extended.devices.find(
      ({ designation }) => designation === "PLC1",
    );
    const plcTypeTerminal = extended.deviceTypes
      .find(({ id }) => id === "core:plc-compact")
      ?.terminals.find(({ key }) => key === "X1.0");
    const materializedTerminal = extended.terminals.find(
      ({ id }) => id.deviceUid === plc?.uid && id.terminalKey === "X1.0",
    );

    if (plcTypeTerminal === undefined || materializedTerminal === undefined) {
      throw new Error("Expected PLC X1.0 terminal records were not found.");
    }

    plcTypeTerminal.description = "field-order sentinel";
    materializedTerminal.description = "field-order sentinel";
    const serialized = JSON.parse(serializeIr(extended)) as ElectricalIr;
    const serializedTypeTerminal = serialized.deviceTypes
      .find(({ id }) => id === "core:plc-compact")
      ?.terminals.find(({ key }) => key === "X1.0");
    const serializedTerminal = serialized.terminals.find(
      ({ id }) => id.deviceUid === plc?.uid && id.terminalKey === "X1.0",
    );

    expect(Object.keys(serializedTypeTerminal ?? {})).toEqual([
      "key",
      "role",
      "rating",
      "connectionPolicy",
      "description",
      "source",
    ]);
    expect(Object.keys(serializedTerminal ?? {})).toEqual([
      "id",
      "role",
      "rating",
      "connectionPolicy",
      "description",
      "source",
    ]);
  });

  it("writes integer-like and __proto__ fallback keys in code-unit order", () => {
    const extended = structuredClone(motorIr) as ElectricalIr & {
      project: ElectricalIr["project"] & Record<string, unknown>;
    };
    Object.defineProperties(extended.project, {
      "2": { value: "two", enumerable: true },
      "10": { value: "ten", enumerable: true },
    });
    Object.defineProperty(extended.project, "__proto__", {
      value: "prototype-safe",
      enumerable: true,
    });

    const lines = serializeIr(extended).split("\n");
    expect(
      lines.filter((line) => /^    "(?:10|2|__proto__)": /u.test(line)),
    ).toEqual([
      '    "10": "ten",',
      '    "2": "two",',
      '    "__proto__": "prototype-safe"',
    ]);
  });

  it("uses the frozen SourceRef tuple and conductive structural comparators", () => {
    const sources = [
      { file: "b", line: 1, column: 1, jsonPointer: "" },
      { file: "a", line: 2, column: 1, jsonPointer: "" },
      { file: "a", line: 1, column: 2, jsonPointer: "" },
      { file: "a", line: 1, column: 1, jsonPointer: "/z" },
      { file: "a", line: 1, column: 1, jsonPointer: "/a" },
    ].sort(compareSourceRef);
    expect(sources).toEqual([
      { file: "a", line: 1, column: 1, jsonPointer: "/a" },
      { file: "a", line: 1, column: 1, jsonPointer: "/z" },
      { file: "a", line: 1, column: 2, jsonPointer: "" },
      { file: "a", line: 2, column: 1, jsonPointer: "" },
      { file: "b", line: 1, column: 1, jsonPointer: "" },
    ]);
    expect(
      [
        { kind: "cable_conductor" as const, cableUid: "a", conductorId: "1" },
        { kind: "jumper" as const, uid: "a" },
        { kind: "wire" as const, uid: "z" },
      ].sort(compareConductiveElementId),
    ).toEqual([
      { kind: "wire", uid: "z" },
      { kind: "jumper", uid: "a" },
      { kind: "cable_conductor", cableUid: "a", conductorId: "1" },
    ]);
  });

  it("emits two-space LF JSON with exactly one final newline and no machine paths or timestamps", () => {
    expect(motorBytes.endsWith("\n")).toBe(true);
    expect(motorBytes.endsWith("\n\n")).toBe(false);
    expect(motorBytes).not.toContain("\r");
    expect(motorBytes).toContain('\n  "project": {\n');
    expect(motorBytes).not.toContain(repositoryRoot);
    expect(motorBytes).not.toMatch(/[A-Za-z]:\\/u);

    const files: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, member] of Object.entries(value)) {
          expect(key.toLowerCase()).not.toContain("timestamp");
          if (key === "file" && typeof member === "string") files.push(member);
          walk(member);
        }
      }
    };
    walk(JSON.parse(motorBytes));
    expect(
      files.every((file) => !posix.isAbsolute(file) && !win32.isAbsolute(file)),
    ).toBe(true);
  });

  it("produces identical repeated compile bytes and keeps compileLoadedProject synchronous", async () => {
    const loaded = await loadProject(motorStarterRoot);
    if (!loaded.ok) throw new Error("motor-starter failed structural loading");

    const direct = compileLoadedProject(loaded.project);
    const repeated = await compileProject(motorStarterRoot);
    expect(direct).not.toBeInstanceOf(Promise);
    expect(direct.ok).toBe(true);
    expect(repeated.ok).toBe(true);
    if (!direct.ok || !repeated.ok) return;
    expect(serializeIr(direct.ir)).toBe(motorBytes);
    expect(serializeIr(repeated.ir)).toBe(motorBytes);
  });

  it("retains optional potential metadata in the final IR", async () => {
    const loaded = await loadProject(motorStarterRoot);
    if (!loaded.ok) throw new Error("motor-starter failed structural loading");
    const changed = structuredClone(loaded.project);
    const potential = changed.sources
      .flatMap(({ value }) => value.objects)
      .find((object) => object.kind === "potential");
    if (potential?.kind !== "potential") throw new Error("potential not found");
    potential.designation = "POT-1";
    potential.description = "authored declaration";
    potential.aliases = ["SUPPLY"];

    const compiled = compileLoadedProject(changed);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(
      compiled.ir.potentials.find(({ uid }) => uid === potential.uid),
    ).toMatchObject({
      designation: "POT-1",
      description: "authored declaration",
      aliases: ["SUPPLY"],
    });
  });

  it("keeps semantic tables equal across authored file/object/key reordering after excluding provenance and fingerprints", async () => {
    const project = await copyValidFixture();
    const sourcePath = join(project, "sources", "devices.json");
    const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
      objects: unknown[];
    };
    source.objects.push({
      uid: "22222222-2222-4222-8222-222222222222",
      kind: "device",
      designation: "K2",
      type: "mini:relay",
    });
    await writeFile(
      sourcePath,
      `${JSON.stringify(source, undefined, 2)}\n`,
      "utf8",
    );
    const baseline = await compileProject(project);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;

    const reorderedObjects = source.objects.map(reverseObjectKeys).reverse();
    await writeFile(
      sourcePath,
      `${JSON.stringify({ objects: [reorderedObjects[0]] }, undefined, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(project, "sources", "z-reordered.json"),
      `${JSON.stringify({ objects: [reorderedObjects[1]] }, undefined, 2)}\n`,
      "utf8",
    );
    const reordered = await compileProject(project);
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;

    expect(withoutProvenanceAndFingerprints(reordered.ir)).toEqual(
      withoutProvenanceAndFingerprints(baseline.ir),
    );
  });
});

describe("D3 compiler failure gating", () => {
  it("returns no IR for a missing lock before library-backed semantic stages", async () => {
    const project = await copyValidFixture();
    await rm(join(project, "electrical-system.lock.json"));
    const sourcePath = join(project, "sources", "devices.json");
    const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
      objects: Array<{ type?: string }>;
    };
    source.objects[0]!.type = "mini:missing";
    await writeFile(sourcePath, `${JSON.stringify(source, undefined, 2)}\n`);
    const compiled = await compileProject(project);
    expect(compiled).toMatchObject({
      ok: false,
      toolFailure: false,
      diagnostics: [{ code: "E105" }],
    });
    expect(compiled.diagnostics.map(({ code }) => code)).toEqual(["E105"]);
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
  });

  it("returns no partial IR for semantic reference errors", async () => {
    const project = await copyValidFixture();
    const sourcePath = join(project, "sources", "devices.json");
    const source = JSON.parse(await readFile(sourcePath, "utf8")) as {
      objects: Array<{ type?: string }>;
    };
    source.objects[0]!.type = "mini:missing";
    await writeFile(sourcePath, `${JSON.stringify(source, undefined, 2)}\n`);

    const compiled = await compileProject(project);
    expect(compiled).toMatchObject({
      ok: false,
      toolFailure: false,
      diagnostics: [{ code: "E103" }],
    });
    expect(Object.hasOwn(compiled, "ir")).toBe(false);
  });
});
