import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { lockProject } from "./engine.mjs";
import { json } from "./support.mjs";
export function uid(label) {
  const bytes = createHash("sha256")
    .update(`thermite-evals-v1/${label}`)
    .digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function syntheticDocuments() {
  const devices = Array.from({ length: 300 }, (_, i) => ({
    uid: uid(`device/${i}`),
    kind: "device",
    designation: `X${i + 1}`,
    type:
      i % 10 === 0
        ? "scale:bus-node"
        : i % 10 === 1
          ? "core:junction-box-8"
          : "core:terminal-block-8",
  }));
  const endpoint = (i, pin) => ({
    device: devices[i].designation,
    terminal: i % 10 === 1 ? `X1.${pin}` : String(pin),
  });
  let seed = 0x13579bdf;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const wires = Array.from({ length: 1500 }, (_, i) => {
    // A binary tree backbone guarantees branches. Seeded additional edges add
    // cycles, cross-pin joins, hub landings and components of varying sizes.
    const a =
      i < 299 ? endpoint(i + 1, 1) : endpoint(next() % 300, (next() % 6) + 1);
    let b =
      i < 299
        ? endpoint(Math.floor(i / 2), 1)
        : endpoint(i % 7 === 0 ? 0 : next() % 300, (next() % 6) + 1);
    if (a.device === b.device && a.terminal === b.terminal)
      b = endpoint(
        (devices.findIndex((d) => d.designation === a.device) + 1) % 300,
        2,
      );
    return {
      uid: uid(`wire/${i}`),
      kind: "wire",
      designation: `W${i + 1}`,
      endpoints: [a, b],
    };
  });
  return {
    "system.json": {
      format: "electrical-system/0.1",
      project: { name: "Synthetic branched graph: 300 devices, 1500 wires" },
      sources: ["objects.json"],
      libraries: [
        { name: "core", version: "0.1.0" },
        { name: "scale", version: "1.0.0", path: "library" },
      ],
    },
    "objects.json": { objects: [...devices, ...wires] },
    "library/library.json": {
      name: "scale",
      version: "1.0.0",
      sources: ["types.json"],
    },
    "library/types.json": {
      types: [
        {
          kind: "device_type",
          id: "scale:bus-node",
          terminals: Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => [String(i + 1), {}]),
          ),
          functions: {
            bus: {
              kind: "bus",
              terminals: ["1", "2", "3", "4", "5", "6", "7", "8"],
            },
          },
          internal_relations: [],
          symbol: "thermite:terminal-strip",
        },
      ],
    },
  };
}
export async function synthetic(project) {
  await mkdir(join(project, "library"), { recursive: true });
  for (const [file, value] of Object.entries(syntheticDocuments()))
    await writeFile(join(project, file), json(value));
  const locked = await lockProject(project);
  if (!locked.ok) throw new Error(json(locked));
}
