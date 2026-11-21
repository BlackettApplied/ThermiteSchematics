import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { cp } from "node:fs/promises";
import { engineRoot } from "./engine.mjs";
import { root, temporary, probe } from "./support.mjs";
import { mutate, mutationCases } from "./validation.mjs";
function fresh(project, packet, cwd, TZ, locale) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, "evals/engine/determinism-worker.mjs"), project, packet],
      {
        cwd,
        env: { ...process.env, TZ, LANG: locale, LC_ALL: locale },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Determinism subprocess timed out"));
    }, 30000);
    child.stdout.on("data", (b) => {
      stdout += b;
    });
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Determinism worker failed: ${stderr}`));
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}
export async function determinism() {
  const rows = [];
  for (const kind of ["compile-and-12-view-packet", "authored-diagnostics"])
    rows.push(
      await probe(`determinism/${kind}`, () =>
        temporary(
          async (project, directory) => {
            if (kind === "authored-diagnostics")
              await mutate(
                project,
                (await mutationCases()).find((s) => s.id === "terminal-0"),
              );
            else
              await cp(join(engineRoot, "examples/machine-demo"), project, {
                recursive: true,
              });
            const packet = join(
              engineRoot,
              "examples/machine-demo/packet.request.json",
            );
            const runs = [];
            for (const [cwdName, cwd] of [
              ["project", project],
              ["parent", directory],
            ])
              for (const TZ of ["UTC", "America/Los_Angeles"])
                for (const locale of ["C", "fr_FR.UTF-8"])
                  runs.push({
                    cwd: cwdName,
                    ...(await fresh(project, packet, cwd, TZ, locale)),
                  });
            assert.equal(
              new Set(runs.map((r) => r.environment.resolvedLocale)).size,
              2,
              "Must exercise two effective JS locales",
            );
            assert.equal(
              new Set(runs.map((r) => r.environment.resolvedTZ)).size,
              2,
              "Must exercise two effective timezones",
            );
            for (const run of runs)
              assert.deepEqual(
                run.evidence,
                runs[0].evidence,
                "Diagnostics/compile/packet bytes changed across process, cwd, TZ or locale",
              );
            assert.equal(runs[0].evidence.ok, kind !== "authored-diagnostics");
            if (kind === "authored-diagnostics")
              assert(
                runs[0].evidence.diagnostics.some((d) => d.code === "E102"),
              );
            return { processes: runs.length, runs };
          },
          kind === "authored-diagnostics" ? "topology" : null,
        ),
      ),
    );
  return rows;
}
