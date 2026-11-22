import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  link,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../../../scripts/entrypoint.mjs";
import { createRuntimeZip } from "../../../scripts/runtime-package/zip.mjs";
import {
  readSafeZipArchive,
  extractSafeZipArchive,
} from "../../../scripts/safe-zip-reader.mjs";
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
    NOTICE: `Thermite Schematics

Bundled Noto fonts are Copyright 2018 The Noto Project Authors and are
licensed under the SIL Open Font License 1.1, not the Apache License.
See node_modules/@thermite/cli/assets/fonts/OFL.txt and THIRD_PARTY_NOTICES.md.
`,
    "THIRD_PARTY_NOTICES.md": "Notices fixture",
    "third-party/sources.json": "{}",
    "third-party/ELK-SOURCE.md": "Source fixture",
    "node_modules/@thermite/cli/assets/fonts/OFL.txt": "OFL fixture",
    "node_modules/@thermite/cli/assets/fonts/NotoSansMono-Regular.ttf":
      "Monospace font fixture",
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
  it("round-trips deterministic portable ZIPs with spaces, Unicode and empty files", async () => {
    const root = await directory();
    await mkdir(join(root, "nested space"));
    await writeFile(join(root, "nested space", "café.json"), '{"ok":true}');
    await writeFile(join(root, "empty"), "");
    const first = await createRuntimeZip(root);
    expect(await createRuntimeZip(root)).toEqual(first);
    // All CI platforms must produce the same fixed ZIP fixture bytes.
    expect(sha256(first)).toBe(
      "14c5b9dd61cd75a4444e570d7f8919cee1e9e117a1e38925ee9081fb78cb9a15",
    );
    const entries = await readSafeZipArchive(first);
    expect(entries.map((entry: Entry) => entry.path)).toEqual([
      "empty",
      "nested space/café.json",
    ]);
    const parent = await directory();
    await extractSafeZipArchive(first, join(parent, "extracted"));
    expect(
      await readFile(
        join(parent, "extracted", "nested space", "café.json"),
        "utf8",
      ),
    ).toBe('{"ok":true}');
  });
  it("binds archive names to each supported platform and refuses unknown targets", () => {
    for (const target of [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-x64",
    ]) {
      const value = fixture();
      value.manifest.target = target;
      expect(verifyEntries(value.seal()).target).toBe(target);
      expect(runtimeFilename(value.manifest)).toContain(`-${target}-bun-`);
    }
    const value = fixture();
    value.manifest.target = "unknown-target";
    expect(() => verifyEntries(value.seal())).toThrow(
      /Invalid runtime manifest/,
    );
  });
  it("requires the monospace font even when removed from the manifest", () => {
    const value = fixture(),
      path = "node_modules/@thermite/cli/assets/fonts/NotoSansMono-Regular.ttf";
    value.entries.splice(
      value.entries.findIndex((entry) => entry.path === path),
      1,
    );
    expect(() => verifyEntries(value.seal())).toThrow(
      `Missing runtime resource: ${path}`,
    );
  });
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
  it("rejects a font notice pointing outside the packaged layout even when hashes match", () => {
    for (const path of ["packages/cli/assets/fonts/OFL.txt", "fonts/OFL.txt"]) {
      const value = fixture();
      const notice = value.entries.find((entry) => entry.path === "NOTICE")!;
      notice.bytes = Buffer.from(
        notice.bytes
          .toString("utf8")
          .replace("node_modules/@thermite/cli/assets/fonts/OFL.txt", path),
      );
      expect(() => verifyEntries(value.seal())).toThrow(
        /NOTICE must reference the packaged font license/,
      );
    }
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
      "evals/README.md",
      "evals/corpus/topology/system.json",
      "evals/out/checkpoint/summary.json",
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

it("includes both core versions in the public release-package file boundary", async () => {
  const { SHIPPED_CORE_VERSIONS, resolveShippedCoreLibrary } =
    await import("@thermite/core-library");
  const root = resolveShippedCoreLibrary().packageRootPath;
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const inventory = new Set(
    (await listFiles(root)).filter((file) =>
      manifest.files.some((path: string) => file.startsWith(`${path}/`)),
    ),
  );
  expect(Object.keys(SHIPPED_CORE_VERSIONS)).toEqual(["0.1.0", "0.2.0"]);
  for (const [version, entry] of Object.entries(SHIPPED_CORE_VERSIONS)) {
    expect(entry.fileInventory).toHaveLength(version === "0.1.0" ? 14 : 34);
    for (const file of entry.fileInventory)
      expect(inventory.has(file), file).toBe(true);
    expect(
      JSON.parse(
        await readFile(join(root, entry.directory, "library.json"), "utf8"),
      ),
    ).toMatchObject({ name: "core", version });
  }
});

describe("pack script entrypoints", () => {
  const packScriptPaths = [
    "scripts/pack-alpha.mjs",
    "scripts/runtime-package/pack.mjs",
  ];
  const nodeImportEvalScript =
    "import { pathToFileURL } from 'node:url'; await import(pathToFileURL(process.argv[1]).href);";
  const nodeProbe = spawnSync(
    "node",
    [
      "-e",
      "process.stdout.write(JSON.stringify({ version: process.version, typescript: Boolean(process.features?.typescript) }))",
    ],
    { encoding: "utf8" },
  );
  function nodeTypeStrippingSkipReason(probe: {
    status: number | null;
    stdout?: string | Buffer | null;
  }): string | null {
    if (probe.status !== 0) {
      return "Node with default TypeScript stripping is not available on PATH";
    }
    try {
      const info: unknown = JSON.parse(String(probe.stdout ?? ""));
      if (
        typeof info === "object" &&
        info !== null &&
        "typescript" in info &&
        info.typescript === true
      ) {
        return null;
      }
      const version =
        typeof info === "object" &&
        info !== null &&
        "version" in info &&
        typeof info.version === "string"
          ? info.version
          : "unknown";
      return `Node ${version} on PATH does not enable process.features.typescript by default`;
    } catch {
      return "Node capability probe returned unreadable output";
    }
  }
  function stripNodeTypeStrippingWarning(stderr: string): string {
    let sawTypeStrippingWarning = false;
    const kept: string[] = [];
    for (const line of stderr.split(/\r?\n/)) {
      if (
        /^\(node:\d+\) ExperimentalWarning: Type Stripping is an experimental feature\b/.test(
          line,
        )
      ) {
        sawTypeStrippingWarning = true;
        continue;
      }
      if (
        sawTypeStrippingWarning &&
        line ===
          "(Use `node --trace-warnings ...` to show where the warning was created)"
      ) {
        continue;
      }
      kept.push(line);
    }
    return sawTypeStrippingWarning ? kept.join("\n") : stderr;
  }
  const nodeSkipReason = nodeTypeStrippingSkipReason(nodeProbe);

  async function tryFileSymlink(
    target: string,
    linkPath: string,
  ): Promise<string | null> {
    try {
      await symlink(target, linkPath, "file");
      return linkPath;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM")
        return null;
      throw error;
    }
  }

  async function alphaPackFixture(dirty = false): Promise<string> {
    const root = await directory();
    for (const rel of [
      "scripts/pack-alpha.mjs",
      "scripts/entrypoint.mjs",
      "packages/schema/src/release-version.ts",
    ]) {
      const dest = join(root, rel);
      await mkdir(join(dest, ".."), { recursive: true });
      await cp(resolve(rel), dest);
    }
    const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: { "alpha:pack": pkg.scripts["alpha:pack"] },
      }) + "\n",
    );
    const git = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    };
    git(["init", "-q"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    ]);
    if (dirty) {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          type: "module",
          scripts: { "alpha:pack": pkg.scripts["alpha:pack"] },
          dirty: true,
        }) + "\n",
      );
    }
    return root;
  }

  it("imports both pack scripts without side effects in Bun", async () => {
    for (const name of packScriptPaths) {
      const target = resolve(name);
      await expect(import(pathToFileURL(target).href)).resolves.toBeDefined();
    }
  });

  it("imports both pack scripts without side effects in Node", async () => {
    if (nodeSkipReason) {
      // scripts/health-ratchet.mjs enforces a monotonic global skippedTests ceiling,
      // so skip with an explicit log message instead of a Vitest skip call.
      console.info(
        `Skipped Node pack entrypoint import test: ${nodeSkipReason}`,
      );
      return;
    }
    const dir = await directory();
    for (const name of packScriptPaths) {
      const target = resolve(name);
      const linkPath = await tryFileSymlink(
        target,
        join(dir, `link#${name.replace(/[/\\]/g, "-")}`),
      );
      for (const entry of linkPath ? [target, linkPath] : [target]) {
        const result = spawnSync(
          "node",
          ["--input-type=module", "-e", nodeImportEvalScript, entry],
          { encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe("");
        expect(stripNodeTypeStrippingWarning(result.stderr)).toBe("");
      }
    }
  });

  it("gates Node subprocess tests on process.features.typescript and filters only type-stripping warnings", () => {
    expect(nodeTypeStrippingSkipReason({ status: null, stdout: "" })).toMatch(
      /not available/,
    );
    expect(
      nodeTypeStrippingSkipReason({
        status: 0,
        stdout: JSON.stringify({ version: "v20.19.5", typescript: false }),
      }),
    ).toMatch(/v20\.19\.5/);
    expect(
      nodeTypeStrippingSkipReason({
        status: 0,
        stdout: JSON.stringify({ version: "v23.5.0", typescript: false }),
      }),
    ).toMatch(/v23\.5\.0/);
    expect(
      nodeTypeStrippingSkipReason({
        status: 0,
        stdout: JSON.stringify({ version: "v24.2.0", typescript: true }),
      }),
    ).toBeNull();
    expect(stripNodeTypeStrippingWarning("")).toBe("");
    expect(
      stripNodeTypeStrippingWarning(
        "(node:44965) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\n",
      ),
    ).toBe("");
    expect(
      stripNodeTypeStrippingWarning(
        "(node:44965) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\n",
      ),
    ).toContain("SQLite");
    expect(
      stripNodeTypeStrippingWarning(
        "(node:44965) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\nunexpected stderr\n",
      ),
    ).toBe("unexpected stderr\n");
  });

  it("evaluates import.meta.main and falls back to realpath equality except under eval/print", async () => {
    const dir = await directory();
    const real = resolve("scripts/pack-alpha.mjs");
    const other = resolve("scripts/runtime-package/pack.mjs");
    const url = pathToFileURL(real).href;
    expect(isMainModule({ main: true, url }, other, ["-e", "1"])).toBe(true);
    expect(isMainModule({ main: false, url }, real, [])).toBe(false);
    expect(isMainModule({ main: "yes", url }, real, [])).toBe(false);
    expect(isMainModule({ url }, real, [])).toBe(true);
    expect(isMainModule({ url }, real, ["--experimental-strip-types"])).toBe(
      true,
    );
    expect(isMainModule({ url }, other, [])).toBe(false);
    expect(isMainModule({ url }, undefined, [])).toBe(false);
    expect(isMainModule({ url }, join(dir, "missing.mjs"), [])).toBe(false);
    for (const evalArgv of [
      ["-e", "await import(process.argv[1])"],
      ["--eval", "await import(process.argv[1])"],
      ["--eval=await import(process.argv[1])"],
      ["-p", "1"],
      ["--print", "1"],
      ["--print=1"],
      ["-pe", "1"],
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        nodeImportEvalScript,
      ],
    ]) {
      expect(isMainModule({ url }, real, evalArgv), evalArgv.join(" ")).toBe(
        false,
      );
    }
    const linkPath = await tryFileSymlink(
      real,
      join(dir, "pack-alpha-link.mjs"),
    );
    if (!linkPath) return;
    expect(isMainModule({ url }, linkPath, [])).toBe(true);
    expect(
      isMainModule({ url }, linkPath, [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        nodeImportEvalScript,
      ]),
    ).toBe(false);
  });

  it("creates the source archive and both sidecars when pack-alpha is invoked with --extra", async () => {
    const fixtureRoot = await alphaPackFixture(false);
    const result = spawnSync(
      process.execPath,
      [join(fixtureRoot, "scripts/pack-alpha.mjs"), "--extra"],
      { cwd: fixtureRoot, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const files = (await readdir(join(fixtureRoot, "alpha-out"))).sort();
    expect(files).toHaveLength(3);
    const archive = files.find((file) => file.endsWith(".zip"));
    expect(archive).toBeDefined();
    expect(files).toEqual([archive, `${archive}.json`, `${archive}.sha256`]);
  });

  it("reaches main via direct, bun-run, and symlinked invocation in Bun", async () => {
    const dir = await directory();
    const alphaRoot = await alphaPackFixture(true);
    const alphaTarget = join(alphaRoot, "scripts/pack-alpha.mjs");
    const alphaLink = await tryFileSymlink(
      alphaTarget,
      join(dir, "alpha-pack.mjs"),
    );
    const alphaBunRun = spawnSync(process.execPath, ["run", "alpha:pack"], {
      cwd: alphaRoot,
      encoding: "utf8",
    });
    expect(alphaBunRun.status).not.toBe(0);
    expect(alphaBunRun.stderr).toMatch(/Commit tracked alpha changes/);
    for (const entry of alphaLink ? [alphaTarget, alphaLink] : [alphaTarget]) {
      const result = spawnSync(process.execPath, [entry], {
        cwd: alphaRoot,
        encoding: "utf8",
      });
      expect(result.status, `bun ${entry}`).not.toBe(0);
      expect(result.stderr, `bun ${entry}`).toMatch(
        /Commit tracked alpha changes/,
      );
    }

    const packTarget = resolve("scripts/runtime-package/pack.mjs");
    const packLink = await tryFileSymlink(
      packTarget,
      join(dir, "package-pack.mjs"),
    );
    const packUsage = /Usage: bun run package:pack \[--preview\]/;
    const packBunRun = spawnSync(
      process.execPath,
      ["run", "package:pack", "--invalid-entrypoint-probe"],
      { encoding: "utf8" },
    );
    expect(packBunRun.status).not.toBe(0);
    expect(packBunRun.stderr).toMatch(packUsage);
    for (const entry of packLink ? [packTarget, packLink] : [packTarget]) {
      const result = spawnSync(
        process.execPath,
        [entry, "--invalid-entrypoint-probe"],
        { encoding: "utf8" },
      );
      expect(result.status, `bun ${entry}`).not.toBe(0);
      expect(result.stderr, `bun ${entry}`).toMatch(packUsage);
    }
  });

  it("reaches main via direct and symlinked invocation in Node", async () => {
    if (nodeSkipReason) {
      console.info(
        `Skipped Node pack entrypoint invocation test: ${nodeSkipReason}`,
      );
      return;
    }
    const dir = await directory();
    const alphaRoot = await alphaPackFixture(true);
    const alphaTarget = join(alphaRoot, "scripts/pack-alpha.mjs");
    const alphaLink = await tryFileSymlink(
      alphaTarget,
      join(dir, "alpha-pack-node.mjs"),
    );
    for (const entry of alphaLink ? [alphaTarget, alphaLink] : [alphaTarget]) {
      const result = spawnSync("node", [entry], {
        cwd: alphaRoot,
        encoding: "utf8",
      });
      expect(result.status, `node ${entry}`).not.toBe(0);
      expect(result.stderr, `node ${entry}`).toMatch(
        /Commit tracked alpha changes/,
      );
    }

    const packTarget = resolve("scripts/runtime-package/pack.mjs");
    const packLink = await tryFileSymlink(
      packTarget,
      join(dir, "package-pack-node.mjs"),
    );
    const packUsage = /Usage: bun run package:pack \[--preview\]/;
    for (const entry of packLink ? [packTarget, packLink] : [packTarget]) {
      const result = spawnSync("node", [entry, "--invalid-entrypoint-probe"], {
        encoding: "utf8",
      });
      expect(result.status, `node ${entry}`).not.toBe(0);
      expect(result.stderr, `node ${entry}`).toMatch(packUsage);
    }
  });
});
