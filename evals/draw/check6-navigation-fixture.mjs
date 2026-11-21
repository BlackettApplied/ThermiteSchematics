import { compileProject, serializeIr } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const read = async (p) => JSON.parse(await readFile(p, "utf8"));
export async function createNavigationProject() {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), "check6-navigation-"),
  );
  try {
    await cp("examples/motor-starter", directory, { recursive: true });
    await cp(
      "examples/network-pagination/library",
      join(directory, "network-library"),
      { recursive: true },
    );
    await cp(
      "examples/network-pagination/source.json",
      join(directory, "network-source.json"),
    );
    const system = await read(join(directory, "system.json"));
    const network = await read("examples/network-pagination/system.json");
    system.sources.push("network-source.json");
    system.libraries.push({ ...network.libraries[0], path: "network-library" });
    const lock = await read(join(directory, "electrical-system.lock.json"));
    const other = await read(
      "examples/network-pagination/electrical-system.lock.json",
    );
    lock.libraries["network-page-fixture"] = {
      ...other.libraries["network-page-fixture"],
      path: "network-library",
    };
    await writeFile(
      join(directory, "system.json"),
      JSON.stringify(system, null, 2) + "\n",
    );
    await writeFile(
      join(directory, "electrical-system.lock.json"),
      JSON.stringify(lock, null, 2) + "\n",
    );
    const compiled = await compileProject(directory);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    return { directory, compiled };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
export async function renderNavigationFixture(input, flow) {
  const command = await read(
    "examples/alpha/motor-starter-documentation.packet.json",
  );
  const request = {
    format: "schematic-packet-request/0.1",
    page: command.page,
    index: true,
    views: [
      { ...command.views[0], flow },
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "M1" },
        family: "power",
        flow,
      },
      { format: "communication-view-request/0.1", medium: "ethernet" },
    ],
  };
  const r = await renderSchematicPacket(
    input.compiled.ir,
    request,
    input.compiled.presentation,
  );
  if (!r.ok) throw Error(JSON.stringify(r.error));
  return {
    packet: r.value,
    ir: JSON.parse(serializeIr(input.compiled.ir)),
    request,
  };
}
