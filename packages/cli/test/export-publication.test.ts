import { appendFile, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compileLoadedProject, writeFileAtomically } from "@thermite/compiler";
import { renderSchematicPacket, renderSchematicSheets } from "@thermite/render";
import { runThermite } from "../src/alpha.js";
import { initializeAlphaProject } from "../src/alpha-init.js";
import {
  fixture,
  manifestName,
  motorPacket,
  mustSucceed,
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
