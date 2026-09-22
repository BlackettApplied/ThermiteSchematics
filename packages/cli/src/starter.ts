import { TextDecoder } from "node:util";

import {
  SHIPPED_CORE_DISPLAY_ROOT,
  SHIPPED_CORE_FILE_INVENTORY,
  generateLibraryLock,
  serializeLibraryLock,
  type LoadedDocument,
  type LoadedLibrary,
  type LoadedLibrarySourceFile,
  type LoadedProject,
  type LoadedProjectSourceFile,
} from "@thermite/compiler";
import {
  createInMemoryCanonicalSchemaRegistry,
  parseJson,
  validateProjectManifest,
  validateSourceDocument,
  validateUniqueUids,
  type JsonValue,
  type LibraryManifest,
  type ProjectManifest,
  type ProjectPresentationFile,
  type SchemaRegistry,
} from "@thermite/schema";

export const DEFAULT_STARTER_PROJECT_NAME =
  "Thermite Schematics Starter Project";
export const DEFAULT_STARTER_REVISION = "0.1.0";

export const STARTER_TEMPLATE_PATHS = Object.freeze([
  "connections/control-power.json",
  "devices/equipment.json",
  "electrical-system.lock.json",
  "potentials/potentials.json",
  "presentation.json",
  "system.json",
] as const);

export const STARTER_NON_LOCK_TEMPLATE_PATHS = Object.freeze([
  "connections/control-power.json",
  "devices/equipment.json",
  "potentials/potentials.json",
  "presentation.json",
  "system.json",
] as const);

export const STARTER_OUTPUT_FILE_PATHS = Object.freeze([
  "AGENTS.md",
  ...STARTER_TEMPLATE_PATHS,
] as const);

export const STARTER_DIRECTORY_PATHS = Object.freeze([
  "connections",
  "devices",
  "potentials",
] as const);

export interface StarterIdentities {
  readonly ps1: string;
  readonly plc1: string;
  readonly controlWirePositive: string;
  readonly controlWireReturn: string;
  readonly potentialPositive: string;
  readonly potentialReturn: string;
}

export const DEFAULT_STARTER_IDENTITIES: StarterIdentities = Object.freeze({
  ps1: "33a15867-296b-40e4-a56b-15282f131b4c",
  plc1: "81148ad3-8c03-4c8d-8c70-6b33bb3b0266",
  controlWirePositive: "5b70d7ec-1a8f-4d53-a60b-e077a8ffb10d",
  controlWireReturn: "00f8fde6-55ad-4b82-8bfb-ac3a0268161a",
  potentialPositive: "46be3efd-17b7-43ee-bb9d-a019c4fb2cdd",
  potentialReturn: "aaccbc22-3208-42dd-ae26-54dce0250f8d",
});

export interface BuildStarterScaffoldOptions {
  readonly name: string;
  readonly revision: string;
  readonly identities: StarterIdentities;
}

export interface StarterScaffoldValues {
  readonly "connections/control-power.json": JsonValue;
  readonly "devices/equipment.json": JsonValue;
  readonly "potentials/potentials.json": JsonValue;
  readonly "presentation.json": JsonValue;
  readonly "system.json": JsonValue;
}

export type StarterTemplatePath = (typeof STARTER_TEMPLATE_PATHS)[number];
export type StarterNonLockTemplatePath =
  (typeof STARTER_NON_LOCK_TEMPLATE_PATHS)[number];
export type ShippedCoreFilePath = (typeof SHIPPED_CORE_FILE_INVENTORY)[number];
export type StarterOutputFilePath = (typeof STARTER_OUTPUT_FILE_PATHS)[number];

export interface StarterAssetBytes {
  readonly agentGuide: Uint8Array;
  readonly templates: ReadonlyMap<StarterTemplatePath, Uint8Array>;
  readonly shippedCore: ReadonlyMap<ShippedCoreFilePath, Uint8Array>;
}

export interface PreparedStarterScaffold {
  readonly files: ReadonlyMap<StarterOutputFilePath, Uint8Array>;
}

export class StarterAssetValidationError extends Error {
  constructor() {
    super("Packaged starter asset validation failed.");
    this.name = "StarterAssetValidationError";
  }
}

export class StarterPreparationError extends Error {
  constructor() {
    super("Starter scaffold preparation failed.");
    this.name = "StarterPreparationError";
  }
}

const PROJECT_SCHEMA_ID =
  "https://thermiteschematics.com/schemas/0.1/project.schema.json";
const PRESENTATION_SCHEMA_ID =
  "https://thermiteschematics.com/schemas/0.1/project-presentation.schema.json";
const SOURCE_SCHEMA_ID =
  "https://thermiteschematics.com/schemas/0.1/source-file.schema.json";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceFile(objects: readonly JsonValue[]): JsonValue {
  return {
    $schema: SOURCE_SCHEMA_ID,
    objects: [...objects],
  };
}

export function buildStarterScaffold(
  options: BuildStarterScaffoldOptions,
): StarterScaffoldValues {
  const { identities, name, revision } = options;
  return {
    "connections/control-power.json": sourceFile([
      {
        uid: identities.controlWirePositive,
        kind: "wire",
        designation: "W-CTL-001",
        endpoints: [
          { device: "PS1", terminal: "+" },
          { device: "PLC1", terminal: "L+" },
        ],
        properties: {
          label: "+24V-PS1-PLC1",
          size: "18AWG",
          color: "blue",
        },
      },
      {
        uid: identities.controlWireReturn,
        kind: "wire",
        designation: "W-CTL-002",
        endpoints: [
          { device: "PS1", terminal: "-" },
          { device: "PLC1", terminal: "M" },
        ],
        properties: {
          label: "0V-PS1-PLC1",
          size: "18AWG",
          color: "blue/white",
        },
      },
    ]),
    "devices/equipment.json": sourceFile([
      {
        uid: identities.ps1,
        kind: "device",
        designation: "PS1",
        type: "core:psu-24vdc",
        description: "480 VAC line-to-line to 24 VDC control power supply",
        location: "MAIN-PANEL",
      },
      {
        uid: identities.plc1,
        kind: "device",
        designation: "PLC1",
        type: "core:plc-compact",
        description: "Motor starter control PLC",
        location: "MAIN-PANEL",
      },
    ]),
    "potentials/potentials.json": sourceFile([
      {
        uid: identities.potentialPositive,
        kind: "potential",
        name: "+24VDC",
        at: { device: "PS1", terminal: "+" },
        electrical: {
          nominal_voltage: 24,
          voltage_type: "DC",
          polarity: "positive",
        },
      },
      {
        uid: identities.potentialReturn,
        kind: "potential",
        name: "0VDC",
        at: { device: "PS1", terminal: "-" },
        electrical: {
          nominal_voltage: 0,
          voltage_type: "DC",
          polarity: "return",
        },
      },
    ]),
    "presentation.json": {
      $schema: PRESENTATION_SCHEMA_ID,
      format: "project-presentation/0.1",
      revision,
      backgroundColor: "#ffffff",
      titleBlock: { lines: ["Starter project"] },
    },
    "system.json": {
      $schema: PROJECT_SCHEMA_ID,
      format: "electrical-system/0.1",
      project: { name },
      sources: [
        "devices/equipment.json",
        "connections/control-power.json",
        "potentials/potentials.json",
      ],
      presentation: "presentation.json",
      libraries: [{ name: "core", version: "0.1.0" }],
    },
  };
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  let text: string;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(label + " is not valid UTF-8.");
  }
  if (text.startsWith("\ufeff")) {
    throw new Error(label + " has a UTF-8 byte-order mark.");
  }
  return text;
}

function parseDocument(
  bytes: Uint8Array,
  file: string,
): ReturnType<typeof parseJson> & { value: JsonValue } {
  const parsed = parseJson(decodeUtf8(bytes, file), file);
  if (parsed.value === undefined || parsed.diagnostics.length !== 0) {
    throw new Error(file + " is not valid canonical JSON.");
  }
  return { ...parsed, value: parsed.value };
}

function requireNoDiagnostics(
  diagnostics: readonly unknown[],
  file: string,
): void {
  if (diagnostics.length !== 0) {
    throw new Error(file + " does not satisfy its canonical schema.");
  }
}

function requireExactPaths<T extends string>(
  actual: ReadonlyMap<T, Uint8Array>,
  expected: readonly T[],
  label: string,
): void {
  const actualPaths = [...actual.keys()].sort(compareText);
  const expectedPaths = [...expected].sort(compareText);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(label + " has a missing or unexpected path.");
  }
}

function loadedDocument<T>(
  file: string,
  rawBytes: Uint8Array,
  parsed: ReturnType<typeof parseJson> & { value: JsonValue },
  kind: LoadedDocument<T>["kind"],
  owner: LoadedDocument<T>["owner"],
): LoadedDocument<T> {
  return {
    file,
    logicalPath: "/thermite-schematics-in-memory/" + file,
    canonicalPath: "/thermite-schematics-in-memory/" + file,
    rawBytes,
    value: parsed.value as T,
    nodes: parsed.nodes,
    owner,
    kind,
  };
}

function assertCoreManifestInventory(manifest: LibraryManifest): void {
  if (
    manifest.name !== "core" ||
    manifest.version !== "0.1.0" ||
    manifest.sources.length !== 1 ||
    manifest.sources[0] !== "types/**/*.json"
  ) {
    throw new Error("The shipped core manifest authority is unexpected.");
  }

  const expanded = SHIPPED_CORE_FILE_INVENTORY.filter(
    (path) => path.startsWith("library/types/") && path.endsWith(".json"),
  );
  const expected = SHIPPED_CORE_FILE_INVENTORY.slice(1);
  if (
    expanded.length !== 13 ||
    JSON.stringify(expanded) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "The shipped core manifest does not expand to the static inventory.",
    );
  }
}

export function createStarterLoadedProject(
  templates: ReadonlyMap<StarterNonLockTemplatePath, Uint8Array>,
  shippedCore: ReadonlyMap<ShippedCoreFilePath, Uint8Array>,
  registry: SchemaRegistry = createInMemoryCanonicalSchemaRegistry(),
): LoadedProject {
  requireExactPaths(
    templates,
    STARTER_NON_LOCK_TEMPLATE_PATHS,
    "The starter template set",
  );
  requireExactPaths(
    shippedCore,
    SHIPPED_CORE_FILE_INVENTORY,
    "The shipped core asset set",
  );

  const systemBytes = templates.get("system.json")!;
  const systemParsed = parseDocument(systemBytes, "system.json");
  requireNoDiagnostics(
    validateProjectManifest(registry, {
      file: "system.json",
      value: systemParsed.value,
      nodes: systemParsed.nodes,
    }),
    "system.json",
  );
  const manifest = loadedDocument<ProjectManifest>(
    "system.json",
    systemBytes,
    systemParsed,
    "project_manifest",
    { kind: "project" },
  );

  const presentationBytes = templates.get("presentation.json")!;
  const presentationParsed = parseDocument(
    presentationBytes,
    "presentation.json",
  );
  requireNoDiagnostics(
    registry.validateEntity("project-presentation", presentationParsed.value, {
      file: "presentation.json",
      nodes: presentationParsed.nodes,
    }),
    "presentation.json",
  );
  const presentation = loadedDocument<ProjectPresentationFile>(
    "presentation.json",
    presentationBytes,
    presentationParsed,
    "project_presentation",
    { kind: "project" },
  );

  const projectSources = [
    "devices/equipment.json",
    "connections/control-power.json",
    "potentials/potentials.json",
  ] as const;
  const sources = projectSources.map((file) => {
    const bytes = templates.get(file)!;
    const parsed = parseDocument(bytes, file);
    requireNoDiagnostics(
      validateSourceDocument(registry, {
        file,
        value: parsed.value,
        nodes: parsed.nodes,
      }),
      file,
    );
    return loadedDocument<LoadedProjectSourceFile>(
      file,
      bytes,
      parsed,
      "project_source",
      { kind: "project" },
    );
  });
  requireNoDiagnostics(
    validateUniqueUids(
      sources.map((source) => ({
        file: source.file,
        value: source.value as unknown as JsonValue,
        nodes: source.nodes,
      })),
    ),
    "starter project sources",
  );

  const coreManifestPath = SHIPPED_CORE_FILE_INVENTORY[0];
  const coreManifestBytes = shippedCore.get(coreManifestPath)!;
  const coreManifestParsed = parseDocument(
    coreManifestBytes,
    SHIPPED_CORE_DISPLAY_ROOT + "/library.json",
  );
  requireNoDiagnostics(
    registry.validateEntity("library", coreManifestParsed.value, {
      file: SHIPPED_CORE_DISPLAY_ROOT + "/library.json",
      nodes: coreManifestParsed.nodes,
    }),
    SHIPPED_CORE_DISPLAY_ROOT + "/library.json",
  );
  assertCoreManifestInventory(
    coreManifestParsed.value as unknown as LibraryManifest,
  );
  const libraryManifest = loadedDocument<LibraryManifest>(
    SHIPPED_CORE_DISPLAY_ROOT + "/library.json",
    coreManifestBytes,
    coreManifestParsed,
    "library_manifest",
    { kind: "library", name: "core", dependencyIndex: 0 },
  );

  const librarySources = SHIPPED_CORE_FILE_INVENTORY.slice(1).map((path) => {
    const bytes = shippedCore.get(path)!;
    const displayFile =
      SHIPPED_CORE_DISPLAY_ROOT + "/" + path.slice("library/".length);
    const parsed = parseDocument(bytes, displayFile);
    requireNoDiagnostics(
      registry.validateEntity("library-file", parsed.value, {
        file: displayFile,
        nodes: parsed.nodes,
      }),
      displayFile,
    );
    return loadedDocument<LoadedLibrarySourceFile>(
      displayFile,
      bytes,
      parsed,
      "library_source",
      { kind: "library", name: "core", dependencyIndex: 0 },
    );
  });

  const dependency = manifest.value.libraries?.[0];
  if (
    manifest.value.libraries?.length !== 1 ||
    dependency?.name !== "core" ||
    dependency.version !== "0.1.0" ||
    dependency.path !== undefined
  ) {
    throw new Error("The starter shipped-library authority is unexpected.");
  }
  const library: LoadedLibrary = {
    dependencyIndex: 0,
    dependency,
    resolutionKind: "shipped",
    logicalRootPath: "/thermite-schematics-in-memory/core",
    canonicalRootPath: "/thermite-schematics-in-memory/core",
    manifest: libraryManifest,
    sources: librarySources,
  };

  return {
    logicalRootPath: "/thermite-schematics-in-memory/project",
    canonicalRootPath: "/thermite-schematics-in-memory/project",
    manifest,
    presentation,
    sources,
    libraries: [library],
    libraryLock: { state: "missing" },
    structuralDiagnostics: [],
  };
}

function exactJsonValue(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateAgentGuide(bytes: Uint8Array): void {
  const text = decodeUtf8(bytes, "assets/AGENTS.md");
  if (
    text.length === 0 ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text.endsWith("\n\n")
  ) {
    throw new Error("The packaged agent guide bytes are not canonical.");
  }
}

interface ValidatedStarterAssets {
  readonly defaultProject: LoadedProject;
}

function validateStarterAssets(
  assets: StarterAssetBytes,
): ValidatedStarterAssets {
  try {
    validateAgentGuide(assets.agentGuide);
    requireExactPaths(
      assets.templates,
      STARTER_TEMPLATE_PATHS,
      "The packaged starter template set",
    );
    const nonLockTemplates = new Map<StarterNonLockTemplatePath, Uint8Array>(
      STARTER_NON_LOCK_TEMPLATE_PATHS.map((path) => [
        path,
        assets.templates.get(path)!,
      ]),
    );
    const defaultProject = createStarterLoadedProject(
      nonLockTemplates,
      assets.shippedCore,
    );
    const expected = buildStarterScaffold({
      name: DEFAULT_STARTER_PROJECT_NAME,
      revision: DEFAULT_STARTER_REVISION,
      identities: DEFAULT_STARTER_IDENTITIES,
    });
    const actual: StarterScaffoldValues = {
      "connections/control-power.json": defaultProject.sources[1]!
        .value as unknown as JsonValue,
      "devices/equipment.json": defaultProject.sources[0]!
        .value as unknown as JsonValue,
      "potentials/potentials.json": defaultProject.sources[2]!
        .value as unknown as JsonValue,
      "presentation.json": defaultProject.presentation!
        .value as unknown as JsonValue,
      "system.json": defaultProject.manifest.value as unknown as JsonValue,
    };
    for (const path of STARTER_NON_LOCK_TEMPLATE_PATHS) {
      if (!exactJsonValue(actual[path], expected[path])) {
        throw new Error("The starter authority " + path + " is unexpected.");
      }
    }

    const lockBytes = assets.templates.get("electrical-system.lock.json")!;
    const lockParsed = parseDocument(lockBytes, "electrical-system.lock.json");
    const registry = createInMemoryCanonicalSchemaRegistry();
    requireNoDiagnostics(
      registry.validateEntity("library-lock", lockParsed.value, {
        file: "electrical-system.lock.json",
        nodes: lockParsed.nodes,
      }),
      "electrical-system.lock.json",
    );
    return { defaultProject };
  } catch {
    throw new StarterAssetValidationError();
  }
}

function spliceJsonStringToken(
  bytes: Uint8Array,
  file: string,
  pointer: string,
  original: string,
  replacement: string,
): Uint8Array {
  const text = decodeUtf8(bytes, file);
  const parsed = parseDocument(bytes, file);
  const token = parsed.nodes.get(pointer)?.value;
  if (
    token?.type !== "string" ||
    text.slice(token.offset, token.offset + token.length) !==
      JSON.stringify(original)
  ) {
    throw new Error(file + " has no canonical token at " + pointer + ".");
  }
  return Buffer.from(
    text.slice(0, token.offset) +
      JSON.stringify(replacement) +
      text.slice(token.offset + token.length),
    "utf8",
  );
}

export function prepareStarterScaffoldFromAssets(
  assets: StarterAssetBytes,
  name: string,
  revision: string,
): PreparedStarterScaffold {
  const { defaultProject } = validateStarterAssets(assets);
  let canonicalDefaultLock: Uint8Array;
  try {
    canonicalDefaultLock = Buffer.from(
      serializeLibraryLock(generateLibraryLock(defaultProject)),
      "utf8",
    );
  } catch {
    throw new StarterPreparationError();
  }
  if (
    !Buffer.from(assets.templates.get("electrical-system.lock.json")!).equals(
      canonicalDefaultLock,
    )
  ) {
    throw new StarterAssetValidationError();
  }

  try {
    const systemBytes =
      name === DEFAULT_STARTER_PROJECT_NAME
        ? assets.templates.get("system.json")!
        : spliceJsonStringToken(
            assets.templates.get("system.json")!,
            "system.json",
            "/project/name",
            DEFAULT_STARTER_PROJECT_NAME,
            name,
          );
    const presentationBytes =
      revision === DEFAULT_STARTER_REVISION
        ? assets.templates.get("presentation.json")!
        : spliceJsonStringToken(
            assets.templates.get("presentation.json")!,
            "presentation.json",
            "/revision",
            DEFAULT_STARTER_REVISION,
            revision,
          );

    const selectedTemplates = new Map<StarterNonLockTemplatePath, Uint8Array>(
      STARTER_NON_LOCK_TEMPLATE_PATHS.map((path) => [
        path,
        assets.templates.get(path)!,
      ]),
    );
    selectedTemplates.set("system.json", systemBytes);
    selectedTemplates.set("presentation.json", presentationBytes);
    const selectedProject = createStarterLoadedProject(
      selectedTemplates,
      assets.shippedCore,
    );
    const generatedLock = Buffer.from(
      serializeLibraryLock(generateLibraryLock(selectedProject)),
      "utf8",
    );
    if (!generatedLock.equals(Buffer.from(canonicalDefaultLock))) {
      throw new Error("The selected starter lock changed unexpectedly.");
    }

    const files = new Map<StarterOutputFilePath, Uint8Array>();
    files.set("AGENTS.md", Buffer.from(assets.agentGuide));
    for (const path of STARTER_TEMPLATE_PATHS) {
      if (path === "system.json") {
        files.set(path, systemBytes);
      } else if (path === "presentation.json") {
        files.set(path, presentationBytes);
      } else if (path === "electrical-system.lock.json") {
        files.set(path, generatedLock);
      } else {
        files.set(path, Buffer.from(assets.templates.get(path)!));
      }
    }
    return { files };
  } catch (error) {
    if (
      error instanceof StarterAssetValidationError ||
      error instanceof StarterPreparationError
    ) {
      throw error;
    }
    throw new StarterPreparationError();
  }
}
