import { compareSourceRef } from "../ir.js";
import type {
  EffectivePotentialIntent,
  PotentialIntentOrigin,
  RuleContext,
} from "./context.js";
import { analyzePotentialDeclarations } from "./potential-analysis.js";

type IrTerminal = RuleContext["ir"]["terminals"][number];
type VoltageFacts = NonNullable<IrTerminal["rating"]>;

/** Shared declared-fact comparisons; neither helper infers a voltage. */
export function declaredVoltageTypeMismatch(
  a: VoltageFacts,
  b: VoltageFacts,
): boolean {
  return (
    Object.hasOwn(a, "voltage_type") &&
    Object.hasOwn(b, "voltage_type") &&
    a.voltage_type !== b.voltage_type
  );
}

export function positiveNominalVoltageMismatch(
  a: VoltageFacts,
  b: VoltageFacts,
): boolean {
  return (
    Object.hasOwn(a, "nominal_voltage") &&
    Object.hasOwn(b, "nominal_voltage") &&
    a.nominal_voltage !== undefined &&
    b.nominal_voltage !== undefined &&
    a.nominal_voltage > 0 &&
    b.nominal_voltage > 0 &&
    a.nominal_voltage !== b.nominal_voltage
  );
}

export interface IncompatibleRatedTerminal {
  readonly terminal: IrTerminal;
  readonly display: string;
}

export interface VoltageTypeCompatibilityFinding {
  readonly netId: string;
  readonly effective: EffectivePotentialIntent;
  readonly origin: PotentialIntentOrigin;
  readonly terminals: readonly IncompatibleRatedTerminal[];
}

export interface NominalVoltageCompatibilityFinding {
  readonly netId: string;
  readonly effective: EffectivePotentialIntent;
  readonly origin: PotentialIntentOrigin;
  readonly terminals: readonly IncompatibleRatedTerminal[];
}

export interface TerminalCompatibilityAnalysis {
  readonly voltageType: readonly VoltageTypeCompatibilityFinding[];
  readonly nominalVoltage: readonly NominalVoltageCompatibilityFinding[];
}

const analysisByContext = new WeakMap<
  RuleContext,
  TerminalCompatibilityAnalysis
>();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRatedTerminal(
  left: IncompatibleRatedTerminal,
  right: IncompatibleRatedTerminal,
): number {
  return (
    compareSourceRef(left.terminal.source, right.terminal.source) ||
    compareText(left.display, right.display)
  );
}

function requiredOrigin(
  effective: EffectivePotentialIntent,
  field: "voltage_type" | "nominal_voltage",
): PotentialIntentOrigin {
  const origin = effective.origins.electrical[field];
  if (origin === undefined) {
    throw new Error(
      `Effective potential intent is missing the origin for ${JSON.stringify(field)}.`,
    );
  }
  return origin;
}

export function analyzeTerminalCompatibility(
  context: RuleContext,
): TerminalCompatibilityAnalysis {
  const cached = analysisByContext.get(context);
  if (cached !== undefined) {
    return cached;
  }

  analyzePotentialDeclarations(context);

  const voltageType: VoltageTypeCompatibilityFinding[] = [];
  const nominalVoltage: NominalVoltageCompatibilityFinding[] = [];
  const nets = [...context.ir.nets].sort((left, right) =>
    compareText(left.id, right.id),
  );

  for (const net of nets) {
    const effective = context.effectivePotentialIntentsByNetId.get(net.id);
    if (effective === undefined) {
      continue;
    }

    const incompatibleVoltageTypes: IncompatibleRatedTerminal[] = [];
    const incompatibleNominalVoltages: IncompatibleRatedTerminal[] = [];

    for (const terminal of context.terminalsForNet(net)) {
      const rating = terminal.rating;
      if (rating === undefined) {
        continue;
      }

      const voltageTypeMismatch = declaredVoltageTypeMismatch(
        effective.electrical,
        rating,
      );
      const displayed = {
        terminal,
        display: context.displayTerminal(terminal.id),
      } satisfies IncompatibleRatedTerminal;

      if (voltageTypeMismatch) {
        incompatibleVoltageTypes.push(displayed);
        continue;
      }

      if (positiveNominalVoltageMismatch(effective.electrical, rating)) {
        incompatibleNominalVoltages.push(displayed);
      }
    }

    incompatibleVoltageTypes.sort(compareRatedTerminal);
    incompatibleNominalVoltages.sort(compareRatedTerminal);

    if (incompatibleVoltageTypes.length > 0) {
      voltageType.push({
        netId: net.id,
        effective,
        origin: requiredOrigin(effective, "voltage_type"),
        terminals: incompatibleVoltageTypes,
      });
    }
    if (incompatibleNominalVoltages.length > 0) {
      nominalVoltage.push({
        netId: net.id,
        effective,
        origin: requiredOrigin(effective, "nominal_voltage"),
        terminals: incompatibleNominalVoltages,
      });
    }
  }

  const analysis = {
    voltageType,
    nominalVoltage,
  } satisfies TerminalCompatibilityAnalysis;
  analysisByContext.set(context, analysis);
  return analysis;
}
