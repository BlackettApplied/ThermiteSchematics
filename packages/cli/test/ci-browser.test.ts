import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  INSTALL_BUDGET,
  worstCaseSeconds,
} from "../../../scripts/install-ci-browser.mjs";
import { discoverBrowserPath } from "./helpers/pdf-raster.js";

it("provisions the pinned browser for both sharded test jobs on every OS", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const jobs = workflow.split(/^  (?:check-test|worktree):$/m).slice(1);
  const stepMinutes = INSTALL_BUDGET.stepTimeoutSeconds / 60;
  expect(worstCaseSeconds(INSTALL_BUDGET)).toBeLessThan(
    INSTALL_BUDGET.stepTimeoutSeconds,
  );
  expect(jobs).toHaveLength(2);
  for (const job of jobs) {
    const header = job.slice(0, job.indexOf("    steps:"));
    expect(header).not.toMatch(/\$\{\{\s*runner\./);
    expect(header).toContain(
      "PLAYWRIGHT_BROWSERS_PATH: ${{ github.workspace }}/../thermite-playwright",
    );
    expect(job).toContain("os: [macos-15, ubuntu-24.04, windows-2022]");
    expect(job).toContain('THERMITE_REQUIRE_BROWSER: "1"');
    expect(job).toContain(`timeout-minutes: ${stepMinutes}`);
    expect(job).toContain("bun scripts/install-ci-browser.mjs");
    expect(job).toContain("chromium.executablePath()");
    expect(job).toContain('"THERMITE_DRAW_CHROMIUM=" + executable');
    expect(job).toContain('"THERMITE_TEST_BROWSER=" + executable');
    expect(job.indexOf("Install pinned Chromium")).toBeLessThan(
      job.indexOf("THERMITE_RESEARCH_PYTHON: python"),
    );
  }
});

it("prefers Playwright-managed browsers over system Chrome while keeping override and fallback", () => {
  const home = "/fake-home";
  const cache = join(home, "Library/Caches/ms-playwright");
  const playwright = join(
    cache,
    "chromium-1248",
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  );
  const older = join(
    cache,
    "chromium-1100",
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  );
  const systemChrome =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const override = "/custom/chrome";

  const withBoth = new Set([cache, playwright, older, systemChrome, override]);
  expect(
    discoverBrowserPath({
      env: {},
      home,
      exists: (p) => withBoth.has(p),
      readdir: () => ["chromium-1100", "chromium-1248"],
    }),
  ).toBe(playwright);

  expect(
    discoverBrowserPath({
      env: { THERMITE_TEST_BROWSER: override },
      home,
      exists: (p) => withBoth.has(p),
      readdir: () => ["chromium-1248"],
    }),
  ).toBe(override);

  expect(
    discoverBrowserPath({
      env: { THERMITE_TEST_BROWSER: "/missing/chrome" },
      home,
      exists: (p) => withBoth.has(p),
      readdir: () => ["chromium-1248"],
    }),
  ).toBeUndefined();

  expect(
    discoverBrowserPath({
      env: {},
      home,
      exists: (p) => p === systemChrome,
      readdir: () => [],
    }),
  ).toBe(systemChrome);
});

it("discovers Playwright Linux ARM64 Chromium ahead of system Chromium", () => {
  const home = "/fake-home";
  const cache = join(home, ".cache/ms-playwright");
  const linuxArm64 = join(cache, "chromium-1248", "chrome-linux-arm64/chrome");
  const systemChromium = "/usr/bin/chromium";

  expect(
    discoverBrowserPath({
      env: {},
      home,
      exists: (p) => p === cache || p === linuxArm64 || p === systemChromium,
      readdir: () => ["chromium-1248"],
    }),
  ).toBe(linuxArm64);

  expect(
    discoverBrowserPath({
      env: {},
      home,
      exists: (p) => p === cache || p === linuxArm64,
      readdir: () => ["chromium-1248"],
    }),
  ).toBe(linuxArm64);
});
