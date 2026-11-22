import { auditDataFixture } from "./audit-scope.mjs";
import { countTypeAssertions, typeAssertionNode } from "./health-casts.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const testFile = (path) =>
  /(?:^|\/)(?:test|tests|__tests__)\//.test(path) ||
  /\.(?:test|spec|check)\.[cm]?[jt]sx?$/.test(path);
// These are generated artifacts, not directory-name conventions. A new code
// location is measured unless its owner is listed here (or it is pure fixture data).
export const EXCLUDED_CODE = [
  /^packages\/schema\/src\/generated\//,
  /^packages\/render\/src\/text-metrics-data\.ts$/,
];
export function inScope(path) {
  if (auditDataFixture(path)) return false;
  if (!/\.(?:[cm]?[jt]sx?|py|sh|ps1)$/.test(path)) return false;
  if (EXCLUDED_CODE.some((pattern) => pattern.test(path))) return false;
  // E2 owns a separately versioned harness; preserve its suppression-only scan.
  return !path.startsWith("evals/agent/") || testFile(path);
}
function sizeScope(path) {
  return !path.startsWith("evals/agent/");
}
function suiteCallee(node) {
  if (ts.isIdentifier(node)) return ["describe", "suite"].includes(node.text);
  if (
    ts.isPropertyAccessExpression(node) &&
    ["only", "skip", "todo", "concurrent", "sequential", "shuffle"].includes(
      node.name.text,
    )
  )
    return suiteCallee(node.expression);
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ["each", "skipIf", "runIf"].includes(node.expression.name.text)
  )
    return suiteCallee(node.expression.expression);
  if (
    ts.isTaggedTemplateExpression(node) &&
    ts.isPropertyAccessExpression(node.tag) &&
    node.tag.name.text === "each"
  )
    return suiteCallee(node.tag.expression);
  return false;
}
function suiteCallback(node, path) {
  return (
    testFile(path) &&
    ts.isCallExpression(node.parent) &&
    node.parent.arguments.includes(node) &&
    suiteCallee(node.parent.expression)
  );
}
export function normalizeLines(text) {
  return text.replace(/\r\n|[\r\n\u2028\u2029]/g, "\n");
}
function pureData(node) {
  if (!node) return false;
  if (
    ts.isLiteralExpression(node) ||
    [
      ts.SyntaxKind.TrueKeyword,
      ts.SyntaxKind.FalseKeyword,
      ts.SyntaxKind.NullKeyword,
    ].includes(node.kind)
  )
    return true;
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return pureData(node.expression);
  if (ts.isPrefixUnaryExpression(node)) return pureData(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(pureData);
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(
      (p) => ts.isPropertyAssignment(p) && pureData(p.initializer),
    );
  return false;
}
function dataFixture(path, source) {
  return (
    /(?:^|\/)(?:fixtures|goldens|snapshots)\//.test(path) &&
    source &&
    source.statements.every((s) =>
      ts.isExportAssignment(s)
        ? pureData(s.expression)
        : ts.isVariableStatement(s) &&
          s.declarationList.declarations.every((d) => pureData(d.initializer)),
    )
  );
}
export function trackedSourcePaths(root) {
  return trackedPaths(root);
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
  const normalized = normalizeLines(text);
  return normalized === ""
    ? 0
    : normalized.replace(/\n$/, "").split("\n").length;
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
function normalizedBody(body, source, onlySkips) {
  const tokens = [];
  const counters = {
    nonNullAssertions: 0,
    typeAssertions: 0,
    definiteAssignments: 0,
    skippedTests: 0,
  };
  function visit(node) {
    // AST leaves preserve regex/template/string contents while removing trivia.
    // A plain scanner cannot rescan template tails or regular expressions.
    if (ts.isJSDoc(node)) return;
    declarationAssertions(node, counters, onlySkips, true);
    if (typeAssertionNode(node)) counters.typeAssertions++;
    if (isSuppression(node, onlySkips)) counters.skippedTests++;
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
    counters,
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

function scanHealthFile(path, text) {
  let milliseconds = 0;
  text = text.replace(/\r\n/g, "\n");
  const source = /\.[cm]?[jt]sx?$/.test(path)
    ? ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    : undefined;
  if (source?.parseDiagnostics.length)
    throw new Error(`Cannot parse health source: ${path}`);
  if (dataFixture(path, source)) return null;
  const onlySkips = testFile(path) || /(?:^|\/)fixtures\//.test(path),
    sizes = sizeScope(path);
  const metrics = !sizes
    ? { skippedTests: 0 }
    : {
        lines: lineCount(text),
        nonNullAssertions: 0,
        definiteAssignments: 0,
        skippedTests: 0,
      };
  if (sizes && source) {
    const counted = countTypeAssertions(source);
    metrics.typeAssertions = counted.count;
    milliseconds = counted.milliseconds;
  }

  return { text, source, onlySkips, sizes, metrics, milliseconds };
}

/** AST metrics, with stable lexical function names rather than source-line IDs. */
export function measure(root = resolve(".")) {
  return measureSources(trackedPaths(root), (path) =>
    readFileSync(join(root, path), "utf8"),
  );
}
function declarationAssertions(node, metrics, onlySkips, sizes) {
  if (!onlySkips && ts.isNonNullExpression(node)) metrics.nonNullAssertions++;
  if (
    sizes &&
    (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
    node.exclamationToken
  )
    metrics.definiteAssignments++;
}
function storeBody(node, source, identity, lines, onlySkips, state) {
  const { hash, tokens, counters } = normalizedBody(
    node.body,
    source,
    onlySkips,
  );
  state.functions[identity] = lines;
  state.bodyRanges[identity] = [node.getStart(source), node.end];
  state.bodyTokens[identity] = tokens;
  state.bodyCounters[identity] = counters;
  state.bodyHashes[identity] = hash;
  state.bodyLines[identity] = normalizedLineHashes(node.body, source);
  return { hash, tokens };
}
function storeFile(path, text, metrics, sizes, state) {
  const { files, fileHashes, fileLines } = state;
  files[path] = metrics;
  if (sizes) {
    fileHashes[path] = createHash("sha256")
      .update(normalizeLines(text))
      .digest("hex");
    fileLines[path] = normalizeLines(text)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => createHash("sha256").update(s).digest("hex"));
  }
}
export function measureSources(paths, read) {
  const files = {},
    functions = {},
    bodies = new Map(),
    bodyTokens = {},
    bodyCounters = {},
    bodyHashes = {},
    bodyRanges = {},
    fileHashes = {},
    bodyLines = {},
    fileLines = {};
  let typeAssertionScanMs = 0;
  for (const path of paths) {
    const scanned = scanHealthFile(path, read(path));
    if (!scanned) continue;
    const { text, source, onlySkips, sizes, metrics } = scanned;
    typeAssertionScanMs += scanned.milliseconds;
    const occurrences = new Map();
    function visit(node, scope = "") {
      if (isSuppression(node, onlySkips)) metrics.skippedTests++;
      declarationAssertions(node, metrics, onlySkips, sizes);
      let nestedScope = scope;
      if (sizes && ts.isFunctionLike(node) && node.body) {
        const name = `${scope}${functionName(node, source)}`;
        const count = (occurrences.get(name) ?? 0) + 1;
        occurrences.set(name, count);
        const identity = `${path}#${name}${count === 1 ? "" : `~${count}`}`;
        const start = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        ).line;
        const end = source.getLineAndCharacterOfPosition(node.end).line;
        nestedScope = `${name}/`;
        if (suiteCallback(node, path)) {
          ts.forEachChild(node, (child) => visit(child, nestedScope));
          return;
        }
        const { hash, tokens } = storeBody(
          node,
          source,
          identity,
          end - start + 1,
          onlySkips,
          {
            functions,
            bodyRanges,
            bodyTokens,
            bodyCounters,
            bodyHashes,
            bodyLines,
          },
        );
        if (onlySkips) {
          ts.forEachChild(node, (child) => visit(child, nestedScope));
          return;
        }
        const group = bodies.get(hash) ?? { tokens, members: [] };
        group.members.push(identity);
        bodies.set(hash, group);
      }
      ts.forEachChild(node, (child) => visit(child, nestedScope));
    }
    if (source) visit(source);
    storeFile(path, text, metrics, sizes, { files, fileHashes, fileLines });
  }
  const duplicates = duplicateGroups(bodies);
  const result = {
    version: 4,
    files,
    functions,
    duplicates,
    bodyTokens,
    bodyCounters,
    bodyHashes,
    bodyRanges,
    fileHashes,
    bodyLines,
    fileLines,
  };
  Object.defineProperty(result, "typeAssertionScanMs", {
    value: typeAssertionScanMs,
  });
  return result;
}

function duplicateGroups(bodies) {
  return Object.fromEntries(
    [...bodies]
      .filter(([, group]) => group.members.length > 1)
      .sort(([a], [b]) => compare(a, b))
      .map(([hash, group]) => [
        hash,
        { ...group, members: group.members.sort(compare) },
      ]),
  );
}

// Trivia-free AST tokens, grouped by source line. Keep literal and regex text;
// omit brace-only lines, which otherwise make unrelated blocks look alike.
function normalizedLineHashes(body, source) {
  const lines = new Map();
  function visit(node) {
    if (ts.isJSDoc(node)) return;
    const children = node.getChildren(source);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    const value = node.getText(source);
    if (!value) return;
    const line = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    ).line;
    const row = lines.get(line) ?? [];
    row.push(value);
    lines.set(line, row);
  }
  visit(body);
  return [...lines.values()]
    .filter((row) =>
      row.some((token) => !["{", "}", ";", ",", ")", "("].includes(token)),
    )
    .map((row) =>
      createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    );
}
