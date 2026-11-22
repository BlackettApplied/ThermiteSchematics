import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readBunLock } from "../../../scripts/read-bun-lock.mjs";
import { CLI_VERSION } from "../../cli/src/version.js";
import { THERMITE_SCHEMATICS_PRODUCT_VERSION } from "../../render/src/product-version.js";
import {
  auditTask1RepositorySources,
  auditTask1SourceTexts,
  trackedTestFiles,
  parseTrackedTestFiles,
} from "../../../scripts/run-vitest-and-audit.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const repositoryRoot = resolve(packageRoot, "../..");

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
  readonly license: string;
  readonly packageManager?: string;
  readonly workspaces?: readonly string[];
  readonly engines: { readonly bun: string };
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: unknown;
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
}

async function workspaceManifestPaths(
  root: PackageManifest,
): Promise<readonly { lockKey: string; path: string }[]> {
  const paths: { lockKey: string; path: string }[] = [];
  for (const workspace of root.workspaces ?? []) {
    if (workspace.endsWith("/*")) {
      const parent = workspace.slice(0, -2);
      const entries = await readdir(join(repositoryRoot, parent), {
        withFileTypes: true,
      });
      for (const entry of entries.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      )) {
        if (entry.isDirectory()) {
          paths.push({
            lockKey: `${parent}/${entry.name}`,
            path: join(repositoryRoot, parent, entry.name, "package.json"),
          });
        }
      }
    } else {
      paths.push({
        lockKey: workspace,
        path: join(repositoryRoot, ...workspace.split("/"), "package.json"),
      });
    }
  }
  return paths;
}

describe("M8 Task 1 package metadata", () => {
  it("keeps every current and future workspace private, Apache-2.0, and on the v0.2.0 floor", async () => {
    const root = await readManifest(join(repositoryRoot, "package.json"));
    const workspacePaths = await workspaceManifestPaths(root);
    const lock = await readBunLock(repositoryRoot);
    const records = [
      { lockKey: "", manifest: root },
      ...(await Promise.all(
        workspacePaths.map(async ({ lockKey, path }) => ({
          lockKey,
          manifest: await readManifest(path),
        })),
      )),
    ];

    expect(root.packageManager).toBe("bun@1.4.2");
    expect(new Set(records.map(({ manifest }) => manifest.name)).size).toBe(
      records.length,
    );
    for (const { lockKey, manifest } of records) {
      expect(manifest).toMatchObject({
        version: "0.2.0",
        private: true,
        license: "Apache-2.0",
        engines: { bun: ">=1.4.2" },
      });
      expect(manifest.publishConfig).toBeUndefined();
      expect(manifest.scripts?.publish).toBeUndefined();
      for (const [name, version] of Object.entries(
        manifest.dependencies ?? {},
      )) {
        if (name.startsWith("@thermite/")) expect(version).toBe("0.2.0");
      }
      expect(lock.workspaces[lockKey]).toMatchObject({
        name: manifest.name,
        ...(lockKey === "" ? {} : { version: "0.2.0" }),
      });
      expect(lock.workspaces[lockKey]?.dependencies).toEqual(
        manifest.dependencies,
      );
    }
    expect(CLI_VERSION).toBe("0.2.0");
    expect(THERMITE_SCHEMATICS_PRODUCT_VERSION).toBe("0.2.0");
  });

  it("keeps ordinary CI and the exact Apache-2.0 license byte-authoritative", async () => {
    await expect(auditTask1RepositorySources()).resolves.toBeUndefined();
    const [workflow, authority, license] = await Promise.all([
      readFile(join(repositoryRoot, ".github", "workflows", "ci.yml")),
      readFile(join(repositoryRoot, "scripts", "ordinary-ci.authority.yml")),
      readFile(join(repositoryRoot, "LICENSE"), "utf8"),
    ]);
    expect(workflow).toEqual(authority);
    expect(createHash("sha256").update(license, "utf8").digest("hex")).toBe(
      "ad543ace308605a41a2674704d31d247c95dc65d0c9b06729ccc2b866d987c02",
    );
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).toContain("Copyright 2026 BlackettApplied");
  });
});

async function trackedTestSources() {
  const tracked = await trackedTestFiles(repositoryRoot);
  return new Map(
    await Promise.all(
      [...tracked.keys()].map(
        async (file) =>
          [
            file,
            await readFile(join(repositoryRoot, ...file.split("/")), "utf8"),
          ] as const,
      ),
    ),
  );
}

describe("Source test accommodation guards", () => {
  it("rejects broadened predicates, changed reasons, extra calls, and runIf drift", async () => {
    const sources = await trackedTestSources();
    expect(() => auditTask1SourceTexts(sources)).not.toThrow();

    const retiredIdentifier = new Map(sources);
    const packageSmoke = "packages/compiler/test/package-smoke.test.ts";
    retiredIdentifier.set(
      packageSmoke,
      retiredIdentifier.get(packageSmoke)!.replace("core-library, ", ""),
    );
    expect(() => auditTask1SourceTexts(retiredIdentifier)).toThrow(
      /Retired Task-1 package-smoke text/u,
    );

    const broadened = new Map(sources);
    const helperFile = "packages/cli/test/agent-cli.test.ts";
    broadened.set(
      helperFile,
      broadened
        .get(helperFile)!
        .replace(
          `error.code === "EPERM"`,
          `(error.code === "EPERM" || error.code === "EACCES")`,
        ),
    );
    expect(() => auditTask1SourceTexts(broadened)).toThrow(
      /predicate changed/u,
    );

    const changedReason = new Map(sources);
    changedReason.set(
      packageSmoke,
      changedReason
        .get(packageSmoke)!
        .replace(
          "RELEASE-EVIDENCE-DENIED: seven-component package-smoke child-process tier is unavailable.",
          "RELEASE-EVIDENCE-DENIED: broader child-process tier is unavailable.",
        ),
    );
    expect(() => auditTask1SourceTexts(changedReason)).toThrow(
      /reason changed/u,
    );

    const extraCall = new Map(sources);
    extraCall.set(
      helperFile,
      `${extraCall.get(helperFile)!}${["\n", "sk", "ip(", `"extra"`, ");"].join("")}`,
    );
    expect(() => auditTask1SourceTexts(extraCall)).toThrow(/27 source-frozen/u);

    const runIfDrift = new Map(sources);
    const loaderFile = "packages/compiler/test/loader.test.ts";
    runIfDrift.set(
      loaderFile,
      runIfDrift
        .get(loaderFile)!
        .replaceAll(
          `process.platform === "win32"`,
          `process.platform !== "linux"`,
        ),
    );
    expect(() => auditTask1SourceTexts(runIfDrift)).toThrow(/Windows-only/u);
  });
});

it("rejects linked and unmerged test entries in the native Git listing", () => {
  const row = (mode: string, stage = "0") =>
    `${mode} ${"1".repeat(40)} ${stage}\tprobe.test.ts\0`;
  expect([...parseTrackedTestFiles(row("100644"))]).toEqual([
    ["probe.test.ts", "100644"],
  ]);
  expect([...parseTrackedTestFiles(row("100755"))]).toEqual([
    ["probe.test.ts", "100755"],
  ]);
  expect(() => parseTrackedTestFiles(row("120000"))).toThrow(
    /ordinary stage-zero/u,
  );
  expect(() => parseTrackedTestFiles(row("100644", "1"))).toThrow(
    /ordinary stage-zero/u,
  );
  expect(() => parseTrackedTestFiles(row("100644") + row("100644"))).toThrow(
    /ordinary stage-zero/u,
  );
});
