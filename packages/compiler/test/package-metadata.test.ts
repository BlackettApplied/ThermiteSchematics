import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readBunLock } from "../../../scripts/read-bun-lock.mjs";

import { CLI_VERSION } from "../../cli/src/version.js";
import { THERMITE_SCHEMATICS_PRODUCT_VERSION } from "../../render/src/product-version.js";
import {
  CASE_SENSITIVE_FILESYSTEM_IDENTIFIER,
  CANDIDATE_IDENTIFIERS,
  TASK1_SANDBOX_ALLOWLIST,
  WINDOWS_ONLY_IDENTIFIERS,
  auditAssertionOccurrences as auditAssertionOccurrencesBase,
  auditTask1RepositorySources,
  auditTask1SourceTexts,
  canonicalAssertionName,
  createCanonicalTestEvidenceManifest,
  normalizeVitestReport,
  serializeCanonicalTestEvidenceManifest,
  trackedTestFiles,
} from "../../../scripts/run-vitest-and-audit.mjs";
import {
  TASK2_REQUIRED_TEST_LEDGERS,
  requiredTestsForLedgers,
} from "../../../scripts/release-evidence-audit.mjs";

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

function key(value: { readonly file: string; readonly name: string }): string {
  return `${value.file}\u0000${value.name}`;
}

function policyOccurrences(
  platform: "linux" | "win32",
  authority: "ordinary" | "task" = "ordinary",
) {
  const unique = new Map(
    [
      ...TASK1_SANDBOX_ALLOWLIST,
      ...WINDOWS_ONLY_IDENTIFIERS,
      CASE_SENSITIVE_FILESYSTEM_IDENTIFIER,
      ...CANDIDATE_IDENTIFIERS,
    ].map((row) => [key(row), row]),
  );
  const windowsOnly = new Set(WINDOWS_ONLY_IDENTIFIERS.map(key));
  return [...unique.values()].map((row) => ({
    ...row,
    status: CANDIDATE_IDENTIFIERS.some(
      (candidate) => key(candidate) === key(row),
    )
      ? authority === "ordinary"
        ? "skipped"
        : "passed"
      : platform === "linux" && windowsOnly.has(key(row))
        ? "skipped"
        : platform === "win32" &&
            key(row) === key(CASE_SENSITIVE_FILESYSTEM_IDENTIFIER)
          ? "skipped"
          : "passed",
  }));
}

function policySidecars(
  occurrences: readonly {
    readonly file: string;
    readonly name: string;
    readonly status: string;
  }[],
) {
  return new Map(
    CANDIDATE_IDENTIFIERS.map((row) => {
      const occurrence = occurrences.find(
        (candidate) => key(candidate) === key(row),
      );
      const outcome =
        occurrence?.status === "skipped"
          ? {
              status: "skipped",
              authorityClassifier: "absent",
              branch: "RELEASE-CANDIDATE-AUTHORITY-ABSENT",
              reason:
                "RELEASE-CANDIDATE-AUTHORITY-ABSENT: candidate injection is not available in ordinary CI.",
            }
          : {
              status: "executed",
              authorityClassifier: "local-task6-complete",
              branch: "RELEASE-CANDIDATE-INJECTED",
            };
      return [key(row), { outcome }];
    }),
  );
}

function auditAssertionOccurrences(
  occurrences: Parameters<typeof auditAssertionOccurrencesBase>[0],
  options: Parameters<typeof auditAssertionOccurrencesBase>[1],
) {
  return auditAssertionOccurrencesBase(occurrences, {
    ...options,
    candidateSidecars: policySidecars(occurrences),
  });
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

describe("M8 Task 1 Vitest status policy", () => {
  it("allows unrelated duplicate rows while auditing every occurrence", () => {
    const occurrences = [
      ...policyOccurrences("win32"),
      {
        file: "packages/compiler/test/index.test.ts",
        name: "unrelated parameterization > duplicate",
        status: "passed",
      },
      {
        file: "packages/compiler/test/index.test.ts",
        name: "unrelated parameterization > duplicate",
        status: "passed",
      },
    ];
    expect(
      auditAssertionOccurrences(occurrences, {
        platform: "win32",
        authority: "ordinary",
      }),
    ).toBe(occurrences);
  });

  it("rejects a duplicated or renamed REQUIRED policy row", () => {
    const duplicate = policyOccurrences("win32");
    duplicate.push({ ...duplicate[0]! });
    expect(() =>
      auditAssertionOccurrences(duplicate, {
        platform: "win32",
        authority: "ordinary",
      }),
    ).toThrow(/exactly one REQUIRED policy row/u);

    const renamed = policyOccurrences("win32");
    renamed[0] = { ...renamed[0]!, name: `${renamed[0]!.name} renamed` };
    expect(() =>
      auditAssertionOccurrences(renamed, {
        platform: "win32",
        authority: "ordinary",
      }),
    ).toThrow(/exactly one REQUIRED policy row/u);
  });

  it("accepts only Task-1 ordinary accommodations and rejects them for task authority", () => {
    const ordinary = policyOccurrences("win32");
    const sandboxRow = ordinary.find(
      (row) => key(row) === key(TASK1_SANDBOX_ALLOWLIST[0]!),
    );
    expect(sandboxRow).toBeDefined();
    sandboxRow!.status = "skipped";
    expect(() =>
      auditAssertionOccurrences(ordinary, {
        platform: "win32",
        authority: "ordinary",
      }),
    ).not.toThrow();
    const task = policyOccurrences("win32", "task");
    const taskSandboxRow = task.find(
      (row) => key(row) === key(TASK1_SANDBOX_ALLOWLIST[0]!),
    );
    expect(taskSandboxRow).toBeDefined();
    taskSandboxRow!.status = "skipped";
    expect(() =>
      auditAssertionOccurrences(task, {
        platform: "win32",
        authority: "task",
      }),
    ).toThrow(/Disallowed skipped outcome/u);

    const extra = policyOccurrences("win32");
    extra.push({
      file: "packages/compiler/test/index.test.ts",
      name: "injected extra > probe",
      status: "skipped",
    });
    expect(() =>
      auditAssertionOccurrences(extra, {
        platform: "win32",
        authority: "ordinary",
      }),
    ).toThrow(/Disallowed skipped outcome/u);
  });

  it("freezes all three Ubuntu-only outcomes and requires Windows case deduplication", () => {
    expect(() =>
      auditAssertionOccurrences(policyOccurrences("linux", "task"), {
        platform: "linux",
        authority: "task",
      }),
    ).not.toThrow();

    const windows = policyOccurrences("win32");
    const deduplication = windows.find(
      (row) => key(row) === key(WINDOWS_ONLY_IDENTIFIERS[2]!),
    );
    expect(deduplication).toBeDefined();
    deduplication!.status = "skipped";
    expect(() =>
      auditAssertionOccurrences(windows, {
        platform: "win32",
        authority: "ordinary",
      }),
    ).toThrow(/case-deduplication assertion must pass|Disallowed skipped/u);
  });

  it.each(["failed", "pending", "todo"] as const)(
    "rejects the %s status for every occurrence",
    (status) => {
      const occurrences = policyOccurrences("win32");
      occurrences.push({
        file: "packages/compiler/test/index.test.ts",
        name: "status audit > injected",
        status,
      });
      expect(() =>
        auditAssertionOccurrences(occurrences, {
          platform: "win32",
          authority: "ordinary",
        }),
      ).toThrow(new RegExp(`Disallowed ${status} outcome`, "u"));
    },
  );
});

describe("M8 Task 1 Vitest parser and source freeze", () => {
  it("freezes the exact Task-2 and Task-4 evidence ledgers", () => {
    expect(TASK2_REQUIRED_TEST_LEDGERS).toEqual({
      "package-smoke": [
        {
          file: "packages/compiler/test/package-smoke.test.ts",
          name: "packed schema, core-library, compiler, query, render, agent-tools, and CLI packages > install together and expose initial agent contracts plus existing APIs and CLI commands",
        },
      ],
      "agent-motor-starter": [
        {
          file: "packages/cli/test/agent-motor-starter-golden.test.ts",
          name: "M7 Task 8 motor-starter agent product workflow > repeats every frozen workflow step through fresh built CLI processes",
        },
      ],
      "release-install": [
        {
          file: "packages/cli/test/release-install-smoke.test.ts",
          name: "shared release candidate offline install > installs the injected downloaded candidate without registry or lifecycle execution",
        },
      ],
      "empty-folder": [
        {
          file: "packages/cli/test/empty-folder-smoke.test.ts",
          name: "installed empty-folder release workflow > runs the complete workflow twice against the injected downloaded candidate",
        },
      ],
      "task4-ledger": [
        {
          file: "packages/render/test/determinism.test.ts",
          name: "D8 end-to-end determinism > matches both complete source-state matrices in two fresh Node processes",
        },
        {
          file: "packages/cli/test/render-cli.test.ts",
          name: "M5 Task 8 render warnings, expected failures, and tool boundaries > locks the Tier 2 view CLI human and JSON R004 product bytes end to end",
        },
        {
          file: "packages/cli/test/render-cli.test.ts",
          name: "M6 Task 6 view subprocess stream and exit matrix > preserves every D9 row in a fresh process",
        },
        {
          file: "packages/cli/test/render-cli.test.ts",
          name: "M5 Task 8 subprocess boundaries > preserves every Q/R stream shape and raw-code-unit identity in a fresh process",
        },
        {
          file: "packages/cli/test/render-cli.test.ts",
          name: "M5 Task 8 subprocess boundaries > preserves compiler failures and end-of-options parsing in fresh processes",
        },
        {
          file: "packages/cli/test/render-motor-starter-golden.test.ts",
          name: "M5 Task 8 and M6 Task 6 reviewed schematic CLI goldens > matches both split-stream goldens across repeated fresh CLI processes",
        },
        {
          file: "packages/cli/test/render-motor-starter-golden.test.ts",
          name: "M6 amended Task 7 reviewed PNP schematic CLI goldens > matches the four PNP split-stream goldens across repeated fresh CLI processes",
        },
        {
          file: "packages/cli/test/agent-motor-starter-golden.test.ts",
          name: "M7 Task 8 motor-starter agent product workflow > repeats every frozen workflow step through fresh built CLI processes",
        },
      ],
    });
    expect(
      requiredTestsForLedgers(["package-smoke", "agent-motor-starter"]),
    ).toEqual([
      ...TASK2_REQUIRED_TEST_LEDGERS["package-smoke"],
      ...TASK2_REQUIRED_TEST_LEDGERS["agent-motor-starter"],
    ]);
    expect(requiredTestsForLedgers(["task4-ledger"])).toEqual(
      TASK2_REQUIRED_TEST_LEDGERS["task4-ledger"],
    );
    expect(() => requiredTestsForLedgers(["legacy-package-smoke"])).toThrow(
      /Unknown release-evidence ledger/u,
    );
  });

  it("canonicalizes only ancestorTitles and title without collapsing bytes", () => {
    expect(
      canonicalAssertionName({
        ancestorTitles: ["ancestor  one", "ancestor two"],
        title: "title  three",
        fullName: "ignored joined name",
      }),
    ).toBe("ancestor  one > ancestor two > title  three");
    expect(() =>
      canonicalAssertionName({
        ancestorTitles: ["bad\nancestor"],
        title: "test",
      }),
    ).toThrow(/nonempty and single-line/u);
  });

  it("normalizes exact tracked suite paths and retains unrelated duplicate occurrences", async () => {
    const report = {
      testResults: [
        {
          name: fileURLToPath(import.meta.url),
          assertionResults: [
            {
              ancestorTitles: ["fixture"],
              title: "duplicate",
              fullName: "must be ignored",
              status: "passed",
            },
            {
              ancestorTitles: ["fixture"],
              title: "duplicate",
              fullName: "also ignored",
              status: "passed",
            },
          ],
        },
      ],
    };
    await expect(normalizeVitestReport(report)).resolves.toEqual([
      {
        file: "packages/compiler/test/package-metadata.test.ts",
        name: "fixture > duplicate",
        status: "passed",
      },
      {
        file: "packages/compiler/test/package-metadata.test.ts",
        name: "fixture > duplicate",
        status: "passed",
      },
    ]);
  });

  it("writes only sorted REQUIRED passed rows to canonical evidence", () => {
    const occurrences = [
      ...policyOccurrences("win32"),
      {
        file: "packages/compiler/test/index.test.ts",
        name: "unrelated duplicate > row",
        status: "passed",
      },
      {
        file: "packages/compiler/test/index.test.ts",
        name: "unrelated duplicate > row",
        status: "passed",
      },
    ];
    const required = [TASK1_SANDBOX_ALLOWLIST[1]!, TASK1_SANDBOX_ALLOWLIST[0]!];
    const manifest = createCanonicalTestEvidenceManifest(occurrences, required);
    expect(manifest).toEqual({
      format: "thermite-schematics-audited-tests/0.1",
      tests: required
        .map((row) => ({
          identifier: { file: row.file, name: row.name },
          outcome: { status: "passed" },
        }))
        .sort((left, right) =>
          left.identifier.file < right.identifier.file ? -1 : 1,
        ),
    });
    expect(serializeCanonicalTestEvidenceManifest(manifest)).toBe(
      `${JSON.stringify(manifest, undefined, 2)}\n`,
    );
  });

  it("rejects broadened predicates, changed reasons, extra calls, and runIf drift", async () => {
    const tracked = await trackedTestFiles(repositoryRoot);
    const sources = new Map(
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
    expect(() => auditTask1SourceTexts(extraCall)).toThrow(/31 source-frozen/u);

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
