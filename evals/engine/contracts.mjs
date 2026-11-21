import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, rename, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { patchEngine, writeFileAtomically } from "./engine.mjs";
const {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
} = await patchEngine();
import {
  cli,
  streams,
  request,
  patchRequest,
  filePatch,
  temporary,
  probe,
  root,
  json,
  edit,
  required,
  observed,
} from "./support.mjs";

const deviceFile = "devices/equipment.json";
const wireFile = "connections/wires.json";
const operation = (value = "Synthetic guarded edit") => ({
  op: "replace",
  path: "/objects/0/description",
  value,
});

async function snapshot(project) {
  return Promise.all(
    [deviceFile, wireFile, "presentation.json"].map((file) =>
      readFile(join(project, file), "utf8"),
    ),
  );
}

function send(worker, message) {
  if (!worker.child.connected) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    worker.child.send(message, (error) => {
      if (error && !["ERR_IPC_CHANNEL_CLOSED", "EPIPE"].includes(error.code))
        reject(error);
      else resolve(!error);
    });
  });
}
function worker(input) {
  const child = spawn(
    process.execPath,
    [join(root, "evals/engine/patch-worker.mjs"), input],
    { cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  let stdout = "",
    stderr = "",
    done = false;
  const events = new Set();
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.on("message", (message) => events.add(message));
  const completion = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error("Patch worker deadline exceeded"));
    }, 30000);
    child.on("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      done = true;
      resolve({ code, stdout, stderr });
    });
  });
  completion.catch(() => {}); // errors are consumed by the round, not unhandled
  return {
    child,
    events,
    completion,
    get done() {
      return done;
    },
  };
}
async function until(predicate, label) {
  const deadline = performance.now() + 10000;
  while (!predicate()) {
    if (performance.now() > deadline)
      throw new Error(`Barrier timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function stop(workers) {
  for (const w of workers) if (!w.done) w.child.kill();
  await Promise.allSettled(workers.map((w) => w.completion));
}
async function conflict(project, directory) {
  const files = [];
  for (const name of ["A", "B"]) {
    const input = join(directory, `${name}.json`);
    const file = await filePatch(project, deviceFile, [
      {
        op: "test",
        path: "/objects/0/description",
        value: "Synthetic control source",
      },
      operation(name),
    ]);
    const req = patchRequest(project, [file], false);
    streams(
      await cli("apply-source-patch", { ...req, dryRun: true }),
      "apply-source-patch",
      0,
    );
    await writeFile(input, json(req));
    files.push(input);
  }
  const workers = files.map(worker);
  try {
    await until(
      () => workers.every((w) => w.events.has("ready") || w.done),
      "both processes ready",
    );
    if (!workers.every((w) => w.events.has("ready")))
      throw new Error("Worker exited before ready");
    // Hold A at precommit BEFORE B starts. On WS-C, B must actually attempt
    // reservation while A holds it; on historical engines both captured
    // snapshots must overlap. There is no elapsed-time fallback release.
    await send(workers[0], "start");
    await until(
      () => workers[0].events.has("barrier") || workers[0].done,
      "owner precommit snapshot",
    );
    if (!workers[0].events.has("barrier"))
      throw new Error("Owner exited before snapshot barrier");
    await send(workers[1], "start");
    await until(
      () =>
        workers[1].events.has("barrier") ||
        workers[1].events.has("contended") ||
        workers[1].done,
      "peer captured snapshot or reservation contention",
    );
    const releasedBy = workers[1].events.has("barrier")
      ? "both-precommit-barriers"
      : workers[1].events.has("contended")
        ? "reservation-contention"
        : "peer-finished-without-overlap";
    // Exactly one release per worker barrier; callbacks handle disconnect races.
    await send(workers[0], "release");
    if (workers[1].events.has("barrier")) await send(workers[1], "release");
    const outcomes = await Promise.all(workers.map((w) => w.completion));
    for (const outcome of outcomes) {
      assert([0, 1, 2].includes(outcome.code));
      streams(outcome, "apply-source-patch", outcome.code);
    }
    const loser = outcomes.find((o) => o.code !== 0);
    const loserCode = loser
      ? (JSON.parse(loser.stderr).error?.code ?? null)
      : null;
    const actual = JSON.parse(
      await readFile(join(project, deviceFile), "utf8"),
    );
    const evidence = {
      releasedBy,
      overlapped: releasedBy !== "peer-finished-without-overlap",
      exits: outcomes.map((o) => o.code),
      loserCode,
      finalDescription: actual.objects[0].description,
    };
    if (!evidence.overlapped)
      return {
        assessment: true,
        status: "not-overlapped",
        evidence,
        failure:
          "No observed competing reservation or snapshot; cannot count as a pass",
      };
    return await observed(evidence, () => {
      assert.equal(
        outcomes.filter((o) => o.code === 0).length,
        1,
        `Exactly one writer must win; observed exits ${evidence.exits}`,
      );
      assert([1, 2].includes(loser.code));
      assert(
        ["A004", "A005"].includes(loserCode),
        "Loser must report stale integrity or lock contention",
      );
      assert.equal(
        JSON.parse(outcomes.find((o) => o.code === 0).stdout).value.applied,
        true,
      );
      assert.equal(
        actual.objects[0].description,
        outcomes[0].code === 0 ? "A" : "B",
      );
    });
  } finally {
    await stop(workers);
  }
}

async function rollbackSentinel(project, directory) {
  const outside = join(directory, "outside");
  await mkdir(outside);
  const sentinel = "SYNTHETIC OUTSIDE SENTINEL\n";
  for (const file of ["equipment.json", "wires.json"])
    await writeFile(join(outside, file), sentinel);
  const files = await Promise.all(
    [wireFile, deviceFile].map((file) =>
      filePatch(project, file, [
        {
          op: "add",
          path: "/objects/0/description",
          value: "Synthetic rollback edit",
        },
      ]),
    ),
  );
  const req = patchRequest(project, files);
  const dryRun =
    await createInternalApplySourcePatchTool().applySourcePatch(req);
  required(() =>
    assert(dryRun.ok, "Dry run must succeed before fault injection"),
  );
  let injected = false;
  const tool = createInternalApplySourcePatchTool(
    {},
    {
      ...defaultApplySourcePatchDependencies,
      async writeFileAtomically(path, bytes) {
        await writeFileAtomically(path, bytes);
        if (!injected) {
          injected = true;
          for (const name of ["connections", "devices"]) {
            await rename(join(project, name), join(project, `${name}-saved`));
            await symlink(
              outside,
              join(project, name),
              process.platform === "win32" ? "junction" : "dir",
            );
          }
        }
      },
    },
  );
  const result = await tool.applySourcePatch({ ...req, dryRun: false });
  required(() => assert(injected, "Fault injection must execute"));
  const outsideUnchanged = Object.fromEntries(
    await Promise.all(
      ["equipment.json", "wires.json"].map(async (file) => [
        file,
        (await readFile(join(outside, file), "utf8")) === sentinel,
      ]),
    ),
  );
  return observed({ injected, outsideUnchanged, outcome: result }, () => {
    required(() => assert(!result.ok, "Ancestor swap must reject the patch"));
    for (const [file, unchanged] of Object.entries(outsideUnchanged))
      assert(unchanged, `Rollback overwrote outside sentinel ${file}`);
    assert.equal(
      result.failureClass,
      "tool",
      "Incomplete rollback must classify as infrastructure failure (exit 2)",
    );
  });
}

async function lockControl(project, directory, abandoned) {
  const input = join(directory, "owner.json");
  const patch = await filePatch(project, deviceFile, [operation("Owner")]);
  await writeFile(input, json(patchRequest(project, [patch], false)));
  const owner = worker(input);
  try {
    await until(() => owner.events.has("ready"), "lock owner ready");
    await send(owner, "start");
    await until(
      () => owner.events.has("barrier"),
      "owner paused with snapshot",
    );
    const before = await snapshot(project);
    if (abandoned) {
      owner.child.kill("SIGKILL");
      await owner.completion;
    }
    const result = await cli(
      "apply-source-patch",
      patchRequest(project, [patch], false),
    );
    const { report } = required(() => {
      assert([0, 1, 2].includes(result.code));
      return streams(result, "apply-source-patch", result.code);
    });
    const unchanged =
      JSON.stringify(await snapshot(project)) === JSON.stringify(before);
    return await observed(
      { exit: result.code, error: report.error, unchanged },
      () => {
        assert.notEqual(
          result.code,
          0,
          "Held/abandoned reservation must refuse a competing writer",
        );
        assert.equal(
          report.error?.code,
          "A005",
          "Lock owner/abandonment must be reported distinctly",
        );
        assert.equal(
          report.error.ownerState,
          abandoned ? "not-running" : "alive",
        );
        assert(unchanged, "Contending writer changed project source");
      },
    );
  } finally {
    await stop([owner]);
  }
}

export async function contracts({ conflicts = 100 } = {}) {
  const rows = [];
  const requests = {
    validate: {},
    resolve: { target: { by: "designation", value: "PS1" } },
    inspect: { selector: { by: "designation", value: "PS1" } },
    query: {
      query: {
        operation: "net",
        selector: { by: "parts", deviceDesignation: "PS1", terminalKey: "+" },
      },
    },
    "create-view": {
      spec: {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "C1" },
        intent: { kind: "conductors" },
        flow: "left-to-right",
      },
    },
    "apply-source-patch": null,
  };
  for (const [tool, fields] of Object.entries(requests)) {
    for (const mode of [
      "success",
      "request-error",
      "compile-error",
      "infrastructure-error",
    ])
      rows.push(
        await probe(`contract/${tool}/${mode}`, () =>
          temporary(async (project) => {
            let input =
              fields === null
                ? patchRequest(project, [
                    await filePatch(project, deviceFile, [operation()]),
                  ])
                : request(project, fields);
            let exit = 0;
            if (mode === "request-error") {
              input = { ...input, extra: true };
              exit = 1;
            }
            if (mode === "compile-error") {
              await edit(project, deviceFile, (value) => {
                value.objects[0].type = "core:missing";
              });
              exit = 1;
              if (tool === "apply-source-patch")
                input = patchRequest(project, [
                  await filePatch(project, deviceFile, [operation()]),
                ]);
            }
            if (mode === "infrastructure-error") {
              input = { ...input, project: join(project, "absent") };
              exit = 2;
            }
            const { report, result } = streams(
              await cli(tool, input),
              tool,
              exit,
            );
            if (mode === "request-error")
              assert.equal(report.error?.code, "A001");
            if (mode === "compile-error")
              assert(report.diagnostics.some((d) => d.code === "E103"));
            if (mode === "success" && tool === "inspect") assert(result.value);
            return {
              exit,
              diagnostics: report.diagnostics,
              error: report.error,
            };
          }),
        ),
      );
  }
  for (const [id, modify, expectedCode] of [
    [
      "stale",
      (file) => ({
        ...file,
        expectedIntegrity: "sha256-" + "A".repeat(43) + "=",
      }),
      "A004",
    ],
    ["escape", (file) => ({ ...file, path: "../outside.json" }), "A003"],
    ["absolute", (file) => ({ ...file, path: "/outside.json" }), "A003"],
    ["manifest", (file) => ({ ...file, path: "system.json" }), "A003"],
    [
      "lock",
      (file) => ({ ...file, path: "electrical-system.lock.json" }),
      "A003",
    ],
    [
      "library",
      (file) => ({ ...file, path: "library/types/node.json" }),
      "A003",
    ],
    ["guide", (file) => ({ ...file, path: "AGENTS.md" }), "A003"],
    [
      "pointer",
      (file) => ({
        ...file,
        operations: [{ ...operation(), path: "/objects/~2" }],
      }),
      "A002",
    ],
    [
      "test",
      (file) => ({
        ...file,
        operations: [
          { op: "test", path: "/objects/0/designation", value: "ABSENT" },
        ],
      }),
      "A002",
    ],
  ])
    rows.push(
      await probe(`guard/${id}`, () =>
        temporary(async (project) => {
          const before = await snapshot(project);
          const file = modify(
            await filePatch(project, deviceFile, [operation()]),
          );
          const { report } = streams(
            await cli(
              "apply-source-patch",
              patchRequest(project, [file], false),
            ),
            "apply-source-patch",
            1,
          );
          assert.equal(report.error?.code, expectedCode);
          assert.deepEqual(await snapshot(project), before);
          return { exit: 1, error: report.error, unchanged: true };
        }),
      ),
    );
  rows.push(
    await probe("guard/dry-run-apply-stale-noop-presentation", () =>
      temporary(async (project) => {
        const before = await snapshot(project);
        const files = await Promise.all([
          filePatch(project, deviceFile, [operation()]),
          filePatch(project, "presentation.json", [
            { op: "replace", path: "/revision", value: "EVAL-2" },
          ]),
        ]);
        const dry = streams(
          await cli("apply-source-patch", patchRequest(project, files)),
          "apply-source-patch",
          0,
        );
        assert.equal(dry.result.value.dryRun, true);
        assert.deepEqual(await snapshot(project), before);
        const apply = streams(
          await cli("apply-source-patch", patchRequest(project, files, false)),
          "apply-source-patch",
          0,
        );
        assert.equal(apply.result.value.applied, true);
        assert.deepEqual(dry.result.value.files, apply.result.value.files);
        assert.notDeepEqual(await snapshot(project), before);
        const after = await snapshot(project);
        streams(await cli("validate", request(project)), "validate", 0);
        const stale = streams(
          await cli("apply-source-patch", patchRequest(project, files, false)),
          "apply-source-patch",
          1,
        );
        assert.equal(stale.report.error?.code, "A004");
        const noop = await filePatch(project, deviceFile, [operation()]);
        streams(
          await cli("apply-source-patch", patchRequest(project, [noop], false)),
          "apply-source-patch",
          0,
        );
        assert.deepEqual(await snapshot(project), after);
        return {
          dryRunUnchanged: true,
          applied: true,
          staleUnchanged: true,
          noopUnchanged: true,
        };
      }),
    ),
  );
  rows.push(
    await probe("guard/staged-invalid-second-file", () =>
      temporary(async (project) => {
        const before = await snapshot(project);
        const files = await Promise.all([
          filePatch(project, deviceFile, [operation()]),
          filePatch(project, wireFile, [
            {
              op: "replace",
              path: "/objects/0/endpoints/0/device",
              value: "ABSENT",
            },
          ]),
        ]);
        const { report } = streams(
          await cli("apply-source-patch", patchRequest(project, files, false)),
          "apply-source-patch",
          1,
        );
        assert(report.diagnostics.some((d) => d.code === "E101"));
        assert.deepEqual(await snapshot(project), before);
        return { unchanged: true };
      }),
    ),
  );
  rows.push(
    await probe("guard/rollback-outside-sentinel", () =>
      temporary(rollbackSentinel),
    ),
  );
  rows.push(
    await probe("guard/held-lock", () =>
      temporary((p, d) => lockControl(p, d, false)),
    ),
  );
  rows.push(
    await probe("guard/abandoned-lock", () =>
      temporary((p, d) => lockControl(p, d, true)),
    ),
  );
  for (let i = 0; i < conflicts; i++)
    rows.push(
      await probe(`guard/two-process-barrier/${i + 1}`, () =>
        temporary(conflict),
      ),
    );
  return rows;
}
