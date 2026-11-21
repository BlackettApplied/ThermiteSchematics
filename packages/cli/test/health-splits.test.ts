import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  acceptBudget,
  createBudget,
  historyRegressions,
  regressions,
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

const from = "src/source.ts",
  to = "src/part.ts";
const lines = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => `void "line-${start + i}";`).join(
    "\n",
  );
const body = (name: string, text: string) =>
  `function ${name}() {\n${text}\n}\n`;
const shapes = ["103/100", "72/131", "73/130", "three-way-202", "file"];

function split(shape: string, growth = 0) {
  if (shape === "file")
    return {
      section: "files",
      old: lines(0, 2000) + "\n",
      changed: {
        [from]:
          lines(0, 1000) +
          '\nimport "./part.js";\nexport * from "./part.js";\n',
        [to]:
          lines(1000, 1000) +
          "\nexport {};\n" +
          (growth ? lines(10000, growth) + "\n" : ""),
      },
      keys: [from, to],
      sizes: [1002, 1001 + growth],
    };
  if (shape === "three-way-202")
    return {
      section: "functions",
      old: body("assess", lines(0, 198)),
      changed: {
        [from]:
          "function assess() { partA(); partB(); }\n" +
          body("partA", lines(0, 99)) +
          body(
            "partB",
            lines(99, 99) + (growth ? "\n" + lines(10000, growth) : ""),
          ),
      },
      keys: [from + "#assess", from + "#partA", from + "#partB"],
      sizes: [1, 101, 101 + growth],
    };
  const kept = shape === "72/131" ? 69 : shape === "73/130" ? 70 : 100;
  return {
    section: "functions",
    old: body("assess", lines(0, 198)),
    changed: {
      [from]:
        body("assess", lines(0, kept) + "\nreturn part();") +
        body(
          "part",
          lines(kept, 198 - kept) + (growth ? "\n" + lines(10000, growth) : ""),
        ),
    },
    keys: [from + "#assess", from + "#part"],
    sizes: [kept + 3, 200 - kept + growth],
  };
}

function proposedFor(
  current: ReturnType<typeof metrics>,
  before: ReturnType<typeof createBudget>,
) {
  const proposed = createBudget(current);
  proposed.ceilings = structuredClone(before.ceilings);
  for (const section of ["files", "functions"])
    for (const [key, value] of Object.entries(proposed[section]))
      if (before[section][key] === undefined) {
        const identity = section + ":" + key;
        proposed.reasons[identity] = [
          {
            identity,
            from: section === "files" ? 850 : 70,
            to: value,
            reason: "pure continuation split",
          },
        ];
      }
  return proposed;
}

function fixture(shape: string, growth = 0) {
  const root = repo(),
    spec = split(shape, growth);
  put(root, from, spec.old);
  const base = metrics(root),
    before = createBudget(base);
  save(root, before);
  const sha = commit(root);
  for (const [path, text] of Object.entries(spec.changed))
    put(root, path, text);
  const current = metrics(root),
    proposed = proposedFor(current, before);
  const sizes = spec.keys.map((key) =>
    spec.section === "files"
      ? current.files[key].lines
      : current.functions[key],
  );
  expect(sizes).toEqual(spec.sizes);
  expect(
    spec.section === "files"
      ? base.files[from].lines
      : base.functions[from + "#assess"],
  ).toBe(spec.section === "files" ? 2000 : 200);
  for (const text of [spec.old, ...Object.values(spec.changed)]) {
    expect(text).not.toMatch(/\n[ \t]*\n/);
    expect(
      ts.transpileModule(text, { reportDiagnostics: true }).diagnostics,
    ).toEqual([]);
  }
  return { root, base, before, current, proposed, sha };
}

for (const target of ["dev", "release"])
  for (const shape of shapes) {
    it(`assesses pure ${shape} split with structural overhead on ${target}`, () => {
      const f = fixture(shape),
        reference = { budget: f.before, metrics: f.base, target };
      expect(regressions(f.current, f.proposed, reference)).toEqual([]);
      expect(
        historyRegressions(f.current, f.proposed, f.before, f.base, target),
      ).toEqual([]);
    });
    it(`accepts pure ${shape} split with structural overhead on ${target}`, () => {
      const f = fixture(shape);
      let next = f.before;
      expect(() => {
        next = acceptBudget(f.current, f.before, "pure continuation split", {
          budget: f.before,
          metrics: f.base,
          target,
        });
      }).not.toThrow();
      expect(
        historyRegressions(f.current, next, f.before, f.base, target),
      ).toEqual([]);
    });
    it(`CLI accepts pure ${shape} split with structural overhead on ${target}`, () => {
      const f = fixture(shape);
      git(f.root, "update-ref", "refs/remotes/origin/" + target, f.sha);
      const result = run(
        f.root,
        ["--accept", "--reason", "pure continuation split"],
        { GITHUB_BASE_REF: target },
      );
      expect(result.status, result.stderr).toBe(0);
      const next = JSON.parse(
        readFileSync(join(f.root, "scripts/health-budget.json"), "utf8"),
      );
      expect(
        historyRegressions(f.current, next, f.before, f.base, target),
      ).toEqual([]);
    });
  }

for (const target of ["dev", "release"])
  for (const shape of shapes.filter((s) => s !== "three-way-202")) {
    it(`assesses ${shape} split plus four growth lines as invalid on ${target}`, () => {
      const f = fixture(shape, 4);
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
    it(`accept refuses ${shape} split plus four growth lines on ${target}`, () => {
      const f = fixture(shape, 4);
      expect(() =>
        acceptBudget(f.current, f.before, "growth", {
          budget: f.before,
          metrics: f.base,
          target,
        }),
      ).toThrow("cannot rise through rename");
    });
    it(`CLI refuses ${shape} split plus four growth lines on ${target}`, () => {
      const f = fixture(shape, 4);
      git(f.root, "update-ref", "refs/remotes/origin/" + target, f.sha);
      const result = run(f.root, ["--accept", "--reason", "growth"], {
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

for (const target of ["dev", "release"]) {
  it.each(["103/100", "file"])(
    "rejects just one line past the %s structural cap on " + target,
    (shape) => {
      const f = fixture(shape, 1);
      expect(() =>
        acceptBudget(f.current, f.before, "growth", {
          budget: f.before,
          metrics: f.base,
          target,
        }),
      ).toThrow("cannot rise through rename");
    },
  );
  it("rejects three-way growth beyond its six-line credit on " + target, () => {
    const f = fixture("three-way-202", 5);
    expect(() =>
      acceptBudget(f.current, f.before, "growth", {
        budget: f.before,
        metrics: f.base,
        target,
      }),
    ).toThrow("cannot rise through rename");
  });
  it(
    "does not credit an unbudgeted small continuation part on " + target,
    () => {
      const root = repo();
      put(root, from, body("assess", lines(0, 198)));
      const base = metrics(root),
        before = createBudget(base);
      put(
        root,
        from,
        body("large", lines(0, 148) + "\n" + lines(10000, 54)) +
          body("small", lines(148, 50)),
      );
      const current = metrics(root);
      expect(current.functions[from + "#large"]).toBe(204);
      expect(current.functions[from + "#small"]).toBe(52);
      expect(() =>
        acceptBudget(current, before, "growth", {
          budget: before,
          metrics: base,
          target,
        }),
      ).toThrow("cannot rise through rename");
    },
  );
  it("still requires a reason for a new split allowance on " + target, () => {
    const f = fixture("103/100");
    expect(() =>
      acceptBudget(f.current, f.before, undefined, {
        budget: f.before,
        metrics: f.base,
        target,
      }),
    ).toThrow();
  });
}

const attacks = [
  "cross-file",
  "cross-file-decoy",
  "nested",
  "absorb-budgeted",
  "absorb-unbudgeted",
];
function attack(kind: string) {
  const root = repo(),
    recipient = kind === "absorb-budgeted" ? 148 : 58;
  put(
    root,
    from,
    body("assess", lines(0, 136)) +
      (kind.startsWith("absorb")
        ? body("recipient", lines(1000, recipient))
        : ""),
  );
  const before = createBudget(metrics(root));
  if (kind === "absorb-budgeted")
    put(
      root,
      from,
      body("assess", lines(0, 136)) + body("recipient", lines(1000, 90)),
    );
  const base = metrics(root);
  if (kind.startsWith("absorb"))
    put(
      root,
      from,
      body(
        "recipient",
        lines(1000, kind === "absorb-budgeted" ? 90 : 58) +
          "\n" +
          lines(0, 136),
      ),
    );
  else {
    put(
      root,
      from,
      kind === "cross-file-decoy"
        ? body("assess", lines(50000, 68) + "\nreturn grown();")
        : "",
    );
    const moved = body("grown", lines(0, 136) + "\n" + lines(10000, 100));
    put(
      root,
      to,
      kind === "nested" ? "function outer() {\n" + moved + "}\n" : moved,
    );
  }
  return { before, base, current: metrics(root) };
}
for (const target of ["dev", "release"])
  it.each(attacks)(
    "still rejects %s continuation growth on " + target,
    (kind) => {
      const f = attack(kind);
      expect(() =>
        acceptBudget(f.current, f.before, "probe growth", {
          budget: f.before,
          metrics: f.base,
          target,
        }),
      ).toThrow("cannot rise");
    },
  );
