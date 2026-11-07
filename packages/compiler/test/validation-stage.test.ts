import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lockProject } from "../src/index.js";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { compileLoadedProjectWithStages } from "../src/compiler.js";
import { compileProject, loadProject } from "../src/index.js";
import {
  device,
  end,
  node,
  potential,
  project,
  wire,
} from "./validation-fixture.js";

async function faults(unresolved = false) {
  return project(
    [
      device(1, "N"),
      wire(2, end("N", "x"), end("N", "a")),
      wire(3, end("N", "x"), end("N", "b")),
      potential(4, end("N", "c"), {}, "A"),
      potential(5, end("N", "c"), {}, "B"),
      ...(unresolved ? [wire(6, end("N", "missing"), end("N", "d"))] : []),
    ],
    [
      node({
        x: { connection_policy: "exclusive" },
        a: {},
        b: {},
        c: {},
        d: {},
      }),
    ],
  );
}
describe("validation gate honesty", () => {
  it("already reports disjoint E201 and E300 in one run, with local gates announced", async () => {
    const r = await compileProject(await faults());
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E201", "E300", "I208"]);
    const d = r.diagnostics.find((d) => d.code === "I208");
    expect(d?.message).toContain("E201");
    expect(d?.message).toContain("E300");
    expect(d?.message).toContain("E301");
    expect(d?.message).toContain("N.x");
    expect(d?.message).toContain("N.c");
  });
  it("does not fabricate partial IR when E102 prevents resolution", async () => {
    const r = await compileProject(await faults(true));
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E102", "I208"]);
    expect(Object.hasOwn(r, "ir")).toBe(false);
    expect(r.diagnostics.find((d) => d.code === "I208")?.message).toMatch(
      /resolution.*E102/i,
    );
    expect(r.diagnostics.find((d) => d.code === "I208")?.message).toContain(
      "objects.json",
    );
  });
  it.each(["structural", "library lock"])(
    "announces the %s gate without invoking rules",
    async (gate) => {
      const root = await faults();
      const loaded = await loadProject(root);
      if (!loaded.ok) throw Error("load");
      if (gate === "structural")
        loaded.project.structuralDiagnostics = [
          {
            code: "E020",
            severity: "error",
            message: "Synthetic duplicate.",
            file: "objects.json",
            line: 1,
            column: 1,
            jsonPointer: "/objects/0",
          },
        ];
      else loaded.project.libraryLock = { state: "missing" };
      const evaluateRules = vi.fn(() => []);
      const r = compileLoadedProjectWithStages(loaded.project, {
        evaluateRules,
      });
      expect(evaluateRules).not.toHaveBeenCalled();
      expect(r.diagnostics.find((d) => d.code === "I208")?.message).toContain(
        "reference resolution (E1xx)",
      );
      if (gate === "structural")
        expect(r.diagnostics.find((d) => d.code === "I208")?.message).toContain(
          "library-lock verification",
        );
      expect(r.diagnostics.filter((d) => d.code === "I208")).toHaveLength(1);
      expect(r.diagnostics.find((d) => d.code === "I208")?.message).toContain(
        gate,
      );
    },
  );
});

describe("gate scope, determinism and CLI exits", () => {
  it("announces E200 on its real containing net and does not assess it", async () => {
    const root = await project(
      [
        device(1, "N"),
        {
          uid: "7f000000-0000-4000-8000-000000000002",
          kind: "cable",
          designation: "CBL",
          type: "assessment:cable",
          conductors: [
            { id: "missing", endpoints: [end("N", "a"), end("N", "b")] },
          ],
        },
      ],
      [
        node({
          a: { rating: { voltage_type: "AC" } },
          b: { rating: { voltage_type: "DC" } },
        }),
        {
          kind: "cable_type",
          id: "assessment:cable",
          conductors: [{ id: "1", color: "black" }],
        },
      ],
    );
    const r = await compileProject(root);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E200", "I208"]);
    expect(r.diagnostics[1]?.message).toContain("E200 topology gate");
    expect(r.diagnostics[1]?.message).toContain("N.a");
    expect(r.diagnostics[1]?.message).toContain("W303");
  });
  it("names per-terminal E301 suppression of E302", async () => {
    const root = await project(
      [
        device(1, "N"),
        potential(2, end("N", "a"), {
          voltage_type: "AC",
          nominal_voltage: 480,
        }),
      ],
      [node({ a: { rating: { voltage_type: "DC", nominal_voltage: 24 } } })],
    );
    const r = await compileProject(root);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E301", "I208"]);
    expect(r.diagnostics[1]?.message).toContain(
      "E301 voltage-type gate: skipped E302",
    );
    expect(r.diagnostics[1]?.message).toContain("N.a");
  });
  it("caps and naturally sorts blocking objects with full counts", async () => {
    const objects = [device(1, "N")];
    for (let i = 12; i >= 1; i--)
      objects.push(wire(i + 1, end("N", `missing${i}`), end("N", "a")));
    const root = await project(objects, [node({ a: {} })]);
    const r = await compileProject(root);
    expect(r.diagnostics.filter((d) => d.code === "E102")).toHaveLength(12);
    const ds = r.diagnostics.filter((d) => d.code === "I208");
    expect(ds).toHaveLength(1);
    expect(ds[0]?.message).toContain("12 items:");
    expect(ds[0]?.message).toContain("and 2 more");
  });
  it("caps affected nets while preserving every independent E201", async () => {
    const objects = [device(1, "N")];
    const terminals: Record<string, unknown> = {};
    for (let i = 12; i >= 1; i--) {
      terminals[`X${i}`] = { connection_policy: "exclusive" };
      terminals[`A${i}`] = {};
      terminals[`B${i}`] = {};
      objects.push(
        wire(2 * i, end("N", `X${i}`), end("N", `A${i}`)),
        wire(2 * i + 1, end("N", `X${i}`), end("N", `B${i}`)),
      );
    }
    const r = await compileProject(await project(objects, [node(terminals)]));
    expect(r.diagnostics.filter((d) => d.code === "E201")).toHaveLength(12);
    const d = r.diagnostics.find((d) => d.code === "I208");
    expect(d?.message).toContain("12 nets:");
    expect(d?.message).toContain("and 2 more");
    expect(d?.message.indexOf("N.A2")).toBeLessThan(
      d!.message.indexOf("N.A10"),
    );
    expect(d?.message).not.toContain("N.A11");
  });
});

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
it("keeps diagnostics, locations and 0/1/2 exits stable across processes/cwd/TZ/locale", async () => {
  const error = await faults(true);
  const rated = await project(
    [device(1, "N"), wire(2, end("N", "a"), end("N", "b"))],
    [
      node({
        a: { rating: { voltage_type: "AC" } },
        b: { rating: { voltage_type: "DC" } },
      }),
    ],
  );
  for (const [root, exit] of [
    [error, 1],
    [rated, 0],
    [resolve(rated, "absent"), 2],
  ] as const) {
    let baseline: string | undefined;
    for (const [cwd, tz, locale] of [
      [repositoryRoot, "UTC", "C"],
      [rated, "Pacific/Auckland", "tr_TR.UTF-8"],
      [repositoryRoot, "America/Los_Angeles", "de_DE.UTF-8"],
    ]) {
      const r = spawnSync(
        process.execPath,
        [resolve(repositoryRoot, "thermite.mjs"), "validate", root!, "--json"],
        {
          cwd,
          env: { ...process.env, TZ: tz, LC_ALL: locale, LANG: locale },
          encoding: "utf8",
        },
      );
      expect(r.error).toBeUndefined();
      expect(r.status, r.stderr).toBe(exit);
      expect(r.stderr).toBe("");
      if (baseline === undefined) baseline = r.stdout;
      else expect(r.stdout).toBe(baseline);
      expect(JSON.parse(r.stdout).length).toBeGreaterThan(0);
    }
  }
});

it.each(["loading/structural", "library lock"])(
  "names resolution hidden by the %s gate before a later E102",
  async (stage) => {
    const root = await project(
      [device(1, "N"), wire(2, end("N", "a"), end("N", "missing"))],
      [node({ a: {}, b: {} })],
    );
    const source = join(root, "objects.json");
    if (stage === "loading/structural") {
      const data = JSON.parse(await readFile(source, "utf8"));
      data.objects[0].bogus = true;
      await writeFile(source, JSON.stringify(data, null, 2) + "\n");
    } else await appendFile(join(root, "library/types.json"), " ");
    const first = await compileProject(root);
    expect(first.ok).toBe(false);
    expect(first.diagnostics.map((d) => d.code)).toEqual([
      stage === "library lock" ? "E108" : "E012",
      "I208",
    ]);
    const info = first.diagnostics.find((d) => d.code === "I208")!;
    expect(info.message).toContain("reference resolution (E1xx)");
    expect(info.message).toContain("W111");
    expect(info.message).toContain("W303");
    if (stage === "loading/structural") {
      expect(info.message).toContain("library-lock verification");
      const data = JSON.parse(await readFile(source, "utf8"));
      delete data.objects[0].bogus;
      await writeFile(source, JSON.stringify(data, null, 2) + "\n");
    } else {
      expect(info.message).not.toContain("skipped library-lock verification");
      expect((await lockProject(root)).ok).toBe(true);
    }
    const second = await compileProject(root);
    expect(second.diagnostics.map((d) => d.code)).toEqual(["E102", "I208"]);
    expect(
      second.diagnostics.find((d) => d.code === "I208")?.message,
    ).not.toContain("reference resolution (E1xx)");
  },
);

it("uses consistent accurate wording and no empty-pointer padding for tool failures", async () => {
  const root = await faults();
  const missing = await compileProject(resolve(root, "missing"));
  expect(missing.ok).toBe(false);
  const loaded = await loadProject(root);
  if (!loaded.ok) throw Error("load");
  const crashed = compileLoadedProjectWithStages(loaded.project, {
    evaluateRules: () => {
      throw Error("synthetic stage failure");
    },
  });
  for (const result of [missing, crashed]) {
    expect(result.ok).toBe(false);
    const d = result.diagnostics.find((d) => d.code === "I208")!;
    expect(d.message).toMatch(/^Checks not completed:/u);
    expect(d.message).not.toContain(':1:1 "');
  }
  expect(crashed.diagnostics.find((d) => d.code === "I208")?.message).toContain(
    "no complete results available",
  );
});

it.each(["libraryLock", "sources"] as const)(
  "names unavailable lock and resolution results when %s throws",
  async (property) => {
    const loaded = await loadProject(await faults());
    if (!loaded.ok) throw Error("load");
    Object.defineProperty(loaded.project, property, {
      get() {
        throw Error(`synthetic ${property} failure`);
      },
    });
    const evaluateRules = vi.fn(() => []);
    const result = compileLoadedProjectWithStages(loaded.project, {
      evaluateRules,
    });
    expect(evaluateRules).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("unexpected IR");
    expect(result.toolFailure).toBe(true);
    expect(result.diagnostics).toEqual([
      {
        file: "system.json",
        line: 1,
        column: 1,
        jsonPointer: "",
        code: "E001",
        severity: "error",
        message: `Compilation tool failure (synthetic ${property} failure).`,
      },
      {
        file: "system.json",
        line: 1,
        column: 1,
        jsonPointer: "",
        code: "I208",
        severity: "info",
        message:
          'Checks not completed: compilation tool failure gate (E001); no complete results available for library-lock verification, reference resolution (E1xx), W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (1 item: ["system.json:1:1"]); the failed stage supplied no trustworthy validation result.',
      },
    ]);
  },
);
