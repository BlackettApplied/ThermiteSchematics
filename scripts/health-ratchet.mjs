import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measure } from "./health-measure.mjs";
import { readHistory, formatHistoryInformation } from "./health-history.mjs";
import { upgradeBudget } from "./health-budget.mjs";
import { textMetricRegressions } from "./health-text-metrics.mjs";
import {
  acceptBudget,
  lowerBudget,
  regressions,
  historyRegressions,
  regressionMessage,
} from "./health-policy.mjs";
export { measure } from "./health-measure.mjs";
export {
  DEFAULT_THRESHOLDS,
  SIZE_CEILINGS,
  createBudget,
  acceptBudget,
  lowerBudget,
  regressions,
  historyRegressions,
} from "./health-policy.mjs";
function argumentsOf(args) {
  const mode = args[0];
  if (!args.length) return {};
  if (mode === "--lower" && args.length === 1) return { mode };
  if (mode === "--accept" && args.length === 1) return { mode };
  if (
    mode === "--accept" &&
    args.length === 3 &&
    args[1] === "--reason" &&
    args[2].trim()
  )
    return { mode, reason: args[2] };
  throw Error(
    "Use bun scripts/health-ratchet.mjs [--lower|--accept [--reason <text>]]",
  );
}
function readBudget(path, current, history) {
  return upgradeBudget(
    JSON.parse(readFileSync(path, "utf8")),
    current,
    history?.metrics ?? current,
  );
}
function main() {
  const start = performance.now(),
    { mode, reason } = argumentsOf(process.argv.slice(2));
  const root = resolve("."),
    path = resolve("scripts/health-budget.json");
  const current = measure(root),
    history = readHistory(root);
  process.stdout.write(formatHistoryInformation(history));
  const budget = readBudget(path, current, history);
  const next =
    mode === "--accept"
      ? acceptBudget(current, budget, reason, history)
      : mode === "--lower"
        ? lowerBudget(current, budget, history)
        : budget;
  const failures = [
    ...textMetricRegressions(Object.keys(current.files), (file) =>
      readFileSync(join(root, file), "utf8"),
    ),
    ...regressions(current, next, history),
    ...(history
      ? historyRegressions(
          current,
          next,
          history.budget,
          history.metrics,
          history.target,
        )
      : []),
  ];
  if (failures.length) throw Error(regressionMessage(failures));
  if (mode === "--accept") {
    const raised = regressions(current, budget, history);
    for (const message of raised)
      process.stdout.write(`Accepted: ${message}; reason: ${reason}\n`);
    if (!raised.length) process.stdout.write("No budget raises needed.\n");
    if (
      JSON.stringify(next) !==
      JSON.stringify(JSON.parse(readFileSync(path, "utf8")))
    )
      writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  }
  if (mode === "--lower")
    writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  process.stdout.write(
    `Type assertion AST scan: ${(current.typeAssertionScanMs + (history?.metrics.typeAssertionScanMs ?? 0)).toFixed(1)} ms (current + baseline; no type program).\n`,
  );
  process.stdout.write(
    `Health ratchet passed (${Object.keys(current.files).length} files, ${Object.keys(current.functions).length} functions; ${(performance.now() - start).toFixed(0)} ms).\n`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
