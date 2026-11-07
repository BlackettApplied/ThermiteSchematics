import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const DEFAULT_THRESHOLDS = Object.freeze({
  duplicateTokens: 50,
  fileLines: 850,
  functionLines: 70,
});
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const testFile = (path) =>
  /(?:^|\/)(?:test|tests|__tests__)\//.test(path) ||
  /\.(?:test|spec|check)\.[cm]?[jt]sx?$/.test(path);
// Generator inventory: packages/schema/scripts/generate-types.mjs owns src/generated;
// scripts/update-text-metrics.mjs owns the standalone render metrics data file.
function generated(path) {
  return (
    /^packages\/schema\/src\/generated\//.test(path) ||
    path === "packages/render/src/text-metrics-data.ts"
  );
}
function inScope(path) {
  return (
    !generated(path) &&
    !/(?:^|\/)(?:node_modules|dist|out|fixtures|goldens|snapshots)\//.test(
      path,
    ) &&
    /\.(?:[cm]?[jt]sx?|py|sh|ps1)$/.test(path) &&
    (/^packages\/[^/]+\/src\//.test(path) ||
      path.startsWith("scripts/") ||
      testFile(path))
  );
}
function trackedPaths(root) {
  const prefix = spawnSync("git", ["-C", root, "rev-parse", "--show-prefix"], {
    encoding: "utf8",
  });
  if (prefix.error || prefix.status !== 0)
    throw new Error(
      "Health ratchet requires a git checkout; run it from the checkout root.",
    );
  if (prefix.stdout.trim() !== "")
    throw new Error("Health ratchet must run from the git checkout root.");
  const untracked = spawnSync(
    "git",
    ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  if (untracked.error || untracked.status !== 0)
    throw new Error("Cannot list untracked files for the health ratchet.");
  const omitted = untracked.stdout.split("\0").filter(inScope).sort(compare);
  if (omitted.length)
    console.warn(
      `Health ratchet warning: ${omitted.length} untracked in-scope files were not scanned:\n${omitted.map((path) => `  ${path}`).join("\n")}\nUse git add -N <file> to include them.`,
    );
  const result = spawnSync("git", ["-C", root, "ls-files", "--cached", "-z"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot list git-tracked files for the health ratchet.");
  return [...new Set(result.stdout.split("\0").filter(Boolean))]
    .filter((path) => inScope(path) && existsSync(join(root, path)))
    .sort(compare);
}
function lineCount(text) {
  // CRLF and LF checkouts have the same budget; a final newline adds no line.
  return text === "" ? 0 : text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}
function functionName(node, source) {
  if (node.name) return node.name.getText(source);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent))
    return parent.name.getText(source);
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    const name = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isIdentifier(callee)
        ? callee.text
        : "call";
    return `${name} callback`;
  }
  return "anonymous";
}
function normalizedBody(body, source) {
  const tokens = [];
  function visit(node) {
    // AST leaves preserve regex/template/string contents while removing trivia.
    // A plain scanner cannot rescan template tails or regular expressions.
    if (ts.isJSDoc(node)) return;
    const children = node.getChildren(source);
    if (!children.length) {
      if (node.kind !== ts.SyntaxKind.JSDocComment)
        tokens.push(node.getText(source));
    } else for (const child of children) visit(child);
  }
  visit(body);
  return {
    hash: createHash("sha256").update(JSON.stringify(tokens)).digest("hex"),
    tokens: tokens.filter(Boolean).length,
  };
}
function propertyName(node) {
  return ts.isPropertyAccessExpression(node)
    ? node.name.text
    : node.argumentExpression?.text;
}
function testRoot(node) {
  while (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)
  )
    node = node.expression;
  return (
    ts.isIdentifier(node) &&
    ["it", "test", "describe", "suite"].includes(node.text)
  );
}
function suppressionOption(node) {
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (property) =>
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        ["skip", "todo", "only"].includes(
          property.name.getText().replace(/["']/g, ""),
        ) &&
        (ts.isShorthandPropertyAssignment(property) ||
          property.initializer.kind !== ts.SyntaxKind.FalseKeyword),
    )
  );
}
function destructuredSkip(node) {
  if (!ts.isIdentifier(node.expression)) return false;
  const name = node.expression.text;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    if (
      parent.parameters.some(
        (parameter) =>
          ts.isObjectBindingPattern(parameter.name) &&
          parameter.name.elements.some(
            (binding) =>
              (binding.propertyName?.getText() ?? binding.name.getText()) ===
                "skip" && binding.name.getText() === name,
          ),
      )
    )
      return true;
    if (
      parent.parameters.some(
        (parameter) =>
          ts.isIdentifier(parameter.name) && parameter.name.text === name,
      )
    )
      return false;
  }
  return false;
}
function isSuppression(node, inTest) {
  if (ts.isCallExpression(node)) {
    if (
      ts.isIdentifier(node.expression) &&
      testRoot(node.expression) &&
      node.arguments.some(suppressionOption)
    )
      return true;
    const callee = node.expression;
    if (
      inTest &&
      (ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)) &&
      propertyName(callee) === "skip" &&
      !testRoot(callee)
    )
      return true;
    if (inTest && destructuredSkip(node)) return true;
  }
  return (
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    ["skip", "todo", "only", "skipIf", "runIf"].includes(propertyName(node)) &&
    testRoot(node)
  );
}

/** AST metrics, with stable lexical function names rather than source-line IDs. */
export function measure(root = resolve(".")) {
  const paths = trackedPaths(root);
  const files = {},
    functions = {},
    bodies = new Map(),
    bodyTokens = {};
  for (const path of paths) {
    const text = readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
    const source = /\.[cm]?[jt]sx?$/.test(path)
      ? ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
      : undefined;
    const onlySkips = testFile(path);
    const metrics = onlySkips
      ? { skippedTests: 0 }
      : { lines: lineCount(text), nonNullAssertions: 0, skippedTests: 0 };
    const occurrences = new Map();
    function visit(node, scope = "") {
      if (isSuppression(node, onlySkips)) metrics.skippedTests++;
      if (!onlySkips && ts.isNonNullExpression(node))
        metrics.nonNullAssertions++;
      let nestedScope = scope;
      if (!onlySkips && ts.isFunctionLike(node) && node.body) {
        const name = `${scope}${functionName(node, source)}`;
        const count = (occurrences.get(name) ?? 0) + 1;
        occurrences.set(name, count);
        const identity = `${path}#${name}${count === 1 ? "" : `~${count}`}`;
        const start = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        ).line;
        const end = source.getLineAndCharacterOfPosition(node.end).line;
        functions[identity] = end - start + 1;
        nestedScope = `${name}/`;
        const { hash, tokens } = normalizedBody(node.body, source);
        bodyTokens[identity] = tokens;
        const group = bodies.get(hash) ?? { tokens, members: [] };
        group.members.push(identity);
        bodies.set(hash, group);
      }
      ts.forEachChild(node, (child) => visit(child, nestedScope));
    }
    if (source) visit(source);
    files[path] = metrics;
  }
  const duplicates = Object.fromEntries(
    [...bodies]
      .filter(([, group]) => group.members.length > 1)
      .sort(([a], [b]) => compare(a, b))
      .map(([hash, group]) => [
        hash,
        { ...group, members: group.members.sort(compare) },
      ]),
  );
  return { version: 2, files, functions, duplicates, bodyTokens };
}

function sorted(entries) {
  return Object.fromEntries(entries.sort(([a], [b]) => compare(a, b)));
}
function thresholdsOf(budget) {
  if (budget.version !== 2)
    throw new Error("Unsupported health budget version; expected 2");
  for (const key of Object.keys(DEFAULT_THRESHOLDS))
    if (
      !Number.isSafeInteger(budget.thresholds?.[key]) ||
      budget.thresholds[key] < 1
    )
      throw new Error(`Invalid health threshold: ${key}`);
  for (const map of [
    "files",
    "functions",
    "nonNullAssertions",
    "skippedTests",
    "duplicates",
  ]) {
    const values = budget[map];
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error(`Invalid health budget map: ${map} (expected an object)`);
    for (const [key, value] of Object.entries(values))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(`Invalid health budget value: ${map}.${key}`);
  }
  return budget.thresholds;
}

/** Store only size outliers, nonzero counters and meaningful duplicate groups. */
export function createBudget(current, thresholds = DEFAULT_THRESHOLDS) {
  const files = Object.entries(current.files);
  return sorted(
    Object.entries({
      version: 2,
      thresholds: sorted(Object.entries(thresholds)),
      files: sorted(
        files
          .filter(([, metrics]) => metrics.lines > thresholds.fileLines)
          .map(([path, metrics]) => [path, metrics.lines]),
      ),
      functions: sorted(
        Object.entries(current.functions).filter(
          ([, lines]) => lines > thresholds.functionLines,
        ),
      ),
      nonNullAssertions: sorted(
        files
          .filter(([, metrics]) => metrics.nonNullAssertions > 0)
          .map(([path, metrics]) => [path, metrics.nonNullAssertions]),
      ),
      skippedTests: sorted(
        files
          .filter(([, metrics]) => metrics.skippedTests > 0)
          .map(([path, metrics]) => [path, metrics.skippedTests]),
      ),
      duplicates: sorted(
        Object.entries(current.duplicates)
          .filter(([, group]) => group.tokens >= thresholds.duplicateTokens)
          .map(([hash, group]) => [hash, group.members.length]),
      ),
    }),
  );
}

function increases(current, budget) {
  const thresholds = thresholdsOf(budget),
    changes = [];
  const check = (
    section,
    key,
    identity,
    metric,
    newValue,
    fallback = 0,
    size = false,
  ) => {
    const oldValue = budget[section][key] ?? fallback;
    if (newValue > oldValue)
      changes.push({
        section,
        key,
        oldValue,
        newValue,
        message: `${identity}: ${metric}${size && budget[section][key] === undefined ? " threshold" : ""} ${oldValue} -> ${newValue}`,
      });
  };
  for (const [path, metrics] of Object.entries(current.files)) {
    check(
      "files",
      path,
      path,
      "file lines",
      metrics.lines ?? 0,
      thresholds.fileLines,
      true,
    );
    check(
      "nonNullAssertions",
      path,
      path,
      "non-null assertions",
      metrics.nonNullAssertions ?? 0,
    );
    check("skippedTests", path, path, "skipped tests", metrics.skippedTests);
  }
  for (const [identity, lines] of Object.entries(current.functions))
    check(
      "functions",
      identity,
      identity,
      "function lines",
      lines,
      thresholds.functionLines,
      true,
    );
  for (const [hash, { tokens, members }] of Object.entries(current.duplicates))
    if (tokens >= thresholds.duplicateTokens)
      check(
        "duplicates",
        hash,
        `${members.join(", ")} [${hash}]`,
        "duplicate bodies",
        members.length,
        1,
      );
  return changes;
}
export function regressions(current, budget) {
  return increases(current, budget).map((change) => change.message);
}
export function acceptBudget(current, budget) {
  const changes = increases(current, budget),
    accepted = structuredClone(budget);
  for (const { section, key, newValue } of changes)
    accepted[section][key] = newValue;
  for (const section of new Set(changes.map((change) => change.section)))
    accepted[section] = sorted(Object.entries(accepted[section]));
  return accepted;
}
export function lowerBudget(current, budget) {
  const failures = regressions(current, budget);
  if (failures.length) throw new Error(regressionMessage(failures));
  return createBudget(current, budget.thresholds);
}
function regressionMessage(failures) {
  return `${failures.join("\n")}\nRaising a budget requires a manual edit or bun run health:accept; list every raise with a reason in PR.md. --lower only lowers budgets. For intentional renames/moves or positional callback shifts, re-key the entry, then run bun run health:lower.`;
}
function main() {
  const start = performance.now();
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && !["--lower", "--accept"].includes(args[0]))
  )
    throw new Error("Use bun scripts/health-ratchet.mjs [--lower|--accept]");
  const path = resolve("scripts/health-budget.json");
  const current = measure();
  const budget = JSON.parse(readFileSync(path, "utf8"));
  const failures = regressions(current, budget);
  if (args[0] === "--accept") {
    if (failures.length) {
      writeFileSync(
        path,
        JSON.stringify(acceptBudget(current, budget), null, 2) + "\n",
      );
      for (const failure of failures)
        process.stdout.write(`Accepted: ${failure}\n`);
    } else process.stdout.write("No budget raises needed.\n");
  } else if (failures.length) throw new Error(regressionMessage(failures));
  if (args[0] === "--lower")
    writeFileSync(
      path,
      JSON.stringify(lowerBudget(current, budget), null, 2) + "\n",
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
