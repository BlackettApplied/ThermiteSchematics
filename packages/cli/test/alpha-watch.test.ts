import { expect, it, vi } from "vitest";
import { watchAlphaProject } from "../src/alpha-watch.js";

const { loadProject, readFile } = vi.hoisted(() => ({
  loadProject: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@thermite/compiler", () => ({ loadProject }));
vi.mock("node:fs/promises", () => ({ readFile }));

it("schedules the initial and subsequent polls every 1000 ms", async () => {
  const originalHandlers = new Set(process.listeners("SIGTERM"));
  vi.useFakeTimers();
  const scheduled = vi.spyOn(globalThis, "setTimeout");
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  let revision = 0;
  loadProject.mockImplementation(async () => ({ ok: true, revision }));
  readFile.mockResolvedValue("request");
  const rebuild = vi.fn(async () => {});
  const watching = watchAlphaProject(
    "project",
    "request.json",
    "out.html",
    rebuild,
  );
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenLastCalledWith(expect.any(Function), 1000);
    revision++;
    await vi.advanceTimersByTimeAsync(999);
    expect(loadProject).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadProject).toHaveBeenCalledTimes(2);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(scheduled).toHaveBeenLastCalledWith(expect.any(Function), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadProject).toHaveBeenCalledTimes(3);
    expect(rebuild).toHaveBeenCalledTimes(2);
  } finally {
    // Invoke only this watcher's handler. Windows cannot deliver catchable
    // POSIX termination signals, but the JS lifecycle is identical everywhere.
    process.listeners("SIGTERM").find((f) => !originalHandlers.has(f))?.();
    await watching;
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
  expect(new Set(process.listeners("SIGTERM"))).toEqual(originalHandlers);
});
