import { expect, it, vi } from "vitest";
import { createVitest } from "vitest/node";

async function resolveProjects(workers) {
  vi.stubEnv("THERMITE_CI_MAX_WORKERS", workers);
  const runner = await createVitest("test", { watch: false });
  try {
    return runner.projects.map(({ name, config }) => ({
      name,
      include: config.include,
      exclude: config.exclude,
      maxWorkers: config.maxWorkers,
      testTimeout: config.testTimeout,
      hookTimeout: config.hookTimeout,
    }));
  } finally {
    await runner.close();
  }
}

it("preserves Vitest defaults and caps workers in both CI projects", async () => {
  vi.stubEnv("CI", "1");
  vi.stubEnv("VITEST_MAX_WORKERS", undefined);
  try {
    const standalone = await resolveProjects("2");
    expect(standalone).toHaveLength(1);
    const [root] = standalone;
    const projects = await resolveProjects("3");
    expect(projects.map(({ name }) => name)).toEqual(["limited", "main"]);
    const [limited, main] = projects;

    expect(root.hookTimeout).toBe(120_000);
    expect(root.testTimeout).toBe(120_000);
    expect(root.maxWorkers).toBe(2);
    expect(limited.maxWorkers).toBe(2);
    expect(main.maxWorkers).toBe(process.platform === "darwin" ? 2 : 3);
    expect(root.exclude).toEqual(
      expect.arrayContaining(["alpha-out/**", "release-out/**"]),
    );
    for (const project of projects) {
      expect(project.hookTimeout, project.name).toBe(root.hookTimeout);
      expect(project.testTimeout, project.name).toBe(root.testTimeout);
    }
    expect(limited.exclude).toEqual(root.exclude);
    expect(main.exclude).toEqual([...root.exclude, ...limited.include]);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("passes timeouts and archive exclusions to Vitest for config-less runs", async () => {
  const spawnSync = vi.fn().mockReturnValue({ status: 0 });
  const argv = process.argv;
  const exitCode = process.exitCode;
  vi.doMock("node:child_process", () => ({ spawnSync }));
  vi.stubEnv("THERMITE_CONTRIBUTOR_BUN", undefined);
  try {
    process.argv = [process.execPath, "scripts/test.mjs"];
    await import("./test.mjs");
    expect(spawnSync).toHaveBeenCalledOnce();
    expect(spawnSync.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        "--testTimeout=120000",
        "--hookTimeout=120000",
        "--exclude=alpha-out/**",
        "--exclude=release-out/**",
      ]),
    );
  } finally {
    vi.doUnmock("node:child_process");
    vi.unstubAllEnvs();
    process.argv = argv;
    process.exitCode = exitCode;
  }
});
