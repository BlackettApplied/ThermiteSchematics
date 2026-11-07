import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  analyzeCompleteness,
  compileProject,
  lockProject,
} from "../src/index.js";
import { device, wire } from "./validation-fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.each([
  ["0.1.0", [], []],
  ["0.2.0", [], ["95", "96"]],
  ["0.2.0", ["95"], ["96"]],
  ["0.2.0", ["95", "96"], []],
] as const)(
  "core %s trip contact with %j connected reports missing %j",
  async (version, connected, missing) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-overload-review-"));
    roots.push(root);
    await writeFile(
      join(root, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Synthetic overload output obligation" },
        sources: ["source.json"],
        libraries: [{ name: "core", version }],
      }),
    );
    await writeFile(
      join(root, "source.json"),
      JSON.stringify({
        objects: [
          device(1, "OL1", "core:overload-3p-1nc"),
          device(2, "TB1", "core:terminal-block-8"),
          ...connected.map((terminal, i) =>
            wire(
              3 + i,
              { device: "OL1", terminal },
              { device: "TB1", terminal: String(i + 1) },
            ),
          ),
        ],
      }),
    );
    expect((await lockProject(root)).ok).toBe(true);
    const compiled = await compileProject(root);
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const report = analyzeCompleteness(compiled.ir);
    expect(
      report.findings.filter((f) => f.code === "W903").map((f) => f.key),
    ).toEqual(missing);
    expect(compiled.ir.nets).toHaveLength(16 - connected.length);
    if (version === "0.2.0") {
      const overload = report.devices.find((d) => d.designation === "OL1")!;
      expect(overload.coverage.notes).toContain(
        "the trip contact is the only modeled output; unwired, the overload cannot interrupt its load",
      );
      for (const key of ["95", "96"])
        expect(overload.connections.find((c) => c.key === key)?.required).toBe(
          true,
        );
    }
  },
);

it("keeps every shipped 0.2.0 template/example free of missing overload outputs", async () => {
  const selected: string[] = [];
  for (const root of ["examples", "packages/cli/templates"]) {
    for (const file of await readdir(root, { recursive: true })) {
      if (!file.endsWith("system.json")) continue;
      const manifest = JSON.parse(await readFile(join(root, file), "utf8"));
      if (
        !manifest.libraries?.some(
          (l: any) => l.name === "core" && l.version === "0.2.0",
        )
      )
        continue;
      const project = join(root, dirname(file));
      selected.push(project.replaceAll("\\", "/"));
      const compiled = await compileProject(project);
      expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const report = analyzeCompleteness(compiled.ir);
      const overloads = new Set(
        report.devices
          .filter((d) => d.typeId === "core:overload-3p-1nc")
          .map((d) => d.uid),
      );
      expect(
        report.findings.filter(
          (f) => overloads.has(f.deviceUid) && f.code === "W903",
        ),
      ).toEqual([]);
    }
  }
  expect(selected.sort()).toEqual(["packages/cli/templates/starter-default"]);
});
