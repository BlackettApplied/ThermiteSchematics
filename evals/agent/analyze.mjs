#!/usr/bin/env bun
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  selectAttempts,
  isComplete,
  runKey,
  configurationKey,
} from "./attempts.mjs";
import { readRun } from "./records.mjs";
import { canonical } from "./source-files.mjs";
const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2
    : null;
};
const taskGroup = (id) => (id === "T09a" || id === "T09b" ? "T09" : id);
export const fullTasks = [
  "T01",
  "T02",
  "T03",
  "T04",
  "T05",
  "T06",
  "T07",
  "T08",
  "T09a",
  "T09b",
  "T10",
  "T11",
  "T12",
];
const spotTasks = ["T02", "T05", "T06", "T07"];
function judged(run) {
  if (!run.outcome?.rubricPending) return true;
  return (
    run.judges?.length === 2 &&
    new Set(run.judges.map((j) => j.judge)).size === 2 &&
    run.judges.some((j) => j.judge === "claude") &&
    run.judges.some((j) => j.judge === "codex") &&
    run.judges.every((j) => j.pass === true)
  );
}
const success = (run) =>
  Number(isComplete(run) && run.outcome?.pass === true && judged(run));
const violations = (run) => [
  ...(run.metrics?.violations ?? []),
  ...(run.judges ?? []).flatMap((j) => j.violations ?? []),
];
export function bootstrapLower(
  deltas,
  { samples = 10000, seed = 460017 } = {},
) {
  if (!deltas.length) return null;
  let state = seed >>> 0;
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const draws = [];
  for (let b = 0; b < samples; b++) {
    let total = 0;
    for (let i = 0; i < deltas.length; i++)
      total += deltas[Math.floor(rng() * deltas.length)];
    draws.push(total / deltas.length);
  }
  draws.sort((a, b) => a - b);
  return draws[Math.floor(samples * 0.05)];
}
export function analyze(runs, { requireComplete = true } = {}) {
  const attemptSelection = selectAttempts(runs);
  runs = attemptSelection.selected;
  const errors = [...attemptSelection.errors],
    pairs = [],
    maps = { A: new Map(), B: new Map() };
  for (const field of [
    "harnessHash",
    "checkerHarnessHash",
    "checkerHash",
    "evalVersion",
  ]) {
    const values = new Set(
      runs.map(
        (r) =>
          r[field] ??
          (field === "checkerHarnessHash" || field === "checkerHash"
            ? (r.checkerHarnessHash ?? r.harnessHash)
            : null) ??
          null,
      ),
    );
    if (values.size > 1) errors.push(`Mixed ${field} across selected runs`);
  }
  for (const task of new Set(runs.map((r) => r.task))) {
    const hashes = new Set(
      runs
        .filter((r) => r.task === task)
        .map((r) => r.checkerTaskTreeHash ?? r.taskTreeHash ?? null),
    );
    if (hashes.size > 1) errors.push(`Mixed checker task tree for ${task}`);
  }
  const key = runKey;
  for (const agent of ["claude", "codex", "reference"]) {
    const configurations = new Set(
      runs
        .filter((r) => r.agent === agent)
        .map((r) => canonical(configurationKey(r))),
    );
    if (configurations.size > 1)
      errors.push(
        `Mixed model/effort configurations for ${agent}; analyze separately`,
      );
  }
  for (const run of runs)
    if (maps[run.arm]) {
      if (maps[run.arm].has(key(run)))
        errors.push(`Duplicate ${run.arm} ${key(run)}`);
      maps[run.arm].set(key(run), run);
    }
  for (const [k, a] of maps.A) {
    const b = maps.B.get(k);
    if (!b) {
      errors.push(`Missing B ${k}`);
      continue;
    }
    if (canonical(a.cliVersions) !== canonical(b.cliVersions))
      errors.push(`CLI version mismatch ${k}`);
    if (a.guideHash && a.guideHash === b.guideHash)
      errors.push(`Guide hashes identical ${k}`);
    if (a.commit !== b.commit) errors.push(`Engine mismatch ${k}`);
    if (a.model !== b.model || a.effort !== b.effort)
      errors.push(`Model/effort mismatch needs bridge evidence ${k}`);
    if (a.taskTreeHash !== b.taskTreeHash || a.harnessHash !== b.harnessHash)
      errors.push(`Checker/harness mismatch ${k}`);
    if (
      (a.checkerHarnessHash ?? a.harnessHash) !==
        (b.checkerHarnessHash ?? b.harnessHash) ||
      (a.checkerTaskTreeHash ?? a.taskTreeHash) !==
        (b.checkerTaskTreeHash ?? b.taskTreeHash)
    )
      errors.push(`Effective checker mismatch ${k}`);
    if (a.runtimeHash?.before !== b.runtimeHash?.before)
      errors.push(`Runtime payload mismatch ${k}`);
    if (a.taskHash !== b.taskHash || a.promptHash !== b.promptHash)
      errors.push(`Task/prompt mismatch ${k}`);
    pairs.push({ a, b });
  }
  for (const k of maps.B.keys())
    if (!maps.A.has(k)) errors.push(`Missing A ${k}`);
  if (!pairs.length) errors.push("No paired runs");
  if (requireComplete) {
    for (const context of ["runtime", "source"])
      for (const task of context === "runtime" ? fullTasks : spotTasks)
        for (const agent of ["claude", "codex"])
          for (const arm of ["A", "B"])
            if (
              ![...maps[arm].values()].some(
                (r) =>
                  r.context === context &&
                  r.task === task &&
                  r.agent === agent &&
                  r.seed === 1,
              )
            )
              errors.push(
                `Missing required ${arm} ${context}/${task}/${agent}/1`,
              );
    for (const { a, b } of pairs.filter(
      (p) => p.a.context === "runtime" && p.a.seed === 1,
    ))
      if (success(a) !== success(b))
        for (const arm of ["A", "B"])
          if (!maps[arm].has(key({ ...a, seed: 2 })))
            errors.push(
              `Differing outcome needs seed 2: ${arm} ${a.task}/${a.agent}`,
            );
  }
  for (const run of runs.filter((r) => ["A", "B"].includes(r.arm))) {
    if (run.outcome?.rubricPending && !judged(run))
      errors.push(`Unresolved rubric ${run.arm} ${key(run)}`);
    if (!isComplete(run))
      errors.push(`Infrastructure failure retained: ${run.arm} ${key(run)}`);
    for (const value of [
      run.metrics?.guideBytes,
      run.metrics?.usage?.inputTokens,
      run.metrics?.failedCalls,
    ])
      if (!Number.isFinite(value))
        errors.push(`Missing measured metric ${run.arm} ${key(run)}`);
  }
  const runtime = pairs.filter((p) => p.a.context === "runtime"),
    source = pairs.filter((p) => p.a.context === "source");
  const grouped = new Map();
  for (const p of runtime) {
    const task = taskGroup(p.a.task);
    if (!grouped.has(task)) grouped.set(task, []);
    grouped.get(task).push(success(p.b) - success(p.a));
  }
  const lower = bootstrapLower([...grouped.values()].map(mean));
  const A = runtime.map((p) => p.a),
    B = runtime.map((p) => p.b);
  const aClasses = new Set(
    runs
      .filter((r) => r.arm === "A")
      .flatMap(violations)
      .map((v) => v.rule),
  );
  const bViolations = runs.filter((r) => r.arm === "B").flatMap(violations),
    newClasses = [...new Set(bViolations.map((v) => v.rule))].filter(
      (v) => !aClasses.has(v),
    );
  const collapses = [];
  for (const task of new Set(
    pairs.map((p) => `${p.a.context}/${taskGroup(p.a.task)}/${p.a.seed}`),
  )) {
    const ps = pairs.filter(
      (p) => `${p.a.context}/${taskGroup(p.a.task)}/${p.a.seed}` === task,
    );
    if (
      ["claude", "codex"].every(
        (agent) =>
          ps.some((p) => p.a.agent === agent) &&
          ps
            .filter((p) => p.a.agent === agent)
            .every((p) => success(p.a) === 1),
      ) &&
      ["claude", "codex"].every((agent) =>
        ps.filter((p) => p.a.agent === agent).some((p) => success(p.b) === 0),
      )
    )
      collapses.push(task);
  }
  const topics = [...B, ...source.map((p) => p.b)].flatMap(
      (r) => r.metrics.retrieval ?? [],
    ),
    retrieval = topics.length
      ? topics.filter((t) => t.retrieved).length / topics.length
      : null;
  const costA = pairs.map((p) => p.a),
    costB = pairs.map((p) => p.b);
  const cost = {
    guideA: median(costA.map((r) => r.metrics.guideBytes)),
    guideB: median(costB.map((r) => r.metrics.guideBytes)),
    inputA: median(costA.map((r) => r.metrics.usage.inputTokens)),
    inputB: median(costB.map((r) => r.metrics.usage.inputTokens)),
    failedA: costA.reduce((n, r) => n + r.metrics.failedCalls, 0),
    failedB: costB.reduce((n, r) => n + r.metrics.failedCalls, 0),
  };
  const rules = [
    {
      id: 1,
      pass: bViolations.length === 0 && newClasses.length === 0,
      bViolations: bViolations.length,
      newClasses,
    },
    {
      id: 2,
      pass: lower !== null && lower >= -0.05,
      pairedDelta: mean([...grouped.values()].map(mean)),
      perRunDelta: mean(runtime.map((p) => success(p.b) - success(p.a))),
      lower95: lower,
      bootstrap: { unit: "task", oneSided: true, samples: 10000, seed: 460017 },
    },
    { id: 3, pass: collapses.length === 0, collapses },
    {
      id: 4,
      pass:
        A.length > 0 &&
        pairs.every(
          (p) =>
            p.a.metrics.usage.partial !== true &&
            p.b.metrics.usage.partial !== true,
        ) &&
        cost.guideB <= cost.guideA * 0.8 &&
        cost.inputB <= cost.inputA &&
        cost.failedB <= cost.failedA,
      ...cost,
    },
    { id: 5, pass: retrieval !== null && retrieval >= 0.9, retrieval },
    {
      id: 6,
      pass:
        source.length > 0 &&
        mean(source.map((p) => success(p.b))) >=
          mean(source.map((p) => success(p.a))),
      sourceA: mean(source.map((p) => success(p.a))),
      sourceB: mean(source.map((p) => success(p.b))),
    },
  ];
  const table = pairs
    .map(({ a, b }) => ({
      task: a.task,
      context: a.context,
      agent: a.agent,
      model: a.model ?? null,
      effort: a.effort ?? null,
      modelOverrides: a.modelOverrides ?? { model: null, effort: null },
      seed: a.seed,
      attemptA: a.attempt ?? 1,
      attemptB: b.attempt ?? 1,
      A: success(a),
      B: success(b),
      delta: success(b) - success(a),
      guideA: a.metrics.guideBytes,
      guideB: b.metrics.guideBytes,
      failedA: a.metrics.failedCalls,
      failedB: b.metrics.failedCalls,
      violationsB: violations(b)
        .map((v) => v.rule)
        .join(","),
    }))
    .sort((a, b) =>
      `${a.context}/${a.task}/${a.agent}/${a.seed}`.localeCompare(
        `${b.context}/${b.task}/${b.agent}/${b.seed}`,
      ),
    );
  return {
    format: "thermite-agent-ab/1.0",
    accepted: errors.length === 0 && rules.every((r) => r.pass),
    errors,
    attempts: attemptSelection.history,
    warnings: attemptSelection.history.flatMap((h) => [
      ...(h.multipleCompleteAttempts
        ? [
            `Multiple complete attempts (first counts): ${h.key}; forced: ${h.forcedReruns.join(",") || "unmarked"}`,
          ]
        : []),
      ...h.infraReopens.map(
        (r) =>
          `Infra counter reopened ${h.key} attempt ${r.attempt}: ${r.request}`,
      ),
      ...h.reopenedHalts.map(
        (a) => `Halted key reopened ${h.key} attempt ${a}`,
      ),
      ...h.adjudications.map(
        (r) =>
          `Infra adjudication ${h.key} attempt ${r.attempt}: ${r.resolution} by ${r.operator}: ${r.reason}`,
      ),
      ...h.pendingAdjudications.map(
        (a) => `Needs adjudication ${h.key} attempt ${a}; final scores blocked`,
      ),
      ...h.exitWarnings.map(
        (r) =>
          `Exit after completion ${h.key} attempt ${r.attempt}: exit=${r.exit ?? "unknown"} signal=${r.signal ?? "none"}`,
      ),
    ]),
    infraCounts: Object.fromEntries(
      ["A", "B"].map((arm) => {
        const attempts = attemptSelection.history
          .filter((h) => h.arm === arm)
          .flatMap((h) => h.attempts)
          .filter((a) => !isComplete(a));
        const byKind = {};
        for (const a of attempts)
          byKind[a.infrastructureKind] =
            (byKind[a.infrastructureKind] ?? 0) + 1;
        return [arm, { total: attempts.length, byKind }];
      }),
    ),
    attemptCounts: Object.fromEntries(
      ["A", "B"].map((arm) => {
        const histories = attemptSelection.history.filter((h) => h.arm === arm),
          attempts = histories.flatMap((h) => h.attempts);
        return [
          arm,
          {
            runs: histories.length,
            totalAttempts: attempts.length,
            completeAttempts: attempts.filter(isComplete).length,
            infrastructureAttempts: attempts.filter((a) => !isComplete(a))
              .length,
          },
        ];
      }),
    ),
    rules,
    table,
  };
}
function manifests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    ["manifest.json", "manifest.adjudicated.json"].includes(entry.name)
      ? [readRun(join(dir, entry.name))]
      : entry.isDirectory() &&
          ![
            "context",
            "project",
            "runtime",
            "node_modules",
            ".git",
            "checker-input",
          ].includes(entry.name)
        ? manifests(join(dir, entry.name))
        : [],
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      A: { type: "string" },
      B: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const result = analyze([...manifests(values.A), ...manifests(values.B)]);
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      "| Task | Context | Agent | Seed | Attempts A/B | A | B | Guide A/B | Failed A/B | B violations |\n|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const row of result.table)
      console.log(
        `| ${row.task} | ${row.context} | ${row.agent} | ${row.seed} | ${row.attemptA}/${row.attemptB} | ${row.A} | ${row.B} | ${row.guideA}/${row.guideB} | ${row.failedA}/${row.failedB} | ${row.violationsB} |`,
      );
    console.log(
      JSON.stringify(
        {
          accepted: result.accepted,
          rules: result.rules,
          errors: result.errors,
          attemptCounts: result.attemptCounts,
          warnings: result.warnings,
          infraCounts: result.infraCounts,
        },
        null,
        2,
      ),
    );
  }
  if (!result.accepted) process.exitCode = 1;
}
