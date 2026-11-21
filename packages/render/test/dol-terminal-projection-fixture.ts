import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";
import {
  coreTypes,
  machineProbe,
} from "../../core-library/test/machine-fixtures.js";

// A renamed pass-through coil terminal with no selected contact to mask W906.
export async function terminalOnlyProbe(typeId = "core:relay-1co") {
  const type = (await coreTypes()).find((t) => t.id === typeId);
  const probe = await machineProbe(
    type,
    "control",
    typeId.includes("relay") ? "contact14" : "aux13",
  );
  try {
    const path = join(probe.root, "source.json");
    const source = JSON.parse(await readFile(path, "utf8"));
    for (const object of source.objects) {
      if (object.kind === "device" && object.designation === "DUT")
        object.designation = "AUX7";
      if (object.kind === "wire")
        for (const endpoint of object.endpoints)
          if (endpoint.device === "DUT") {
            endpoint.device = "AUX7";
            endpoint.terminal = "A1";
          }
    }
    await writeFile(path, JSON.stringify(source));
    const compiled = await compileProject(probe.root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    return { ...compiled, dispose: probe.dispose };
  } catch (error) {
    await probe.dispose();
    throw error;
  }
}
