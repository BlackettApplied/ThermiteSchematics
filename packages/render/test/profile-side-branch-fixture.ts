import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compileProject,
  loadProject,
  writeLibraryLock,
} from "@thermite/compiler";
export async function sideBranch(
  device: string,
  terminal: string,
  options: { removeWire?: string; contact?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "thermite-side-branch-"));
  try {
    await cp(resolve("examples/motor-starter"), root, { recursive: true });
    const edit = async (file: string, update: (v: any) => void) => {
      const value = JSON.parse(await readFile(join(root, file), "utf8"));
      update(value);
      await writeFile(join(root, file), JSON.stringify(value));
    };
    await mkdir(join(root, "local"));
    await writeFile(
      join(root, "local/library.json"),
      JSON.stringify({
        name: "local",
        version: "0.1.0",
        sources: ["types.json"],
      }),
    );
    await writeFile(
      join(root, "local/types.json"),
      JSON.stringify({
        types: [
          {
            kind: "device_type",
            id: options.contact ? "local:aux-contact" : "local:pe-bar",
            description: "Unsupported side branch",
            ...(options.contact ? { symbol: "iec:indicator-light" } : {}),
            terminals: {
              "1": { role: "protective_earth" },
              "2": { role: "protective_earth" },
            },
            functions: options.contact
              ? {
                  c: {
                    kind: "contact",
                    normal_state: "open",
                    terminals: ["1", "2"],
                  },
                }
              : { bar: { kind: "bus", terminals: ["1", "2"] } },
            internal_relations: [],
          },
        ],
      }),
    );
    await edit("system.json", (v) =>
      v.libraries.push({ name: "local", version: "0.1.0", path: "local" }),
    );
    await edit("devices/equipment.json", (v) =>
      v.objects.push({
        kind: "device",
        uid: "11111111-1111-4111-8111-111111111111",
        designation: options.contact ? "X1" : "PE1",
        type: options.contact ? "local:aux-contact" : "local:pe-bar",
      }),
    );
    await edit("connections/control-chain.json", (v) =>
      v.objects.push({
        kind: "wire",
        uid: "22222222-2222-4222-8222-222222222222",
        designation: "W-X",
        endpoints: [
          { device, terminal },
          { device: options.contact ? "X1" : "PE1", terminal: "1" },
        ],
      }),
    );
    if (options.removeWire)
      for (const file of await readdir(join(root, "connections")))
        if (file.endsWith(".json"))
          await edit(`connections/${file}`, (v) => {
            v.objects = v.objects.filter(
              (o: any) => o.designation !== options.removeWire,
            );
          });
    const loaded = await loadProject(root);
    if (!loaded.ok) throw Error(JSON.stringify(loaded.diagnostics));
    await writeLibraryLock(loaded.project);
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    return compiled.ir;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
