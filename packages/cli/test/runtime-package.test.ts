import { spawnSync } from "node:child_process";
import {
  cp,
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  json,
  listFiles,
  manifestName,
  sha256,
  verifyEntries,
  runtimeFilename,
  verifyArchiveIdentity,
  isLicenseFile,
} from "../../../scripts/runtime-package/common.mjs";

type Entry = { path: string; type: string; bytes: Buffer };
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "thermite-runtime-unit-"));
  temporary.push(path);
  return path;
}
function fixture() {
  const contents: Record<string, string> = {
    "thermite.mjs": "// fixture launcher\n",
    "README.md": "Runtime fixture\n",
    LICENSE: "Apache fixture",
    NOTICE: "Notice fixture",
    "THIRD_PARTY_NOTICES.md": "Notices fixture",
    "third-party/sources.json": "{}",
    "third-party/ELK-SOURCE.md": "Source fixture",
    "node_modules/@thermite/cli/assets/fonts/OFL.txt": "OFL fixture",
    "node_modules/@thermite/core-library/LICENSE": "Apache fixture",
    "node_modules/@thermite/core-library/NOTICE": "Notice fixture",
    "node_modules/@thermite/cli/package.json": json({
      name: "@thermite/cli",
      version: "0.2.0",
      dependencies: { sample: "1.0.0", "@thermite/core-library": "0.2.0" },
    }),
    "node_modules/@thermite/core-library/package.json": json({
      name: "@thermite/core-library",
      version: "0.2.0",
    }),
    "node_modules/sample/package.json": json({
      name: "sample",
      version: "1.0.0",
      license: "MIT",
    }),
    "node_modules/sample/LICENSE": "MIT fixture",
    "bun.lock": json({
      lockfileVersion: 1,
      workspaces: {},
      packages: { sample: ["sample@1.0.0", "", {}, "sha512-test"] },
    }),
  };
  const entries: Entry[] = Object.entries(contents).map(([path, content]) => ({
    path,
    type: "file",
    bytes: Buffer.from(content),
  }));
  const manifest = {
    format: "thermite-runtime-release/0.1",
    version: "0.3.0-alpha.2",
    commit: "a".repeat(40),
    sourceUrl: `https://github.com/BlackettApplied/ThermiteSchematics/tree/${"a".repeat(40)}`,
    baseSourceUrl: `https://github.com/BlackettApplied/ThermiteSchematics/tree/${"a".repeat(40)}`,
    sourceDigest: "b".repeat(64),
    preview: false,
    runtime: "Bun 1.4.2",
    target: "darwin-arm64",
    dependencies: [
      {
        name: "sample",
        version: "1.0.0",
        path: "node_modules/sample",
        integrity: "sha512-test",
        licenses: ["LICENSE"],
      },
    ],
    files: [] as { path: string; size: number; sha256: string }[],
  };
  const seal = () => {
    manifest.files = entries
      .filter((entry) => entry.path !== manifestName)
      .map((entry) => ({
        path: entry.path,
        size: entry.bytes.length,
        sha256: sha256(entry.bytes),
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const prior = entries.findIndex((entry) => entry.path === manifestName);
    if (prior >= 0) entries.splice(prior, 1);
    entries.push({
      path: manifestName,
      type: "file",
      bytes: Buffer.from(json(manifest)),
    });
    return entries;
  };
  return { entries, manifest, seal };
}

describe("public runtime package boundary", () => {
  it("accepts a complete inventory and rejects tampered or unlisted bytes", () => {
    const value = fixture();
    expect(verifyEntries(value.seal()).preview).toBe(false);
    value.entries.find((entry) => entry.path === "thermite.mjs")!.bytes =
      Buffer.from("changed");
    expect(() => verifyEntries(value.entries)).toThrow(/digest mismatch/);
    value.seal();
    value.entries.push({
      path: "unexpected",
      type: "file",
      bytes: Buffer.from("extra"),
    });
    expect(() => verifyEntries(value.entries)).toThrow(/digest mismatch/);
  });
  it("rejects incomplete dependency attribution even when file hashes match", () => {
    const value = fixture();
    value.manifest.dependencies = [];
    expect(() => verifyEntries(value.seal())).toThrow(/dependency inventory/);
    const missingLicense = fixture();
    missingLicense.entries.splice(
      missingLicense.entries.findIndex(
        (entry) => entry.path === "node_modules/sample/LICENSE",
      ),
      1,
    );
    expect(() => verifyEntries(missingLicense.seal())).toThrow(
      /Missing dependency license/,
    );
  });
  it("rejects a dependency version not bound to the provenance lock", () => {
    const value = fixture();
    value.manifest.dependencies[0]!.integrity = "sha512-wrong";
    expect(() => verifyEntries(value.seal())).toThrow(
      /Invalid dependency inventory/,
    );
  });
  it("rejects missing transitive dependencies and extra development packages", () => {
    const value = fixture();
    value.entries.find(
      (entry) => entry.path === "node_modules/sample/package.json",
    )!.bytes = Buffer.from(
      json({
        name: "sample",
        version: "1.0.0",
        dependencies: { absent: "1.0.0" },
      }),
    );
    expect(() => verifyEntries(value.seal())).toThrow(
      /Missing runtime dependency/,
    );
    const extra = fixture();
    extra.entries.find(
      (entry) => entry.path === "node_modules/@thermite/cli/package.json",
    )!.bytes = Buffer.from(
      json({
        name: "@thermite/cli",
        dependencies: { "@thermite/core-library": "0.2.0" },
      }),
    );
    expect(() => verifyEntries(extra.seal())).toThrow(
      /Unreachable or development package/,
    );
  });
  it("binds release filenames and source URLs and requires explicit preview opt-in", () => {
    const { manifest } = fixture();
    expect(() =>
      verifyArchiveIdentity(manifest, runtimeFilename(manifest)),
    ).not.toThrow();
    expect(() => verifyArchiveIdentity(manifest, "renamed.zip")).toThrow(
      /filename/,
    );
    manifest.sourceUrl = "https://example.com/wrong";
    expect(() =>
      verifyArchiveIdentity(manifest, runtimeFilename(manifest)),
    ).toThrow(/source URL/);
    manifest.preview = true;
    expect(() =>
      verifyArchiveIdentity(manifest, runtimeFilename(manifest)),
    ).toThrow(/Preview/);
    expect(() =>
      verifyArchiveIdentity(manifest, runtimeFilename(manifest), {
        allowPreview: true,
      }),
    ).not.toThrow();
  });
  it("does not credit a dependency's child license or a source filename as license text", () => {
    for (const name of [
      "node_modules/child/LICENSE",
      "lib/license.js",
      "src/notice.ts",
      "copyright-check.js",
    ])
      expect(isLicenseFile(name)).toBe(false);
    for (const name of [
      "LICENSE",
      "LICENSE.md",
      "LICENSE.MIT",
      "MIT-LICENSE",
      "Apache-2.0-LICENSE",
      "brotli-vendor-LICENSE",
      "CopyrightNotice.txt",
    ])
      expect(isLicenseFile(name)).toBe(true);
    const value = fixture();
    value.manifest.dependencies[0]!.licenses = ["node_modules/child/LICENSE"];
    value.entries.push({
      path: "node_modules/sample/node_modules/child/LICENSE",
      type: "file",
      bytes: Buffer.from("Other license"),
    });
    expect(() => verifyEntries(value.seal())).toThrow(
      /Missing dependency license/,
    );
  });
  it("refuses a hoisted dependency outside the requested version range", () => {
    const value = fixture();
    value.entries.find(
      (entry) => entry.path === "node_modules/@thermite/cli/package.json",
    )!.bytes = Buffer.from(
      json({
        name: "@thermite/cli",
        dependencies: { sample: "^2.0.0", "@thermite/core-library": "0.2.0" },
      }),
    );
    expect(() => verifyEntries(value.seal())).toThrow(/version mismatch/);
  });
  it("rejects source caches and private paths even if listed in a manifest", () => {
    for (const path of [
      ".env",
      "projects/customer.json",
      "node_modules/@thermite/cli/dist/.tsbuildinfo",
      "node_modules/@thermite/cli/dist/tsconfig.tsbuildinfo",
      "node_modules/sample/.env.local",
    ]) {
      const value = fixture();
      value.entries.push({ path, type: "file", bytes: Buffer.from("private") });
      expect(() => verifyEntries(value.seal())).toThrow(
        /Unexpected runtime payload/,
      );
    }
  });
  it("refuses symlinks and hardlinks instead of copying checkout/cache files", async () => {
    for (const kind of ["symbolic", "hard"]) {
      const root = await directory();
      await writeFile(join(root, "real"), "bytes");
      if (kind === "symbolic")
        await symlink(join(root, "real"), join(root, "alias"));
      else await link(join(root, "real"), join(root, "alias"));
      await expect(listFiles(root)).rejects.toThrow(/ordinary files/);
    }
  });
  it("gives package-specific repair advice when the payload is incomplete", async () => {
    const root = await directory();
    const launcher = join(root, "thermite.mjs");
    await cp(resolve("scripts/runtime-package/thermite.mjs"), launcher);
    const result = spawnSync(process.execPath, [launcher, "--help"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("extract a fresh copy");
    expect(result.stderr).not.toContain("bun install");
  });
  it("refuses missing or unverified Bun before importing runtime code", async () => {
    const code = (
      await readFile(resolve("scripts/runtime-package/thermite.mjs"), "utf8")
    ).replace(/^#!.*\n/, "");
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    for (const runtime of [{}, { Bun: { version: "0.0.0" } }]) {
      let stderr = "";
      const process = {
        exitCode: 0,
        stderr: {
          write: (value: string) => {
            stderr += value;
          },
        },
      };
      await new AsyncFunction("globalThis", "process", code)(runtime, process);
      expect(process.exitCode).toBe(2);
      expect(stderr).toContain("requires Bun 1.4.2");
    }
  });
});
