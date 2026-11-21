import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  acceptBudget,
  createBudget,
  historyRegressions,
  lowerBudget,
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

const realAssessment = readFileSync(
  new URL("../../../evals/draw/assessment.mjs", import.meta.url),
  "utf8",
);
function assessment() {
  const source = ts.createSourceFile(
    "assessment.mjs",
    realAssessment,
    99,
    true,
  );
  const node = source.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "assess",
  );
  if (!node) throw Error("Missing real assess fixture");
  return node.getText(source) + "\n";
}
const assessSource = ts.createSourceFile("assess.ts", assessment(), 99, true);
const assessNode = assessSource.statements.find(ts.isFunctionDeclaration);
if (!assessNode?.body) throw Error("Missing assess fixture body");
const realBodyLines =
  assessSource.getLineAndCharacterOfPosition(assessNode.body.end - 1).line -
  assessSource.getLineAndCharacterOfPosition(
    assessNode.body.getStart(assessSource),
  ).line +
  1;
const statements = (start: number, n: number) =>
  Array.from({ length: n }, (_, i) => `void "line-${start + i}";`).join("\n");
const body = (name: string, start: number, n: number, extra = 0) =>
  `function ${name}() {\n${statements(start, n)}${extra ? "\n" + statements(10000 + start, extra) : ""}\n}\n`;

function fixture(section: string, split = false) {
  const root = repo(),
    from = section === "files" ? "src/old.ts" : "evals/draw/assessment.mjs",
    to = section === "files" ? "src/new.ts" : from;
  const old =
    section === "files"
      ? statements(0, 1462) + "\n"
      : split
        ? body("assess", 0, 136)
        : assessment();
  put(root, from, old);
  const base = metrics(root),
    before = createBudget(base);
  let next: string;
  if (section === "files") {
    rmSync(join(root, from));
    next = split
      ? statements(0, 731) + "\n" + statements(10000, 769) + "\n"
      : old.replace('"line-0"', '"edited-line"') +
        statements(10000, 1438) +
        "\n";
    if (split)
      put(
        root,
        "src/second.ts",
        statements(731, 731) + "\n" + statements(20000, 769) + "\n",
      );
  } else
    next = split
      ? body("assessPartA", 0, 68, 40) + body("assessPartB", 68, 68, 40)
      : old
          .replace("function assess(", "function assessGrown(")
          .replace(
            "context = {}) {",
            "context = {}) {\n" + statements(10000, 111),
          );
  put(root, to, next);
  const current = metrics(root),
    proposed = createBudget(current);
  proposed.ceilings = structuredClone(before.ceilings);
  for (const kind of ["files", "functions"])
    for (const [key, value] of Object.entries(proposed[kind]))
      if (before[kind][key] === undefined) {
        const identity = kind + ":" + key;
        proposed.reasons[identity] = [
          {
            identity,
            from: kind === "files" ? 850 : 70,
            to: value,
            reason: "new identity is not permission to rename and grow",
          },
        ];
      }
  return { root, from, to, base, before, current, proposed };
}

for (const target of ["dev", "release"]) {
  for (const section of ["files", "functions"]) {
    it(`rejects ${section} rename-and-grow on ${target}`, () => {
      const { base, before, current, proposed, to } = fixture(section);
      if (section === "functions") {
        expect(realBodyLines).toBeGreaterThan(70);
        expect(base.functions[to + "#assess"]).toBe(realBodyLines);
        expect(current.functions[to + "#assessGrown"]).toBe(
          realBodyLines + 111,
        );
      } else expect(current.files[to].lines).toBe(2900);
      expect(
        historyRegressions(current, proposed, before, base, target).join("\n"),
      ).toContain("cannot rise");
    });
    it(`accept refuses ${section} rename-and-grow on ${target}`, () => {
      const { base, before, current } = fixture(section);
      expect(() =>
        acceptBudget(current, before, "probe rename", {
          budget: before,
          metrics: base,
          target,
        }),
      ).toThrow("cannot rise");
    });
    it(`rejects ${section} rename-and-grow split between two identities on ${target}`, () => {
      const { base, before, current, proposed } = fixture(section, true);
      expect(
        historyRegressions(current, proposed, before, base, target).join("\n"),
      ).toContain("cannot rise");
    });
  }
  it(`CLI refuses real assess rename-and-grow on ${target}`, () => {
    const root = repo(),
      path = "evals/draw/assessment.mjs";
    put(root, path, assessment());
    const before = createBudget(metrics(root));
    save(root, before);
    const sha = commit(root);
    git(root, "update-ref", "refs/remotes/origin/" + target, sha);
    put(
      root,
      path,
      assessment()
        .replace("function assess(", "function assessGrown(")
        .replace(
          "context = {}) {",
          "context = {}) {\n" + statements(10000, 111),
        ),
    );
    const result = run(root, ["--accept", "--reason", "probe rename"], {
      GITHUB_BASE_REF: target,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot rise");
    expect(
      JSON.parse(
        readFileSync(join(root, "scripts/health-budget.json"), "utf8"),
      ),
    ).toEqual(before);
  });
}

it("accepts a small edited rename within the old allowance", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("oldName", 0, 136));
  const base = metrics(root),
    before = createBudget(base);
  put(root, path, body("newName", 0, 136).replace('"line-1"', '"small-edit"'));
  const current = metrics(root),
    next = acceptBudget(current, before, "rename", {
      budget: before,
      metrics: base,
    });
  expect(next.functions[path + "#newName"]).toBe(138);
  expect(historyRegressions(current, next, before, base)).toEqual([]);
});
it("accepts a legitimate extraction while the original function remains", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("original", 0, 136));
  const base = metrics(root),
    before = createBudget(base);
  put(
    root,
    path,
    "function original() { return helper(); }\n" + body("helper", 0, 136),
  );
  const current = metrics(root),
    next = acceptBudget(current, before, "extract", {
      budget: before,
      metrics: base,
    });
  expect(historyRegressions(current, next, before, base)).toEqual([]);
});
it("accepts genuinely new code sharing only boilerplate", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("retired", 0, 136));
  const base = metrics(root),
    before = createBudget(base);
  put(
    root,
    path,
    body("brandNew", 1000, 120, 0).replace('"line-1000"', '"line-0"') +
      body("boilerplate", 1, 9),
  );
  const current = metrics(root),
    next = acceptBudget(current, before, "new code", {
      budget: before,
      metrics: base,
    });
  expect(historyRegressions(current, next, before, base)).toEqual([]);
});

it("accepts a verbatim move with separately budgeted nested bodies", () => {
  const root = repo(),
    from = "src/old.ts",
    to = "src/new.ts";
  const text =
    "function outer() {\n" +
    body("inner", 0, 158) +
    statements(1000, 38) +
    "\n}\n";
  put(root, from, text);
  const base = metrics(root),
    before = createBudget(base);
  rmSync(join(root, from));
  put(root, to, text);
  const current = metrics(root),
    next = createBudget(current);
  for (const name of ["outer", "outer/inner"])
    next.moves[to + "#" + name] = {
      section: "functions",
      from: from + "#" + name,
      sha256: base.bodyHashes[from + "#" + name],
    };
  expect(historyRegressions(current, next, before, base)).toEqual([]);
});

it("rejects a renamed stale allowance whose base body is below the soft threshold", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("oldName", 0, 136));
  const before = createBudget(metrics(root));
  put(root, path, body("oldName", 0, 10));
  const base = metrics(root);
  put(root, path, body("newName", 0, 10, 160));
  const current = metrics(root);
  expect(() =>
    acceptBudget(current, before, "rename", { budget: before, metrics: base }),
  ).toThrow("cannot rise");
});

it("matches splits independently of object and line ordering", () => {
  const { base, before, current, proposed } = fixture("functions", true);
  const original = historyRegressions(current, proposed, before, base);
  for (const data of [current, base]) {
    data.functions = Object.fromEntries(
      Object.entries(data.functions).reverse(),
    );
    data.bodyLines = Object.fromEntries(
      Object.entries(data.bodyLines)
        .reverse()
        .map(([key, lines]) => [key, [...lines].reverse()]),
    );
  }
  expect(historyRegressions(current, proposed, before, base)).toEqual(original);
  expect(original.join("\n")).toContain("cannot rise");
});

it("permits a small-helper split that needs no new numeric allowances", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("original", 0, 136));
  const base = metrics(root),
    before = createBudget(base);
  put(root, path, body("partA", 0, 68) + body("partB", 68, 68));
  const current = metrics(root),
    next = lowerBudget(current, before, { budget: before, metrics: base });
  expect(current.functions[path + "#partA"]).toBe(70);
  expect(current.functions[path + "#partB"]).toBe(70);
  expect(next.functions).toEqual({});
  expect(historyRegressions(current, next, before, base)).toEqual([]);
});

it("rejects splitting exactly 20-percent parts without floating-point drift", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("original", 0, 285));
  const base = metrics(root),
    before = createBudget(base);
  put(
    root,
    path,
    Array.from({ length: 5 }, (_, i) => body("part" + i, i * 57, 57, 20)).join(
      "",
    ),
  );
  const current = metrics(root);
  expect(() =>
    acceptBudget(current, before, "split", { budget: before, metrics: base }),
  ).toThrow("cannot rise");
});

it("rejects a continuation at exactly 80-percent retained content", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("original", 0, 285));
  const base = metrics(root),
    before = createBudget(base);
  put(root, path, body("partA", 0, 114, 35) + body("partB", 114, 114, 35));
  const current = metrics(root);
  expect(() =>
    acceptBudget(current, before, "split", { budget: before, metrics: base }),
  ).toThrow("cannot rise");
});

it.each(["dev", "release"])(
  "accepts a small edited file rename on %s",
  (target) => {
    const root = repo(),
      from = "src/old.ts",
      to = "src/new.ts";
    put(root, from, statements(0, 1462) + "\n");
    const base = metrics(root),
      before = createBudget(base);
    rmSync(join(root, from));
    put(
      root,
      to,
      (statements(0, 1462) + "\n").replace('"line-0"', '"small-edit"'),
    );
    const current = metrics(root),
      next = acceptBudget(current, before, "rename", {
        budget: before,
        metrics: base,
        target,
      });
    expect(next.files[to]).toBe(1462);
    expect(historyRegressions(current, next, before, base, target)).toEqual([]);
  },
);

for (const target of ["dev", "release"])
  it.each(["files", "functions"])(
    "rejects %s rename-and-grow behind a retiring source stub on " + target,
    (section) => {
      const { root, from, to, base, before } = fixture(section);
      if (section === "files") put(root, from, 'export * from "./new.js";\n');
      else
        put(
          root,
          from,
          "export function assess() { return assessGrown(...arguments); }\n" +
            readFileSync(join(root, to), "utf8"),
        );
      const current = metrics(root);
      expect(() =>
        acceptBudget(current, before, "rename", {
          budget: before,
          metrics: base,
          target,
        }),
      ).toThrow("cannot rise");
    },
  );

it("rejects growth split between a retiring original and a new helper", () => {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("original", 0, 136));
  const base = metrics(root),
    before = createBudget(base);
  put(root, path, body("original", 0, 60) + body("helper", 60, 76, 100));
  const current = metrics(root);
  expect(() =>
    acceptBudget(current, before, "extract", { budget: before, metrics: base }),
  ).toThrow("cannot rise");
});

for (const target of ["dev", "release"])
  it.each(["files", "functions"])(
    "honors a proven %s source among overlapping retired items on " + target,
    (section) => {
      const root = repo(),
        a = "src/a.ts",
        b = "src/b.ts",
        to = "src/c.ts";
      const first =
        section === "files" ? statements(0, 1000) + "\n" : body("same", 0, 78);
      const second =
        section === "files"
          ? statements(0, 1200) + "\n"
          : first.replace(/\n}\n$/, "\n" + "\n".repeat(40) + "}\n");
      put(root, a, first);
      put(root, b, second);
      const base = metrics(root),
        before = createBudget(base);
      rmSync(join(root, a));
      rmSync(join(root, b));
      put(root, to, second);
      const current = metrics(root),
        next = createBudget(current),
        key = section === "files" ? to : to + "#same",
        from = section === "files" ? b : b + "#same";
      next.moves[key] = {
        section,
        from,
        sha256:
          section === "files" ? base.fileHashes[from] : base.bodyHashes[from],
      };
      expect(historyRegressions(current, next, before, base, target)).toEqual(
        [],
      );
    },
  );

it("rejects an inner rename even when a weak retired ancestor overlaps it", () => {
  const root = repo(),
    path = "src/one.ts";
  put(
    root,
    path,
    "function outer() {\n" +
      body("inner", 0, 98) +
      statements(1000, 38) +
      "\n}\n",
  );
  const base = metrics(root),
    before = createBudget(base);
  put(root, path, body("lifted", 0, 98, 30));
  const current = metrics(root);
  expect(() =>
    acceptBudget(current, before, "rename", { budget: before, metrics: base }),
  ).toThrow("cannot rise");
});

function duplicateSplit(extra: number) {
  const root = repo(),
    path = "src/one.ts";
  put(root, path, body("first", 0, 100) + body("second", 0, 100));
  const base = metrics(root),
    before = createBudget(base);
  put(root, path, body("partA", 0, 50, extra) + body("partB", 50, 50, extra));
  return { base, before, current: metrics(root) };
}
it("rejects split growth when two retired origins have identical content", () => {
  const { base, before, current } = duplicateSplit(100);
  expect(() =>
    acceptBudget(current, before, "split", { budget: before, metrics: base }),
  ).toThrow("cannot rise");
});
it("shares separate allowances for an affordable split of identical origins", () => {
  const { base, before, current } = duplicateSplit(28);
  const next = acceptBudget(current, before, "split", {
    budget: before,
    metrics: base,
  });
  expect(historyRegressions(current, next, before, base)).toEqual([]);
});
