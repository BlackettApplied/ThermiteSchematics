/** An inline-labelled return loop occupies the same routing bank as the
 * external wires. Its dummy needs its measured height plus edge/node clearance;
 * the old 7 mm bank can otherwise force a sub-millimetre sideways turn. */
export function circuitRoutePitch<
  Conductor extends {
    ends: readonly { deviceUid: string }[];
  },
>(
  conductors: readonly Conductor[],
  labelHeight: (conductor: Conductor) => number,
) {
  const loops = conductors.filter((c) => {
    const owner = c.ends[0]?.deviceUid;
    return c.ends.length === 2 && c.ends.every((t) => t.deviceUid === owner);
  });
  return Math.max(7, ...loops.map((c) => Math.ceil(labelHeight(c) + 4)));
}
