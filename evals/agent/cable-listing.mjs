import { canonical } from "./source-files.mjs";
// A listing declares its cable identity; source ordering is not an instruction.
export function cableListingMatches(listing, sourceObjects, readCable) {
  const cable = sourceObjects.find(
    (o) =>
      o.kind === "cable" &&
      o.designation === listing?.designation &&
      o.uid === listing?.cableUid,
  );
  return (
    !!cable && canonical(listing) === canonical(readCable(cable.designation))
  );
}
