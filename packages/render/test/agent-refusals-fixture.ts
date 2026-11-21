import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";

/** Reduced synthetic U2 dogfood inputs; preserve the #365/#366 mechanisms. */
export async function agentRefusalFixture(
  name: "sensor" | "sensor-wire" | "pump",
) {
  const root = await mkdtemp(join(tmpdir(), "thermite-agent-refusal-"));
  let result: Awaited<ReturnType<typeof compileProject>>;
  try {
    const source = await readFile(
      new URL(`./fixtures/agent-refusals/${name}.json`, import.meta.url),
    );
    await writeFile(join(root, "source.json"), source);
    await writeFile(
      join(root, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: `Synthetic ${name} refusal regression` },
        sources: ["source.json"],
        libraries: [{ name: "core", version: "0.2.0" }],
      }),
    );
    const locked = await lockProject(root);
    if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
    result = await compileProject(root);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  } catch (error) {
    await rm(root, { recursive: true });
    throw error;
  }
  return { ...result, root, dispose: () => rm(root, { recursive: true }) };
}

export const sensorTrace = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "B1" },
  intent: {
    kind: "trace",
    to: { by: "designation", value: "PLC1" },
    includePower: true,
  },
} as const;

export const pumpPower = {
  format: "schematic-view-request/0.1",
  root: { by: "designation", value: "M1" },
  family: "power",
} as const;
