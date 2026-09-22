import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { format, resolveConfig } from "prettier";

import {
  compileProject,
  loadProject,
  writeFileAtomically,
} from "../packages/compiler/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const motorStarterRoot = join(repositoryRoot, "examples", "motor-starter");
const destinations = Object.freeze({
  presentation: join(motorStarterRoot, "presentation.json"),
  system: join(motorStarterRoot, "system.json"),
});

const PRESENTATION_SCHEMA_ID =
  "https://thermiteschematics.com/schemas/0.1/project-presentation.schema.json";
const EXPECTED_PRESENTATION = Object.freeze({
  $schema: PRESENTATION_SCHEMA_ID,
  format: "project-presentation/0.1",
  revision: "A",
  backgroundColor: "#ffffff",
  titleBlock: { lines: ["Motor starter reference"] },
});

const EXPECTED_PROJECT = Object.freeze({
  name: "Motor Starter Reference System",
  description:
    "480 VAC motor starter with 24 VDC PLC control and field limit switch",
});
const EXPECTED_SOURCES = Object.freeze([
  "devices/**/*.json",
  "connections/**/*.json",
  "cables/**/*.json",
  "potentials/**/*.json",
]);
const EXPECTED_LIBRARIES = Object.freeze([
  Object.freeze({ name: "core", version: "0.1.0" }),
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSystemAuthority(value) {
  if (!isRecord(value)) {
    throw new Error("The motor-starter system authority is not an object.");
  }
  const allowedKeys = [
    "$schema",
    "format",
    "project",
    "sources",
    "presentation",
    "libraries",
  ];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new Error(
      "The motor-starter system authority has an unexpected field.",
    );
  }
  if (
    value.$schema !==
      "https://thermiteschematics.com/schemas/0.1/project.schema.json" ||
    value.format !== "electrical-system/0.1" ||
    JSON.stringify(value.project) !== JSON.stringify(EXPECTED_PROJECT) ||
    JSON.stringify(value.sources) !== JSON.stringify(EXPECTED_SOURCES) ||
    JSON.stringify(value.libraries) !== JSON.stringify(EXPECTED_LIBRARIES)
  ) {
    throw new Error(
      "The motor-starter system authority has unexpected semantics.",
    );
  }
}

async function formattedJsonBytes(source, destination, prettierConfig) {
  const once = await format(`${source}\n`, {
    ...prettierConfig,
    filepath: destination,
    endOfLine: "lf",
  });
  const twice = await format(once, {
    ...prettierConfig,
    filepath: destination,
    endOfLine: "lf",
  });
  if (once !== twice || !once.endsWith("\n") || once.includes("\r")) {
    throw new Error(
      `Repository Prettier is not byte-stable for ${destination.slice(repositoryRoot.length + 1)}.`,
    );
  }
  return Buffer.from(once, "utf8");
}

function serializeSystemAuthority(value) {
  const libraryMarker = "__THERMITE_SCHEMATICS_CORE_LIBRARY__";
  const quotedMarker = JSON.stringify(libraryMarker);
  const expanded = JSON.stringify(
    { ...value, libraries: libraryMarker },
    undefined,
    2,
  );
  const first = expanded.indexOf(quotedMarker);
  if (first < 0 || expanded.indexOf(quotedMarker, first + 1) >= 0) {
    throw new Error(
      "Unable to serialize the canonical core library reference.",
    );
  }
  return expanded.replace(
    quotedMarker,
    '[{ "name": "core", "version": "0.1.0" }]',
  );
}

async function generateOwnedBytes() {
  const sourceSystem = JSON.parse(await readFile(destinations.system, "utf8"));
  assertSystemAuthority(sourceSystem);
  const system = {
    $schema: "https://thermiteschematics.com/schemas/0.1/project.schema.json",
    format: "electrical-system/0.1",
    project: EXPECTED_PROJECT,
    sources: EXPECTED_SOURCES,
    presentation: "presentation.json",
    libraries: EXPECTED_LIBRARIES,
  };
  const prettierConfig =
    (await resolveConfig(join(repositoryRoot, "package.json"))) ?? {};
  const presentationBytes = await formattedJsonBytes(
    JSON.stringify(EXPECTED_PRESENTATION, undefined, 2),
    destinations.presentation,
    prettierConfig,
  );
  const systemBytes = await formattedJsonBytes(
    serializeSystemAuthority(system),
    destinations.system,
    prettierConfig,
  );

  const temporaryRoot = await mkdtemp(
    join(resolve(tmpdir()), "thermite-schematics-motor-presentation-"),
  );
  const projectRoot = join(temporaryRoot, "motor-starter");
  try {
    await cp(motorStarterRoot, projectRoot, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await writeFileAtomically(
      join(projectRoot, "presentation.json"),
      presentationBytes,
    );
    await writeFileAtomically(join(projectRoot, "system.json"), systemBytes);

    const loaded = await loadProject(projectRoot);
    if (!loaded.ok) {
      throw new Error(
        `Unable to load the generated motor-starter presentation: ${JSON.stringify(loaded.diagnostics)}`,
      );
    }
    if (
      loaded.project.presentation?.file !== "presentation.json" ||
      loaded.project.presentation.kind !== "project_presentation"
    ) {
      throw new Error(
        "The generated presentation did not use the loader contract.",
      );
    }

    const compiled = await compileProject(projectRoot);
    if (!compiled.ok) {
      throw new Error(
        `Unable to compile the generated motor-starter presentation: ${JSON.stringify(compiled.diagnostics)}`,
      );
    }
    if (
      JSON.stringify(compiled.presentation) !==
      JSON.stringify({
        format: "project-presentation/0.1",
        revision: "A",
        backgroundColor: "#ffffff",
        titleBlockLines: ["Motor starter reference"],
      })
    ) {
      throw new Error(
        "The generated presentation did not normalize canonically.",
      );
    }

    return { presentation: presentationBytes, system: systemBytes };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function updateMotorStarterPresentation(mode) {
  if (mode !== "--write" && mode !== "--check") {
    throw new Error(
      "Usage: node scripts/update-motor-starter-presentation.mjs --write|--check",
    );
  }
  const generated = await generateOwnedBytes();
  for (const key of ["presentation", "system"]) {
    const destination = destinations[key];
    const bytes = generated[key];
    if (mode === "--write") {
      await writeFileAtomically(destination, bytes);
      continue;
    }
    const committed = await readFile(destination);
    if (!committed.equals(bytes)) {
      throw new Error(
        `Motor-starter presentation fixture is stale: ${destination.slice(repositoryRoot.length + 1)}`,
      );
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await updateMotorStarterPresentation(process.argv[2]);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
