// Engine cases the guide's sentences claim, run by this suite.
//
// Each engine matrix a sentence relies on is a table in a case module next to
// its engine test. The engine test iterates the table; this suite imports the
// same table and, for each claim:
// - requires every row the sentence claims, by the name the engine test uses;
// - requires the engine test to register the table exactly once, with no
//   modifier other than its declared platform skip, and that skip constant to
//   equal its platform condition;
// - runs every claimed row itself and compares the outcome, named in words,
//   with the outcome the sentence states.
// So a removed row, a forced skip and a case that no longer fails as claimed
// each fail here, whatever the engine test asserts. The guarantee is that
// last step: this suite runs every claimed row itself. The registration check
// is a lint against accidental edits (modifiers, table changes); it reads the
// call text and does not follow hooks or control flow, so skips added through
// hooks or dead code are left to review and the repository skip ratchet.
// Rows run in this worker,
// spawning only the engine's own writer fixtures, and agent applies go
// through the CLI's own `runAgentCommand`.
import { hostname } from "node:os";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createAgentTools } from "@thermite/agent-tools";
import {
  compileProject,
  PROJECT_WRITE_LOCK_FILE_NAME,
} from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { runAgentCommand } from "../../dist/agent-command.js";
import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
  type ApplySourcePatchDependencies,
} from "../../../agent-tools/src/apply-source-patch.js";
import {
  mutateBeforePrecommit,
  PRECOMMIT_MUTATIONS,
} from "../../../agent-tools/test/patch-filesystem.cases.js";
import {
  createPatchProjectFixture,
  type PatchProjectFixture,
} from "../../../agent-tools/test/patch-project-fixture.js";
import {
  HOST_HANDLER_MODES,
  runEmbeddedWriter,
} from "../../../agent-tools/test/patch-write-chain-changes.cases.js";
import {
  POSIX_SIGNALS_UNAVAILABLE,
  requestFor,
  RESERVATION_SIGNALS,
  startPausedWriter,
  stopPausedWriter,
  withFailingRelease,
} from "../../../agent-tools/test/patch-write-recovery.cases.js";
import {
  arrangePartialRollback,
  ROLLBACK_CHANGES,
} from "../../../agent-tools/test/patch-write-serialization.cases.js";
import {
  OUTPUT_REJECTIONS,
  removeFixtures as removeOutputFixtures,
  renderOutputRejection,
} from "../analog-output.cases.js";
import {
  compileCableLength,
  compileConnectionRejection,
  CONNECTION_REJECTIONS,
  INVALID_CABLE_LENGTHS,
  removeFixtures as removeCommunicationFixtures,
} from "../communication.cases.js";
import {
  compileMetadataRejection,
  METADATA_REJECTIONS,
  removeFixtures as removeCompletenessFixtures,
} from "../completeness.cases.js";
import {
  LOOP_REJECTIONS,
  removeFixtures as removeLoopFixtures,
  renderLoopRejection,
} from "../signal-loop.cases.js";
import {
  noteOutput,
  once,
  repositoryRoot,
  withProcessSlot,
} from "./harness.js";

// ---------------------------------------------------------------------------
// Shared case tables

export interface CaseTable<Row> {
  /** The engine test that iterates the table, from the repository root. */
  readonly test: string;
  /** The case module, as the engine test imports it. */
  readonly module: string;
  /** The table's exported name, and its rows. */
  readonly name: string;
  readonly rows: readonly Row[];
  /** A row's name, as the engine test's title prints it. */
  readonly id: (row: Row) => string;
  /** The one condition under which the engine test may skip the table. */
  readonly skip?: {
    /** The constant the case module exports and the registration skips on. */
    readonly name: string;
    readonly value: boolean;
    /** The platform condition that constant must equal, and declare. */
    readonly when: boolean;
    readonly condition: string;
    /** The case module that declares the constant. */
    readonly declaredIn: string;
  };
  /** Runs one row in this suite and names its outcome. */
  readonly run: (row: Row) => Promise<string>;
}

/**
 * `source` without comments, and with string and template contents blanked
 * unless `strings` keeps them: titles and messages never read as code.
 */
export function codeOf(source: string, strings = false): string {
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c)
        j += source[j] === "\\" ? 2 : 1;
      const body = source.slice(i + 1, j);
      out += c + (strings ? body : body.replace(/[^\n]/g, " ")) + c;
      i = j;
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      out += " ";
    } else out += c;
  }
  return out;
}

/** Test API names that skip, select or invert tests. */
const SELECTING = /\b(?:only|skip|skipIf|runIf|todo|fails)\b/g;
/** Every `describe`/`it`/`test` member chain, its modifiers and its end. */
function chainsOf(code: string) {
  return [
    ...code.matchAll(
      /\b(describe|suite|it|test)\b((?:\s*\.\s*[A-Za-z_]\w*(?:\s*\([^()]*\))?)+)/g,
    ),
  ].map((m) => ({
    root: m[1]!,
    parts: [...m[2]!.matchAll(/\.\s*([A-Za-z_]\w*)(?:\s*\(([^()]*)\))?/g)].map(
      (p) => ({ name: p[1]!, args: p[2]?.trim() }),
    ),
    end: m.index! + m[0].length,
  }));
}
const written = (parts: readonly { name: string; args?: string }[]) =>
  parts
    .map((p) => `.${p.name}${p.args === undefined ? "" : `(${p.args})`}`)
    .join("");
/** The parenthesized call that opens at or after `start`, or "". */
function callAt(code: string, start: number): string {
  const open = code.slice(start).search(/\S/) + start;
  if (code[open] !== "(") return "";
  let depth = 0;
  for (let i = open; i < code.length; i += 1)
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")" && (depth -= 1) === 0)
      return code.slice(open, i + 1);
  return "";
}

/**
 * How `source`, the engine test, fails to iterate `table` exactly as declared:
 * the table and any skip constant are imported from the case module and used
 * only by one `it.each(<table>)` registration; its only modifier is the
 * declared `.skipIf(<constant>)`; no describe or suite in the file carries a
 * skip, only, todo, fails or runIf modifier, nothing else carries `only`, and
 * the registered cases call none at runtime; and the skip constant equals its
 * platform condition. Another test's own skip cannot skip these cases: a test
 * neither deselects nor encloses them, so it may skip on its own condition.
 */
export function registrationProblems(
  table: CaseTable<unknown>,
  source: string,
): string[] {
  const code = codeOf(source);
  const problems: string[] = [];
  const module = table.module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imported = new Set(
    [
      ...codeOf(source, true).matchAll(
        new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${module}"`, "g"),
      ),
    ].flatMap((m) => m[1]!.split(",").map((n) => n.trim())),
  );
  for (const name of [table.name, ...(table.skip ? [table.skip.name] : [])]) {
    if (!imported.has(name))
      problems.push(
        `${table.test} does not import ${name} from ${table.module}`,
      );
    const uses = code.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
    if (uses !== 2)
      problems.push(
        `${table.test} uses ${name} ${uses - 1} times besides its import; only its registration may`,
      );
  }
  const declared = table.skip ? `.skipIf(${table.skip.name})` : "";
  const registrations: { modifiers: string; call: string }[] = [];
  for (const { root, parts, end } of chainsOf(code)) {
    const last = parts.at(-1)!;
    const registers =
      (root === "it" || root === "test") &&
      last.name === "each" &&
      last.args === table.name;
    const modifiers = written(registers ? parts.slice(0, -1) : parts);
    if (registers) registrations.push({ modifiers, call: callAt(code, end) });
    else if (
      /\.only\b/.test(modifiers) ||
      ((root === "describe" || root === "suite") && modifiers.match(SELECTING))
    )
      problems.push(`${table.test} applies ${root}${modifiers}`);
  }
  if (registrations.length !== 1)
    problems.push(
      `${table.test} registers ${table.name} ${registrations.length} times, not once`,
    );
  for (const { modifiers, call } of registrations) {
    if (modifiers !== declared)
      problems.push(
        `${table.test} registers ${table.name} as it${modifiers}.each; the declared registration is it${declared}.each`,
      );
    if (call === "")
      problems.push(`${table.test} has no call after it${modifiers}.each`);
    for (const [token] of call.matchAll(SELECTING))
      problems.push(
        `${table.test} calls ${token} inside its ${table.name} cases`,
      );
  }
  if (table.skip && table.skip.value !== table.skip.when)
    problems.push(
      `${table.skip.name} is ${table.skip.value}, but its declared platform condition is ${table.skip.when}`,
    );
  return problems;
}

/**
 * How `source`, the case module that declares a skip constant, fails to
 * declare it exactly once as its platform condition.
 */
export function declarationProblems(
  skip: NonNullable<CaseTable<unknown>["skip"]>,
  source: string,
): string[] {
  const code = codeOf(source, true);
  const declared = `export const ${skip.name} = ${skip.condition};`;
  const declarations = code.match(
    new RegExp(`\\b(?:const|let|var)\\s+${skip.name}\\b`, "g"),
  );
  return code.includes(declared) && declarations?.length === 1
    ? []
    : [`${skip.declaredIn} does not declare exactly ${declared}`];
}

/**
 * Everything wrong with a sentence's claim on `table`: `outcomes` maps each
 * claimed row to the outcome the sentence states. Rows run here unless the
 * declared platform skip applies; `source` replaces the engine test's text.
 */
export async function claimProblems<Row>(
  table: CaseTable<Row>,
  outcomes: Readonly<Record<string, string>>,
  source?: string,
): Promise<string[]> {
  source ??= await readFile(join(repositoryRoot, table.test), "utf8");
  const problems = registrationProblems(table as CaseTable<unknown>, source);
  if (table.skip)
    problems.push(
      ...declarationProblems(
        table.skip,
        await readFile(join(repositoryRoot, table.skip.declaredIn), "utf8"),
      ),
    );
  const runs = Object.entries(outcomes).map(async ([id, stated]) => {
    const rows = table.rows.filter((row) => table.id(row) === id);
    if (rows.length !== 1)
      return `${table.name} has ${rows.length} "${id}" rows; the guide claims one`;
    if (table.skip?.value) return undefined;
    let outcome: string;
    try {
      outcome = await table.run(rows[0]!);
    } catch (error) {
      return `${table.name} "${id}" threw ${String(error)}`;
    }
    return outcome === stated
      ? undefined
      : `${table.name} "${id}" gave ${JSON.stringify(outcome)}; the guide states ${JSON.stringify(stated)}`;
  });
  for (const problem of await Promise.all(runs))
    if (problem !== undefined) problems.push(problem);
  return problems;
}
/** Requires `table` to hold, register and produce what the sentence claims. */
export async function claimed<Row>(
  table: CaseTable<Row>,
  outcomes: Readonly<Record<string, string>>,
) {
  expect(await claimProblems(table, outcomes)).toEqual([]);
}

/** An engine compile's outcome: "compiled", or its error codes. */
function compiled(result: {
  ok: boolean;
  diagnostics: readonly { code: string; severity: string }[];
}) {
  if (result.ok) return "compiled";
  const codes = result.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.code);
  return [...new Set(codes)].sort().join(", ");
}
/** A packet render's outcome: "rendered", or its error code. */
const rendered = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? "rendered" : result.error!.code;

const CLI = "packages/cli/test";
const TOOLS = "packages/agent-tools/test";
/** Windows cannot run JS signal handlers on terminate-process delivery. */
const POSIX_SKIP = {
  name: "POSIX_SIGNALS_UNAVAILABLE",
  value: POSIX_SIGNALS_UNAVAILABLE,
  when: process.platform === "win32",
  condition: 'process.platform === "win32"',
  declaredIn: `${TOOLS}/patch-write-recovery.cases.ts`,
} as const;

/** Signal-loop source faults, each rendered plain and grouped. */
export const LOOP_FAULTS: CaseTable<(typeof LOOP_REJECTIONS)[number]> = {
  test: `${CLI}/signal-loop.test.ts`,
  module: "./signal-loop.cases.js",
  name: "LOOP_REJECTIONS",
  rows: LOOP_REJECTIONS,
  id: (row) => row,
  run: async (row) => (await renderLoopRejection(row)).map(rendered).join(", "),
};
/** Analog-output request and source faults. */
export const OUTPUT_FAULTS: CaseTable<(typeof OUTPUT_REJECTIONS)[number]> = {
  test: `${CLI}/analog-output.test.ts`,
  module: "./analog-output.cases.js",
  name: "OUTPUT_REJECTIONS",
  rows: OUTPUT_REJECTIONS,
  id: (row) => row,
  run: async (row) => rendered(await renderOutputRejection(row)),
};
/** Communication relation faults. */
export const CONNECTION_FAULTS: CaseTable<
  (typeof CONNECTION_REJECTIONS)[number]
> = {
  test: `${CLI}/communication.test.ts`,
  module: "./communication.cases.js",
  name: "CONNECTION_REJECTIONS",
  rows: CONNECTION_REJECTIONS,
  id: (row) => row,
  run: async (row) => compiled(await compileConnectionRejection(row)),
};
/** Communication cable lengths, named as JSON. */
export const CABLE_LENGTHS: CaseTable<(typeof INVALID_CABLE_LENGTHS)[number]> =
  {
    test: `${CLI}/communication.test.ts`,
    module: "./communication.cases.js",
    name: "INVALID_CABLE_LENGTHS",
    rows: INVALID_CABLE_LENGTHS,
    id: (row) => JSON.stringify(row),
    run: async (row) => compiled(await compileCableLength(row)),
  };
/** Completeness metadata faults. */
export const METADATA_FAULTS: CaseTable<(typeof METADATA_REJECTIONS)[number]> =
  {
    test: `${CLI}/completeness.test.ts`,
    module: "./completeness.cases.js",
    name: "METADATA_REJECTIONS",
    rows: METADATA_REJECTIONS,
    id: (row) => row,
    run: async (row) => compiled(await compileMetadataRejection(row)),
  };

/**
 * A held reservation interrupted by `signal`: what the writer printed and
 * recorded, how it exited, and whether a retry can apply.
 */
export const HELD_SIGNALS: CaseTable<(typeof RESERVATION_SIGNALS)[number]> = {
  test: `${TOOLS}/patch-write-recovery.test.ts`,
  module: "./patch-write-recovery.cases.js",
  name: "RESERVATION_SIGNALS",
  rows: RESERVATION_SIGNALS,
  id: (row) => row,
  skip: POSIX_SKIP,
  run: (signal) =>
    withProcessSlot(async () => {
      const fixture = await createPatchProjectFixture("clean");
      const writer = await startPausedWriter(fixture);
      try {
        const ready = (await writer.lines.next()).value;
        const lockPath = join(
          fixture.projectRoot,
          PROJECT_WRITE_LOCK_FILE_NAME,
        );
        const owner = JSON.parse(await readFile(lockPath, "utf8"));
        writer.child.kill(signal);
        const [, exited] = await writer.closed;
        const held = (await readdir(fixture.projectRoot)).includes(
          PROJECT_WRITE_LOCK_FILE_NAME,
        );
        const retry = await agentApply(
          fixture,
          await requestFor(fixture.projectRoot),
        );
        return [
          ready,
          owner.pid === writer.child.pid ? "owner recorded" : "owner missing",
          `exited on ${exited}`,
          held ? "reservation kept" : "reservation released",
          `retry exit ${retry.code}`,
        ].join("; ");
      } finally {
        await stopPausedWriter(writer);
        await fixture.cleanup();
      }
    }),
};
/** An embedded host's own SIGINT handler, registered at each point. */
export const HOST_HANDLERS: CaseTable<(typeof HOST_HANDLER_MODES)[number]> = {
  test: `${TOOLS}/patch-write-chain-changes.test.ts`,
  module: "./patch-write-chain-changes.cases.js",
  name: "HOST_HANDLER_MODES",
  rows: HOST_HANDLER_MODES,
  id: (row) => row,
  skip: POSIX_SKIP,
  run: (mode) =>
    withProcessSlot(async () => {
      const fixture = await createPatchProjectFixture("clean");
      try {
        const path = join(fixture.projectRoot, "sources/a.json");
        const original = await readFile(path);
        const { hostCalls, outcome } = await runEmbeddedWriter(fixture, mode);
        const after = await readFile(path);
        const report = JSON.stringify(outcome);
        return [
          `host handler ran ${hostCalls}x`,
          outcome.ok
            ? "applied"
            : `failed ${outcome.failureClass}${report.includes("PATCH_LOCK_REVOKED") ? " (PATCH_LOCK_REVOKED)" : ""}`,
          after.equals(original)
            ? "source unchanged"
            : `source patched${report.includes("not restored") ? ", not restored" : ""}`,
          (await readdir(fixture.projectRoot)).includes(
            PROJECT_WRITE_LOCK_FILE_NAME,
          )
            ? "reservation kept"
            : "reservation released",
        ].join("; ");
      } finally {
        await fixture.cleanup();
      }
    }),
};
/** A rollback that one changed file interrupts, through the agent CLI path. */
export const PARTIAL_ROLLBACKS: CaseTable<(typeof ROLLBACK_CHANGES)[number]> = {
  test: `${TOOLS}/patch-write-serialization.test.ts`,
  module: "./patch-write-serialization.cases.js",
  name: "ROLLBACK_CHANGES",
  rows: ROLLBACK_CHANGES,
  id: (row) => row,
  run: async (change) => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const { request, dependencies } = await arrangePartialRollback(
        fixture,
        change,
      );
      const run = await agentApply(fixture, request, dependencies);
      const rollback = run.report.diagnostics
        .map((d: { message: string }) => d.message)
        .find((m: string) => m.startsWith("Source patch rollback"));
      return `exit ${run.code}: ${rollback}`;
    } finally {
      await fixture.cleanup();
    }
  },
};
/** A guarded file changed between staging and the precommit snapshot. */
export const PRECOMMIT_CHANGES: CaseTable<
  (typeof PRECOMMIT_MUTATIONS)[number]
> = {
  test: `${TOOLS}/patch-filesystem.test.ts`,
  module: "./patch-filesystem.cases.js",
  name: "PRECOMMIT_MUTATIONS",
  rows: PRECOMMIT_MUTATIONS,
  id: (row) => row.name,
  run: async (row) => {
    const { outcome, captureCalls } = await mutateBeforePrecommit(row);
    return outcome.ok
      ? "applied"
      : `${outcome.error?.code} ${outcome.error?.file}, ${captureCalls === 2 ? "at the precommit snapshot" : `at snapshot ${captureCalls}`}`;
  },
};

/** Removes the fixtures the case modules made for this suite. */
export async function removeCaseFixtures() {
  await Promise.all([
    removeLoopFixtures(),
    removeOutputFixtures(),
    removeCommunicationFixtures(),
    removeCompletenessFixtures(),
  ]);
}

// ---------------------------------------------------------------------------
// The agent CLI path in-process

let requests = 0;
export interface AgentRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: any;
}
/**
 * `thermite agent apply-source-patch --input <file>` in the fixture's project,
 * through the CLI's own command with the engine's `dependencies` injected into
 * the tool; records the codes it prints like any run.
 */
export async function agentApply(
  fixture: PatchProjectFixture,
  request: unknown,
  dependencies: ApplySourcePatchDependencies = defaultApplySourcePatchDependencies,
): Promise<AgentRun> {
  const input = join(fixture.root, `guide-request-${(requests += 1)}.json`);
  await writeFile(input, JSON.stringify(request));
  const run = await runAgentCommand("apply-source-patch", input, {
    cwd: fixture.projectRoot,
    createTools: (options) => ({
      ...createAgentTools(options),
      applySourcePatch: createInternalApplySourcePatchTool(
        { cwd: options?.cwd },
        dependencies,
      ).applySourcePatch,
    }),
  });
  noteOutput(run.stdout);
  noteOutput(run.stderr);
  return {
    code: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    report: JSON.parse(run.stderr),
  };
}

/** A commit whose reservation release fails. */
export const releaseFailure = () =>
  once("engine:release failure", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const lockPath = join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME);
      const run = await agentApply(
        fixture,
        await requestFor(fixture.projectRoot),
        withFailingRelease(defaultApplySourcePatchDependencies),
      );
      const source = JSON.parse(
        await readFile(join(fixture.projectRoot, "sources/a.json"), "utf8"),
      );
      return { run, lockPath, committed: source.$schema === "review" };
    } finally {
      await fixture.cleanup();
    }
  });
/** An apply whose write and then reservation release both fail. */
export const leftoverReservation = () =>
  once("engine:leftover reservation", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const lockPath = join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME);
      const run = await agentApply(
        fixture,
        await requestFor(fixture.projectRoot),
        {
          ...withFailingRelease(defaultApplySourcePatchDependencies),
          async writeFileAtomically() {
            throw Object.assign(new Error("injected"), { code: "EIO" });
          },
        },
      );
      return { run, lockPath };
    } finally {
      await fixture.cleanup();
    }
  });
/**
 * An apply that finds a reservation it cannot judge: one recorded on another
 * host, or one without owner metadata. Returns the reservation's bytes after.
 */
export const foreignReservation = (state: "other-host" | "unknown") =>
  once(`engine:${state} reservation`, async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const lockPath = join(fixture.projectRoot, PROJECT_WRITE_LOCK_FILE_NAME);
      const contents =
        state === "unknown"
          ? "not metadata"
          : JSON.stringify({
              pid: process.pid,
              hostname: `${hostname()}-other`,
              createdAt: new Date(Date.now() - 60_000).toISOString(),
              thermiteVersion: "9.9.9",
            });
      await writeFile(lockPath, contents);
      const run = await agentApply(
        fixture,
        await requestFor(fixture.projectRoot),
      );
      return {
        lockPath,
        contents,
        run,
        kept: await readFile(lockPath, "utf8"),
      };
    } finally {
      await fixture.cleanup();
    }
  });
/**
 * A writer SIGKILLed while it holds the reservation, the apply that finds the
 * reservation, and the apply after removing exactly that path.
 */
export const abandonedReservation = () =>
  once("engine:abandoned reservation", () =>
    withProcessSlot(async () => {
      const fixture = await createPatchProjectFixture("clean");
      const writer = await startPausedWriter(fixture);
      try {
        expect((await writer.lines.next()).value).toBe("ready");
        writer.child.kill("SIGKILL");
        await writer.closed;
        const lockPath = join(
          fixture.projectRoot,
          PROJECT_WRITE_LOCK_FILE_NAME,
        );
        const request = await requestFor(fixture.projectRoot);
        const found = await agentApply(fixture, request);
        await unlink(lockPath);
        const recovered = await agentApply(
          fixture,
          await requestFor(fixture.projectRoot),
        );
        return {
          lockPath,
          pid: writer.child.pid,
          found,
          recovered,
        };
      } finally {
        await stopPausedWriter(writer);
        await fixture.cleanup();
      }
    }),
  );

// ---------------------------------------------------------------------------
// Packets in-process

const builds = new Map<string, ReturnType<typeof compileProject>>();
/**
 * Renders `request` against `project` through the compiler and renderer the
 * `packet` command calls; each project compiles once.
 */
export async function renderHere(project: string, request: unknown) {
  if (!builds.has(project)) builds.set(project, compileProject(project));
  const build = await builds.get(project)!;
  if (!build.ok) throw new Error(JSON.stringify(build.diagnostics));
  return renderSchematicPacket(build.ir, request as never);
}
/** The R006 message `request` fails with in-process; any other outcome fails. */
export async function refusedHere(project: string, request: unknown) {
  const result = await renderHere(project, request);
  expect(result.ok, JSON.stringify(request).slice(0, 300)).toBe(false);
  if (result.ok) return "";
  expect(result.error.code).toBe("R006");
  return result.error.message;
}
