import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compileLoadedProject, writeFileAtomically } from "@thermite/compiler";
import { renderSchematicPacket, renderSchematicSheets } from "@thermite/render";
import { runThermite } from "../src/alpha.js";
import { LOCK_NAME } from "../src/alpha-export-lock.js";
import { initializeAlphaProject } from "../src/alpha-init.js";
import {
  fixture,
  manifestName,
  motorPacket,
  mustSucceed,
  readJson,
  reportJob,
  reportView,
  writeJson,
  type Fixture,
} from "./helpers/export-fixture.js";

vi.mock(import("@thermite/compiler"), async (original) => {
  const compiler = await original();
  return {
    ...compiler,
    compileLoadedProject: vi.fn(compiler.compileLoadedProject),
    writeFileAtomically: vi.fn(compiler.writeFileAtomically),
  };
});
vi.mock(import("@thermite/render"), async (original) => {
  const render = await original();
  return {
    ...render,
    renderSchematicPacket: vi.fn(render.renderSchematicPacket),
    renderSchematicSheets: vi.fn(render.renderSchematicSheets),
  };
});

const compiler =
  await vi.importActual<typeof import("@thermite/compiler")>(
    "@thermite/compiler",
  );
const renderer =
  await vi.importActual<typeof import("@thermite/render")>("@thermite/render");

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

function run(f: Fixture, verb = "bundle", ...options: string[]) {
  return runThermite([
    "bun",
    "thermite",
    ...f.exportArgs(verb, ...options),
    "--project",
    f.project,
  ]);
}

const packetJob = {
  kind: "packet",
  input: "packet.json",
  outputs: { html: "packet.html", json: "packet.json" },
};

it("rejects a malformed delivery filter without compiling or rendering", async () => {
  const f = await fixture();
  await writeJson(join(f.project, "bad-filter.json"), { devices: [] });
  await f.plan(reportJob("bom", "bad-filter.json"));
  expect(await run(f)).toBe(1);
  expect(compileLoadedProject).not.toHaveBeenCalled();
  expect(renderSchematicSheets).not.toHaveBeenCalled();
  expect((await f.check()).findings.reasons).toContainEqual(
    expect.objectContaining({ code: "unverifiable_input" }),
  );
});

it.each([
  "foreign host",
  "malformed metadata",
  "duplicate owner field",
  "missing metadata",
])(
  "leaves a nested reservation with %s intact and fails before compile",
  async (caseName) => {
    const f = await fixture();
    const dryJob = { ...packetJob, outputs: { html: "nested/packet.html" } };
    await motorPacket(f.project);
    await f.plan(dryJob);
    const path = join(f.out, "nested", LOCK_NAME);
    await mkdir(path, { recursive: true });
    const entries = [];
    if (caseName !== "missing metadata") {
      const name = `owner-${randomUUID()}.json`;
      entries.push(name);
      const child = spawnSync(process.execPath, ["-e", ""]);
      expect(child.status).toBe(0);
      const owner = {
        pid: child.pid,
        hostname:
          caseName === "foreign host" ? `${hostname()}-other` : hostname(),
        startedAt: new Date().toISOString(),
      };
      if (caseName === "duplicate owner field")
        await writeFile(
          join(path, name),
          `{"hostname":"other",${JSON.stringify(owner).slice(1)}`,
        );
      else
        await writeJson(
          join(path, name),
          caseName === "malformed metadata"
            ? { ...owner, pid: "unknown" }
            : owner,
        );
    }
    expect(await run(f)).toBe(2);
    expect(compileLoadedProject).not.toHaveBeenCalled();
    expect(renderSchematicPacket).not.toHaveBeenCalled();
    expect(await readdir(path)).toEqual(entries);
    const failure = await f.bundle();
    expect(failure.code).toBe(2);
    const { error } = JSON.parse(failure.stderr);
    expect(error.message).toContain(path);
    expect(error.message).toContain(
      "remove the lock and its owner metadata by hand",
    );
  },
);

it("reclaims a local reservation with a dead owner and publishes normally", async () => {
  const f = await fixture();
  await f.plan(reportJob("bom"));
  const child = spawnSync(process.execPath, ["-e", ""]);
  expect(child.status).toBe(0);
  const path = join(f.out, LOCK_NAME);
  await mkdir(path, { recursive: true });
  await writeJson(join(path, `owner-${randomUUID()}.json`), {
    pid: child.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  });
  expect(await run(f)).toBe(0);
  expect(compileLoadedProject).toHaveBeenCalledTimes(1);
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await f.check()).code).toBe(0);
});

it.each([
  { signal: "SIGINT", exit: 130 },
  { signal: "SIGTERM", exit: 143 },
] as const)(
  "makes all held reservations reusable after $signal",
  async ({ signal, exit }) => {
    const f = await fixture();
    const lockModule = pathToFileURL(
      resolve("packages/cli/dist/alpha-export-lock.js"),
    ).href;
    const directories = [f.out, join(f.out, "nested")];
    const targets = directories.map((path) => ({
      file: join(path, "bom.csv"),
    }));
    const code = `
    import { withExportReservations } from ${JSON.stringify(lockModule)};
    await withExportReservations(${JSON.stringify(targets)}, async () => {
      process.stdout.write("ready\\n");
      setInterval(() => {}, 1000);
      await new Promise(() => {});
    });
  `;
    const child = spawn(process.execPath, ["-e", code], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const closed = once(child, "close");
    try {
      const ready = once(child.stdout, "data", {
        signal: AbortSignal.timeout(10000),
      });
      expect(
        await Promise.race([ready.then(([bytes]) => String(bytes)), closed]),
      ).toBe("ready\n");
      expect(child.kill(signal)).toBe(true);
      const result = await closed;
      if (process.platform === "win32") {
        // Windows may terminate the child before it can run the signal handler.
        await f.plan(reportJob("bom"), {
          ...reportJob("terminals"),
          outputs: { csv: "nested/terminals.csv" },
        });
        expect(await run(f)).toBe(0);
      } else {
        expect(result).toEqual([exit, null]);
      }
      for (const path of directories)
        await expect(lstat(join(path, LOCK_NAME))).rejects.toMatchObject({
          code: "ENOENT",
        });
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    }
  },
);

it("compiles once and renders each distinct drawing once across jobs and formats", async () => {
  const f = await fixture();
  await motorPacket(f.project, [reportView("bom")]);
  const view = { kind: "view", designation: "M1", intent: "power" };
  await f.plan(
    packetJob,
    { ...packetJob, outputs: { pdf: "packet.pdf" } },
    { ...view, outputs: { html: "motor.html", json: "motor.json" } },
    { ...view, outputs: { pdf: "motor.pdf" } },
    reportJob("bom"),
  );
  expect(await run(f)).toBe(0);
  expect(compileLoadedProject).toHaveBeenCalledTimes(1);
  expect(renderSchematicPacket).toHaveBeenCalledTimes(1);
  expect(renderSchematicSheets).toHaveBeenCalledTimes(1);
  expect(await run(f, "check")).toBe(0);
  expect(compileLoadedProject).toHaveBeenCalledTimes(1);
  expect(renderSchematicPacket).toHaveBeenCalledTimes(1);
  expect(renderSchematicSheets).toHaveBeenCalledTimes(1);
});

it("leaves the previous generation intact if the project changes during rendering", async () => {
  const f = await fixture();
  await motorPacket(f.project, [reportView("bom")]);
  await f.plan(packetJob);
  await mustSucceed(await f.bundle());
  const marker = join(f.out, manifestName);
  const old = await readFile(marker);
  vi.mocked(renderSchematicPacket).mockImplementationOnce(async (...args) => {
    const result = await renderer.renderSchematicPacket(...args);
    await appendFile(join(f.project, "devices/equipment.json"), " ");
    return result;
  });
  expect(await run(f)).toBe(1);
  expect((await readFile(marker)).equals(old)).toBe(true);
  expect((await f.check()).findings.reasons).toContainEqual({
    path: manifestName,
    code: "source_changed",
  });
  expect(await run(f)).toBe(0);
  expect((await f.check()).code).toBe(0);
});

it("preserves a completed generation when a late job fails or an SVG would lose sheets", async () => {
  const f = await fixture();
  await f.plan(reportJob("bom"));
  await mustSucceed(await f.bundle());
  const old = await readFile(join(f.out, manifestName));
  await f.plan(reportJob("bom"), {
    kind: "cable",
    designation: "missing",
    outputs: { json: "cable.json" },
  });
  expect(await run(f)).toBe(1);
  expect(writeFileAtomically).not.toHaveBeenCalled();
  expect((await readFile(join(f.out, manifestName))).equals(old)).toBe(true);
  await f.plan(reportJob("bom"), {
    kind: "view",
    designation: "M1",
    intent: "power",
    outputs: { svg: "motor.svg" },
  });
  const failure = await f.bundle();
  expect(JSON.parse(failure.stderr).error.code).toBe("R006");
  expect(failure.code).toBe(1);
  expect((await readFile(join(f.out, manifestName))).equals(old)).toBe(true);
});

it("retires the manifest before replacement and recovers after an interrupted write", async () => {
  const f = await fixture();
  await f.plan(reportJob("bom"), reportJob("terminals"));
  await mustSucceed(await f.bundle());
  const marker = join(f.out, manifestName);
  vi.mocked(writeFileAtomically).mockImplementation(
    async (target, bytes, options) => {
      expect(await readFile(marker).catch((error) => error.code)).toBe(
        "ENOENT",
      );
      if (basename(target) === "terminals.csv")
        throw new Error("Injected publication interruption");
      await compiler.writeFileAtomically(target, bytes, options);
    },
  );
  expect(await run(f)).toBe(2);
  expect(writeFileAtomically).toHaveBeenCalledTimes(2);
  expect((await f.check()).findings.reasons).toContainEqual({
    path: manifestName,
    code: "missing_manifest",
  });
  vi.mocked(writeFileAtomically).mockReset();
  expect(await run(f)).toBe(0);
  expect((await f.check()).code).toBe(0);
});

it("serializes concurrent publishers and keeps the marker absent until the last write", async () => {
  const f = await fixture();
  await f.plan(reportJob("bom"));
  await mustSucceed(await f.bundle());
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.mocked(writeFileAtomically).mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return compiler.writeFileAtomically(...args);
  });
  const first = run(f);
  try {
    await Promise.race([
      entered.promise,
      first.then(() => {
        throw new Error("Publisher did not reach its first write.");
      }),
    ]);
    const path = join(f.out, LOCK_NAME);
    const owners = await readdir(path);
    expect(owners).toHaveLength(1);
    const owner = await readJson(join(path, owners[0]!));
    expect(owner).toMatchObject({ pid: process.pid, hostname: hostname() });
    expect(Number.isFinite(Date.parse(owner.startedAt))).toBe(true);
    expect(await run(f)).toBe(2);
    expect(compileLoadedProject).toHaveBeenCalledTimes(1);
    const other = await f.bundle();
    expect(other.code).toBe(2);
    expect(other.stderr).toContain("Export destination is reserved");
    expect((await f.check()).code).toBe(1);
  } finally {
    release.resolve();
  }
  expect(await first).toBe(0);
  expect((await f.check()).code).toBe(0);
});

it("keeps deferred PSU warnings in compiler and completeness scopes, and honors strict packets", async () => {
  const f = await fixture();
  await rm(f.project, { recursive: true });
  await initializeAlphaProject(f.project);
  await writeJson(join(f.project, "packet.json"), {
    format: "schematic-packet-request/0.1",
    views: [
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
      },
      reportView("bom"),
    ],
  });
  const diagnostics = {
    kind: "diagnostics",
    outputs: { json: "completeness.json" },
  };
  await f.plan(packetJob, diagnostics);
  const success = await f.bundle();
  await mustSucceed(success);
  const report = JSON.parse(success.stderr);
  expect(
    report.diagnostics.filter((item: { code: string }) => item.code === "W905"),
  ).toHaveLength(1);
  expect(report.jobs).toEqual([]);
  const completeness = JSON.parse(
    await readFile(join(f.out, "completeness.json"), "utf8"),
  );
  expect(JSON.stringify(completeness)).toMatch(/deferred/u);
  await f.plan({ ...packetJob, strict: true }, diagnostics);
  const strict = await f.bundle();
  expect(strict.code).toBe(1);
  expect(JSON.parse(strict.stderr).error.code).toBe("strict_warnings");
  expect((await f.check()).code).toBe(1);
});
