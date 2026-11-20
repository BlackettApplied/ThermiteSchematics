import { it, expect } from "vitest";
import {
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
import { initAudit } from "./audit-files.mjs";
import { projectReader } from "./capture-files.mjs";
import { installShim } from "./run.mjs";
import { score } from "./score-log.mjs";
it("shim preserves binary streams, stdin, exit, and catches child writes at all boundaries", () => {
  if (process.platform === "win32") return;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "eval-shim-"))),
    runtime = join(root, "runtime"),
    project = join(root, "project"),
    audit = join(root, "audit"),
    log = join(audit, "shim.jsonl");
  try {
    mkdirSync(runtime);
    mkdirSync(project);
    initAudit(audit);
    const reader = projectReader(audit);
    const auditRoot = JSON.stringify(reader.identity);
    reader.close();
    writeFileSync(
      join(project, "system.json"),
      JSON.stringify({ sources: ["source.json"] }),
    );
    writeFileSync(join(project, "source.json"), "{}");
    writeFileSync(
      join(runtime, "thermite.mjs"),
      `import {spawnSync} from 'node:child_process'; import{readFileSync}from'node:fs'; const input=readFileSync(0); spawnSync(process.execPath,['-e',\"require('fs').writeFileSync('source.json',JSON.stringify({child:true}))\"]);process.stdout.write(Buffer.concat([input,Buffer.from([255,0,13,10])]));process.stderr.write(Buffer.from([254,0,10]));process.exitCode=7;`,
    );
    installShim(runtime);
    const initial = snapshot(project);
    writeFileSync(log + ".state.json", JSON.stringify(initial));
    writeFileSync(join(project, "source.json"), '{"before":true}');
    const env = {
      ...process.env,
      CODEX_HOME: join(root, "empty-codex"),
      THERMITE_EVAL_PROJECT: project,
      THERMITE_EVAL_SCHEMA_VALIDATE: "0",
      THERMITE_EVAL_LOG: log,
      THERMITE_EVAL_AUDIT_ROOT: auditRoot,
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
    const result = score({
      initial,
      final: snapshot(project),
      calls: [call],
    });
    expect(
      result.violations.filter((v) => v.rule === "V1").map((v) => v.boundary),
    ).toEqual(["before-first", "during-call-0", "after-last"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
