import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { readBunLock, lockedPackage } from "../../../scripts/read-bun-lock.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const agentSourceRoot = join(packageRoot, "src");
const cliAgentSource = join(
  repositoryRoot,
  "packages",
  "cli",
  "src",
  "agent-command.ts",
);
const agentGoldenRoot = join(
  repositoryRoot,
  "packages",
  "cli",
  "test",
  "goldens",
  "motor-starter-agent",
);

const AGENT_LITERALS = new Set([
  "agent-tools/0.1",
  "agent-tool-request/0.1",
  "agent-tool-result/0.1",
  "agent-tool-report/0.1",
  "json-patch/0.1",
]);

const AGENT_CODES = new Set([
  "A001",
  "A002",
  "A003",
  "A004",
  "E001",
  "E002",
  "E003",
]);

async function sourceFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries: Dirent[] = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  }
  await visit(root);
  return files;
}

async function textInventory(paths: readonly string[]): Promise<string> {
  return (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join(
    "\n",
  );
}

function matches(text: string, pattern: RegExp): Set<string> {
  return new Set([...text.matchAll(pattern)].map((match) => match[0]));
}

describe("M7 Task 9 final inventories", () => {
  it("locks agent literals, codes, root imports, and direct failure classification", async () => {
    const production = await textInventory([
      ...(await sourceFiles(agentSourceRoot)),
      cliAgentSource,
    ]);

    expect(
      matches(
        production,
        /agent-tools\/[0-9]+\.[0-9]+|agent-tool-(?:request|result|report)\/[0-9]+\.[0-9]+|json-patch\/[0-9]+\.[0-9]+/gu,
      ),
    ).toEqual(AGENT_LITERALS);
    expect(matches(production, /\b[AEQR][0-9]{3}\b/gu)).toEqual(AGENT_CODES);
    expect(production).not.toMatch(
      /(?:from\s+|import\()["']@thermite\/[^"']+\//u,
    );

    const cli = await readFile(cliAgentSource, "utf8");
    expect(cli.match(/outcome\.failureClass === "tool"/gu)).toHaveLength(1);
    expect(cli).not.toMatch(
      /(?:error\.code|diagnostic\.code|message)\s*(?:===|\.startsWith|\.includes).*exit/gu,
    );
  });

  it("audits the package graph and licenses, including alpha PDF dependencies", async () => {
    const [agentPackageText, cliPackageText, compilerPackageText, lock] =
      await Promise.all([
        readFile(join(packageRoot, "package.json"), "utf8"),
        readFile(
          join(repositoryRoot, "packages", "cli", "package.json"),
          "utf8",
        ),
        readFile(
          join(repositoryRoot, "packages", "compiler", "package.json"),
          "utf8",
        ),
        readBunLock(repositoryRoot),
      ]);
    const agentPackage = JSON.parse(agentPackageText) as {
      private: boolean;
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
    };
    const cliPackage = JSON.parse(cliPackageText) as {
      dependencies: Record<string, string>;
    };
    const compilerPackage = JSON.parse(compilerPackageText) as {
      dependencies: Record<string, string>;
    };

    expect(agentPackage.private).toBe(true);
    expect(Object.keys(agentPackage.exports)).toEqual(["."]);
    expect(agentPackage.dependencies).toEqual({
      "@thermite/compiler": "0.2.0",
      "@thermite/query": "0.2.0",
      "@thermite/render": "0.2.0",
      "@thermite/schema": "0.2.0",
    });
    expect(cliPackage.dependencies).toEqual({
      "@thermite/agent-tools": "0.2.0",
      "@thermite/compiler": "0.2.0",
      "@thermite/query": "0.2.0",
      "@thermite/render": "0.2.0",
      "@thermite/schema": "0.2.0",
      commander: "^15.0.0",
      micromatch: "^4.0.8",
      fontkit: "^2.0.4",
      pdfkit: "^0.17.2",
      "svg-to-pdfkit": "^0.1.8",
    });
    expect(compilerPackage.dependencies).toEqual({
      "@thermite/core-library": "0.2.0",
      "@thermite/schema": "0.2.0",
      "fast-glob": "^3.3.3",
    });
    expect(lock.workspaces["packages/agent-tools"]?.dependencies).toEqual(
      agentPackage.dependencies,
    );
    const licenses: Record<string, string> = {};
    for (const name of [
      "pdfkit",
      "fontkit",
      "svg-to-pdfkit",
      "ajv",
      "commander",
      "elkjs",
      "fast-glob",
      "jsonc-parser",
    ]) {
      const manifest = JSON.parse(
        await readFile(
          join(repositoryRoot, "node_modules", name, "package.json"),
          "utf8",
        ),
      );
      expect(manifest.version).toBe(lockedPackage(lock, name).version);
      licenses[name] = manifest.license;
    }
    expect(licenses).toEqual({
      pdfkit: "MIT",
      fontkit: "MIT",
      "svg-to-pdfkit": "MIT",
      ajv: "MIT",
      commander: "MIT",
      elkjs: "EPL-2.0 OR GPL-3.0-or-later",
      "fast-glob": "MIT",
      "jsonc-parser": "MIT",
    });
  });

  it("runs the alpha repository check on macOS, Linux, and Windows", async () => {
    const workflow = await readFile(
      join(repositoryRoot, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const rootPackage = JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(workflow).toContain("os: [macos-14, ubuntu-24.04, windows-2022]");
    expect(workflow).toContain("runs-on: ${{ matrix.os }}");
    expect(workflow).toContain("- run: bun run check");
    expect(rootPackage.scripts.check).toContain("bun run test");
    expect(rootPackage.scripts.test).toBe("bun scripts/test.mjs");
  });

  it("finds no absolute, staging, ANSI, clock, or process leak in product goldens", async () => {
    const goldenFiles = (await readdir(agentGoldenRoot))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const bytes = await textInventory(
      goldenFiles.map((name) => join(agentGoldenRoot, name)),
    );

    expect(goldenFiles).toHaveLength(20);
    expect(bytes).not.toContain(repositoryRoot);
    expect(bytes).not.toContain(repositoryRoot.replaceAll("\\", "/"));
    expect(bytes).not.toContain(".thermite-schematics-stage-");
    expect(bytes).not.toContain(".thermite-schematics-quarantine-");
    expect(bytes).not.toMatch(/"[A-Za-z]:[\\/]/u);
    expect(bytes).not.toMatch(/"\/(?:home|private|tmp|Users)\//u);
    expect(bytes).not.toMatch(/\u001b\[/u);
    expect(bytes).not.toMatch(
      /"(?:pid|timestamp|timezone|elapsed(?:Ms)?)"\s*:/u,
    );
  });

  it("proves the docs-bypassing Prettier gate does not ignore an ordinary probe", async ({
    skip,
  }) => {
    const probeName = ".prettier-gate-probe.md";
    const probePath = join(repositoryRoot, probeName);
    await writeFile(
      probePath,
      "#     Deliberately unformatted\n\n-       probe item\n",
      { encoding: "utf8", flag: "wx" },
    );

    let exitCode: unknown;
    let output = "";
    try {
      await execFileAsync(
        process.execPath,
        [
          join(
            repositoryRoot,
            "node_modules",
            "prettier",
            "bin",
            "prettier.cjs",
          ),
          "--check",
          "--ignore-path",
          ".gitignore",
          probeName,
        ],
        { cwd: repositoryRoot, encoding: "utf8", windowsHide: true },
      );
      exitCode = 0;
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        exitCode = "code" in error ? error.code : undefined;
        output = `${"stdout" in error ? String(error.stdout) : ""}${
          "stderr" in error ? String(error.stderr) : ""
        }`;
      }
    } finally {
      await rm(probePath, { force: true });
    }

    if (exitCode === "EPERM") {
      skip("The execution sandbox denied the Prettier probe child process.");
      return;
    }
    expect(exitCode).toBe(1);
    expect(output).toContain(probeName);
  });
});
