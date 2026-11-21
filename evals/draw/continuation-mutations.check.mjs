// Native row extraction and production call-site mutants, in an OS temp copy.
import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  copy = await mkdtemp(join(tmpdir(), "thermite-continuation-mutations-")),
  results = [];
try {
  await cp(join(root, "evals/draw"), join(copy, "evals/draw"), {
    recursive: true,
  });
  for (const n of ["package.json", "vitest.config.mjs"])
    await cp(join(root, n), join(copy, n));
  await symlink(
    join(root, "node_modules"),
    join(copy, "node_modules"),
    "junction",
  );
  await symlink(join(root, "packages"), join(copy, "packages"), "junction");
  const paths = [
      "browser",
      "evaluate",
      "continuation-labels",
      "pdf",
      "pdf-painted",
      "identifier-pdf",
    ],
    original = new Map();
  for (const n of paths)
    original.set(
      n,
      await readFile(join(copy, "evals/draw", n + ".mjs"), "utf8"),
    );
  const source = original.get("evaluate"),
    ast = ts.createSourceFile(
      "evaluate.mjs",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    calls = [];
  function visit(n) {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === "continuationMediaIssues"
    )
      calls.push(n);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  const media = (m) => {
    const xs = calls.filter((n) => n.arguments[2]?.text === m);
    assert.equal(xs.length, 1);
    return xs[0].getText(ast);
  };
  const vectors = [
    [
      "cross-medium-anchor",
      "continuation-labels",
      "const anchor = source[0].continuationAnchor;",
      "const anchor = undefined;",
    ],
    [
      "connector-hit-target",
      "browser",
      'return a?.querySelector("path,line") ? a : null;',
      "return a;",
    ],
    [
      "span-rows",
      "browser",
      "return spans.filter((n) => !n.children.length);",
      "return [e];",
    ],
    ["hidden-rows", "browser", "Number(style.opacity) === 0", "false"],
    [
      "span-parent-locator",
      "browser",
      'locatorElement: ids.get(e.closest("text"))',
      "locatorElement: ids.get(e)",
    ],
    [
      "row-physical-em",
      "browser",
      "fontSize: parseFloat(css.fontSize) * scaleY,",
      "fontSize: 2.5,",
    ],
    [
      "independent-source-ir",
      "evaluate",
      "checks.continuations(s, packet, g, geometries, ir)",
      "checks.continuations(s, packet, g, geometries, undefined)",
    ],
    [
      "reference-anywhere",
      "browser",
      "const references = rows\n",
      "const references = rows.slice(0, 1)\n",
    ],
    [
      "reference-single",
      "browser",
      "references.filter((r) => r === id).length === 1",
      "true",
    ],
    [
      "mixed-content-scope",
      "browser",
      '"Mixed direct text and positioned spans unsupported",',
      '(() => { throw Error("Mixed direct text and positioned spans unsupported"); })(),',
    ],
    [
      "painted-pdf-call",
      "pdf",
      "return paintedPdfItems(page, await rawPdfText(page, families, fontCaps));",
      "return rawPdfText(page, families, fontCaps);",
    ],
    [
      "painted-ink-clip",
      "pdf-painted",
      "visible: !!overlap && overlap.w > 0 && overlap.h > 0,",
      "visible: true,",
    ],
    [
      "painted-visible",
      "pdf-painted",
      "if (!ink.some((g) => g.visible)) return [];",
      "return [];",
    ],
    [
      "identifier-painted",
      "identifier-pdf",
      "await paintedPdfItems(page, measured, nonempty, withPaintedBox)",
      "measured",
    ],
    [
      "exact-reference",
      "browser",
      "const idsForLink = [...new Set(references)].filter(",
      "const idsForLink = (references.length === 1 ? [...new Set(references)] : []).filter(",
    ],
    ["html-call", "evaluate", media("html"), "[]"],
    ["pdf-call", "evaluate", media("pdf"), "[]"],
  ];
  const run = async (id) => {
    const path = join(copy, "result.json");
    await rm(path, { force: true });
    const p = spawnSync(
      process.execPath,
      [
        join(copy, "node_modules/vitest/vitest.mjs"),
        "run",
        "--pool=forks",
        "--maxWorkers=2",
        "--no-cache",
        "--reporter=json",
        "--outputFile=" + path,
        "evals/draw/continuation-browser.test.mjs",
        "evals/draw/pdf-painted-browser.test.mjs",
      ],
      {
        cwd: copy,
        encoding: "utf8",
        env: { ...process.env, THERMITE_REQUIRE_BROWSER: "1" },
      },
    );
    const report = await readFile(path, "utf8").then(JSON.parse, () => ({}));
    const messages = (report.testResults ?? [])
      .flatMap((s) => s.assertionResults ?? [])
      .filter((t) => t.status === "failed")
      .flatMap((t) => t.failureMessages ?? []);
    const status =
      p.status === 0 && report.numPassedTests > 0
        ? "passed"
        : messages.some((m) => m.includes("AssertionError"))
          ? "killed"
          : "invalid";
    results.push({
      id,
      status,
      details:
        status === "invalid" ? p.stderr + JSON.stringify(messages) : undefined,
    });
    console.log(id + ": " + status);
    return status;
  };
  assert.equal(await run("unmodified-control"), "passed");
  for (const [id, file, from, to] of vectors) {
    const path = join(copy, "evals/draw", file + ".mjs"),
      src = original.get(file);
    assert.equal(src.split(from).length, 2, "One anchor required: " + id);
    await writeFile(path, src.replace(from, to));
    assert.equal(
      spawnSync("node", ["--check", path]).status,
      0,
      "Buildable mutant required",
    );
    assert.equal(await run(id), "killed", id);
    await writeFile(path, src);
  }
  assert(process.argv[2], "Supply a fresh output JSON path");
  await writeFile(
    resolve(process.argv[2]),
    JSON.stringify({ results }, null, 2) + "\n",
    { flag: "wx" },
  );
} finally {
  await rm(copy, { recursive: true, force: true });
}
