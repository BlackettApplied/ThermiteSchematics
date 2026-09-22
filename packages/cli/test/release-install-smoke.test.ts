import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, it } from "vitest";

import { installCandidate } from "../../../scripts/release-acceptance.mjs";
import {
  AUTHORITY_ABSENT_REASON,
  RELEASE_INSTALL_TEST_NAME,
  classifyCandidateAuthority,
  writeCandidateBranchSidecar,
} from "./release-candidate.js";
import { compileStrictCandidateConsumer } from "./release-consumer-closure.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..");
const npmCommand = process.platform === "win32" ? process.execPath : "npm";
const npmArguments =
  process.platform === "win32"
    ? [
        join(
          dirname(process.execPath),
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        ),
      ]
    : [];

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

describe("shared release candidate offline install", () => {
  it("installs the injected downloaded candidate without registry or lifecycle execution", async ({
    skip,
  }) => {
    const authority = await classifyCandidateAuthority();
    await writeCandidateBranchSidecar(
      "release-install-smoke.branch.json",
      "packages/cli/test/release-install-smoke.test.ts",
      RELEASE_INSTALL_TEST_NAME,
      authority,
    );
    if (authority.classifier === "absent") {
      skip(AUTHORITY_ABSENT_REASON);
      return;
    }
    if (authority.classifier === "partial-or-unknown") {
      throw new Error(authority.reason);
    }
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-install-test-"),
    );
    const captured = await lstat(temporaryRoot, { bigint: true });
    try {
      try {
        await installCandidate({
          tarPath: authority.candidate,
          expectedSha: authority.sha256,
          root: join(temporaryRoot, "global"),
        });
        const consumer = join(temporaryRoot, "consumer");
        const cache = join(temporaryRoot, "cache");
        await mkdir(consumer);
        await mkdir(cache);
        await writeFile(
          join(consumer, "package.json"),
          `${JSON.stringify({ name: "strict-release-consumer", private: true, type: "module" }, undefined, 2)}\n`,
        );
        const userConfig = join(temporaryRoot, "empty-user.npmrc");
        const globalConfig = join(temporaryRoot, "empty-global.npmrc");
        await writeFile(userConfig, "", { flag: "wx" });
        await writeFile(globalConfig, "", { flag: "wx" });
        const environment = {
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          PATH: dirname(process.execPath),
          NPM_CONFIG_REGISTRY: "https://registry.invalid/",
        } as NodeJS.ProcessEnv;
        await execFileAsync(
          npmCommand,
          [
            ...npmArguments,
            "install",
            "--offline",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--package-lock=false",
            "--install-links=false",
            "--omit=dev",
            "--workspaces=false",
            "--userconfig",
            userConfig,
            "--globalconfig",
            globalConfig,
            "--cache",
            cache,
            authority.candidate,
          ],
          { cwd: consumer, env: environment, windowsHide: true },
        );
        await compileStrictCandidateConsumer({
          consumerDirectory: consumer,
          candidateRoot: join(consumer, "node_modules", "@thermite", "cli"),
          checkedInSource: join(
            import.meta.dirname,
            "release-type-consumer",
            "consumer.ts",
          ),
          repositoryRoot,
        });
      } catch (error) {
        if (isChildProcessDenied(error)) {
          skip(
            "RELEASE-EVIDENCE-DENIED: isolated offline global-install child-process tier is unavailable.",
          );
          return;
        }
        throw error;
      }
    } finally {
      const observed = await lstat(temporaryRoot, { bigint: true });
      if (observed.dev !== captured.dev || observed.ino !== captured.ino) {
        throw new Error(
          "Release install test temporary-root identity changed.",
        );
      }
      await rm(temporaryRoot, {
        recursive: true,
        force: false,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  }, 120_000);
});
