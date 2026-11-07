import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

const root = resolve("packages/core-library");
describe("side-by-side core versions", () => {
  it("resolves each exact version without moving the old library", () => {
    expect(core).toHaveProperty("resolveShippedCoreLibraryVersion");
    for (const version of ["0.1.0", "0.2.0"]) {
      const entry = core.SHIPPED_CORE_VERSIONS[version];
      const result = core.resolveShippedCoreLibraryVersion(version);
      expect(result?.libraryRootPath).toBe(resolve(root, entry.directory));
      expect(result?.locator).toBe(`ais-shipped:core@${version}`);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.fileInventory)).toBe(true);
    }
    expect(core.resolveShippedCoreLibraryVersion("9.9.9")).toBeUndefined();
    expect(core.resolveShippedCoreLibraryVersion("toString")).toBeUndefined();
    expect(core.resolveShippedCoreLibraryVersion("0.1.0")).toEqual(
      core.resolveShippedCoreLibrary(),
    );
  });
});

it("pins every original 0.1.0 byte", async () => {
  const pins = {
    "library/library.json":
      "ba244e2a3ecc93fb05f482811e2e8f3b3f0b351adfd575604fc035d739309532",
    "library/types/breaker-3p.json":
      "63c93a0a3eb7e76a52af115ec7abf8b734ec4d23baca4e6ec9816d90a11bd7d7",
    "library/types/cable-2pair-shielded.json":
      "d3b5b9561afd3301c0ad8082339897759aafafa156813b9baab92ff4a35087e9",
    "library/types/contactor-3p-1no.json":
      "ac4c6674860d33e0239db434b415a80fbc62189dc2e38264c725f9c2d876b2a3",
    "library/types/junction-box-8.json":
      "453210d1b7f6a17c18d36a6ee7f14b99d46a77eca382576d86d276f0868fc0a3",
    "library/types/limit-switch-2wire.json":
      "999036ee4d68b5a450bd07785a4b0d4cc920f5cebfa56f77790b35cb2fc75611",
    "library/types/motor-3ph.json":
      "46976801a683440c37c7e907533fd953c65b46961850fe7209e6c8dce128cd81",
    "library/types/overload-3p-1nc.json":
      "4b689313a9129b0ec427a12e8279fed4ef450165ac4d4515ad6391abc334d639",
    "library/types/plc-compact.json":
      "adfe8783aec27514d3de1a926c6319cf19218055f5c2e4c4f447985982881bda",
    "library/types/prox-pnp-3wire.json":
      "ddc8173a977ff6271da5b937fcccb643201fc944d02ebad2af844159b536b875",
    "library/types/psu-24vdc.json":
      "224a909488507c5e914e5dc9fde37a7b428fc62b764dc8c0c12a0d61e9349837",
    "library/types/pushbutton-nc.json":
      "087f37dabe45086e6c02728b58d76c5deb2412004152e22d1cb9e9eecfc6ead3",
    "library/types/supply-480v-3ph.json":
      "2d4df5a52a995a2681f68a8b5876f5ac9f4b2b1bf404ca7ae2c2c559a852fa4c",
    "library/types/terminal-block-8.json":
      "9d40147f806a9b10f2b37ee3b136b4a6473135c2500b17bb727eba9196de9825",
  };
  for (const [file, sha] of Object.entries(pins)) {
    expect(
      createHash("sha256")
        .update(await readFile(resolve(root, file)))
        .digest("hex"),
      file,
    ).toBe(sha);
  }
});

it("retains the L0 electrical fields in every original 0.2.0 model", async () => {
  const required: Record<string, string[]> = {
    "breaker-3p": [],
    "cable-2pair-shielded": [],
    "contactor-3p-1no": ["A1", "A2"],
    "junction-box-8": [],
    "limit-switch-2wire": ["13", "14"],
    "motor-3ph": ["U", "V", "W", "PE"],
    "overload-3p-1nc": ["95", "96"],
    "plc-compact": ["L+", "M"],
    "prox-pnp-3wire": ["1", "3"],
    "psu-24vdc": ["L", "N"],
    "pushbutton-nc": ["11", "12"],
    "supply-480v-3ph": ["PE"],
    "terminal-block-8": [],
  };
  const { CORE_SYMBOL_BINDINGS, SYMBOL_PROFILES } =
    await import("@thermite/schema");
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  const oldFiles = core.SHIPPED_CORE_FILE_INVENTORY.slice(1);
  const nextFiles = oldFiles.map((file) =>
    file.replace(/^library\//u, "versions/0.2.0/"),
  );
  expect(nextFiles).toHaveLength(13);
  for (const [index, file] of nextFiles.entries()) {
    const old = JSON.parse(
      await readFile(resolve(root, oldFiles[index]!), "utf8"),
    ).types[0];
    const next = JSON.parse(await readFile(resolve(root, file), "utf8"))
      .types[0];
    const name = next.id.slice("core:".length);
    expect(readme).toMatch(new RegExp(`^\\|\\s+${name}\\s+\\|`, "m"));
    if (next.kind === "cable_type") {
      expect(next).toEqual(old);
      expect(readme).toContain("profile/coverage-field exception");
      expect(readme).toContain("shield/drain termination");
      expect(readme).toContain("**Reviewed partial:**");
      continue;
    }
    expect(next.symbol).toBe(
      CORE_SYMBOL_BINDINGS.find((b) => b.typeId === old.id)!.equivalent,
    );
    expect(SYMBOL_PROFILES.some((p) => p.id === next.symbol)).toBe(true);
    expect(next.connectionCoverage).toMatchObject({ status: "generic" });
    expect(next.connectionCoverage.notes).toMatch(
      /^Reviewed generic interface:/,
    );
    expect(next.connectionCoverage.notes).toContain("Unmodeled:");
    expect(
      Object.entries(next.terminals)
        .filter(([, t]: [string, any]) => t.required)
        .map(([key]) => key),
    ).toEqual(required[name]);
    const normalized = structuredClone(next);
    normalized.symbol = old.symbol;
    delete normalized.connectionCoverage;
    for (const t of Object.values(normalized.terminals) as any[])
      delete t.required;
    expect(normalized).toEqual(old);
  }
});

it("ships exactly the original cable bytes in 0.2.0", async () => {
  expect(
    await readFile(
      resolve(root, "versions/0.2.0/types/cable-2pair-shielded.json"),
    ),
  ).toEqual(
    await readFile(resolve(root, "library/types/cable-2pair-shielded.json")),
  );
});
