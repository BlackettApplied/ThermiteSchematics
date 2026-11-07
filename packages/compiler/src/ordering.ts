import type { ConductiveElementId } from "./graph.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const conductiveKindOrder: Record<ConductiveElementId["kind"], number> = {
  wire: 0,
  jumper: 1,
  cable_conductor: 2,
};

export function compareConductiveElementId(
  left: ConductiveElementId,
  right: ConductiveElementId,
): number {
  const kindOrder =
    conductiveKindOrder[left.kind] - conductiveKindOrder[right.kind];

  if (kindOrder !== 0) {
    return kindOrder;
  }

  if (left.kind === "cable_conductor") {
    const rightConductor = right as Extract<
      ConductiveElementId,
      { kind: "cable_conductor" }
    >;
    return (
      compareText(left.cableUid, rightConductor.cableUid) ||
      compareText(left.conductorId, rightConductor.conductorId)
    );
  }

  return compareText(
    left.uid,
    (right as Extract<ConductiveElementId, { kind: typeof left.kind }>).uid,
  );
}
