import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shellCommand } from "../../agent/launch.mjs";
import { focus, ordering, run } from "./support.mjs";
import { inspectK1, inspectOrder } from "./R02/query-proof.mjs";

function frictionReport(seeded) {
  const setup = seeded
    ? "The focused test exposed the reversed terminal comparison. The rebuilt K1 inspection lists terminal keys from 1/L1 through A2."
    : "Created the linked worktree and installed its frozen dependencies with bun install --frozen-lockfile.";
  return `${setup}\n\nbun scripts/test.mjs ${focus} passed. bun run build passed.\n`;
}

function repairedComparator(repository, emit) {
  const source = readFileSync(join(repository, ordering), "utf8");
  emit("command_execution", {
    command: shellCommand(["cat", ordering]),
    exit_code: 0,
    aggregated_output: source,
  });
  const reversed = "  right: TerminalView,\n  left: TerminalView,";
  assert(
    source.includes(reversed),
    "Expected the focused test's reversed comparator",
  );
  return source.replace(
    reversed,
    "  left: TerminalView,\n  right: TerminalView,",
  );
}

export function contributorReference(ctx, seeded) {
  const repository = join(ctx.project, ctx.task.contributor.checkout);
  let calls = 0;
  const emit = (type, fields) =>
    console.log(
      JSON.stringify({
        type: "item.completed",
        item: { id: "contributor-" + ++calls, type, ...fields },
      }),
    );
  const edit = (cwd, path, text) => {
    writeFileSync(join(cwd, path), text);
    emit("file_change", { changes: [{ path, kind: "update" }] });
  };
  const command = (cwd, executable, argv, expected = 0, bun = false) => {
    const worker = ctx.env.THERMITE_CONTRIBUTOR_BUN;
    assert(!bun || worker, "Missing contributor command observer");
    // POSIX references also exercise discovery through the recorded PATH.
    // Windows references run the same observer without invoking cmd.exe.
    const result =
      bun && process.platform === "win32"
        ? run(ctx, cwd, process.execPath, [worker, ...argv])
        : run(ctx, cwd, executable, argv);
    emit("command_execution", {
      command: shellCommand([executable, ...argv]),
      exit_code: result.exit,
      aggregated_output: (result.stdout + result.stderr).slice(-4000),
    });
    assert.equal(result.exit, expected, result.stdout + result.stderr);
    return result;
  };
  const observedBun = (args, expected) =>
    command(repository, "bun", args, expected, true);
  if (seeded) {
    const red = observedBun(["scripts/test.mjs", focus], 1);
    assert.match(red.stdout + red.stderr, /to be less than 0/);
    edit(repository, ordering, repairedComparator(repository, emit));
  } else {
    command(join(ctx.project, "engine"), "git", [
      "worktree",
      "add",
      "--detach",
      "../worktree",
    ]);
    observedBun(["install", "--frozen-lockfile"]);
  }
  observedBun(["scripts/test.mjs", focus]);
  observedBun(["run", "build"]);
  if (seeded) {
    const result = inspectOrder(observedBun(inspectK1));
    assert.equal(result.terminals[0], "1/L1");
    assert.equal(result.terminals.at(-1), "A2");
  }
  const message = frictionReport(seeded);
  edit(ctx.project, "contributor-friction.md", message);
  return message;
}
