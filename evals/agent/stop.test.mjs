import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { captureProcess } from "./process.mjs";
import { harnessIdentity, pinCheckpoint } from "./checkpoint.mjs";
import { adjudicateRun } from "./records.mjs";
import { credentialKeys } from "./auth.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};
function fixture(scenario) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "eval-main-stop-"))),
    checkpoint = "test-" + basename(work),
    destination = join(repo, "evals/out/agent", checkpoint),
    prepared = join(work, "prepared"),
    tasks = join(work, "tasks"),
    bin = join(work, "bin"),
    control = join(work, "control.json"),
    trace = join(work, "trace.jsonl"),
    exited = join(work, "a-exited"),
    inSetup = join(work, "b-in-setup");
  for (const dir of [prepared, tasks, bin]) mkdirSync(dir);
  const plan = {
    scenario,
    behavior: scenario === "race" ? "quota" : "unknown",
    version: scenario === "race" ? "codex-cli 0.164.0" : "codex-cli 0.165.0",
  };
  write(control, plan);
  const common = `import * as fs from 'node:fs';import * as p from 'node:path';const plan=JSON.parse(fs.readFileSync(${JSON.stringify(control)}));const event=(stage)=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({stage,at:Date.now()})+'\\n');const wait=async(path)=>{const end=Date.now()+10000;while(!fs.existsSync(path)){if(Date.now()>end)throw Error('fixture barrier timed out');await new Promise(r=>setTimeout(r,5));}};`;
  writeFileSync(
    join(prepared, "thermite.mjs"),
    common +
      `
    const args=process.argv.slice(2);
    if(args[0]==='init') {
      const b=args.includes('cabinets');
      if(b&&plan.scenario==='race'){event('B-init-enter');fs.writeFileSync(${JSON.stringify(inSetup)},'ready');await wait(${JSON.stringify(exited)});event('B-init-leave');}
      fs.mkdirSync(args[1],{recursive:true});
      fs.writeFileSync(p.join(args[1],'AGENTS.md'),'Synthetic project guide.');
      fs.writeFileSync(p.join(args[1],'system.json'),JSON.stringify({format:'electrical-system/0.1',project:{name:b?'B':'A'},sources:[],libraries:[]}));
    } else if(args[0]==='validate') console.log('[]');
  `,
  );
  const quota = readFileSync(
      new URL(
        "./fixtures/cli/codex-0.164.0/usage_limit_reached.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
    unknown = readFileSync(
      new URL(
        "./fixtures/cli/codex-0.164.0/insufficient_quota.jsonl",
        import.meta.url,
      ),
      "utf8",
    );
  writeFileSync(
    join(bin, "codex"),
    "#!/usr/bin/env bun\n" +
      common +
      `
    const args=process.argv.slice(2);
    if(args.includes('--version')){console.log(plan.version);process.exit(plan.versionExit??0);}
    if(args[0]==='login')process.exit(0);
    const task=JSON.parse(fs.readFileSync('system.json')).project.name;event('agent-'+task);
    if(task==='A'&&plan.behavior!=='ok'){
      if(plan.scenario==='race')await wait(${JSON.stringify(inSetup)});
      process.stdout.write(plan.behavior==='quota'?${JSON.stringify(quota)}:${JSON.stringify(unknown)});
      event('A-exited');fs.writeFileSync(${JSON.stringify(exited)},'exited');process.exit(1);
    }
    console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
  `,
    { mode: 0o755 },
  );
  for (const id of ["A", "B"]) {
    write(join(tasks, id, "task.json"), {
      id,
      template: id === "B" ? "cabinets" : "starter",
      prompt: "Synthetic dispatch probe",
      expectedWarnings: [],
      ...(scenario === "hook-error" && id === "A"
        ? { setup: "setup.mjs" }
        : {}),
    });
    if (scenario === "hook-error" && id === "A")
      writeFileSync(
        join(tasks, id, "setup.mjs"),
        'export default()=>{throw Error("hook failure: W-CTL-001 not found")};',
      );
    writeFileSync(
      join(tasks, id, "check.mjs"),
      "export default()=>({pass:true});",
    );
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  write(join(destination, "context/context.json"), {
    commit,
    context: "runtime",
    prepared: { path: prepared, commit },
    ...pinCheckpoint(null, harnessIdentity({ tasksDir: tasks })),
  });
  const env = { ...process.env, PATH: bin + delimiter + process.env.PATH };
  for (const key of credentialKeys) delete env[key];
  return {
    work,
    destination,
    plan,
    invoke: (...extra) =>
      captureProcess(
        process.execPath,
        [
          join(repo, "evals/agent/run.mjs"),
          "--agent",
          "codex",
          "--checkpoint",
          checkpoint,
          ...(extra.includes("--task") ? [] : ["--all"]),
          "--tasks-dir",
          tasks,
          ...extra,
        ],
        { cwd: repo, env, timeout: 20000 },
      ),
    records: () =>
      readdirSync(destination, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "context")
        .flatMap((d) =>
          readdirSync(join(destination, d.name))
            .map((a) => join(destination, d.name, a, "manifest.json"))
            .filter(existsSync),
        )
        .map((path) => ({ path, run: read(path) })),
    events: () =>
      existsSync(trace)
        ? readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse)
        : [],
    update: () => write(control, plan),
    cleanup: () => {
      rmSync(work, { recursive: true, force: true });
      rmSync(destination, { recursive: true, force: true });
    },
  };
}
// These probes need a real POSIX executable shebang; no model CLI is invoked.
it.skipIf(process.platform === "win32")(
  "setup worker errors reach the infrastructure diagnostic",
  async () => {
    const w = fixture("hook-error");
    try {
      const r = await w.invoke("--task", "A");
      expect(r.status, r.stderr).toBe(1);
      expect(w.records()[0].run).toMatchObject({
        status: "infrastructure-failure",
        stage: "setup",
      });
      expect(w.records()[0].run.infrastructureError).toContain(
        "hook failure: W-CTL-001 not found",
      );
      expect(w.events().filter((e) => e.stage.startsWith("agent-"))).toEqual(
        [],
      );
    } finally {
      w.cleanup();
    }
  },
  25000,
);
it.skipIf(process.platform === "win32").each([
  ["", 0],
  ["codex-cli 0.164.0", 1],
])(
  "unknown CLI version is null (stdout=%j, exit=%s)",
  async (version, versionExit) => {
    const w = fixture("version");
    try {
      Object.assign(w.plan, { version, versionExit, behavior: "ok" });
      w.update();
      const r = await w.invoke("--task", "A");
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain("unpinned codex CLI version unknown;");
      expect(w.records()[0].run.cliVersions.agent).toBeNull();
      expect(read(join(w.destination, "checkpoint.json"))).toMatchObject({
        batchCliVersion: null,
        protocolWarnings: [{ cliVersion: null }],
      });
    } finally {
      w.cleanup();
    }
  },
  25000,
);
it.skipIf(process.platform === "win32")(
  "main dispatch handles a sibling quota exit during setup-free init",
  async () => {
    const w = fixture("race");
    try {
      const r = await w.invoke("--concurrency", "2");
      expect(r.status, r.stderr).toBe(1);
      expect(
        w
          .records()
          .map((x) => [x.run.task, x.run.status])
          .sort(),
      ).toEqual([
        ["A", "halted-infra"],
        ["B", "not-started"],
      ]);
      expect(
        w
          .events()
          .filter((e) => e.stage.startsWith("agent-"))
          .map((e) => e.stage),
      ).toEqual(["agent-A"]);
      const times = Object.fromEntries(w.events().map((e) => [e.stage, e.at]));
      expect(times["A-exited"]).toBeGreaterThanOrEqual(times["B-init-enter"]);
      expect(times["B-init-leave"]).toBeGreaterThanOrEqual(times["A-exited"]);
    } finally {
      w.cleanup();
    }
  },
  25000,
);
it.skipIf(process.platform === "win32")(
  "an unpinned unknown halts main, blocks resume, then continues after adjudication",
  async () => {
    const w = fixture("unknown");
    try {
      const first = await w.invoke();
      expect(first.status, first.stderr).toBe(1);
      expect(first.stderr).toContain(
        "unpinned codex CLI version codex-cli 0.165.0",
      );
      expect(w.records()).toHaveLength(1);
      const original = w.records()[0],
        bytes = readFileSync(original.path, "utf8");
      expect(original.run.status).toBe("needs-adjudication");
      for (const extra of [[], ["--force-rerun"], ["--task", "B"]]) {
        const r = await w.invoke(...extra);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("Unresolved adjudication");
      }
      expect(
        w.events().filter((e) => e.stage.startsWith("agent-")),
      ).toHaveLength(1);
      adjudicateRun(join(original.path, ".."), {
        resolution: "infrastructure",
        reason: "Synthetic unpinned native fixture",
        operator: "test",
      });
      expect(readFileSync(original.path, "utf8")).toBe(bytes);
      w.plan.behavior = "ok";
      w.plan.version = "codex-cli 0.164.0";
      w.update();
      const resumed = await w.invoke();
      expect(resumed.status, resumed.stderr).toBe(0);
      expect(
        w
          .records()
          .filter((x) => x.run.status === "complete")
          .map((x) => x.run.task)
          .sort(),
      ).toEqual(["A", "B"]);
    } finally {
      w.cleanup();
    }
  },
  25000,
);
