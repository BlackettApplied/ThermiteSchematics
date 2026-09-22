import { compareSourceRef } from "../ir.js";
import type {
  EffectivePotentialIntent,
  PotentialElectricalField,
  PotentialElectricalIntent,
  PotentialIntentOrigin,
  RuleContext,
} from "./context.js";

type IrPotential = RuleContext["ir"]["potentials"][number];
type PotentialIntentField = "name" | PotentialElectricalField;

export const POTENTIAL_ELECTRICAL_FIELDS = [
  "nominal_voltage",
  "voltage_type",
  "polarity",
  "current",
  "power",
  "frequency",
] as const satisfies readonly PotentialElectricalField[];

const POTENTIAL_INTENT_FIELDS = [
  "name",
  ...POTENTIAL_ELECTRICAL_FIELDS,
] as const satisfies readonly PotentialIntentField[];

export interface DuplicatePotentialFinding {
  readonly later: IrPotential;
  readonly earliestExactDuplicate: IrPotential;
}

export interface IncompatiblePotentialDeclaration {
  readonly potential: IrPotential;
  readonly fields: readonly PotentialIntentField[];
}

export interface ConflictingPotentialFinding {
  readonly later: IrPotential;
  readonly earlier: readonly IncompatiblePotentialDeclaration[];
  readonly fields: readonly PotentialIntentField[];
}

export interface PotentialAnalysis {
  readonly duplicates: readonly DuplicatePotentialFinding[];
  readonly conflicts: readonly ConflictingPotentialFinding[];
}

const analysisByContext = new WeakMap<RuleContext, PotentialAnalysis>();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePotential(left: IrPotential, right: IrPotential): number {
  return (
    compareSourceRef(left.source, right.source) ||
    compareText(left.uid, right.uid)
  );
}

function hasElectricalField(
  electrical: PotentialElectricalIntent,
  field: PotentialElectricalField,
): boolean {
  return Object.hasOwn(electrical, field);
}

function presentElectricalFields(
  potential: IrPotential,
): PotentialElectricalField[] {
  return POTENTIAL_ELECTRICAL_FIELDS.filter((field) =>
    hasElectricalField(potential.electrical, field),
  );
}

function exactDuplicate(left: IrPotential, right: IrPotential): boolean {
  if (left.name !== right.name) {
    return false;
  }

  const leftFields = presentElectricalFields(left);
  const rightFields = presentElectricalFields(right);

  return (
    leftFields.length === rightFields.length &&
    leftFields.every(
      (field, index) =>
        field === rightFields[index] &&
        left.electrical[field] === right.electrical[field],
    )
  );
}

function conflictingFields(
  earlier: IrPotential,
  later: IrPotential,
): PotentialIntentField[] {
  const fields: PotentialIntentField[] = [];

  if (earlier.name !== later.name) {
    fields.push("name");
  }

  for (const field of POTENTIAL_ELECTRICAL_FIELDS) {
    if (
      hasElectricalField(earlier.electrical, field) &&
      hasElectricalField(later.electrical, field) &&
      earlier.electrical[field] !== later.electrical[field]
    ) {
      fields.push(field);
    }
  }

  return fields;
}

function uniqueConflictingFields(
  incompatible: readonly IncompatiblePotentialDeclaration[],
): PotentialIntentField[] {
  const fields = new Set(
    incompatible.flatMap(({ fields: declarationFields }) => declarationFields),
  );
  return POTENTIAL_INTENT_FIELDS.filter((field) => fields.has(field));
}

function origin(potential: IrPotential): PotentialIntentOrigin {
  return { uid: potential.uid, source: potential.source };
}

function mergeCompatibleDeclarations(
  declarations: readonly IrPotential[],
): EffectivePotentialIntent {
  const earliest = declarations[0];
  if (earliest === undefined) {
    throw new Error("Cannot merge an empty potential declaration set.");
  }

  const electrical: PotentialElectricalIntent = {};
  const electricalOrigins: Partial<
    Record<PotentialElectricalField, PotentialIntentOrigin>
  > = {};

  for (const declaration of declarations) {
    for (const field of POTENTIAL_ELECTRICAL_FIELDS) {
      if (
        !Object.hasOwn(electricalOrigins, field) &&
        hasElectricalField(declaration.electrical, field)
      ) {
        Object.assign(electrical, {
          [field]: declaration.electrical[field],
        });
        electricalOrigins[field] = origin(declaration);
      }
    }
  }

  return {
    name: earliest.name,
    electrical,
    origins: {
      name: origin(earliest),
      electrical: electricalOrigins,
    },
  };
}

export function analyzePotentialDeclarations(
  context: RuleContext,
): PotentialAnalysis {
  const cached = analysisByContext.get(context);
  if (cached !== undefined) {
    return cached;
  }

  const duplicates: DuplicatePotentialFinding[] = [];
  const conflicts: ConflictingPotentialFinding[] = [];
  const nets = [...context.ir.nets].sort((left, right) =>
    compareText(left.id, right.id),
  );

  for (const net of nets) {
    if (context.topologicallyAffectedNetIds.has(net.id)) {
      continue;
    }

    const declarations = context.potentialsForNet(net).sort(comparePotential);
    let netHasConflict = false;

    for (const [index, later] of declarations.entries()) {
      const earlierDeclarations = declarations.slice(0, index);
      const earliestExactDuplicate = earlierDeclarations.find((earlier) =>
        exactDuplicate(earlier, later),
      );

      if (earliestExactDuplicate !== undefined) {
        duplicates.push({ later, earliestExactDuplicate });
      }

      const incompatible = earlierDeclarations.flatMap((earlier) => {
        const fields = conflictingFields(earlier, later);
        return fields.length === 0
          ? []
          : ([
              { potential: earlier, fields },
            ] satisfies IncompatiblePotentialDeclaration[]);
      });

      if (incompatible.length > 0) {
        netHasConflict = true;
        conflicts.push({
          later,
          earlier: incompatible,
          fields: uniqueConflictingFields(incompatible),
        });
      }
    }

    if (netHasConflict) {
      context.conflictingPotentialNetIds.add(net.id);
    } else if (declarations.length > 0) {
      context.effectivePotentialIntentsByNetId.set(
        net.id,
        mergeCompatibleDeclarations(declarations),
      );
    }
  }

  const analysis = { duplicates, conflicts } satisfies PotentialAnalysis;
  analysisByContext.set(context, analysis);
  return analysis;
}
