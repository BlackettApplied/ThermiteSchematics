import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  acceptBudget,
  createBudget,
  historyRegressions,
} from "../../../scripts/health-ratchet.mjs";
import {
  commit,
  git,
  metrics,
  put,
  repo,
  run,
  save,
} from "./health-fixture.js";

const path = "evals/draw/assessment.mjs";
const moduleText = readFileSync(
  new URL("../../../" + path, import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(path, moduleText, ts.ScriptTarget.Latest, true);
const assess = ast.statements.find(
  (n): n is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(n) && n.name?.text === "assess",
);
if (!assess?.body) throw Error("Missing real assess body");
const real = assess.getText(ast) + "\n";
const realBodyLines =
  ast.getLineAndCharacterOfPosition(assess.body.end - 1).line -
  ast.getLineAndCharacterOfPosition(assess.body.getStart(ast)).line +
  1;
const lines = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => `void "line-${start + i}";`).join(
    "\n",
  );
const body = (name: string, text: string) =>
  `function ${name}() {\n${text}\n}\n`;
const shim = (name: string, count: number) =>
  body(name, lines(50000, count - 3) + "\nreturn assessGrown(...arguments);");
const grown = (text: string, count: number) =>
  text
    .replace("function assess(", "function assessGrown(")
    .replace(
      "context = {}) {",
      "context = {}) {" + (count ? "\n" + lines(10000, count) : ""),
    );

function realSplit() {
  // Split only at a complete AST statement: the mixed-row loop ends at line 75.
  const node = assess;
  if (!node?.body) throw Error("Missing assess body");
  const cut = node.body.statements[5].end;
  const prefix = moduleText.slice(node.getStart(ast), cut);
  const tail = moduleText.slice(cut, node.body.end - 1).trimStart();
  const helper = body("assessGrown", tail.trimEnd());
  const count = 297 - helper.trimEnd().split("\n").length;
  return (
    prefix +
    "\nreturn assessGrown(...arguments);\n}\n" +
    helper.replace("{\n", "{\n" + lines(20000, count) + "\n")
  );
}

function texts(kind: string) {
  if (kind === "file-851" || kind === "file-cap-sharing") {
    const old =
      real + lines(0, 1462 - real.trimEnd().split("\n").length) + "\n";
    return {
      old,
      source: lines(50000, 851) + "\n",
      // Avoid the separate verbatim-body identity-proof gate, so this probe
      // exercises the file allowance rather than failing on a missing proof.
      helper:
        old.replace(
          "Duplicate observation identity",
          "Moved observation identity",
        ) + (kind === "file-851" ? lines(10000, 1400) + "\n" : ""),
      to: "evals/draw/moved-assessment.mjs",
      sizes: [851, kind === "file-851" ? 2862 : 1462],
      section: "files",
    };
  }
  if (kind === "natural-69")
    return {
      old: body("assess", lines(0, 136)),
      source: body("assess", lines(0, 69) + "\nreturn assessGrown();"),
      helper: body("assessGrown", lines(69, 67) + "\n" + lines(10000, 228)),
      to: path,
      sizes: [72, 297],
      section: "functions",
    };
  if (kind === "real-natural")
    return {
      old: real,
      source: realSplit(),
      helper: "",
      to: path,
      sizes: [77, 297],
      section: "functions",
    };
  return {
    old: real,
    source: shim("assess", 71),
    helper: grown(real, kind === "function-71" ? 111 : 0),
    to: path,
    sizes: [71, realBodyLines + (kind === "function-71" ? 111 : 0)],
    section: "functions",
  };
}

function decoy(kind: string) {
  const root = repo(),
    text = texts(kind);
  put(root, path, text.old);
  const base = metrics(root),
    before = createBudget(base);
  save(root, before);
  const sha = commit(root);
  put(root, path, text.source + (text.to === path ? text.helper : ""));
  if (text.to !== path) put(root, text.to, text.helper);
  const current = metrics(root),
    proposed = createBudget(current);
  proposed.ceilings = structuredClone(before.ceilings);
  const sizes =
    text.section === "files"
      ? [current.files[path].lines, current.files[text.to].lines]
      : [
          current.functions[path + "#assess"],
          current.functions[path + "#assessGrown"],
        ];
  expect(sizes).toEqual(text.sizes);
  expect(realBodyLines).toBeGreaterThan(70);
  expect(base.functions[path + "#assess"]).toBe(
    kind === "natural-69" ? 138 : realBodyLines,
  );
  for (const value of [
    text.old,
    text.source + (text.to === path ? text.helper : ""),
    text.helper,
  ])
    expect(
      ts.transpileModule(value, { reportDiagnostics: true }).diagnostics,
    ).toEqual([]);
  for (const section of ["files", "functions"])
    for (const [key, value] of Object.entries(proposed[section]))
      if (before[section][key] === undefined) {
        const identity = section + ":" + key;
        proposed.reasons[identity] = [
          {
            identity,
            from: section === "files" ? 850 : 70,
            to: value,
            reason: "decoy cannot fund a continuation",
          },
        ];
      }
  return { root, base, before, current, proposed, sha };
}

const attacks = ["function-71", "file-851", "natural-69", "real-natural"];
for (const target of ["dev", "release"]) {
  for (const kind of attacks) {
    it(`rejects ${kind} decoy history on ${target}`, () => {
      const f = decoy(kind);
      expect(
        historyRegressions(
          f.current,
          f.proposed,
          f.before,
          f.base,
          target,
        ).join("\n"),
      ).toContain("cannot rise through rename");
    });
    it(`accept refuses ${kind} decoy on ${target}`, () => {
      const f = decoy(kind);
      expect(() =>
        acceptBudget(f.current, f.before, "probe decoy", {
          budget: f.before,
          metrics: f.base,
          target,
        }),
      ).toThrow("cannot rise through rename");
    });
    it(`CLI refuses ${kind} decoy on ${target}`, () => {
      const f = decoy(kind);
      git(f.root, "update-ref", "refs/remotes/origin/" + target, f.sha);
      const result = run(f.root, ["--accept", "--reason", "probe decoy"], {
        GITHUB_BASE_REF: target,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cannot rise through rename");
      expect(
        JSON.parse(
          readFileSync(join(f.root, "scripts/health-budget.json"), "utf8"),
        ),
      ).toEqual(f.before);
    });
  }
  it.each(["function-cap-sharing", "file-cap-sharing"])(
    "charges the retained source for %s on " + target,
    (kind) => {
      const f = decoy(kind);
      expect(() =>
        acceptBudget(f.current, f.before, "probe retained cap", {
          budget: f.before,
          metrics: f.base,
          target,
        }),
      ).toThrow("cannot rise through rename");
    },
  );
}

function retained(section: string, count: number) {
  const root = repo(),
    from = "src/old.ts",
    to = "src/new.ts";
  const oldCount = section === "files" ? 1000 : 100;
  const wrap = (s: string) =>
    section === "files" ? s + "\n" : body("source", s);
  put(root, from, wrap(lines(0, oldCount)));
  const base = metrics(root),
    before = createBudget(base);
  put(
    root,
    from,
    wrap(lines(0, count) + "\n" + lines(50000, oldCount - count)),
  );
  put(root, to, wrap(lines(0, oldCount) + "\n" + lines(10000, oldCount)));
  return { root, base, before, current: metrics(root) };
}

for (const target of ["dev", "release"])
  it.each(["files", "functions"])(
    "exempts %s sources retaining exactly 80 percent on " + target,
    (section) => {
      const f = retained(section, section === "files" ? 800 : 80);
      let next = f.before;
      expect(() => {
        next = acceptBudget(f.current, f.before, "intact source", {
          budget: f.before,
          metrics: f.base,
          target,
        });
      }).not.toThrow();
      expect(
        historyRegressions(f.current, next, f.before, f.base, target),
      ).toEqual([]);
    },
  );

for (const target of ["dev", "release"])
  it.each(["files", "functions"])(
    "charges %s sources retaining 79 percent on " + target,
    (section) => {
      const f = retained(section, section === "files" ? 790 : 79);
      expect(() =>
        acceptBudget(f.current, f.before, "changed source", {
          budget: f.before,
          metrics: f.base,
          target,
        }),
      ).toThrow("cannot rise through rename");
    },
  );

it.each(["dev", "release"])(
  "banks a real shared-cap reduction on %s",
  (target) => {
    const root = repo(),
      from = "src/one.ts";
    put(root, from, body("source", lines(0, 248)));
    const base = metrics(root),
      before = createBudget(base);
    put(
      root,
      from,
      body("source", lines(0, 80) + "\nreturn helper();") +
        body("helper", lines(80, 168)),
    );
    const current = metrics(root);
    let next = before;
    expect(() => {
      next = acceptBudget(current, before, "extract", {
        budget: before,
        metrics: base,
        target,
      });
    }).not.toThrow();
    expect(before.functions[from + "#source"]).toBe(250);
    expect(next.functions[from + "#source"]).toBe(83);
    expect(next.functions[from + "#helper"]).toBe(170);
    expect(historyRegressions(current, next, before, base, target)).toEqual([]);
  },
);
