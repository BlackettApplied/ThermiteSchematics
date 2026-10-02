import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { createQueryEngine } from "./engine.js";
import type { QueryError, TerminalSelector } from "./types.js";

export interface ContinuityRequest {
  readonly format: "continuity-check-request/0.1";
  readonly checks: readonly {
    readonly id: string;
    readonly reason: string;
    readonly from: TerminalSelector;
    readonly to: TerminalSelector;
  }[];
}
export interface ContinuityEndpoint {
  readonly terminal: TerminalId;
  readonly display: string;
  readonly netId: string;
  readonly modelCoverage: "complete" | "partial" | "unreviewed";
}
export interface ContinuityReport {
  readonly format: "physical-continuity-report/0.1";
  readonly project: string;
  readonly passed: boolean;
  readonly counts: {
    readonly total: number;
    readonly satisfied: number;
    readonly missingModeledPath: number;
    readonly indeterminate: number;
  };
  readonly checks: readonly {
    readonly id: string;
    readonly reason: string;
    readonly status: "satisfied" | "missing-modeled-path" | "indeterminate";
    readonly from?: ContinuityEndpoint;
    readonly to?: ContinuityEndpoint;
    readonly errors: readonly {
      readonly endpoint: "from" | "to";
      readonly error: QueryError;
    }[];
  }[];
  readonly limitations: readonly string[];
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
const keysOnly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, limit = 400): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= limit &&
  !/[\u0000-\u001f\u007f]/u.test(value);
function selector(value: unknown): value is TerminalSelector {
  if (!record(value)) return false;
  if (value.by === "parts")
    return (
      keysOnly(value, ["by", "deviceDesignation", "terminalKey"]) &&
      text(value.deviceDesignation, 2048) &&
      text(value.terminalKey, 2048)
    );
  if (value.by === "display")
    return keysOnly(value, ["by", "value"]) && text(value.value, 2048);
  return (
    value.by === "id" &&
    keysOnly(value, ["by", "value"]) &&
    record(value.value) &&
    keysOnly(value.value, ["deviceUid", "terminalKey"]) &&
    text(value.value.deviceUid, 2048) &&
    text(value.value.terminalKey, 2048)
  );
}
function normalizeRequest(input: unknown): ContinuityRequest {
  if (
    !record(input) ||
    input.format !== "continuity-check-request/0.1" ||
    !keysOnly(input, ["format", "checks"]) ||
    !Array.isArray(input.checks) ||
    input.checks.length < 1 ||
    input.checks.length > 500
  )
    throw new Error(
      "A continuity request requires format continuity-check-request/0.1 and 1–500 explicit checks.",
    );
  const ids = new Set<string>();
  for (const check of input.checks) {
    if (
      !record(check) ||
      !keysOnly(check, ["id", "reason", "from", "to"]) ||
      !text(check.id, 120) ||
      !text(check.reason) ||
      !selector(check.from) ||
      !selector(check.to)
    )
      throw new Error(
        "Each continuity check requires an id, reason and two valid terminal selectors; no inferred path mode is supported.",
      );
    if (ids.has(check.id))
      throw new Error(
        `Duplicate continuity check id ${JSON.stringify(check.id)}.`,
      );
    ids.add(check.id);
  }
  return structuredClone(input) as unknown as ContinuityRequest;
}

/** Audit explicitly authored commoning/bond/feed obligations using physical nets only. */
export function auditContinuity(
  ir: Readonly<ElectricalIr>,
  input: unknown,
): ContinuityReport {
  const request = normalizeRequest(input);
  const query = createQueryEngine(ir);
  const devices = new Map(ir.devices.map((d) => [d.uid, d]));
  const types = new Map(ir.deviceTypes.map((t) => [t.id, t]));
  const checks: ContinuityReport["checks"][number][] = request.checks.map(
    (check) => {
      const from = query.net(check.from),
        to = query.net(check.to);
      const endpoint = (
        result: typeof from,
      ): ContinuityEndpoint | undefined => {
        if (!result.ok) return undefined;
        const terminal = result.value.selectedTerminal;
        const type = types.get(devices.get(terminal.id.deviceUid)!.typeId)!;
        return {
          terminal: { ...terminal.id },
          display: terminal.display,
          netId: result.value.net.id,
          modelCoverage: type.connectionCoverage?.status ?? "unreviewed",
        };
      };
      const a = endpoint(from),
        b = endpoint(to);
      if (
        a &&
        b &&
        a.terminal.deviceUid === b.terminal.deviceUid &&
        a.terminal.terminalKey === b.terminal.terminalKey
      )
        throw new Error(
          `Continuity check ${JSON.stringify(check.id)} requires two distinct physical terminals.`,
        );
      return {
        id: check.id,
        reason: check.reason,
        status:
          !a || !b
            ? "indeterminate"
            : a.netId === b.netId
              ? "satisfied"
              : "missing-modeled-path",
        ...(a ? { from: a } : {}),
        ...(b ? { to: b } : {}),
        errors: [
          ...(!from.ok
            ? [{ endpoint: "from" as const, error: from.error }]
            : []),
          ...(!to.ok ? [{ endpoint: "to" as const, error: to.error }] : []),
        ],
      };
    },
  );
  const counts = {
    total: checks.length,
    satisfied: checks.filter((c) => c.status === "satisfied").length,
    missingModeledPath: checks.filter(
      (c) => c.status === "missing-modeled-path",
    ).length,
    indeterminate: checks.filter((c) => c.status === "indeterminate").length,
  };
  return {
    format: "physical-continuity-report/0.1",
    project: ir.project.name,
    passed: counts.missingModeledPath === 0 && counts.indeterminate === 0,
    counts,
    checks,
    limitations: [
      "Checks are explicit project obligations, not inferred requirements. Only wires, jumpers and fully terminated cable cores join physical nets.",
      "Contacts (including normally closed contacts), coils, windings, channels, loads, sources and internal function relationships are not conductive edges.",
      "Missing-modeled-path means separate nets in the authored graph, not proof of a physical wiring defect. Unmodeled commoning remains outside this analysis.",
      "Unresolved terminal selectors remain indeterminate with their query errors. Partial and unreviewed endpoint model coverage is retained.",
      "Continuity does not prove functional supply traversal, energized state, voltage compatibility, adequate bonding, conductor sizing, protection coordination or machine safety.",
    ],
  };
}
