import { ENDPOINT_LANDING_TOLERANCE_MM } from "./endpoint-landings.mjs";
import { pointDistance } from "./review-geometry.mjs";

const sameJogPoint = (a, b) => pointDistance(a, b) < 1e-7;

export function shortRouteJogs(lengths, points, fanIn, tolerance) {
  return lengths
    .map((lengthMm, segment) => ({ lengthMm, segment }))
    .filter(
      ({ lengthMm }, i) =>
        i > 0 &&
        i < lengths.length - 1 &&
        lengthMm > 0.05 &&
        lengthMm < 3 - tolerance &&
        !fanIn.some(
          ([a, b]) =>
            sameJogPoint(a, points[i]) && sameJogPoint(b, points[i + 1]),
        ),
    );
}

/** Match the actual path segment to its measured, owned terminal anchor.
 * Segment identities are taken before viewport clipping and point collapse. */
export function circuitFanInJogs(shape, points, tolerance) {
  if (!shape.circuitGroup || !shape.circuitFanIn) return [];
  return shape.circuitFanIn
    .trim()
    .split(/\s+/)
    .flatMap((marker) => {
      const match = /^(source|target):([0-9]+)$/.exec(marker);
      if (!match) return [];
      const [, end, index] = match;
      const i = Number(index),
        a = points[i],
        b = points[i + 1],
        endpoint = end === "source" ? points[0] : points.at(-1),
        landing = shape.ownedLandings?.find((p) => p.end === end);
      if (
        !a ||
        !b ||
        !landing?.anchor ||
        !landing.physicalTerminal ||
        landing.reason ||
        !shape.endpoints?.some(
          (ep) =>
            ep.deviceUid === landing.deviceUid &&
            ep.terminalKey === landing.terminal,
        ) ||
        pointDistance(endpoint, landing.anchor) >
          ENDPOINT_LANDING_TOLERANCE_MM ||
        [a, b].some(
          (p) => pointDistance(p, landing.physicalTerminal) > 3 + tolerance,
        )
      )
        return [];
      return [[a, b]];
    });
}
