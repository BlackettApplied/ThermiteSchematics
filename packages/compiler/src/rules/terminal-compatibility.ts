import { compareSourceRef } from "../ir.js";
import type {
  EffectivePotentialIntent,
  PotentialIntentOrigin,
  RuleContext,
} from "./context.js";
import { analyzePotentialDeclarations } from "./potential-analysis.js";

type IrTerminal = RuleContext["ir"]["terminals"][number];

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

      const effectiveHasVoltageType = Object.hasOwn(
        effective.electrical,
        "voltage_type",
      );
      const ratingHasVoltageType = Object.hasOwn(rating, "voltage_type");
      const voltageTypeMismatch =
        effectiveHasVoltageType &&
        ratingHasVoltageType &&
        effective.electrical.voltage_type !== rating.voltage_type;
      const displayed = {
        terminal,
        display: context.displayTerminal(terminal.id),
      } satisfies IncompatibleRatedTerminal;

      if (voltageTypeMismatch) {
        incompatibleVoltageTypes.push(displayed);
        continue;
      }

      const effectiveHasNominalVoltage = Object.hasOwn(
        effective.electrical,
        "nominal_voltage",
      );
      const ratingHasNominalVoltage = Object.hasOwn(rating, "nominal_voltage");
      const effectiveNominalVoltage = effective.electrical.nominal_voltage;
      const ratedNominalVoltage = rating.nominal_voltage;

      if (
        effectiveHasNominalVoltage &&
        ratingHasNominalVoltage &&
        effectiveNominalVoltage !== undefined &&
        ratedNominalVoltage !== undefined &&
        effectiveNominalVoltage > 0 &&
        ratedNominalVoltage > 0 &&
        effectiveNominalVoltage !== ratedNominalVoltage
      ) {
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
