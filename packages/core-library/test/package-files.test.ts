import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SHIPPED_CORE_DISPLAY_ROOT,
  SHIPPED_CORE_FILE_INVENTORY,
  SHIPPED_CORE_LIBRARY_LOCATOR,
  SHIPPED_CORE_LIBRARY_NAME,
  SHIPPED_CORE_LIBRARY_VERSION,
  SHIPPED_CORE_PACKAGE_NAME,
  resolveShippedCoreLibrary,
} from "../src/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");

async function ordinaryFileInventory(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(path: string): Promise<void> {
    const stats = await lstat(path);
    expect(stats.isSymbolicLink()).toBe(false);
    if (stats.isDirectory()) {
      const entries = await readdir(path);
      entries.sort();
      for (const entry of entries) await visit(join(path, entry));
      return;
    }
    expect(stats.isFile()).toBe(true);
    expect(stats.nlink).toBe(1);
    files.push(relative(packageRoot, path).split(sep).join("/"));
  }

  await visit(root);
  files.sort();
  return files;
}

describe("shipped core package files", () => {
  it("exports the exact frozen core identity, locator, and fourteen-file inventory", () => {
    expect(SHIPPED_CORE_PACKAGE_NAME).toBe("@thermite/core-library");
    expect(SHIPPED_CORE_LIBRARY_NAME).toBe("core");
    expect(SHIPPED_CORE_LIBRARY_VERSION).toBe("0.1.0");
    expect(SHIPPED_CORE_LIBRARY_LOCATOR).toBe("ais-shipped:core@0.1.0");
    expect(SHIPPED_CORE_DISPLAY_ROOT).toBe("@thermite/core-library");
    expect(SHIPPED_CORE_FILE_INVENTORY).toEqual([
      "library/library.json",
      "library/types/breaker-3p.json",
      "library/types/cable-2pair-shielded.json",
      "library/types/contactor-3p-1no.json",
      "library/types/junction-box-8.json",
      "library/types/limit-switch-2wire.json",
      "library/types/motor-3ph.json",
      "library/types/overload-3p-1nc.json",
      "library/types/plc-compact.json",
      "library/types/prox-pnp-3wire.json",
      "library/types/psu-24vdc.json",
      "library/types/pushbutton-nc.json",
      "library/types/supply-480v-3ph.json",
      "library/types/terminal-block-8.json",
    ]);
    expect(Object.isFrozen(SHIPPED_CORE_FILE_INVENTORY)).toBe(true);
  });

  it("keeps the package library tree ordinary, link-free, and exactly inventoried", async () => {
    await expect(
      ordinaryFileInventory(join(packageRoot, "library")),
    ).resolves.toEqual(SHIPPED_CORE_FILE_INVENTORY);
  });

  it("declares only the shipped runtime, library, README, and Apache-2.0 notices", async () => {
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      private: boolean;
      license: string;
      exports: Record<string, unknown>;
      files: string[];
    };
    expect(manifest).toMatchObject({
      name: "@thermite/core-library",
      version: "0.2.0",
      private: true,
      license: "Apache-2.0",
    });
    expect(Object.keys(manifest.exports)).toEqual(["."]);
    expect(manifest.files).toEqual([
      "dist",
      "library",
      "README.md",
      "LICENSE",
      "NOTICE",
    ]);
    await expect(readFile(join(packageRoot, "LICENSE"))).resolves.toEqual(
      await readFile(join(repositoryRoot, "LICENSE")),
    );
  });

  it("resolves from the module location without consulting cwd or environment", () => {
    const resolution = resolveShippedCoreLibrary(
      new URL("../dist/index.js", import.meta.url).href,
    );
    expect(resolution).toEqual({
      packageRootPath: packageRoot,
      libraryRootPath: join(packageRoot, "library"),
      displayRoot: "@thermite/core-library",
      locator: "ais-shipped:core@0.1.0",
    });
    expect(Object.isFrozen(resolution)).toBe(true);
  });
});
