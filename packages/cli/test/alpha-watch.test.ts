import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { watchAlphaProject } from "../src/alpha-watch.js";

const { loadProject, readFile } = vi.hoisted(() => ({
  loadProject: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@thermite/compiler", () => ({ loadProject }));
vi.mock("node:fs/promises", () => ({ readFile }));

it("schedules the initial and subsequent polls after a 1000 ms wait", async () => {
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

it("waits 1000 ms after slow initial and subsequent rebuilds finish", async () => {
  const originalHandlers = new Set(process.listeners("SIGTERM"));
  vi.useFakeTimers();
  const scheduled = vi.spyOn(globalThis, "setTimeout");
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  let revision = 0;
  loadProject
    .mockReset()
    .mockImplementation(async () => ({ ok: true, revision }));
  readFile.mockReset().mockResolvedValue("request");
  let finish: (() => void) | undefined;
  const rebuild = vi.fn(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  const watching = watchAlphaProject(
    "project",
    "request.json",
    "out.html",
    rebuild,
  );
  try {
    await vi.advanceTimersByTimeAsync(1500);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(scheduled).not.toHaveBeenCalled();
    finish!();
    await vi.advanceTimersByTimeAsync(0);
    revision++;
    await vi.advanceTimersByTimeAsync(999);
    expect(loadProject).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(loadProject).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(loadProject).toHaveBeenCalledTimes(2);
    finish!();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(loadProject).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadProject).toHaveBeenCalledTimes(3);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("one second after each run finishes"),
    );
  } finally {
    finish?.();
    process.listeners("SIGTERM").find((f) => !originalHandlers.has(f))?.();
    await watching;
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
  expect(new Set(process.listeners("SIGTERM"))).toEqual(originalHandlers);
});

it("keeps guide and review watch claims portable and tied to finished work", () => {
  const guide = readFileSync(
    new URL("../assets/THERMITE_AGENTS.md", import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");
  const review = readFileSync(
    new URL("../../../docs/review.md", import.meta.url),
    "utf8",
  )
    .split("## Watch")[1]!
    .replace(/\s+/g, " ");
  expect(guide).toContain(
    "polls declared inputs one second after work finishes",
  );
  expect(guide).not.toContain("(macOS)");
  expect(review).toContain(
    "one second after the previous load/rebuild finishes",
  );
  expect(review).not.toContain("(macOS)");
});

it("keeps both machine-demo watch references tied to finished work", () => {
  for (const [file, claim] of [
    [
      "examples/machine-demo/AGENTS.md",
      "polls declared inputs one second after work finishes",
    ],
    ["docs/machine-demo.md", "one second after the previous work finishes"],
  ]) {
    const text = readFileSync(
      new URL(`../../../${file}`, import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(text).toContain(claim);
    expect(text).not.toMatch(/(?:once per|every) second/);
  }
});
