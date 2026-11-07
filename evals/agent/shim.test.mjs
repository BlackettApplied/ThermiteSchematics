import { it, expect } from "vitest";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { snapshot } from "./snapshot.mjs";
import { score } from "./score-log.mjs";
it("shim preserves binary streams, stdin, exit, and catches child writes at all boundaries", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "eval-shim-"))),
    runtime = join(root, "runtime"),
    project = join(root, "project"),
    log = join(root, "log.jsonl");
  try {
    mkdirSync(runtime);
    mkdirSync(project);
    cpSync(
      new URL("./shim/observe.mjs", import.meta.url),
      join(runtime, "eval-observe.mjs"),
    );
    cpSync(
      new URL("./shim/thermite.mjs", import.meta.url),
      join(runtime, "thermite.mjs"),
    );
    cpSync(
      new URL("./snapshot.mjs", import.meta.url),
      join(runtime, "eval-snapshot.mjs"),
    );
    cpSync(
      new URL("./process.mjs", import.meta.url),
      join(runtime, "eval-process.mjs"),
    );
    writeFileSync(
      join(runtime, "eval-audit.mjs"),
      readFileSync(new URL("./audit.mjs", import.meta.url), "utf8")
        .replaceAll('"./snapshot.mjs"', '"./eval-snapshot.mjs"')
        .replaceAll('"./process.mjs"', '"./eval-process.mjs"'),
    );
    writeFileSync(
      join(runtime, "eval-auth.mjs"),
      readFileSync(new URL("./auth.mjs", import.meta.url), "utf8")
        .replaceAll('"./snapshot.mjs"', '"./eval-snapshot.mjs"')
        .replaceAll('"./process.mjs"', '"./eval-process.mjs"'),
    );
    writeFileSync(
      join(project, "system.json"),
      JSON.stringify({ sources: ["source.json"] }),
    );
    writeFileSync(join(project, "source.json"), "{}");
    writeFileSync(
      join(runtime, "thermite.real.mjs"),
      `import {spawnSync} from 'node:child_process'; import{readFileSync}from'node:fs'; const input=readFileSync(0); spawnSync(process.execPath,['-e',\"require('fs').writeFileSync('source.json',JSON.stringify({child:true}))\"]);process.stdout.write(Buffer.concat([input,Buffer.from([255,0,13,10])]));process.stderr.write(Buffer.from([254,0,10]));process.exitCode=7;`,
    );
    const initial = snapshot(project);
    writeFileSync(log + ".state.json", JSON.stringify(initial));
    writeFileSync(join(project, "source.json"), '{"before":true}');
    const env = {
      ...process.env,
      CODEX_HOME: join(root, "empty-codex"),
      THERMITE_EVAL_PROJECT: project,
      THERMITE_EVAL_SCHEMA_VALIDATE: "0",
      THERMITE_EVAL_LOG: log,
    };
    const input = Buffer.from('{"dryRun":true}');
    const r = spawnSync(
      process.env.BUN_BIN ?? "bun",
      [
        join(runtime, "thermite.mjs"),
        "agent",
        "apply-source-patch",
        "--input",
        "-",
      ],
      { cwd: project, env, input },
    );
    expect(r.status).toBe(7);
    expect(r.stdout).toEqual(
      Buffer.concat([input, Buffer.from([255, 0, 13, 10])]),
    );
    expect(r.stderr).toEqual(Buffer.from([254, 0, 10]));
    const call = JSON.parse(readFileSync(log, "utf8"));
    expect(call.request).toBe(input.toString());
    expect(call.stdoutBytes).toBe(r.stdout.length);
    expect(call.stderrBytes).toBe(r.stderr.length);
    expect(call.directEditsSincePrevious[0].path).toBe("source.json");
    expect(call.editsByThisCall[0].path).toBe("source.json");
    writeFileSync(join(project, "source.json"), '{"after":true}');
    const result = score({ initial, final: snapshot(project), calls: [call] });
    expect(
      result.violations.filter((v) => v.rule === "V1").map((v) => v.boundary),
    ).toEqual(["before-first", "during-call-0", "after-last"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
