import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileProject,
  lockProject,
  resolveShippedCoreLibrary,
  SHIPPED_CORE_FILE_INVENTORY,
} from "@thermite/compiler";
import { isValidInitText, runInit } from "./init.js";
import { assertOrdinaryPath } from "./alpha-output.js";

export interface AlphaInitOptions {
  name?: string;
  revision?: string;
  template?: "starter" | "cabinets";
}
export async function initializeAlphaProject(
  destination: string,
  options: AlphaInitOptions = {},
): Promise<void> {
  const target = resolve(destination),
    parent = dirname(target);
  const name = options.name ?? "Thermite Electrical Project",
    revision = options.revision ?? "A";
  if (!isValidInitText(name, 160) || !isValidInitText(revision, 96))
    throw new Error(
      "Project name must be 1–160 and revision 1–96 printable single-line characters.",
    );
  await assertOrdinaryPath(parent);
  try {
    await lstat(target);
    throw new Error(
      "Initialization requires a new directory; destination already exists.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const stage = await mkdtemp(join(parent, ".thermite-init-"));
  try {
    const initialized = await runInit(name, revision, { cwd: stage });
    if (initialized.exitCode !== 0) throw new Error(initialized.stderr.trim());
    const core = resolveShippedCoreLibrary();
    for (const file of SHIPPED_CORE_FILE_INVENTORY) {
      const relative = file.replace(/^library\//, "");
      const output = join(stage, "libraries/core", relative);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(
        output,
        await readFile(join(core.libraryRootPath, relative)),
        { flag: "wx" },
      );
    }
    // Apache-2.0 notices travel with the copied library, outside its locked sources.
    for (const notice of ["LICENSE", "NOTICE"])
      await writeFile(
        join(stage, "libraries/core", notice),
        await readFile(join(core.packageRootPath, notice)),
        { flag: "wx" },
      );
    const manifest = JSON.parse(
      await readFile(join(stage, "system.json"), "utf8"),
    );
    manifest.libraries = [
      { name: "core", version: "0.1.0", path: "libraries/core" },
    ];
    const presentation = JSON.parse(
      await readFile(join(stage, "presentation.json"), "utf8"),
    );
    presentation.format = "project-presentation/0.2";
    presentation.page = {
      size: "tabloid",
      orientation: "landscape",
      marginMm: 10,
    };
    if (options.template === "cabinets") {
      const objects = [
        {
          uid: randomUUID(),
          kind: "device",
          designation: "TB1",
          type: "core:terminal-block-8",
          location: "CONTROL CABINET",
        },
        {
          uid: randomUUID(),
          kind: "device",
          designation: "TB2",
          type: "core:terminal-block-8",
          location: "FIELD CABINET",
        },
        {
          uid: randomUUID(),
          kind: "cable",
          designation: "CBL1",
          type: "core:cable-2pair-shielded",
          fromLocation: "CONTROL CABINET",
          toLocation: "FIELD CABINET",
          conductors: [
            {
              id: "1+",
              usage: "in-use",
              endpoints: [
                { device: "TB1", terminal: "1" },
                { device: "TB2", terminal: "1" },
              ],
            },
            {
              id: "1-",
              usage: "in-use",
              endpoints: [
                { device: "TB1", terminal: "2" },
                { device: "TB2", terminal: "2" },
              ],
            },
            { id: "2+", usage: "spare", endpoints: [null, null] },
            { id: "2-", usage: "spare", endpoints: [null, null] },
          ],
        },
      ];
      await writeFile(
        join(stage, "devices/equipment.json"),
        JSON.stringify({ objects }, null, 2) + "\n",
      );
      for (const file of [
        "connections/control-power.json",
        "potentials/potentials.json",
      ])
        await writeFile(join(stage, file), '{"objects":[]}\n');
      presentation.titleBlock = {
        lines: ["Inter-cabinet cable / two used cores and two spare cores"],
      };
    }
    await writeFile(
      join(stage, "system.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await writeFile(
      join(stage, "presentation.json"),
      JSON.stringify(presentation, null, 2) + "\n",
    );
    await writeFile(
      join(stage, "AGENTS.md"),
      await readFile(
        fileURLToPath(new URL("../assets/THERMITE_AGENTS.md", import.meta.url)),
      ),
    );
    const locked = await lockProject(stage);
    if (!locked.ok) throw new Error(JSON.stringify(locked.diagnostics));
    const compiled = await compileProject(stage);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    // The destination is created only once the entire staged project validates.
    // rename cannot replace a nonempty directory on the supported Mac platform.
    try {
      await lstat(target);
      throw new Error(
        "Destination appeared during initialization; refusing to replace it.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stage, target);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
