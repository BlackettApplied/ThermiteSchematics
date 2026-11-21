import { expect, it } from "vitest";
import {
  endpointLandingFindings,
  ENDPOINT_LANDING_TOLERANCE_MM,
} from "./endpoint-landings.mjs";
import { doubleLandings } from "./checks.mjs";
const anchor = { x: 103, y: 46.662 };
const terminal = {
  deviceUid: "PE-HMI",
  terminal: "PE",
  point: anchor,
  element: "pe",
  bbox: { x: 102, y: 45, w: 2, h: 2 },
};
const wire = (id, offset = 0, x = 93) => ({
  wire: id,
  conductor: true,
  endpoints: [
    { deviceUid: "s", terminalKey: "PE" },
    { deviceUid: "PE-HMI", terminalKey: "PE" },
  ],
  element: id,
  points: [
    { x, y: anchor.y + offset },
    { x: 103, y: anchor.y + offset },
  ],
  ownedLandings: [
    {
      end: "target",
      deviceUid: "PE-HMI",
      terminal: "PE",
      endpoint: { x: 103, y: anchor.y + offset },
      anchor,
    },
  ],
});
const geometry = (shapes) => ({ shapes, terminals: [terminal] });
it.each([0, 0.00004, ENDPOINT_LANDING_TOLERANCE_MM - 1e-8])(
  "accepts coincident landings with numerical noise %s mm",
  (offset) => {
    expect(endpointLandingFindings(geometry([wire("W-PE01", offset)]))).toEqual(
      [],
    );
  },
);
it.each([0.0101, 0.05, 0.199, 0.338, 0.7])(
  "rejects a %s mm gap below or above the old 0.2 mm search radius",
  (offset) => {
    expect(endpointLandingFindings(geometry([wire("W-PE01", offset)]))).toEqual(
      [
        expect.objectContaining({
          kind: "endpoint-off-owned-anchor",
          toleranceMm: 0.01,
          terminal: "PE",
        }),
      ],
    );
  },
);
it.each([
  "missing-owned-anchor",
  "ambiguous-owned-anchor",
  "invalid-route-port-owner",
])("fails closed on %s", (reason) => {
  const shape = wire("W-PE01");
  shape.ownedLandings[0] = {
    ...shape.ownedLandings[0],
    anchor: undefined,
    reason,
  };
  expect(endpointLandingFindings(geometry([shape]))[0]).toMatchObject({
    kind: "endpoint-landing-ownership-unavailable",
    reason,
  });
});
it.each([0, 0.338])(
  "retains all PE-HMI shared-stub pairs with %s mm offset",
  (offset) => {
    const findings = doubleLandings(
      geometry([
        wire("W-PE01", offset),
        wire("W-PE02", offset, 73),
        wire("W-PE03", offset),
      ]),
    );
    expect(
      findings.filter((f) => f.kind === "merged-double-landing"),
    ).toHaveLength(3);
    expect(
      findings.filter((f) => f.kind === "endpoint-off-owned-anchor"),
    ).toHaveLength(offset ? 3 : 0);
  },
);
it("accepts separate approaches to the owned terminal", () => {
  const other = wire("W-PE02");
  other.points = [{ x: 103, y: 36.662 }, anchor];
  expect(doubleLandings(geometry([wire("W-PE01"), other]))).toEqual([]);
});
