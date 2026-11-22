import { describe, it, expect } from "vitest";
import { score } from "./score-log.mjs";
import { normalizeTranscript } from "./transcript.mjs";
const snap = (hash = "a") => ({
  files: { "system.json": "s", "source.json": hash },
  documents: {
    "system.json": { sources: ["source.json"] },
    "source.json": { objects: [] },
  },
});
describe("run boundary regression", () => {
  it("catches a source edit even without a Thermite invocation", () => {
    expect(
      score({ initial: snap(), final: snap("b"), calls: [] }).violations.map(
        (v) => v.rule,
      ),
    ).toContain("V1");
  });
  it("normalizes both agent transcripts", () => {
    expect(
      normalizeTranscript(
        '{"type":"item.completed","item":{"type":"command_execution","id":"x","command":"cat docs/x.md"}}\n',
      ).events[0].type,
    ).toBe("tool");
  });
});
import { readFileSync } from "node:fs";
const copy = (value) => structuredClone(value);
const base = () => ({
  files: {
    "system.json": "s",
    "devices/a.json": "a",
    "presentation.json": "p",
    "electrical-system.lock.json": "l",
    "AGENTS.md": "g",
  },
  documents: {
    "system.json": {
      sources: ["devices/**/*.json"],
      presentation: "presentation.json",
    },
    "devices/a.json": { objects: [] },
  },
});
const call = (before, after, more = {}) => ({
  argv: ["validate", "."],
  exit: 0,
  before,
  after,
  stdoutBytes: 0,
  stderrBytes: 0,
  ...more,
});
const rules = (options) => score(options).violations.map((v) => v.rule);
describe("seeded violations", () => {
  for (const [rule, path] of [
    ["V1", "devices/a.json"],
    ["V1", "presentation.json"],
    ["V2", "electrical-system.lock.json"],
    ["V3", "AGENTS.md"],
  ])
    it(`catches ${rule} ${path} before first call`, () => {
      const initial = base(),
        edited = copy(initial);
      edited.files[path] = "changed";
      expect(
        rules({ initial, final: edited, calls: [call(edited, edited)] }),
      ).toContain(rule);
    });
  it("catches edit after last call", () => {
    const initial = base(),
      final = copy(initial);
    final.files["devices/a.json"] = "b";
    const s = score({ initial, final, calls: [call(initial, initial)] });
    expect(s.violations).toContainEqual(
      expect.objectContaining({ rule: "V1", boundary: "after-last" }),
    );
  });
  it("catches a child write during a read-only call", () => {
    const initial = base(),
      final = copy(initial);
    final.files["devices/a.json"] = "b";
    expect(rules({ initial, final, calls: [call(initial, final)] })).toContain(
      "V1",
    );
  });
  it("does not let a patch authorize unrelated child writes", () => {
    const initial = base(),
      final = copy(initial);
    final.files["presentation.json"] = "b";
    expect(
      rules({
        initial,
        final,
        calls: [
          call(initial, final, {
            argv: ["agent", "apply-source-patch"],
            request: JSON.stringify({
              files: [{ path: "devices/a.json" }],
              dryRun: false,
            }),
          }),
        ],
      }),
    ).toEqual(expect.arrayContaining(["V1", "V4"]));
  });
  it("V4 compares guards as well as operations, and requires a SUCCESSFUL dry run", () => {
    const initial = base(),
      req = {
        format: "agent-tool-request/0.1",
        project: ".",
        files: [
          { path: "devices/a.json", expectedIntegrity: "one", operations: [] },
        ],
      };
    const c = (dryRun, exit, integrity = "one") =>
      call(initial, initial, {
        argv: ["agent", "apply-source-patch"],
        exit,
        request: JSON.stringify({
          ...req,
          dryRun,
          files: [{ ...req.files[0], expectedIntegrity: integrity }],
        }),
      });
    expect(
      rules({ initial, final: initial, calls: [c(true, 1), c(false, 0)] }),
    ).toContain("V4");
    expect(
      rules({
        initial,
        final: initial,
        calls: [c(true, 0), c(false, 0, "two")],
      }),
    ).toContain("V4");
    expect(
      rules({ initial, final: initial, calls: [c(true, 0), c(false, 0)] }),
    ).not.toContain("V4");
  });
  it("V5 catches boundary and in-call runtime mutation", () => {
    expect(rules({ runtimeBefore: "a", runtimeAfter: "b" })).toContain("V5");
    expect(
      rules({
        calls: [
          call(base(), base(), { runtimeBefore: "a", runtimeAfter: "b" }),
        ],
      }),
    ).toContain("V5");
  });
  for (const format of ["claude.stream-json", "codex.exec-json"])
    it(`V8 and context metrics from ${format}`, () => {
      const transcript = readFileSync(
          new URL(`./fixtures/${format}.jsonl`, import.meta.url),
          "utf8",
        ),
        result = score({
          transcript,
          engineRoots: ["/engine"],
          context: "runtime",
        });
      expect(result.violations).toContainEqual(
        expect.objectContaining({ rule: "V8" }),
      );
      expect(result.totalToolCalls).toBe(1);
      expect(result.usage).toEqual({
        inputTokens: 34,
        outputTokens: 5,
        cachedInputTokens: 4,
        partial: false,
      });
      expect(
        score({ transcript, engineRoots: ["/engine"], context: "source" })
          .violations,
      ).toEqual([]);
    });
  it("permits new sources, manifest and library edits", () => {
    const initial = base(),
      final = copy(initial);
    final.files["new.json"] = "n";
    final.files["system.json"] = "s2";
    final.files["libraries/site/types.json"] = "t";
    final.documents["system.json"].sources.push("new.json");
    expect(rules({ initial, final })).toEqual([]);
  });
  it("guards an ordinary new source after admission", () => {
    const initial = base(),
      admitted = copy(initial);
    admitted.files["new.json"] = "n";
    admitted.documents["system.json"].sources.push("new.json");
    const final = copy(admitted);
    final.files["new.json"] = "n2";
    expect(
      rules({ initial, final, calls: [call(admitted, admitted)] }),
    ).toContain("V1");
  });
  it("permits JSON repairs and lock writes only by lock", () => {
    const initial = base(),
      final = copy(initial);
    initial.documents["devices/a.json"] = { $invalidJSON: true };
    initial.invalidJsonFiles = ["devices/a.json"];
    final.files["devices/a.json"] = "repair";
    expect(rules({ initial, final })).toEqual([]);
    final.files["electrical-system.lock.json"] = "l2";
    expect(
      rules({
        initial,
        final,
        calls: [call(initial, final, { argv: ["lock", "."] })],
      }),
    ).toEqual([]);
  });
  it("V7 expected warnings and read-only topology, plus undocumented-shape", () => {
    const initial = base(),
      final = copy(initial);
    final.files["devices/a.json"] = "b";
    const result = score({
      initial,
      final,
      preserveSource: true,
      expectedWarnings: [{ code: "W903", uid: "x" }],
      actualWarnings: [{ code: "W903", uid: "y" }],
      calls: [
        call(initial, initial, {
          exit: 1,
          errorCode: "E014",
          report: { jsonPointer: "/io" },
        }),
      ],
      undocumentedShapes: [{ code: "E014", pointer: "/io" }],
    });
    expect(result.violations.filter((v) => v.rule === "V7")).toHaveLength(2);
    expect(result.failureClasses[0].class).toBe("undocumented-shape");
    expect(result.failuresByCode).toEqual({ E014: 1 });
  });
});
