import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  compileProject,
  computeFileIntegrity,
  lockProject,
  serializeIr,
  writeFileAtomically,
} from "../packages/compiler/dist/index.js";
import {
  createAgentTools,
  serializeAgentToolReport,
} from "../packages/agent-tools/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const motorStarterRoot = join(repositoryRoot, "examples", "motor-starter");
const destinations = Object.freeze({
  lock: join(motorStarterRoot, "electrical-system.lock.json"),
  ir: join(
    repositoryRoot,
    "packages",
    "compiler",
    "test",
    "goldens",
    "motor-starter.ir.json",
  ),
  agent: join(
    repositoryRoot,
    "packages",
    "cli",
    "test",
    "goldens",
    "motor-starter-agent",
    "type-only-patch.stderr.json",
  ),
});

const LS1_UID = "596f728b-1445-4c4b-8974-a3b4ea703636";

async function generateOwnedBytes() {
  const temporaryRoot = await mkdtemp(
    join(resolve(tmpdir()), "thermite-schematics-shipped-core-goldens-"),
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

    const locked = await lockProject(projectRoot);
    if (!locked.ok) {
      throw new Error(
        `Unable to generate the shipped motor-starter lock: ${JSON.stringify(locked.diagnostics)}`,
      );
    }
    const lock = await readFile(locked.lockPath);

    const compiled = await compileProject(projectRoot);
    if (!compiled.ok) {
      throw new Error(
        `Unable to generate the shipped motor-starter IR: ${JSON.stringify(compiled.diagnostics)}`,
      );
    }
    const ir = Buffer.from(serializeIr(compiled.ir), "utf8");

    const equipmentPath = join(projectRoot, "devices", "equipment.json");
    const equipmentIntegrity = computeFileIntegrity(
      await readFile(equipmentPath),
    );
    const outcome = await createAgentTools({
      cwd: projectRoot,
    }).applySourcePatch({
      format: "agent-tool-request/0.1",
      project: ".",
      patchFormat: "json-patch/0.1",
      dryRun: true,
      files: [
        {
          path: "devices/equipment.json",
          expectedIntegrity: equipmentIntegrity,
          operations: [
            { op: "test", path: "/objects/8/uid", value: LS1_UID },
            {
              op: "test",
              path: "/objects/8/type",
              value: "core:limit-switch-2wire",
            },
            {
              op: "replace",
              path: "/objects/8/type",
              value: "core:prox-pnp-3wire",
            },
          ],
        },
      ],
    });
    if (outcome.ok || outcome.failureClass !== "expected") {
      throw new Error(
        "The type-only product workflow did not return its expected compiler failure.",
      );
    }
    const agent = Buffer.from(
      serializeAgentToolReport(
        "apply-source-patch",
        outcome.diagnostics,
        outcome.error,
      ),
      "utf8",
    );

    return { lock, ir, agent };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function updateShippedCoreGoldens(mode) {
  if (mode !== "--write" && mode !== "--check") {
    throw new Error(
      "Usage: node scripts/update-shipped-core-goldens.mjs --write|--check",
    );
  }
  const generated = await generateOwnedBytes();
  for (const key of ["lock", "ir", "agent"]) {
    const destination = destinations[key];
    const bytes = generated[key];
    if (mode === "--write") {
      await writeFileAtomically(destination, bytes);
      continue;
    }
    const committed = await readFile(destination);
    if (!committed.equals(bytes)) {
      throw new Error(
        `Shipped-core golden is stale: ${destination.slice(repositoryRoot.length + 1)}`,
      );
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await updateShippedCoreGoldens(process.argv[2]);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
