import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { json } from "./common.mjs";

export async function verifyShippedCore({
  runtime,
  entries,
  temporary,
  invoke,
  check,
}) {
  const core = await import(
    pathToFileURL(
      join(runtime, "node_modules/@thermite/core-library/dist/index.js"),
    ).href
  );
  for (const version of ["0.1.0", "0.2.0"]) {
    const entry = core.SHIPPED_CORE_VERSIONS[version];
    assert.equal(entry.fileInventory.length, version === "0.1.0" ? 14 : 34);
    for (const file of entry.fileInventory) {
      assert(
        entries.some(
          (item) => item.path === `node_modules/@thermite/core-library/${file}`,
        ),
        `Missing core ${version} file ${file}`,
      );
    }
    const shippedProject = join(temporary, `shipped-core-${version}`);
    await mkdir(shippedProject);
    await writeFile(
      join(shippedProject, "system.json"),
      json({
        format: "electrical-system/0.1",
        project: { name: `Shipped ${version}` },
        sources: ["devices.json"],
        libraries: [{ name: "core", version }],
      }),
    );
    await writeFile(
      join(shippedProject, "devices.json"),
      json({ objects: [] }),
    );
    invoke(["lock", shippedProject]);
    invoke(["validate", shippedProject]);
    const lock = JSON.parse(
      await readFile(
        join(shippedProject, "electrical-system.lock.json"),
        "utf8",
      ),
    );
    assert.equal(lock.libraries.core.version, version);
    assert.equal(lock.libraries.core.path, `ais-shipped:core@${version}`);
    assert.equal(lock.libraries.core.resolutionKind, "shipped");
    assert.equal(
      Object.keys(lock.libraries.core.files).length,
      version === "0.1.0" ? 14 : 34,
    );
  }
  check(
    "both shipped core inventories resolve and validate from the relocated release package",
  );
}
