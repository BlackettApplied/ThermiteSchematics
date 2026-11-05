import { expect, it, vi } from "vitest";

const spawn = vi.hoisted(() =>
  vi.fn((_command: string, _args: string[], _options: unknown) => ({
    status: 0,
  })),
);
vi.mock("node:child_process", () => ({ spawnSync: spawn }));

it.each([
  ["packages/cli/test/release-package.test.ts", true],
  ["packages\\cli\\test\\release-package.test.ts", true],
  ["packages/cli/test/init.test.ts", false],
])("selects the legacy suite explicitly with %s", async (selected, legacy) => {
  const argv = process.argv;
  const exit = process.exitCode;
  try {
    vi.resetModules();
    spawn.mockClear();
    process.argv = [process.execPath, "scripts/test.mjs", selected];
    await import("../../../scripts/test.mjs");
    expect(spawn).toHaveBeenCalledOnce();
    const args = spawn.mock.calls[0]![1];
    expect(args).toContain(selected);
    expect(
      args.includes("--exclude=packages/cli/test/release-package.test.ts"),
    ).toBe(!legacy);
  } finally {
    process.argv = argv;
    process.exitCode = exit;
  }
});
