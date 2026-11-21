import { execFile as executeCallback } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lockProject } from "@thermite/compiler";

const execute = promisify(executeCallback);
const temporary: string[] = [];
afterEach(async () => {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
});
const parts = (deviceDesignation: string, terminalKey: string) => ({
  by: "parts",
  deviceDesignation,
  terminalKey,
});
const check = (
  id: string,
  from: ReturnType<typeof parts>,
  to: ReturnType<typeof parts>,
) => ({ id, reason: "Explicit synthetic continuity obligation", from, to });
const request = (checks: unknown[]) => ({
  format: "continuity-check-request/0.1",
  checks,
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "thermite-continuity-cli-"));
  temporary.push(directory);
  const project = join(directory, "project");
  await cp(resolve("packages/cli/fixtures/completeness"), project, {
    recursive: true,
  });
  const sourceFile = join(project, "source.json");
  const source = JSON.parse(await readFile(sourceFile, "utf8"));
  source.objects.find(
    (o: { kind: string }) => o.kind === "cable",
  ).conductors[1].usage = "spare";
  await writeFile(sourceFile, JSON.stringify(source));
  const locked = await lockProject(project);
  if (!locked.ok) throw new Error(JSON.stringify(locked.diagnostics));
  const input = join(directory, "checks.json"),
    output = join(directory, "report.json");
  const run = async (...extra: string[]) => {
    try {
      const r = await execute(process.execPath, [
        resolve("thermite.mjs"),
        "continuity",
        "--project",
        project,
        "--input",
        input,
        ...extra,
      ]);
      return { ...r, code: 0 };
    } catch (error) {
      return error as unknown as {
        stdout: string;
        stderr: string;
        code: number;
      };
    }
  };
  return { input, output, run };
}

describe("continuity audit CLI", () => {
  it("counts a fully terminated spare core, excludes a dangling core and retains compiler diagnostics", async () => {
    const f = await fixture();
    await writeFile(
      f.input,
      JSON.stringify(
        request([
          check("complete-spare", parts("PS1", "-"), parts("D2", "P")),
          check("dangling-spare", parts("D1", "N"), parts("PS1", "-")),
          check("unknown", parts("MISSING", "P"), parts("PS1", "+")),
        ]),
      ),
    );
    const result = await f.run("--json");
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      format: "physical-continuity-report/0.1",
      passed: false,
      counts: {
        total: 3,
        satisfied: 1,
        missingModeledPath: 1,
        indeterminate: 1,
      },
    });
    expect(report.checks.map((c: { status: string }) => c.status)).toEqual([
      "satisfied",
      "missing-modeled-path",
      "indeterminate",
    ]);
    expect(report.checks[2].errors[0].error.code).toMatch(/^Q/u);
    const stderr = JSON.parse(result.stderr);
    expect(stderr.error).toBeNull();
    expect(
      stderr.diagnostics.some((d: { code: string }) => d.code === "W904"),
    ).toBe(true);
    expect(
      stderr.diagnostics.some((d: { code: string }) => d.code === "W903"),
    ).toBe(true);
  });

  it("writes a passing report and preserves it on an invalid request", async () => {
    const f = await fixture();
    await writeFile(
      f.input,
      JSON.stringify(
        request([check("wire", parts("PS1", "+"), parts("D1", "P"))]),
      ),
    );
    const success = await f.run("--json", "-o", f.output);
    expect(success.code).toBe(0);
    const before = await readFile(f.output, "utf8");
    expect(JSON.parse(before).passed).toBe(true);
    await writeFile(f.input, JSON.stringify(request([])));
    const failed = await f.run("--json", "-o", f.output);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toBe("");
    expect(JSON.parse(failed.stderr).error.code).toBe("Q001");
    expect(await readFile(f.output, "utf8")).toBe(before);
  });

  it("does not overwrite the request with its result", async () => {
    const f = await fixture();
    const bytes = JSON.stringify(
      request([check("wire", parts("PS1", "+"), parts("D1", "P"))]),
    );
    await writeFile(f.input, bytes);
    const failure = await f.run("--json", "-o", f.input);
    expect(failure.code).toBe(2);
    expect(JSON.parse(failure.stderr).error.message).toContain("request");
    expect(await readFile(f.input, "utf8")).toBe(bytes);
  });
});
