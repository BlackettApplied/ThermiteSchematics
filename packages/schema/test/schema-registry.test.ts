import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { basename, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createAjv2020 } from "../src/ajv-validation.js";
import { parseJson, type JsonValue } from "../src/parser.js";
import {
  ENTITY_SCHEMA_NAMES,
  PROJECT_PRESENTATION_SINGLE_LINE_PATTERN,
  SUPPORTED_PROJECT_FORMATS,
  createInMemoryCanonicalSchemaRegistry,
  type EntitySchemaName,
  type SchemaRegistry,
  loadCanonicalSchemas,
  loadSchemaRegistry,
} from "../src/schema-registry.js";

const EXPECTED_SCHEMA_FILES = [
  "cable-type.schema.json",
  "cable.schema.json",
  "common.schema.json",
  "device-type.schema.json",
  "device.schema.json",
  "jumper.schema.json",
  "library-file.schema.json",
  "library-lock.schema.json",
  "library.schema.json",
  "potential.schema.json",
  "project-presentation.schema.json",
  "project.schema.json",
  "relation.schema.json",
  "source-file.schema.json",
  "wire.schema.json",
] as const;

const EXPECTED_ROOT_TITLES: Readonly<Record<string, string>> = {
  "cable.schema.json": "Cable",
  "cable-type.schema.json": "CableType",
  "device.schema.json": "Device",
  "device-type.schema.json": "DeviceType",
  "jumper.schema.json": "Jumper",
  "library.schema.json": "LibraryManifest",
  "library-file.schema.json": "LibraryFile",
  "library-lock.schema.json": "LibraryLock",
  "potential.schema.json": "Potential",
  "project-presentation.schema.json": "ProjectPresentationFile",
  "project.schema.json": "ProjectManifest",
  "relation.schema.json": "Relation",
  "source-file.schema.json": "SourceFile",
  "wire.schema.json": "Wire",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectRefs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectRefs);
  }

  if (!isObject(value)) {
    return [];
  }

  return [
    ...(typeof value.$ref === "string" ? [value.$ref] : []),
    ...Object.values(value).flatMap(collectRefs),
  ];
}

function assertObjectShapesAreClosed(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertObjectShapesAreClosed);
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (value.type === "object") {
    expect(value.additionalProperties).toBe(false);
  }

  Object.values(value).forEach(assertObjectShapesAreClosed);
}

const FUNCTION_KINDS = [
  "coil",
  "contact",
  "channel",
  "source",
  "load",
  "bus",
  "mechanism",
  "other",
] as const;

type FunctionKind = (typeof FUNCTION_KINDS)[number];

function functionRecord(kind: FunctionKind): Record<string, unknown> {
  switch (kind) {
    case "coil":
      return { kind, terminals: ["T1", "T2"] };
    case "contact":
      return {
        kind,
        normal_state: "open",
        terminals: ["T1", "T2"],
      };
    case "channel":
      return { kind, direction: "input", terminals: ["T1"] };
    case "source":
    case "load":
    case "bus":
      return { kind, terminals: ["T1"] };
    case "mechanism":
    case "other":
      return { kind, terminals: [] };
  }
}

function internalRelationIsLegal(
  relation: string,
  from: FunctionKind,
  to: FunctionKind,
): boolean {
  const electrical = new Set<FunctionKind>([
    "coil",
    "contact",
    "channel",
    "source",
    "load",
    "bus",
  ]);

  return relation === "actuates"
    ? ["coil", "channel", "mechanism"].includes(from) && to === "contact"
    : relation === "trips"
      ? from === "mechanism" && to === "contact"
      : relation === "ganged_with"
        ? (from === "contact" || from === "mechanism") && to === from
        : relation === "feeds_internal"
          ? electrical.has(from) && electrical.has(to)
          : false;
}

describe("canonical schema metadata", async () => {
  const schemas = await loadCanonicalSchemas();

  it("contains the fourteen-file M2 inventory with draft 2020-12 unique ids", () => {
    expect(schemas.map(({ fileName }) => fileName)).toEqual(
      EXPECTED_SCHEMA_FILES,
    );
    expect(new Set(schemas.map(({ id }) => id)).size).toBe(schemas.length);

    for (const { fileName, id, schema } of schemas) {
      expect(schema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: `https://thermiteschematics.com/schemas/0.1/${fileName}`,
      });
      assertObjectShapesAreClosed(schema);

      if (fileName === "common.schema.json") {
        expect(schema).not.toHaveProperty("title");
      } else {
        expect(schema).toMatchObject({ title: EXPECTED_ROOT_TITLES[fileName] });
      }
    }
  });

  it("keeps common limited to the frozen definitions", () => {
    const common = schemas.find(
      ({ fileName }) => fileName === "common.schema.json",
    )?.schema;

    expect(common).toMatchObject({
      $defs: expect.any(Object),
    });
    expect(Object.keys((common as { $defs: object }).$defs)).toEqual([
      "uid",
      "designation",
      "deviceRef",
      "terminalRef",
      "endpointPair",
      "typeId",
      "electricalIntent",
      "electricalRating",
      "aliases",
    ]);
    expect(common).not.toHaveProperty("type");
  });

  it("defines the D6 lock constraints and mirrors the manifest path grammar", () => {
    const project = schemas.find(
      ({ fileName }) => fileName === "project.schema.json",
    )?.schema as {
      properties: {
        libraries: {
          items: {
            properties: { path: { minLength: number; pattern: string } };
          };
        };
      };
    };
    const lock = schemas.find(
      ({ fileName }) => fileName === "library-lock.schema.json",
    )?.schema as {
      $defs: Record<
        "portableDependencyPath" | "libraryFilePath" | "integrity",
        { minLength?: number; pattern: string }
      >;
    };

    expect(lock.$defs.portableDependencyPath).toEqual(
      project.properties.libraries.items.properties.path,
    );
    expect(lock.$defs.libraryFilePath).toEqual({
      type: "string",
      minLength: 1,
      pattern:
        "^(?![A-Za-z]:)(?![\\s\\S]*\\\\)(?!\\.{1,2}(?:/|$))(?![\\s\\S]*/\\.{1,2}(?:/|$))[^\\u0000-\\u001f\\u007f-\\u009f/]+(?:/[^\\u0000-\\u001f\\u007f-\\u009f/]+)*$",
    });
    expect(lock.$defs.integrity.pattern).toBe(
      "^sha256-[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$",
    );
  });

  it("preserves the authored dependency path schema while accepting omission", async () => {
    const project = schemas.find(
      ({ fileName }) => fileName === "project.schema.json",
    )?.schema as {
      properties: {
        libraries: {
          items: {
            required: string[];
            properties: { path: unknown };
          };
        };
      };
    };
    const dependency = project.properties.libraries.items;

    expect(dependency.required).toEqual(["name", "version"]);
    expect(dependency.properties.path).toEqual({
      type: "string",
      minLength: 1,
      pattern:
        "^(?!/)(?![A-Za-z]:)(?![\\s\\S]*\\\\)[^\\u0000-\\u001f\\u007f-\\u009f]+$",
    });

    const parsed = parseJson(
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Shipped dependency" },
        sources: ["source.json"],
        libraries: [{ name: "core", version: "0.1.0" }],
      }),
      "project.json",
    );
    const registry = await loadSchemaRegistry();
    expect(
      registry.validateEntity("project", parsed.value as JsonValue, {
        file: "project.json",
        nodes: parsed.nodes,
      }),
    ).toEqual([]);
  });

  it("annotates every canonical numeric unit", () => {
    const common = schemas.find(
      ({ fileName }) => fileName === "common.schema.json",
    )?.schema as {
      $defs: Record<
        "electricalIntent" | "electricalRating",
        { properties: Record<string, { description?: string }> }
      >;
    };
    const units = {
      nominal_voltage: "volts (V)",
      current: "amperes (A)",
      power: "watts (W)",
      frequency: "hertz (Hz)",
    };

    for (const definitionName of [
      "electricalIntent",
      "electricalRating",
    ] as const) {
      for (const [property, unit] of Object.entries(units)) {
        expect(
          common.$defs[definitionName].properties[property]?.description,
        ).toContain(unit);
      }
    }
  });

  it("defines exactly the D8 function kinds with no pole branch", () => {
    const deviceType = schemas.find(
      ({ fileName }) => fileName === "device-type.schema.json",
    )?.schema as {
      $defs: Record<string, unknown>;
    };

    expect(
      Object.keys(deviceType.$defs)
        .filter((name) => name.endsWith("Function"))
        .sort(),
    ).toEqual(FUNCTION_KINDS.map((kind) => `${kind}Function`).sort());
    expect(JSON.stringify(deviceType)).not.toContain('"pole"');
  });

  it("compiles every schema under strict Ajv2020 with all refs offline", () => {
    const ajv = createAjv2020(schemas.map(({ schema }) => schema));

    for (const { id, schema } of schemas) {
      expect(() => ajv.getSchema(id)).not.toThrow();
      expect(ajv.getSchema(id)).toBeDefined();

      for (const ref of collectRefs(schema)) {
        const resolvedRef = new URL(ref, id).href;
        expect(ajv.getSchema(resolvedRef), resolvedRef).toBeDefined();
      }
    }
  });

  it("exports every canonical file through the package schema subpath", async () => {
    for (const fileName of EXPECTED_SCHEMA_FILES) {
      const specifier = `@thermite/schema/schemas/${fileName}`;
      // Use the native resolver: Vitest rewrites import.meta.resolve and its
      // Windows file-URL base is not understood by Bun. This still exercises
      // the package exports map for every canonical JSON subpath.
      const resolved = createRequire(import.meta.url).resolve(specifier);

      expect(basename(resolved)).toBe(fileName);
      await expect(readFile(resolved, "utf8")).resolves.toContain(
        `https://thermiteschematics.com/schemas/0.1/${fileName}`,
      );
    }
  });
});

describe("schema registry", async () => {
  const registry = await loadSchemaRegistry();

  it("registers one source-located validator per canonical entity schema", () => {
    expect(ENTITY_SCHEMA_NAMES).toEqual([
      "project",
      "project-presentation",
      "source-file",
      "device",
      "device-type",
      "wire",
      "cable",
      "cable-type",
      "jumper",
      "relation",
      "potential",
      "library",
      "library-file",
      "library-lock",
    ]);

    const parsed = parseJson(
      '{"kind":"device","designation":"K1","type":"core:contactor"}',
      "device.json",
    );

    expect(parsed.value).toBeDefined();
    expect(
      registry.validateEntity("device", parsed.value as JsonValue, {
        file: "device.json",
        nodes: parsed.nodes,
      }),
    ).toMatchObject([
      {
        code: "E010",
        jsonPointer: "/uid",
        line: 1,
        column: 1,
      },
    ]);
  });

  it("accepts lowercase canonical UUID versions 1 through 8", () => {
    for (let version = 1; version <= 8; version += 1) {
      const uid = `abcdef00-0000-${version}000-8000-000000000000`;
      const source = JSON.stringify({
        uid,
        kind: "device",
        designation: "=F1+P1-K1",
        type: "core:contactor",
      });
      const parsed = parseJson(source, `uuid-v${version}.json`);

      expect(parsed.value).toBeDefined();
      expect(
        registry.validateEntity("device", parsed.value as JsonValue, {
          file: `uuid-v${version}.json`,
          nodes: parsed.nodes,
        }),
      ).toEqual([]);
    }
  });

  it.each([
    "ABCDEF00-0000-4000-8000-000000000000",
    "abcdef00-0000-4000-8000-00000000000A",
  ])("rejects uppercase or mixed-case UUID source text: %s", (uid) => {
    const parsed = parseJson(
      JSON.stringify({
        uid,
        kind: "device",
        designation: "K1",
        type: "core:contactor",
      }),
      "uppercase-uuid.json",
    );

    expect(parsed.value).toBeDefined();
    expect(
      registry.validateEntity("device", parsed.value as JsonValue, {
        file: "uppercase-uuid.json",
        nodes: parsed.nodes,
      }),
    ).toMatchObject([{ code: "E013", jsonPointer: "/uid" }]);
  });

  it("enforces portable dependency paths independently of host path semantics", () => {
    const cases = [
      {
        value: "../library/core",
        accepted: true,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "libraries/vendor/core",
        accepted: true,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "/library/core",
        accepted: false,
        posixAbsolute: true,
        win32Absolute: true,
      },
      {
        value: "//server/share",
        accepted: false,
        posixAbsolute: true,
        win32Absolute: true,
      },
      {
        value: "C:/library/core",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: true,
      },
      {
        value: "C:\\library\\core",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: true,
      },
      {
        value: "C:library",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "D:../library",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "\\\\server\\share",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: true,
      },
      {
        value: "\\\\?\\C:\\library",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: true,
      },
      {
        value: "nested\\library",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "bad\u0000path",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "bad\u001fpath",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "bad\u007fpath",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
      {
        value: "bad\u0085path",
        accepted: false,
        posixAbsolute: false,
        win32Absolute: false,
      },
    ];

    for (const testCase of cases) {
      expect(posix.isAbsolute(testCase.value), testCase.value).toBe(
        testCase.posixAbsolute,
      );
      expect(win32.isAbsolute(testCase.value), testCase.value).toBe(
        testCase.win32Absolute,
      );
      const parsed = parseJson(
        JSON.stringify({
          format: "electrical-system/0.1",
          project: { name: "Path matrix" },
          sources: ["sources/**/*.json"],
          libraries: [{ name: "core", version: "0.1.0", path: testCase.value }],
        }),
        "project.json",
      );

      expect(parsed.value).toBeDefined();
      const diagnostics = registry.validateEntity(
        "project",
        parsed.value as JsonValue,
        { file: "project.json", nodes: parsed.nodes },
      );
      expect(
        diagnostics.map(({ code, jsonPointer }) => ({ code, jsonPointer })),
        testCase.value,
      ).toEqual(
        testCase.accepted
          ? []
          : [{ code: "E013", jsonPointer: "/libraries/0/path" }],
      );
    }
  });

  it("validates the D6 lock path, file, and integrity string constraints", async () => {
    const digest = `sha256-${"A".repeat(43)}=`;
    const valid = {
      $schema:
        "https://thermiteschematics.com/schemas/0.1/library-lock.schema.json",
      lockfile_version: 1,
      project_format: "electrical-system/0.1",
      libraries: {
        core: {
          version: "0.1.0",
          path: "../library/core",
          integrity: digest,
          files: { "library.json": digest, "types/relay.json": digest },
        },
      },
    };

    const validate = (value: unknown) => {
      const parsed = parseJson(JSON.stringify(value), "lock.json");
      expect(parsed.value).toBeDefined();
      return registry.validateEntity(
        "library-lock",
        parsed.value as JsonValue,
        { file: "lock.json", nodes: parsed.nodes },
      );
    };

    expect(validate(valid)).toEqual([]);
    const schemas = await loadCanonicalSchemas();
    const lockSchema = schemas.find(
      ({ fileName }) => fileName === "library-lock.schema.json",
    )?.schema as {
      $defs: {
        library: {
          required: string[];
          properties: { resolutionKind: unknown };
        };
      };
    };
    const lockEntry = lockSchema.$defs.library;
    expect(lockEntry.required).toEqual([
      "version",
      "path",
      "integrity",
      "files",
    ]);
    expect(lockEntry.properties.resolutionKind).toEqual({
      enum: ["local", "shipped"],
    });
    for (const resolutionKind of [undefined, "local", "shipped"] as const) {
      expect(
        validate({
          ...valid,
          libraries: {
            core: {
              ...valid.libraries.core,
              ...(resolutionKind === undefined ? {} : { resolutionKind }),
            },
          },
        }),
      ).toEqual([]);
    }
    expect(
      validate({
        ...valid,
        libraries: {
          core: { ...valid.libraries.core, resolutionKind: "registry" },
        },
      }).map(({ code }) => code),
    ).toContain("E014");
    expect(
      validate({
        ...valid,
        libraries: {
          core: {
            ...valid.libraries.core,
            integrity: "sha256-9vi8ymHA2mGfBVZvV33DC0mCOaboWJZAWXnc0XE2wbo=",
          },
        },
      }),
    ).toEqual([]);

    for (const invalidPath of [
      "/library",
      "C:/library",
      "C:library",
      "nested\\library",
      "",
      "bad\u0000path",
      "bad\u0085path",
    ]) {
      const invalid = {
        ...valid,
        libraries: {
          core: { ...valid.libraries.core, path: invalidPath },
        },
      };
      expect(validate(invalid).map(({ code }) => code)).toContain("E013");
    }

    for (const invalidIntegrity of [
      `sha256-${"A".repeat(43)}`,
      `sha256-${"A".repeat(42)}_=`,
      `sha256-${"A".repeat(42)}B=`,
    ]) {
      const invalid = {
        ...valid,
        libraries: {
          core: { ...valid.libraries.core, integrity: invalidIntegrity },
        },
      };
      expect(validate(invalid).map(({ code }) => code)).toContain("E013");
    }

    for (const invalidFilePath of [
      "/absolute.json",
      "C:/absolute.json",
      "C:relative.json",
      "types\\relay.json",
      "../escape.json",
      "types/../escape.json",
      "./types/relay.json",
      "types/./relay.json",
      "types//relay.json",
      "types/",
      "bad\u0000path.json",
      "bad\u0085path.json",
    ]) {
      const invalid = {
        ...valid,
        libraries: {
          core: {
            ...valid.libraries.core,
            files: {
              "library.json": digest,
              [invalidFilePath]: digest,
            },
          },
        },
      };
      expect(validate(invalid).map(({ code }) => code)).toContain("E013");
    }
  });

  it.each([
    "abcdef00-0000-0000-8000-000000000000",
    "abcdef00-0000-9000-8000-000000000000",
    "abcdef00-0000-4000-7000-000000000000",
    "abcdef00-0000-4000-c000-000000000000",
  ])("rejects a non-canonical UUID version or variant: %s", (uid) => {
    const source = JSON.stringify({
      uid,
      kind: "device",
      designation: "K1",
      type: "core:contactor",
    });
    const parsed = parseJson(source, "bad-uuid.json");

    expect(parsed.value).toBeDefined();
    expect(
      registry.validateEntity("device", parsed.value as JsonValue, {
        file: "bad-uuid.json",
        nodes: parsed.nodes,
      }),
    ).toMatchObject([{ code: "E013", jsonPointer: "/uid" }]);
  });

  it("reports identical endpoints through the E024 code check", () => {
    const source = JSON.stringify({
      uid: "12345678-1234-4234-9234-123456789abc",
      kind: "wire",
      designation: "W1",
      endpoints: [
        { device: "K1", terminal: "A1" },
        { device: "K1", terminal: "A1" },
      ],
    });
    const parsed = parseJson(source, "identical-endpoints.json");

    expect(parsed.value).toBeDefined();
    expect(
      registry.validateEntity("wire", parsed.value as JsonValue, {
        file: "identical-endpoints.json",
        nodes: parsed.nodes,
      }),
    ).toMatchObject([{ code: "E024", jsonPointer: "/endpoints/1" }]);
  });

  it("applies the complete D8 internal-relation legality table", () => {
    for (const relation of [
      "actuates",
      "trips",
      "ganged_with",
      "feeds_internal",
    ]) {
      for (const fromKind of FUNCTION_KINDS) {
        for (const toKind of FUNCTION_KINDS) {
          const source = JSON.stringify({
            kind: "device_type",
            id: "core:relation-matrix",
            terminals: { T1: {}, T2: {} },
            functions: {
              from: functionRecord(fromKind),
              to: functionRecord(toKind),
            },
            internal_relations: [{ relation, from: "from", to: "to" }],
          });
          const parsed = parseJson(source, "relation-matrix.json");

          expect(parsed.value).toBeDefined();
          expect(
            registry
              .validateEntity("device-type", parsed.value as JsonValue, {
                file: "relation-matrix.json",
                nodes: parsed.nodes,
              })
              .map(({ code }) => code),
            `${relation}: ${fromKind} -> ${toKind}`,
          ).toEqual(
            internalRelationIsLegal(relation, fromKind, toKind) ? [] : ["E030"],
          );
        }
      }
    }
  });

  it("keeps cable conductor ids opaque except for non-emptiness", () => {
    const source = JSON.stringify({
      uid: "12345678-1234-4234-9234-123456789abc",
      kind: "cable",
      designation: "CBL1",
      type: "core:cable",
      conductors: [
        {
          id: " padded.id+ ",
          endpoints: [
            { device: "X1", terminal: "1" },
            { device: "X2", terminal: "1" },
          ],
        },
      ],
    });
    const parsed = parseJson(source, "opaque-conductor-id.json");

    expect(parsed.value).toBeDefined();
    expect(
      registry.validateEntity("cable", parsed.value as JsonValue, {
        file: "opaque-conductor-id.json",
        nodes: parsed.nodes,
      }),
    ).toEqual([]);
  });

  it("enforces terminal key grammar and the closed terminal record", () => {
    for (const terminals of [
      { " padded ": {} },
      { T1: { direction: "input" } },
    ]) {
      const source = JSON.stringify({
        kind: "device_type",
        id: "core:bad-terminal",
        terminals,
        functions: {},
      });
      const parsed = parseJson(source, "bad-terminal.json");

      expect(parsed.value).toBeDefined();
      expect(
        registry
          .validateEntity("device-type", parsed.value as JsonValue, {
            file: "bad-terminal.json",
            nodes: parsed.nodes,
          })
          .map(({ code }) => code),
      ).toEqual(terminals[" padded "] === undefined ? ["E012"] : ["E013"]);
    }
  });

  it("rejects pole as an unknown function kind", () => {
    const source = JSON.stringify({
      kind: "device_type",
      id: "core:no-pole-kind",
      terminals: { T1: {}, T2: {} },
      functions: { pole: { kind: "pole", terminals: ["T1", "T2"] } },
    });
    const parsed = parseJson(source, "no-pole.json");

    expect(parsed.value).toBeDefined();
    expect(
      registry.validateEntity("device-type", parsed.value as JsonValue, {
        file: "no-pole.json",
        nodes: parsed.nodes,
      }),
    ).toMatchObject([{ code: "E014", jsonPointer: "/functions/pole/kind" }]);
  });
});
const SINGLE_LINE_CODE_POINTS = [
  { label: "0009", value: "\u0009" },
  { label: "000A", value: "\u000a" },
  { label: "000D", value: "\u000d" },
  { label: "0085", value: "\u0085" },
  { label: "2028", value: "\u2028" },
  { label: "2029", value: "\u2029" },
] as const;

function presentation(overrides: Record<string, unknown> = {}) {
  return {
    format: "project-presentation/0.1",
    revision: "A",
    backgroundColor: "#ffffff",
    titleBlock: { lines: ["Reference"] },
    ...overrides,
  };
}

function validate(
  registry: SchemaRegistry,
  entity: EntitySchemaName,
  value: unknown,
) {
  const parsed = parseJson(JSON.stringify(value), `${entity}.json`);
  expect(parsed.diagnostics).toEqual([]);
  return registry.validateEntity(entity, parsed.value as JsonValue, {
    file: `${entity}.json`,
    nodes: parsed.nodes,
  });
}

describe("circuit symbol schema", () => {
  const registry = createInMemoryCanonicalSchemaRegistry();
  const type = {
    kind: "device_type",
    id: "fixture:circuit-symbols",
    terminals: { A: {}, B: {} },
    functions: {
      "aux/~": {
        kind: "contact",
        normal_state: "closed",
        terminals: ["A", "B"],
      },
    },
  };

  it("accepts optional explicit marks with ordinary opaque function keys", () => {
    expect(validate(registry, "device-type", type)).toEqual([]);
    expect(
      validate(registry, "device-type", { ...type, circuitSymbols: {} }),
    ).toEqual([]);
    expect(
      validate(registry, "device-type", {
        ...type,
        circuitSymbols: { "aux/~": "contact-nc" },
      }),
    ).toEqual([]);
  });

  it.each(["arbitrary-svg", "protective-earth", "CONTACT-NC"])(
    "rejects unrecognized mark %s",
    (mark) => {
      expect(
        validate(registry, "device-type", {
          ...type,
          circuitSymbols: { "aux/~": mark },
        }),
      ).toMatchObject([
        { code: "E014", jsonPointer: "/circuitSymbols/aux~1~0" },
      ]);
    },
  );

  it.each([
    null,
    [],
    "contact-no",
    { "aux/~": { svg: "<path/>" } },
    { "aux/~": 1 },
    { " padded ": "contact-no" },
  ])("rejects malformed circuitSymbols %j", (circuitSymbols) => {
    expect(
      validate(registry, "device-type", { ...type, circuitSymbols }).length,
    ).toBeGreaterThan(0);
  });
});

describe("M8 project presentation schema", async () => {
  const registry = await loadSchemaRegistry();

  it("freezes the exact single-line rule and accepts the complete closed shape", () => {
    expect(PROJECT_PRESENTATION_SINGLE_LINE_PATTERN).toBe(
      "^[^\\u0009\\u000a\\u000d\\u0085\\u2028\\u2029]+$",
    );
    expect(
      validate(registry, "project-presentation", {
        $schema:
          "https://thermiteschematics.com/schemas/0.1/project-presentation.schema.json",
        ...presentation(),
      }),
    ).toEqual([]);
    expect(
      validate(
        registry,
        "project-presentation",
        presentation({ titleBlock: { lines: [] } }),
      ),
    ).toEqual([]);
    expect(
      validate(registry, "project-presentation", {
        format: "project-presentation/0.1",
        revision: "A",
        backgroundColor: "#000000",
      }),
    ).toEqual([]);
  });

  it.each(SINGLE_LINE_CODE_POINTS)(
    "rejects forbidden single-line code point U+$label in revision and every line index",
    ({ value: codePoint }) => {
      expect(
        validate(
          registry,
          "project-presentation",
          presentation({ revision: `A${codePoint}B` }),
        ),
      ).toMatchObject([{ code: "E013", jsonPointer: "/revision" }]);
      for (let index = 0; index < 4; index += 1) {
        const lines = ["0", "1", "2", "3"];
        lines[index] = `A${codePoint}B`;
        expect(
          validate(
            registry,
            "project-presentation",
            presentation({ titleBlock: { lines } }),
          ),
        ).toMatchObject([
          { code: "E013", jsonPointer: `/titleBlock/lines/${index}` },
        ]);
      }
    },
  );

  it("enforces format, required/closed fields, color, cardinality, and code-point bounds", () => {
    const invalidCases = [
      [{ revision: undefined }, "/revision"],
      [{ backgroundColor: undefined }, "/backgroundColor"],
      [{ format: "project-presentation/99" }, "/format"],
      [{ backgroundColor: "#FFFFFF" }, "/backgroundColor"],
      [{ backgroundColor: "#fff" }, "/backgroundColor"],
      [{ backgroundColor: "blue" }, "/backgroundColor"],
      [{ revision: "" }, "/revision"],
      [{ revision: "\u{1f600}".repeat(129) }, "/revision"],
      [{ titleBlock: {} }, "/titleBlock/lines"],
      [{ titleBlock: { lines: ["", "ok"] } }, "/titleBlock/lines/0"],
      [{ titleBlock: { lines: ["x".repeat(161)] } }, "/titleBlock/lines/0"],
      [
        { titleBlock: { lines: ["0", "1", "2", "3", "4"] } },
        "/titleBlock/lines",
      ],
      [{ titleBlock: { lines: [], extra: true } }, "/titleBlock/extra"],
      [{ extra: true }, "/extra"],
    ] as const;

    for (const [overrides, pointer] of invalidCases) {
      const value = presentation(overrides as Record<string, unknown>);
      for (const [key, member] of Object.entries(value)) {
        if (member === undefined)
          delete (value as Record<string, unknown>)[key];
      }
      expect(
        validate(registry, "project-presentation", value).some(
          (diagnostic) => diagnostic.jsonPointer === pointer,
        ),
        JSON.stringify(overrides),
      ).toBe(true);
    }

    expect(
      validate(
        registry,
        "project-presentation",
        presentation({
          revision: "\u{1f600}".repeat(128),
          titleBlock: { lines: ["\u{1f600}".repeat(160)] },
        }),
      ),
    ).toEqual([]);
    expect(
      validate(
        registry,
        "project-presentation",
        presentation({ revision: "XML-invalid-\u0000-source" }),
      ),
    ).toEqual([]);
  });

  it("adds only the portable presentation reference while preserving project-name compatibility", async () => {
    expect(SUPPORTED_PROJECT_FORMATS).toEqual(["electrical-system/0.1"]);
    const schemas = await loadCanonicalSchemas();
    const projectSchema = schemas.find(
      ({ fileName }) => fileName === "project.schema.json",
    )?.schema as {
      properties: {
        project: { properties: { name: unknown } };
        presentation: unknown;
      };
    };
    expect(projectSchema.properties.project.properties.name).toEqual({
      type: "string",
    });
    expect(projectSchema.properties.presentation).toEqual({
      type: "string",
      minLength: 1,
      pattern:
        "^(?!/)(?![A-Za-z]:)(?![\\s\\S]*\\\\)(?!\\.{1,2}(?:/|$))(?![\\s\\S]*/\\.{1,2}(?:/|$))[^\\u0000-\\u001f\\u007f-\\u009f/]+(?:/[^\\u0000-\\u001f\\u007f-\\u009f/]+)*$",
    });

    for (const name of [
      "",
      "line\nbreak",
      "x".repeat(161),
      "line\u2028separator",
      "paragraph\u2029separator",
    ]) {
      expect(
        validate(registry, "project", {
          format: "electrical-system/0.1",
          project: { name },
          sources: ["source.json"],
        }),
      ).toEqual([]);
    }

    for (const path of [
      "",
      "/presentation.json",
      "//server/share.json",
      "C:/presentation.json",
      "C:presentation.json",
      "nested\\presentation.json",
      "./presentation.json",
      "../presentation.json",
      "nested/./presentation.json",
      "nested/../presentation.json",
      "nested//presentation.json",
      "nested/",
      "bad\u0000path.json",
      "bad\u0085path.json",
    ]) {
      expect(
        validate(registry, "project", {
          format: "electrical-system/0.1",
          project: { name: "Path" },
          sources: ["source.json"],
          presentation: path,
        }).length,
        path,
      ).toBeGreaterThan(0);
    }
    expect(
      validate(registry, "project", {
        format: "electrical-system/0.1",
        project: { name: "Path" },
        sources: ["source.json"],
        presentation: "metadata/presentation.json",
      }),
    ).toEqual([]);
  });
});

describe("M8 in-memory canonical schema registry", async () => {
  const loadedSchemas = await loadCanonicalSchemas();
  const loadedRegistry = await loadSchemaRegistry();
  const inMemoryRegistry = createInMemoryCanonicalSchemaRegistry();

  it("is synchronous and deep-equals filesystem-loaded names, values, ids, and registrations", () => {
    expect(inMemoryRegistry).not.toBeInstanceOf(Promise);
    expect([...inMemoryRegistry.schemas.values()]).toEqual(loadedSchemas);
    expect([...inMemoryRegistry.schemas.values()]).not.toBe(loadedSchemas);
    for (const { id } of loadedSchemas) {
      expect(inMemoryRegistry.ajv.getSchema(id)).toBeDefined();
      expect(loadedRegistry.ajv.getSchema(id)).toBeDefined();
    }
  });

  it("matches filesystem validation behavior for project and presentation probes", () => {
    const probes: readonly [EntitySchemaName, unknown][] = [
      [
        "project",
        {
          format: "electrical-system/0.1",
          project: { name: "Probe" },
          sources: ["source.json"],
          presentation: "presentation.json",
        },
      ],
      ["project-presentation", presentation()],
      ["project-presentation", presentation({ revision: "bad\u2028revision" })],
    ];

    for (const [entity, value] of probes) {
      expect(validate(inMemoryRegistry, entity, value)).toEqual(
        validate(loadedRegistry, entity, value),
      );
    }
  });
});
