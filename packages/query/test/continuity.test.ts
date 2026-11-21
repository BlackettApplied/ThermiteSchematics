import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  auditContinuity,
  type ContinuityRequest,
  type TerminalSelector,
} from "../src/index.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const result = await compileProject(
    fileURLToPath(new URL("../../../examples/motor-starter/", import.meta.url)),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  ir = result.ir;
});
const parts = (
  deviceDesignation: string,
  terminalKey: string,
): TerminalSelector => ({ by: "parts", deviceDesignation, terminalKey });
const request = (
  from: TerminalSelector,
  to: TerminalSelector,
): ContinuityRequest => ({
  format: "continuity-check-request/0.1",
  checks: [
    { id: "common", reason: "Explicit project commoning obligation", from, to },
  ],
});

describe("declared physical continuity audit", () => {
  it("recognizes an authored jumper and its transitive wire path without mutating IR or the request", () => {
    const jumper = ir.jumpers[0]!;
    const input = request(
      { by: "id", value: jumper.endpoints[0].terminal },
      { by: "id", value: jumper.endpoints[1].terminal },
    );
    const before = JSON.stringify({ ir, input });
    const report = auditContinuity(ir, input);
    expect(report).toMatchObject({
      passed: true,
      counts: {
        total: 1,
        satisfied: 1,
        missingModeledPath: 0,
        indeterminate: 0,
      },
    });
    expect(report.checks[0]!.from!.netId).toBe(report.checks[0]!.to!.netId);
    expect(report.checks[0]!.from!.terminal).toEqual(
      jumper.endpoints[0].terminal,
    );
    const wire = ir.wires.find((w) =>
      w.endpoints.some(
        (e) =>
          e.terminal.deviceUid === jumper.endpoints[0].terminal.deviceUid &&
          e.terminal.terminalKey === jumper.endpoints[0].terminal.terminalKey,
      ),
    )!;
    const peer = wire.endpoints.find(
      (e) =>
        e.terminal.deviceUid !== jumper.endpoints[0].terminal.deviceUid ||
        e.terminal.terminalKey !== jumper.endpoints[0].terminal.terminalKey,
    )!;
    const chained = auditContinuity(
      ir,
      request(
        { by: "id", value: jumper.endpoints[1].terminal },
        { by: "id", value: peer.terminal },
      ),
    );
    expect(chained.passed).toBe(true);
    (report.checks[0]!.from!.terminal as { terminalKey: string }).terminalKey =
      "changed output";
    expect(JSON.stringify({ ir, input })).toBe(before);
  });

  it("does not traverse contacts, AC/DC conversion or other internal function relationships", () => {
    const checks = [
      [parts("PS1", "+"), parts("PS1", "-")],
      [parts("PS1", "L"), parts("PS1", "+")],
      [parts("PB1", "11"), parts("PB1", "12")],
    ] as const;
    for (const [from, to] of checks) {
      const report = auditContinuity(ir, request(from, to));
      expect(report.checks[0]!.status).toBe("missing-modeled-path");
      expect(report.passed).toBe(false);
      expect(report.checks[0]!.errors).toEqual([]);
    }
  });

  it("includes fully terminated cable cores in physical continuity", () => {
    for (const core of ir.cableConductors) {
      const report = auditContinuity(
        ir,
        request(
          { by: "id", value: core.endpoints[0].terminal },
          { by: "id", value: core.endpoints[1].terminal },
        ),
      );
      expect(report.passed).toBe(true);
    }
    expect(ir.cableConductors.length).toBeGreaterThan(0);
  });

  it("retains uncertainty and query errors for unresolved selectors", () => {
    const report = auditContinuity(
      ir,
      request(parts("UNKNOWN", "P"), parts("PS1", "missing")),
    );
    expect(report).toMatchObject({
      passed: false,
      counts: { indeterminate: 1, satisfied: 0, missingModeledPath: 0 },
    });
    expect(report.checks[0]!.status).toBe("indeterminate");
    expect(report.checks[0]!.errors.map((e) => e.endpoint)).toEqual([
      "from",
      "to",
    ]);
    expect(
      report.checks[0]!.errors.every((e) => e.error.code.startsWith("Q")),
    ).toBe(true);
  });

  it("preserves partial model status while reporting facts about the authored graph", () => {
    const changed = structuredClone(ir);
    changed.deviceTypes.forEach((t) => {
      t.connectionCoverage = {
        status: "partial",
        notes: "Test: incomplete physical inventory",
      };
    });
    const jumper = changed.jumpers[0]!;
    const report = auditContinuity(
      changed,
      request(
        ...(jumper.endpoints.map(
          (e) => ({ by: "id", value: e.terminal }) as TerminalSelector,
        ) as [TerminalSelector, TerminalSelector]),
      ),
    );
    expect(report.passed).toBe(true);
    expect(report.checks[0]!.from!.modelCoverage).toBe("partial");
    expect(report.checks[0]!.to!.modelCoverage).toBe("partial");
    expect(report.limitations.join(" ")).toContain(
      "not proof of a physical wiring defect",
    );
  });

  it("rejects tautological checks, duplicate IDs and malformed requests", () => {
    expect(() =>
      auditContinuity(
        ir,
        request(parts("PS1", "+"), { by: "display", value: "PS1.+" }),
      ),
    ).toThrow("distinct physical terminals");
    const good = request(parts("PS1", "+"), parts("PS1", "-"));
    expect(() =>
      auditContinuity(ir, {
        ...good,
        checks: [...good.checks, ...good.checks],
      }),
    ).toThrow("Duplicate continuity check id");
    for (const bad of [
      null,
      {},
      { ...good, checks: [] },
      { ...good, mode: "functional-supply" },
      {
        ...good,
        checks: [
          {
            ...good.checks[0],
            from: { by: "parts", deviceDesignation: "PS1" },
          },
        ],
      },
      { ...good, checks: [{ ...good.checks[0], reason: " " }] },
    ])
      expect(() => auditContinuity(ir, bad)).toThrow();
  });
});
