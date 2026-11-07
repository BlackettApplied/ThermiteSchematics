import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Diagnostic } from "@thermite/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  SHIPPED_CORE_FILE_INVENTORY,
  SHIPPED_CORE_VERSIONS,
  compileProject,
  lockProject,
  resolveShippedCoreLibrary,
} from "../src/index.js";
import { openableLibraryFile } from "../src/library-location.js";

// Seeded authoring mistakes must name the valid alternatives (scorecard P-diag)
// without changing the code, severity, pointer, or location of the diagnostic.

const schemaRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../schema/schemas",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const uid = (index: number): string =>
  `7e000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

type Json = Record<string, unknown>;

function relayType(id = "repair:relay"): Json {
  return {
    kind: "device_type",
    id,
    description: "Relay",
    terminals: { A1: {}, A2: {}, "13": {}, "14": {} },
    functions: {
      coil: { kind: "coil", terminals: ["A1", "A2"] },
      contact: {
        kind: "contact",
        normal_state: "open",
        terminals: ["13", "14"],
      },
    },
  };
}

function cableType(id = "repair:cable"): Json {
  return {
    kind: "cable_type",
    id,
    description: "Two-core cable",
    conductors: [
      { id: "1", color: "BK" },
      { id: "2", color: "WH" },
    ],
  };
}

function device(index: number, designation: string, type: string): Json {
  return { uid: uid(index), kind: "device", designation, type };
}

function wire(index: number, from: Json, to: Json): Json {
  return {
    uid: uid(index),
    kind: "wire",
    designation: `W${index}`,
    endpoints: [from, to],
  };
}

interface FixtureInput {
  readonly objects: readonly Json[];
  readonly types?: readonly Json[];
  readonly manifestFormat?: string;
  /** Also depend on the shipped core library, or depend on it alone. */
  readonly shippedCore?: "also" | "only";
}

const SHIPPED_CORE = { name: "core", version: "0.1.0" };

async function compileFixture(input: FixtureInput): Promise<Diagnostic[]> {
  return (await compileFixtureAt(input)).diagnostics;
}

async function compileFixtureAt(
  input: FixtureInput,
): Promise<{ root: string; diagnostics: Diagnostic[] }> {
  const root = await mkdtemp(join(tmpdir(), "thermite-diagnostic-repair-"));
  roots.push(root);
  const write = (path: string, value: unknown) =>
    writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
  await mkdir(join(root, "library"));
  await write("system.json", {
    format: input.manifestFormat ?? "electrical-system/0.1",
    project: { name: "Diagnostic repair fixture" },
    sources: ["source.json"],
    libraries:
      input.shippedCore === "only"
        ? [SHIPPED_CORE]
        : [
            { name: "repair", version: "0.1.0", path: "library" },
            ...(input.shippedCore === "also" ? [SHIPPED_CORE] : []),
          ],
  });
  await write("source.json", { objects: input.objects });
  await write("library/library.json", {
    name: "repair",
    version: "0.1.0",
    sources: ["types.json"],
  });
  await write("library/types.json", {
    types: input.types ?? [relayType(), cableType()],
  });
  await lockProject(root);
  const result = await compileProject(root);
  expect(result.ok).toBe(false);
  return { root, diagnostics: result.diagnostics };
}

function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const matches = diagnostics.filter((diagnostic) => diagnostic.code === code);
  expect(matches, JSON.stringify(diagnostics)).toHaveLength(1);
  return matches[0]!;
}

async function schemaJson(name: string): Promise<Json> {
  return JSON.parse(await readFile(join(schemaRoot, name), "utf8")) as Json;
}

function at(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (current as Json | undefined)?.[key],
    value,
  );
}

describe("E014 lists the schema's allowed values", () => {
  it("includes a small enum in full in the message and structured field", async () => {
    const diagnostics = await compileFixture({
      objects: [
        {
          ...device(1, "K1", "repair:relay"),
          io: { addressSpace: "PLC", channels: { DI0: { usage: "bogus" } } },
        },
      ],
    });
    const deviceSchema = await schemaJson("device.schema.json");
    const usage = at(
      deviceSchema,
      "properties",
      "io",
      "properties",
      "channels",
      "patternProperties",
      "^.+$",
      "properties",
      "usage",
      "enum",
    );

    expect(usage).toEqual(["in-use", "spare"]);
    expect(only(diagnostics, "E014")).toEqual({
      code: "E014",
      severity: "error",
      message: 'Value is not one of the allowed values: ["in-use", "spare"].',
      file: "source.json",
      line: 12,
      column: 22,
      jsonPointer: "/objects/0/io/channels/DI0/usage",
      uid: uid(1),
      allowed: ["in-use", "spare"],
      allowedCount: 2,
    });
  });

  it("keeps a long enum complete in the field and shortens the message", async () => {
    const type = relayType();
    type.circuitSymbols = { coil: "bogus-mark" };
    const diagnostics = await compileFixture({
      objects: [device(1, "K1", "repair:relay")],
      types: [type],
    });
    const marks = at(
      await schemaJson("device-type.schema.json"),
      "properties",
      "circuitSymbols",
      "patternProperties",
      "^.*$",
      "enum",
    ) as string[];
    const diagnostic = only(diagnostics, "E014");

    expect(marks.length).toBeGreaterThan(10);
    expect(marks.length).toBeLessThanOrEqual(50);
    expect(diagnostic).toMatchObject({
      file: "library/types.json",
      jsonPointer: "/types/0/circuitSymbols/coil",
      allowed: marks,
      allowedCount: marks.length,
    });
    expect(diagnostic.allowedLookup).toBeUndefined();
    expect(diagnostic.message).toBe(
      `Value is not one of the allowed values: [${marks
        .slice(0, 10)
        .map((mark) => JSON.stringify(mark))
        .join(", ")}] and ${marks.length - 10} more.`,
    );
  });
});

describe("E013 states the expected pattern", () => {
  it("describes the uid pattern and carries the raw regex", async () => {
    const diagnostics = await compileFixture({
      objects: [{ ...device(1, "K1", "repair:relay"), uid: "K1-uid" }],
    });
    const pattern = at(
      await schemaJson("common.schema.json"),
      "$defs",
      "uid",
      "pattern",
    );

    expect(only(diagnostics, "E013")).toEqual({
      code: "E013",
      severity: "error",
      message:
        "String value does not match the required pattern: a lowercase canonical UUID (8-4-4-4-12 hexadecimal digits, version 1-8, RFC variant 8, 9, a or b).",
      file: "source.json",
      line: 4,
      column: 14,
      jsonPointer: "/objects/0/uid",
      uid: "K1-uid",
      pattern,
    });
  });

  it("describes a malformed property-name pattern", async () => {
    const diagnostics = await compileFixture({
      objects: [
        {
          ...device(1, "K1", "repair:relay"),
          io: { addressSpace: "PLC", channels: { " DI0": {} } },
        },
      ],
    });
    const pattern = at(
      await schemaJson("common.schema.json"),
      "$defs",
      "designation",
      "pattern",
    );

    expect(only(diagnostics, "E013")).toMatchObject({
      message:
        'Malformed property name " DI0"; expected text with no control character and no leading or trailing whitespace.',
      jsonPointer: "/objects/0/io/channels/ DI0",
      pattern,
    });
  });
});

describe("E016 and E017 list the valid discriminators", () => {
  it.each(["devcie", "constructor"])(
    "lists source object kinds for kind %j",
    async (kind) => {
      const diagnostics = await compileFixture({
        objects: [{ ...device(1, "K1", "repair:relay"), kind }],
      });
      const kinds = [
        "device",
        "wire",
        "cable",
        "jumper",
        "relation",
        "potential",
      ];

      expect(only(diagnostics, "E016")).toEqual({
        code: "E016",
        severity: "error",
        message: `Unknown source object kind ${JSON.stringify(kind)}; allowed kinds: ${JSON.stringify(kinds).replaceAll(",", ", ")}.`,
        file: "source.json",
        line: 5,
        column: 15,
        jsonPointer: "/objects/0/kind",
        allowed: kinds,
        allowedCount: 6,
      });
    },
  );

  it("lists library type kinds", async () => {
    const diagnostics = await compileFixture({
      objects: [device(1, "K1", "repair:relay")],
      types: [{ ...relayType(), kind: "device-type" }],
    });

    expect(only(diagnostics, "E016")).toMatchObject({
      message:
        'Unknown library type kind "device-type"; allowed kinds: ["device_type", "cable_type"].',
      file: "library/types.json",
      jsonPointer: "/types/0/kind",
      allowed: ["device_type", "cable_type"],
      allowedCount: 2,
    });
  });

  it("lists supported manifest formats", async () => {
    const diagnostics = await compileFixture({
      objects: [device(1, "K1", "repair:relay")],
      manifestFormat: "electrical-system/9.9",
    });

    expect(only(diagnostics, "E017")).toMatchObject({
      message:
        'Unsupported manifest format "electrical-system/9.9"; supported formats: ["electrical-system/0.1"].',
      file: "system.json",
      jsonPointer: "/format",
      allowed: ["electrical-system/0.1"],
      allowedCount: 1,
    });
  });
});

const E102_STRIP_LOOKUP =
  'the keys at JSON pointer "/types/1/terminals" in "library/types.json"';

describe("E102 lists the resolved device type's terminal keys", () => {
  it("lists every key when there are at most 50", async () => {
    const diagnostics = await compileFixture({
      objects: [
        device(1, "K1", "repair:relay"),
        wire(
          2,
          { device: "K1", terminal: "A1" },
          { device: "K1", terminal: "99" },
        ),
      ],
    });

    expect(only(diagnostics, "E102")).toEqual({
      code: "E102",
      severity: "error",
      message:
        'Device "K1" of type "repair:relay" has no terminal "99". Declared terminal keys: ["13", "14", "A1", "A2"].',
      file: "source.json",
      line: 20,
      column: 23,
      jsonPointer: "/objects/1/endpoints/1/terminal",
      uid: uid(2),
      related: [
        {
          file: "library/types.json",
          line: 5,
          column: 13,
          note: 'Resolved device type "repair:relay" is declared here.',
        },
      ],
      allowed: ["13", "14", "A1", "A2"],
      allowedCount: 4,
    });
  });

  it("caps the field at 50 keys with a count and exact lookup", async () => {
    const terminals = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [
        `X${String(index + 1).padStart(2, "0")}`,
        {},
      ]),
    );
    const strip = {
      kind: "device_type",
      id: "repair:strip",
      description: "Terminal strip",
      terminals,
      functions: {},
    };
    const diagnostics = await compileFixture({
      objects: [
        device(1, "X1", "repair:strip"),
        wire(
          2,
          { device: "X1", terminal: "X01" },
          { device: "X1", terminal: "X99" },
        ),
      ],
      types: [relayType(), strip],
    });
    const keys = Object.keys(terminals);
    const diagnostic = only(diagnostics, "E102");

    expect(diagnostic).toMatchObject({
      jsonPointer: "/objects/1/endpoints/1/terminal",
      allowed: keys.slice(0, 50),
      allowedCount: 60,
      allowedLookup: E102_STRIP_LOOKUP,
    });
    expect(diagnostic.message).toBe(
      `Device "X1" of type "repair:strip" has no terminal "X99". Declared terminal keys: [${keys
        .slice(0, 10)
        .map((key) => JSON.stringify(key))
        .join(", ")}] and 50 more; full list: ${E102_STRIP_LOOKUP}.`,
    );
  });
});

const LOCAL_DEVICE_TYPE_LOOKUP =
  'the "id" of each "types" entry whose "kind" is "device_type" in the "sources" files of "library/library.json"';
const SHIPPED_CORE_MANIFEST =
  '"node_modules/@thermite/core-library/library/library.json" below the runtime package root ("packages/core-library/library/library.json" in a source checkout)';

describe("E103 lists resolved type IDs of the required kind", () => {
  it("lists device type IDs for a device and cable type IDs for a cable", async () => {
    const diagnostics = await compileFixture({
      objects: [
        device(1, "K1", "repair:relai"),
        {
          uid: uid(2),
          kind: "cable",
          designation: "C1",
          type: "repair:cabel",
          conductors: [],
        },
      ],
      types: [
        relayType("repair:relay"),
        relayType("repair:aux-relay"),
        cableType("repair:cable"),
      ],
    });
    const unknownTypes = diagnostics.filter(({ code }) => code === "E103");
    const lookup = (kind: string) =>
      `the "id" of each "types" entry whose "kind" is "${kind}" in the "sources" files of "library/library.json"`;

    expect(unknownTypes).toEqual([
      {
        code: "E103",
        severity: "error",
        message:
          'Device "K1" references unknown type "repair:relai". Available device type IDs: ["repair:aux-relay", "repair:relay"].',
        file: "source.json",
        line: 7,
        column: 15,
        jsonPointer: "/objects/0/type",
        uid: uid(1),
        allowed: ["repair:aux-relay", "repair:relay"],
        allowedCount: 2,
        allowedLookup: lookup("device_type"),
      },
      {
        code: "E103",
        severity: "error",
        message:
          'Cable "C1" references unknown type "repair:cabel". Available cable type IDs: ["repair:cable"].',
        file: "source.json",
        line: 13,
        column: 15,
        jsonPointer: "/objects/1/type",
        uid: uid(2),
        allowed: ["repair:cable"],
        allowedCount: 1,
        allowedLookup: lookup("cable_type"),
      },
    ]);
  });

  it("caps the field at 50 IDs with the total count and lookup", async () => {
    const types = Array.from({ length: 60 }, (_, index) =>
      relayType(`repair:relay-${String(index + 1).padStart(2, "0")}`),
    );
    const diagnostics = await compileFixture({
      objects: [device(1, "K1", "repair:relay-99")],
      types,
    });
    const ids = types.map(({ id }) => id as string);
    const diagnostic = only(diagnostics, "E103");

    expect(diagnostic).toMatchObject({
      jsonPointer: "/objects/0/type",
      allowed: ids.slice(0, 50),
      allowedCount: 60,
      allowedLookup: LOCAL_DEVICE_TYPE_LOOKUP,
    });
    expect(diagnostic.message).toBe(
      `Device "K1" references unknown type "repair:relay-99". Available device type IDs: [${ids
        .slice(0, 10)
        .map((id) => JSON.stringify(id))
        .join(", ")}] and 50 more; full list: ${LOCAL_DEVICE_TYPE_LOOKUP}.`,
    );
  });
});

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Shipped core type IDs of one kind, read from the shipped library files. */
async function shippedCoreTypeIds(kind: string): Promise<string[]> {
  const { libraryRootPath } = resolveShippedCoreLibrary();
  const ids: string[] = [];
  for (const file of SHIPPED_CORE_FILE_INVENTORY) {
    if (!file.startsWith("library/types/")) continue;
    const document = JSON.parse(
      await readFile(
        join(libraryRootPath, file.slice("library/".length)),
        "utf8",
      ),
    ) as { types: Json[] };
    for (const type of document.types) {
      if (type.kind === kind) ids.push(type.id as string);
    }
  }
  return ids.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function quotedJsonFiles(lookup: string): string[] {
  return [...lookup.matchAll(/"([^"]+\.json)"/gu)].map((match) => match[1]!);
}

describe("E103 lookups name files that exist", () => {
  it("maps the shipped core manifest into the runtime package and the source checkout", async () => {
    const { diagnostics } = await compileFixtureAt({
      objects: [device(1, "K1", "core:typo")],
      shippedCore: "only",
    });
    const ids = await shippedCoreTypeIds("device_type");
    const lookup = `the "id" of each "types" entry whose "kind" is "device_type" in the "sources" files of ${SHIPPED_CORE_MANIFEST}`;
    expect(ids.length).toBeGreaterThan(10);

    expect(only(diagnostics, "E103")).toEqual({
      code: "E103",
      severity: "error",
      message: `Device "K1" references unknown type "core:typo". Available device type IDs: [${ids
        .slice(0, 10)
        .map((id) => JSON.stringify(id))
        .join(", ")}] and ${ids.length - 10} more; full list: ${lookup}.`,
      file: "source.json",
      line: 7,
      column: 15,
      jsonPointer: "/objects/0/type",
      uid: uid(1),
      allowed: ids,
      allowedCount: ids.length,
      allowedLookup: lookup,
    });

    // The runtime package root and a source checkout root both contain the
    // named files: the workspace links node_modules/@thermite/core-library to
    // the runtime layout, and the package ships its "library" directory.
    const [runtimeManifest, sourceManifest] = quotedJsonFiles(lookup);
    expect(runtimeManifest).toBe(
      "node_modules/@thermite/core-library/library/library.json",
    );
    expect(sourceManifest).toBe("packages/core-library/library/library.json");
    const packageJson = JSON.parse(
      await readFile(
        join(repositoryRoot, "packages/core-library/package.json"),
        "utf8",
      ),
    ) as { name: string; files: string[] };
    expect(packageJson.name).toBe("@thermite/core-library");
    expect(packageJson.files).toContain("library");
    expect(SHIPPED_CORE_FILE_INVENTORY).toContain("library/library.json");
    for (const manifest of [runtimeManifest!, sourceManifest!]) {
      const bytes = await readFile(join(repositoryRoot, manifest), "utf8");
      expect(JSON.parse(bytes)).toMatchObject({
        name: "core",
        version: "0.1.0",
        sources: ["types/**/*.json"],
      });
    }
  });

  it("lists local and shipped manifests for a cable and resolves the local one from the project", async () => {
    const { root, diagnostics } = await compileFixtureAt({
      objects: [
        {
          uid: uid(1),
          kind: "cable",
          designation: "C1",
          type: "core:typo",
          conductors: [],
        },
      ],
      shippedCore: "also",
    });
    const ids = [
      ...(await shippedCoreTypeIds("cable_type")),
      "repair:cable",
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const lookup = `the "id" of each "types" entry whose "kind" is "cable_type" in the "sources" files of "library/library.json" and ${SHIPPED_CORE_MANIFEST}`;

    expect(only(diagnostics, "E103")).toMatchObject({
      file: "source.json",
      jsonPointer: "/objects/0/type",
      allowed: ids,
      allowedCount: ids.length,
      allowedLookup: lookup,
    });
    const [localManifest] = quotedJsonFiles(lookup);
    expect(localManifest).toBe("library/library.json");
    await expect(
      readFile(join(root, localManifest!), "utf8"),
    ).resolves.toContain('"repair"');
  });

  it("maps every shipped display path to existing runtime and source files", async () => {
    for (const entry of Object.values(SHIPPED_CORE_VERSIONS))
      for (const file of entry.fileInventory) {
        const display = `${entry.displayRoot}/${file.slice(entry.directory.length + 1)}`;
        const location = openableLibraryFile("shipped", display);
        expect(location).toEqual({
          runtime: `node_modules/@thermite/core-library/${file}`,
          source: `packages/core-library/${file}`,
        });
        for (const path of [location.runtime!, location.source!]) {
          await expect(
            readFile(join(repositoryRoot, path)),
          ).resolves.toBeDefined();
        }
      }
    expect(openableLibraryFile("local", "../shared lib/types.json")).toEqual({
      project: "../shared lib/types.json",
    });
    expect(
      openableLibraryFile("local", "@thermite/core-library/types/x.json"),
    ).toEqual({ project: "@thermite/core-library/types/x.json" });
  });
});
