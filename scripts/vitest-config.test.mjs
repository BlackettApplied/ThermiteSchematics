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
      testTimeout: config.testTimeout,
      hookTimeout: config.hookTimeout,
    }));
  } finally {
    await runner.close();
  }
}

it("preserves the root Vitest timeouts and exclusions in both CI projects", async () => {
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
