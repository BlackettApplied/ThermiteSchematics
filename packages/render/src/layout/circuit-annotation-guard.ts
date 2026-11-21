import type { NavigationAnnotation } from "../packet/navigation-types.js";

type NullableDistance<T> = Omit<T, "distanceMm"> & {
  distanceMm: number | null;
};
type ReturnLocality = NonNullable<NavigationAnnotation["returnLocality"]>;
/** A guard also consumes serialized issued measurements, where distance may be
 * absent. This does not change NAV's native measurement or electrical types. */
type GuardAnnotation = Omit<
  NavigationAnnotation,
  "locality" | "returnLocality"
> & {
  locality?: NullableDistance<NonNullable<NavigationAnnotation["locality"]>>;
  returnLocality?: Omit<ReturnLocality, "owners"> & {
    owners: readonly NullableDistance<ReturnLocality["owners"][number]>[];
  };
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const textContent = (s: string) => s.trim().replace(/\s+/gu, " ");
// Absorb floating-point drift only; print significance starts at 0.1 mm.
const ANNOTATION_DISTANCE_DRIFT_MM = 1e-3;
const notFarther = (a: number | null, b: number | null, drift: number) =>
  typeof a === "number" &&
  typeof b === "number" &&
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  a >= 0 &&
  b >= 0 &&
  a <= b + drift;

/** Only two self-located labels may retain absent evidence as unchanged.
 * Absence is never closer: one-sided nulls, local labels and return-owner
 * distances require finite, nonnegative evidence and still fail closed. */
function localityNotFarther(
  a: NonNullable<GuardAnnotation["locality"]>,
  b: NonNullable<GuardAnnotation["locality"]>,
  drift: number,
) {
  if (a.distanceMm === null || b.distanceMm === null)
    return (
      a.distanceMm === null &&
      b.distanceMm === null &&
      a.mode === "self-located" &&
      b.mode === "self-located"
    );
  return notFarther(a.distanceMm, b.distanceMm, drift);
}

/** Destinations and located headings follow NAV's final pagination. Source
 * rows, their identities and their electrical facts must remain unchanged. */
function facts(a: GuardAnnotation) {
  return [
    a.role,
    a.ownerOccurrence,
    a.ownerOccurrences,
    a.targets,
    a.primitiveIds,
    a.gangId,
    a.sourceOrigins,
    a.mirror && {
      coil: a.mirror.coil,
      part: a.mirror.part,
      parts: a.mirror.parts,
      rows: a.mirror.rows.map(({ destinations, ...row }) => row),
    },
  ];
}

function returnDistances(
  a: GuardAnnotation,
  b: GuardAnnotation,
  drift: number,
) {
  const before = b.returnLocality,
    after = a.returnLocality;
  if (!before || !after || !Number.isInteger(after.sheet) || after.sheet < 1)
    return false;
  const owners = new Map(before.owners.map((o) => [o.occurrenceId, o]));
  const ids = after.owners.map((o) => o.occurrenceId);
  if (
    owners.size !== before.owners.length ||
    new Set(ids).size !== ids.length ||
    !same([...owners.keys()].sort(), [...b.ownerOccurrences].sort()) ||
    !same([...ids].sort(), [...a.ownerOccurrences].sort())
  )
    return false;
  return after.owners.every((o) => {
    const old = owners.get(o.occurrenceId);
    return !!old && notFarther(o.distanceMm, old.distanceMm, drift);
  });
}

/** Consume NAV's issued, final measurements, never allocator families or boxes.
 * The printed-ink nearest-frame margin remains entirely NAV's policy. */
export function circuitAnnotationGuard(
  candidate: GuardAnnotation,
  original: GuardAnnotation,
  drift = ANNOTATION_DISTANCE_DRIFT_MM,
) {
  if (!same(facts(candidate), facts(original))) return false;
  const a = candidate.locality,
    b = original.locality;
  if (!!a !== !!b) return false;
  if (
    a &&
    b &&
    ((b.mode === "local" && a.mode !== "local") ||
      !localityNotFarther(a, b, drift))
  )
    return false;
  if (candidate.role === "return")
    return returnDistances(candidate, original, drift);
  if (candidate.returnLocality || original.returnLocality) return false;
  if (["mirror", "canonical", "repeat", "mixed"].includes(candidate.role))
    return !!a && !!b;
  if (["contact-notice", "association-unspecified"].includes(candidate.role))
    return textContent(candidate.text) === textContent(original.text);
  return a ? true : same(candidate, original);
}
