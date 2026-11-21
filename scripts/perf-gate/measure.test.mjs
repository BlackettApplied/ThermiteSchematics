import { describe, expect, test } from "vitest";
import {
  comparison,
  measurePair,
  measurementOrder,
  median,
  sampleCounts,
} from "./measure.mjs";
import { contextWarnings, validateBaseline } from "./report.mjs";

function worker(side, calls = [], overrides = {}) {
  return {
    sample: async ({ name, operation }) => {
      calls.push(`${side}/${name}/${operation}`);
      return {
        ms: 100,
        sha256: `${side}/${name}/${operation}`,
        inputSha256: name,
        views: name === "machine-demo" ? 12 : 4,
        ...overrides,
      };
    },
  };
}
describe("per-PR performance guard", () => {
  test("keeps +20% without a floor and catches a persistent synthetic +25%", async () => {
    expect(comparison(100, 120).pass).toBe(true);
    expect(comparison(0.01, 0.0125).pass).toBe(false);
    for (const bad of [0, -1, NaN, Infinity])
      expect(() => comparison(100, bad)).toThrow();
    const result = await measurePair(
      worker("base"),
      worker("head", [], { ms: 125 }),
    );
    expect(result.pass).toBe(false);
    expect(
      result.rows.every(
        (r) => !r.pass && r.measurements.length === 2 && r.ratio === 1.25,
      ),
    ).toBe(true);
  });
  test("uses 21 compile / 5 packet samples and excludes every warmup", async () => {
    const head = worker("head");
    const sample = head.sample,
      counts = new Map();
    head.sample = async (request) => {
      const key = `${request.name}/${request.operation}`;
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      return { ...(await sample(request)), ms: n === 0 ? 10000 : 100 };
    };
    const result = await measurePair(worker("base"), head);
    expect(result.pass).toBe(true);
    for (const row of result.rows) {
      expect(row.samples).toBe(sampleCounts[row.operation]);
      expect(row.measurements).toHaveLength(1);
      expect(row.headMedianMs).toBe(100);
      expect(row.measurements[0].observations.head).toHaveLength(
        row.samples + 1,
      );
      expect(row.measurements[0].observations.head[0].warmup).toBe(true);
      expect(row.measurements[0].observations.head[1].loadBefore).toHaveLength(
        3,
      );
    }
    expect(median([9, 1, 3])).toBe(3);
    expect(median([9, 1, 3, 5])).toBe(4);
  });
  test("only confirms a failing row once and retains the initial failure", async () => {
    const calls = [],
      head = worker("head", calls),
      sample = head.sample;
    let compileCalls = 0;
    head.sample = async (request) => ({
      ...(await sample(request)),
      ms:
        request.name === "machine-demo" &&
        request.operation === "compile" &&
        compileCalls++ < 22
          ? 125
          : 100,
    });
    const result = await measurePair(worker("base"), head);
    expect(result.pass).toBe(true);
    expect(result.rows[0].measurements.map((m) => m.pass)).toEqual([
      false,
      true,
    ]);
    expect(result.rows.slice(1).every((r) => r.measurements.length === 1)).toBe(
      true,
    );
    expect(calls.filter((s) => s === "head/machine-demo/compile")).toHaveLength(
      44,
    );
  });
  test("balances first positions across workloads and records replayable seeded orders", async () => {
    const result = await measurePair(worker("base"), worker("head"), {
      seed: 42,
    });
    for (const operation of ["compile", "packet"]) {
      const orders = result.rows
        .filter((r) => r.operation === operation)
        .flatMap((r) => r.measurements[0].order.slice(1));
      expect(orders.filter((r) => r[0] === "base").length).toBe(
        orders.length / 2,
      );
    }
    expect(measurementOrder(21, "base", 42)).toEqual(
      measurementOrder(21, "base", 42),
    );
    expect(measurementOrder(21, "base", 42)).not.toEqual(
      measurementOrder(21, "base", 9999),
    );
  });
  test("classifies head correctness separately from base/setup failures", async () => {
    for (const side of ["base", "head"]) {
      const bad = worker(side, [], { views: 2 });
      await expect(
        measurePair(
          side === "base" ? bad : worker("base"),
          side === "head" ? bad : worker("head"),
        ),
      ).rejects.toMatchObject({ exitCode: side === "head" ? 3 : 2 });
    }
    await expect(
      measurePair(
        worker("base"),
        worker("head", [], { inputSha256: "changed" }),
      ),
    ).rejects.toMatchObject({ exitCode: 3 });
    const head = worker("head"),
      sample = head.sample;
    let n = 0;
    head.sample = async (request) => ({
      ...(await sample(request)),
      sha256: `${n++}`,
    });
    await expect(measurePair(worker("base"), head)).rejects.toMatchObject({
      exitCode: 3,
    });
  });
  test("historical machine differences warn; high load warns without changing policy", () => {
    const baseline = {
      format: "thermite-perf-baseline/1",
      revision: "historical",
      machine: { cpu: "old" },
      measurement: {
        rows: ["machine-demo", "conveyor-line"].flatMap((name) =>
          ["compile", "packet"].map((operation) => ({
            name,
            operation,
            views: name === "machine-demo" ? 12 : 4,
            baseMedianMs: 100,
            headMedianMs: 100,
          })),
        ),
      },
    };
    expect(() => validateBaseline(baseline)).not.toThrow();
    const machine = { cpu: "new", logicalCpus: 10 };
    expect(contextWarnings(baseline, machine, [6, 2, 1])).toHaveLength(2);
    expect(
      contextWarnings({ ...baseline, machine }, machine, [5, 2, 1]),
    ).toHaveLength(0);
    baseline.measurement.rows.pop();
    expect(() => validateBaseline(baseline)).toThrow();
  });
});
