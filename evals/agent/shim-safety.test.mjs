import { it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
import { installShim } from "./run.mjs";
import { snapshot, sha256 } from "./snapshot.mjs";
import { auditErrors } from "./audit.mjs";
import { score } from "./score-log.mjs";
const engine = fileURLToPath(new URL("../../thermite.mjs", import.meta.url));
// Review measured 12.09 s at load 46–51. Allow >2x that observed time for the
// three real-CLI integrations, including direct Vitest's 5 s default case.
const engineTestTimeout = 30000;
let starter;
afterAll(() => {
  if (starter) rmSync(starter.root, { recursive: true, force: true });
});
function world(realSource) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "eval-shim-safety-"))),
    runtime = join(root, "runtime"),
    project = join(root, "project"),
    log = join(root, "shim.jsonl"),
    marker = join(root, "shim-errors.jsonl");
  mkdirSync(runtime);
  mkdirSync(project);
  writeFileSync(join(runtime, "thermite.mjs"), realSource);
  installShim(runtime);
  const env = {
    ...process.env,
    CODEX_HOME: join(root, "empty-codex"),
    THERMITE_EVAL_PROJECT: project,
    THERMITE_EVAL_LOG: log,
    THERMITE_EVAL_ERRORS: marker,
  };
  return {
    root,
    runtime,
    project,
    log,
    marker,
    env,
    entry: join(runtime, "thermite.mjs"),
    real: join(runtime, "thermite.real.mjs"),
  };
}
const invoke = (w, args, input) =>
  spawnSync("bun", [w.entry, ...args], {
    cwd: w.project,
    env: w.env,
    input,
    encoding: "utf8",
  });
const lines = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse)
    : [];
// The synthetic CLI prints the native error on one line. Bun's own unhandled
// stack varies with its write path, so the fixture owns that presentation.
// Canonicalize only this errno line; all other stderr bytes remain exact.
function normalizePipeErrno(stderr) {
  return stderr.replace(
    /^pipe errno: (?:EPIPE|ENOTCONN) [+-]?\d+(?=\r?$)/gm,
    "pipe errno: <closed>",
  );
}
it.each([
  "EPIPE -32",
  "ENOTCONN -57",
  "ENOTCONN -107",
  "EPIPE -4047",
  "EPIPE -99",
  "EPIPE +32",
  "ENOTCONN 0",
])("closed-pipe errno is independent of the OS: %s", (errno) => {
  expect(normalizePipeErrno(`prefix\npipe errno: ${errno}\nsuffix\n`)).toBe(
    "prefix\npipe errno: <closed>\nsuffix\n",
  );
});
it("pipe comparison preserves every byte outside the known errno line", () => {
  const pipe = "prefix\npipe errno: <closed>\nsuffix\n";
  const socket = pipe.replace("<closed>", "ENOTCONN -107");
  expect(normalizePipeErrno(socket)).toBe(pipe);
  const reset = socket.replace("ENOTCONN", "ECONNRESET");
  expect(normalizePipeErrno(reset)).toBe(reset);
  for (const changed of [
    socket + "EPIPE: shim stack\n at eval-snapshot.mjs:1\n",
    "extra\n" + socket,
    socket.replace("pipe errno:", "another errno:"),
    socket.replace("-107", "unknown"),
    socket + "pipe errno: EPIPE -4047\n",
  ])
    expect(normalizePipeErrno(changed)).not.toBe(pipe);
});
it("errno normalization preserves CRLF bytes", () => {
  expect(
    normalizePipeErrno("prefix\r\npipe errno: ENOTCONN -107\r\nsuffix\r\n"),
  ).toBe("prefix\r\npipe errno: <closed>\r\nsuffix\r\n");
});
it("unwritable audit paths never alter the real CLI streams or status", () => {
  const w = world(
    "process.stdout.write(Buffer.from([255,0,10]));process.stderr.write(Buffer.from([254,0,13]));process.exitCode=17;",
  );
  try {
    const blocked = join(w.root, "blocked");
    mkdirSync(blocked);
    chmodSync(blocked, 0o500);
    // Windows chmod does not deny directory writes, and root bypasses POSIX
    // write bits. A directory as the append target guarantees a real audit
    // write failure there; unprivileged POSIX still exercises EACCES.
    w.env.THERMITE_EVAL_LOG =
      process.platform === "win32" || process.getuid?.() === 0
        ? blocked
        : join(blocked, "log");
    w.env.THERMITE_EVAL_SCHEMA_VALIDATE = "0";
    const args = ["validate", "."];
    const direct = spawnSync("bun", [w.real, ...args], {
        cwd: w.project,
        env: w.env,
      }),
      shim = spawnSync("bun", [w.entry, ...args], {
        cwd: w.project,
        env: w.env,
      });
    expect(shim.status).toBe(direct.status);
    expect(shim.status).toBe(17);
    expect(shim.stdout).toEqual(direct.stdout);
    expect(shim.stderr).toEqual(direct.stderr);
    expect(lines(w.marker).some((e) => e.kind === "shim-error")).toBe(true);
  } finally {
    chmodSync(join(w.root, "blocked"), 0o700);
    rmSync(w.root, { recursive: true, force: true });
  }
});
it("closed downstream stdout preserves child stderr without a shim EPIPE stack", async () => {
  const w = world(
    'process.stdout.on("error",e=>{process.stderr.write("pipe errno: "+e.code+" "+e.errno+"\\n");process.exitCode=1;});process.stderr.write("real-stderr\\n");process.stdout.write(Buffer.alloc(8*1024*1024,97));',
  );
  w.env.THERMITE_EVAL_SCHEMA_VALIDATE = "0";
  const closeEarly = (entry) =>
    new Promise((res) => {
      const child = spawn("bun", [entry], {
        cwd: w.project,
        env: w.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let error = "",
        prefix;
      child.stdout.once("data", (b) => {
        prefix = b.subarray(0, 10);
        child.stdout.destroy();
      });
      child.stderr.on("data", (b) => (error += b));
      child.on("close", (status, signal) =>
        res({ status, signal, error, prefix }),
      );
    });
  try {
    const direct = await closeEarly(w.real),
      shim = await closeEarly(w.entry);
    expect(shim.prefix).toEqual(direct.prefix);
    expect(shim.status).toBe(direct.status);
    expect(shim.status).toBe(1);
    expect(normalizePipeErrno(direct.error)).toBe(
      "real-stderr\npipe errno: <closed>\n",
    );
    expect(normalizePipeErrno(shim.error)).toBe(
      normalizePipeErrno(direct.error),
    );
    expect(shim.error).not.toContain("eval-snapshot");
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
it("runtime hash includes newly created empty .git directories", () => {
  const w = world("");
  try {
    const before = snapshot(w.runtime, { documents: false }).hash;
    mkdirSync(join(w.runtime, ".git"));
    const after = snapshot(w.runtime, { documents: false }).hash;
    expect(before).not.toBe(after);
    expect(
      score({ runtimeBefore: before, runtimeAfter: after }).violations.some(
        (v) => v.rule === "V5",
      ),
    ).toBe(true);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
it("dead-owner recovery cannot unlink a waiter's new lock", async () => {
  const w = world(
    'await new Promise(r=>setTimeout(r,40));process.stdout.write("ok");',
  );
  w.env.THERMITE_EVAL_SCHEMA_VALIDATE = "0";
  try {
    writeFileSync(w.log + ".lock", JSON.stringify({ pid: 2147483647 }));
    const call = () =>
      new Promise((resolve) => {
        const child = spawn("bun", [w.entry], {
          cwd: w.project,
          env: w.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.resume();
        child.stderr.resume();
        child.on("close", resolve);
      });
    expect(await Promise.all([call(), call(), call()])).toEqual([0, 0, 0]);
    const calls = lines(w.log);
    expect(calls).toHaveLength(3);
    for (let i = 1; i < calls.length; i++)
      expect(calls[i].started).toBeGreaterThanOrEqual(calls[i - 1].ended);
    expect(auditErrors(calls, calls.at(-1).entryHash)).toEqual([]);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
it(
  "the real CLI retains its exit code when report output is piped to head",
  () => {
    const w = engineWorld();
    try {
      const system = JSON.parse(
        readFileSync(join(w.project, "system.json"), "utf8"),
      );
      system.sources.push("many.json");
      writeFileSync(join(w.project, "system.json"), JSON.stringify(system));
      writeFileSync(
        join(w.project, "many.json"),
        JSON.stringify({
          objects: Array.from({ length: 1000 }, (_, i) => ({
            uid: `aaaaaaaa-aaaa-4aaa-aaaa-${String(i).padStart(12, "0")}`,
            kind: "wire",
            designation: `W-PIPE-${i}`,
            endpoints: [
              { device: "PS1", terminal: "-" },
              { device: "PLC1", terminal: "M" },
            ],
          })),
        }),
      );
      const piped = (entry) =>
        spawnSync(
          "bash",
          [
            "-c",
            'bun "$1" report wires | head -c 10 >/dev/null; exit "${PIPESTATUS[0]}"',
            "--",
            entry,
          ],
          { cwd: w.project, env: w.env, encoding: "utf8" },
        );
      const direct = piped(w.real),
        shim = piped(w.entry);
      expect(direct.status).toBe(1);
      expect(shim.status).toBe(direct.status);
      expect(direct.stderr).toContain("EPIPE");
      expect(shim.stderr).toContain("EPIPE");
      expect(lines(w.log).at(-1).exit).toBe(direct.status);
    } finally {
      rmSync(w.root, { recursive: true, force: true });
    }
  },
  engineTestTimeout,
);
function engineWorld(preamble = "") {
  const source =
    preamble +
    `const {runThermite}=await import(${JSON.stringify(new URL("../../packages/cli/dist/alpha.js", import.meta.url).href)});process.exitCode=await runThermite();`;
  const w = world(source);
  // Init is identical in all three tests. Copy its real output once rather
  // than launching the same setup CLI inside each bounded test window.
  if (!starter) {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "eval-shim-starter-")),
    );
    starter = { root, project: join(root, "project") };
    const result = spawnSync("bun", [engine, "init", starter.project], {
      cwd: root,
      env: w.env,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  }
  cpSync(starter.project, w.project, { recursive: true });
  return w;
}
it(
  "file-state permission survives human validate, help and multiple invalid repairs",
  () => {
    const w = engineWorld();
    try {
      const manifest = JSON.parse(
        readFileSync(join(w.project, "system.json"), "utf8"),
      );
      manifest.sources.push("repair.json");
      writeFileSync(join(w.project, "system.json"), JSON.stringify(manifest));
      writeFileSync(
        join(w.project, "repair.json"),
        JSON.stringify({
          objects: [
            { uid: "11111111-1111-4111-a111-111111111111", kind: "not-a-kind" },
          ],
        }),
      );
      // The first shim call establishes schema state with the real validator;
      // no edits precede it, so a second, standalone validation is redundant.
      const initial = snapshot(w.project);
      writeFileSync(
        w.log + ".state.json",
        JSON.stringify({ snapshot: initial, lastHash: null }),
      );
      expect(invoke(w, ["validate", "."]).status).toBe(1);
      invoke(w, ["--help"]);
      writeFileSync(
        join(w.project, "repair.json"),
        JSON.stringify({
          objects: [
            {
              uid: "11111111-1111-4111-a111-111111111111",
              kind: "device",
              designation: "K1",
            },
          ],
        }),
      );
      invoke(w, ["--help"]);
      writeFileSync(
        join(w.project, "repair.json"),
        JSON.stringify({
          objects: [
            {
              uid: "11111111-1111-4111-a111-111111111111",
              kind: "device",
              designation: "K1",
              type: "core:contactor-3p-1no",
            },
          ],
        }),
      );
      expect(invoke(w, ["validate", "."]).status).toBe(0);
      const calls = lines(w.log);
      expect(
        calls.map((c) => c.before.schemaInvalidFiles.includes("repair.json")),
      ).toEqual([true, true, true, false]);
      expect(
        score({ initial, final: snapshot(w.project), calls }).violations.map(
          (v) => v.rule,
        ),
      ).toEqual(["V1", "V1"]);
      expect(
        auditErrors(
          calls,
          JSON.parse(readFileSync(w.log + ".state.json")).lastHash,
        ),
      ).toEqual([]);
      const valid = snapshot(w.project),
        path = join(w.project, "repair.json"),
        doc = JSON.parse(readFileSync(path));
      doc.objects[0].description = "unguarded edit";
      writeFileSync(path, JSON.stringify(doc));
      expect(
        score({ initial: valid, final: snapshot(w.project) }).violations.some(
          (v) => v.rule === "V1",
        ),
      ).toBe(true);
    } finally {
      rmSync(w.root, { recursive: true, force: true });
    }
  },
  engineTestTimeout,
);
it(
  "overlapping guarded apply and packet serialize without a false V1",
  async () => {
    // Hold the real packet child until the apply shim records its queue arrival.
    // This proves overlap without a scheduler-sensitive fixed sleep.
    const w = engineWorld(`
    if(process.argv[2]==="packet") {
      const fs=await import("node:fs");
      fs.writeFileSync(process.env.EVAL_TEST_PACKET_READY, "ready");
      while(!fs.existsSync(process.env.EVAL_TEST_APPLY_QUEUED))
        await new Promise(r=>setTimeout(r,5));
    }
  `);
    const ready = join(w.root, "packet-ready"),
      queued = join(w.root, "apply-queued"),
      children = [],
      pending = [];
    w.env.EVAL_TEST_PACKET_READY = ready;
    w.env.EVAL_TEST_APPLY_QUEUED = queued;
    // Add one test-only signal immediately after the installed shim timestamps
    // queue arrival. Its locking/CLI code stays intact; markers live outside
    // both audited trees. Built-in fs bindings cannot be intercepted in Bun.
    const queueLine = "const queuedAt = Date.now();";
    const shim = readFileSync(w.entry, "utf8");
    expect(shim.split(queueLine)).toHaveLength(2);
    writeFileSync(
      w.entry,
      shim.replace(
        queueLine,
        queueLine +
          '\nif(process.env.EVAL_TEST_QUEUE_SIGNAL) writeFileSync(process.env.EVAL_TEST_QUEUE_SIGNAL,"queued");',
      ),
    );
    try {
      const initial = snapshot(w.project);
      writeFileSync(
        w.log + ".state.json",
        JSON.stringify({ snapshot: initial, lastHash: null }),
      );
      const source = "devices/equipment.json",
        doc = JSON.parse(readFileSync(join(w.project, source))),
        ps = doc.objects.findIndex((o) => o.designation === "PS1");
      const request = {
        format: "agent-tool-request/0.1",
        project: ".",
        patchFormat: "json-patch/0.1",
        dryRun: true,
        files: [
          {
            path: source,
            expectedIntegrity:
              "sha256-" +
              Buffer.from(
                sha256(readFileSync(join(w.project, source))),
                "hex",
              ).toString("base64"),
            operations: [
              {
                op: "test",
                path: `/objects/${ps}/uid`,
                value: doc.objects[ps].uid,
              },
              {
                op: "replace",
                path: `/objects/${ps}/description`,
                value: "Serialized guarded patch",
              },
            ],
          },
        ],
      };
      expect(
        invoke(
          w,
          ["agent", "apply-source-patch", "--input", "-"],
          JSON.stringify(request),
        ).status,
      ).toBe(0);
      writeFileSync(
        join(w.project, "packet.request.json"),
        JSON.stringify({
          format: "schematic-packet-request/0.1",
          index: true,
          views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
        }),
      );
      const asyncCall = (args, input, signalQueue = false) => {
        const child = spawn("bun", [w.entry, ...args], {
          cwd: w.project,
          env: {
            ...w.env,
            ...(signalQueue ? { EVAL_TEST_QUEUE_SIGNAL: queued } : {}),
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        children.push(child);
        const done = new Promise((res, reject) => {
          child.stdout.resume();
          let stderr = "";
          child.stderr.on("data", (b) => (stderr += b));
          child.on("error", reject);
          child.stdin.on("error", () => {});
          child.stdin.end(input ?? "");
          child.on("close", (status) => res({ status, stderr }));
        });
        pending.push(done);
        return { child, done };
      };
      const packet = asyncCall([
        "packet",
        "--input",
        "packet.request.json",
        "-o",
        "packet.json",
      ]);
      while (!existsSync(ready)) {
        if (packet.child.exitCode !== null || packet.child.signalCode)
          throw new Error("Packet exited before announcing readiness");
        await new Promise((r) => setTimeout(r, 5));
      }
      const apply = asyncCall(
        ["agent", "apply-source-patch", "--input", "-"],
        JSON.stringify({ ...request, dryRun: false }),
        true,
      );
      const outcomes = await Promise.all([packet.done, apply.done]);
      expect(
        outcomes.every((r) => r.status === 0),
        JSON.stringify(outcomes),
      ).toBe(true);
      const calls = lines(w.log);
      expect(calls.map((c) => c.argv[0])).toEqual(["agent", "packet", "agent"]);
      for (let i = 1; i < calls.length; i++)
        expect(calls[i].started).toBeGreaterThanOrEqual(calls[i - 1].ended);
      expect(
        calls.find(
          (c) =>
            c.argv[0] === "agent" && JSON.parse(c.request).dryRun === false,
        ).queuedAt,
      ).toBeLessThan(calls.find((c) => c.argv[0] === "packet").commandEnded);
      expect(
        JSON.parse(readFileSync(join(w.project, "packet.json"))).sheets.some(
          (s) => s.view?.kind === "bom",
        ),
      ).toBe(true);
      expect(auditErrors(calls, calls.at(-1).entryHash)).toEqual([]);
      expect(
        score({ initial, final: snapshot(w.project), calls }).violations,
      ).toEqual([]);
    } finally {
      for (const child of children)
        if (child.exitCode === null && !child.signalCode) child.kill();
      await Promise.allSettled(pending);
      rmSync(w.root, { recursive: true, force: true });
    }
  },
  engineTestTimeout,
);

it("credential values are redacted from audit and state without changing streams", () => {
  const w = world("process.stdout.write(process.env.CODEX_API_KEY);");
  const secret = "synthetic-private-credential-abcdef";
  w.env.CODEX_API_KEY = secret;
  w.env.THERMITE_EVAL_SCHEMA_VALIDATE = "0";
  try {
    writeFileSync(
      join(w.project, "system.json"),
      JSON.stringify({ sources: ["source.json"] }),
    );
    writeFileSync(
      join(w.project, "source.json"),
      JSON.stringify({ objects: [], description: secret }),
    );
    const r = invoke(
      w,
      ["agent", "validate", "--input", "-"],
      JSON.stringify({ description: secret }),
    );
    expect(r.stdout).toBe(secret);
    const capture = join(w.root, "private-capture");
    const observed = spawnSync(
      "bun",
      ["--preload", join(w.runtime, "eval-observe.mjs"), w.real],
      { env: { ...w.env, THERMITE_EVAL_CAPTURE: capture }, encoding: "utf8" },
    );
    expect(observed.stdout).toBe(secret);
    expect(readFileSync(capture + ".out", "utf8")).not.toContain(secret);
    expect(JSON.parse(readFileSync(capture + ".counts", "utf8")).stdout).toBe(
      Buffer.byteLength(secret),
    );

    expect(readFileSync(w.log, "utf8")).not.toContain(secret);
    expect(readFileSync(w.log + ".state.json", "utf8")).not.toContain(secret);
    const entry = lines(w.log)[0];
    expect(Buffer.from(entry.stdinBase64, "base64").toString()).not.toContain(
      secret,
    );
    expect(auditErrors([entry], entry.entryHash)).toEqual([]);
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
it("closed downstream stderr stays byte-transparent", async () => {
  const w = world(
    'process.stdout.write("real-stdout\\n");process.stderr.write(Buffer.alloc(8*1024*1024,98));',
  );
  w.env.THERMITE_EVAL_SCHEMA_VALIDATE = "0";
  const closeEarly = (entry) =>
    new Promise((res) => {
      const child = spawn("bun", [entry], {
        cwd: w.project,
        env: w.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "",
        prefix;
      child.stderr.once("data", (b) => {
        prefix = b.subarray(0, 10);
        child.stderr.destroy();
      });
      child.stdout.on("data", (b) => (out += b));
      child.on("close", (status, signal) =>
        res({ status, signal, out, prefix }),
      );
    });
  try {
    expect(await closeEarly(w.entry)).toEqual(await closeEarly(w.real));
  } finally {
    rmSync(w.root, { recursive: true, force: true });
  }
});
