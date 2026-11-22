import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
export async function breakerAuxiliaryFixture() {
  const root = await mkdtemp(join(tmpdir(), "thermite-breaker-aux-"));
  await mkdir(join(root, "local"));
  const files = {
    "system.json": {
      format: "electrical-system/0.1",
      project: { name: "Adjacent breaker auxiliary specification" },
      sources: ["source.json"],
      libraries: [{ name: "local", version: "0.1.0", path: "local" }],
    },
    "local/library.json": {
      name: "local",
      version: "0.1.0",
      sources: ["types.json"],
    },
    "source.json": {
      objects: [
        {
          kind: "device",
          uid: "95000000-0000-4000-8000-000000000001",
          designation: "Q1",
          type: "local:breaker-aux",
        },
      ],
    },
    "local/types.json": {
      types: [
        {
          kind: "device_type",
          id: "local:breaker-aux",
          description: "Breaker with authored NO and NC auxiliaries",
          symbol: "thermite:breaker",
          terminals: {
            "1": { role: "power_input" },
            "2": { role: "power_output" },
            "3": { role: "power_input" },
            "4": { role: "power_output" },
            "13": { role: "aux" },
            "14": { role: "aux" },
            "21": { role: "aux" },
            "22": { role: "aux" },
          },
          functions: {
            pole1: {
              kind: "contact",
              normal_state: "closed",
              terminals: ["1", "2"],
            },
            pole2: {
              kind: "contact",
              normal_state: "closed",
              terminals: ["3", "4"],
            },
            no: {
              kind: "contact",
              normal_state: "open",
              terminals: ["13", "14"],
            },
            nc: {
              kind: "contact",
              normal_state: "closed",
              terminals: ["21", "22"],
            },
          },
          internal_relations: [
            { relation: "ganged_with", from: "pole1", to: "pole2" },
          ],
        },
      ],
    },
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(join(root, name), JSON.stringify(value));
  const lock = await lockProject(root);
  if (!lock.ok) throw Error(JSON.stringify(lock));
  const c = await compileProject(root);
  if (!c.ok) throw Error(JSON.stringify(c));
  return {
    ir: c.ir,
    dispose: () => rm(root, { recursive: true, force: true }),
    request: {
      format: "schematic-packet-request/0.1" as const,
      views: [
        {
          format: "circuit-view-request/0.1" as const,
          title: "Q1 auxiliary specification",
          flow: "top-to-bottom" as const,
          groups: [
            {
              id: "breaker",
              functions: ["pole1", "pole2", "no", "nc"].map((key) => ({
                device: { by: "designation" as const, value: "Q1" },
                key,
              })),
              conductors: [],
            },
          ],
        },
      ],
    },
  };
}
