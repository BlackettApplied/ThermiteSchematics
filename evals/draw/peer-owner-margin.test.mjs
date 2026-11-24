import { expect, it } from "vitest";
import { peerReferenceFindings } from "./issued-reference-audit.mjs";
import {
  CONDUCTOR_OWNER_MARGIN_MM,
  OWNER_MARGIN_MM,
} from "./peer-owner-ink.mjs";
import { readReportSummary } from "./report-summary.mjs";
import { EVALS_VERSION } from "./version.mjs";

it("#573 exports OWNER_MARGIN_MM = 0.5, CONDUCTOR_OWNER_MARGIN_MM = 0.25, and bumps checker protocol to 5.46 with 5.45 readability", () => {
  expect(OWNER_MARGIN_MM).toBe(0.5);
  expect(CONDUCTOR_OWNER_MARGIN_MM).toBe(0.25);
  expect(EVALS_VERSION).toBe("5.46");
  const sample = { evalsVersion: "5.45", summary: { "DQ-08": { pass: 1 } } };
  expect(readReportSummary(sample)).toEqual(sample.summary);
});

it("#573 DQ-08 flags equidistant ties and sub-margin notes while passing >= 0.5 mm margins", () => {
  const obl = {
    kind: "conductor-peer",
    source: ["S2.11", "W-CTL-012", "PS1.+"],
    ownerLabel: "S2.11",
    owners: [{ x: 102.82, y: 95.35, w: 1.3, h: 1.3 }],
    supports: [{ x: 72, y: 96, w: 31.47, h: 0 }],
    foreignOwners: [{ x: 128.82, y: 95.35, w: 1.3, h: 1.3 }],
    foreignConductors: [{ x: 145.47, y: 96, w: 20, h: 0 }],
    values: ["W-CTL-012 · S2.11 → PS1.+ 04.B2 (also shown 05.B2)"],
    compactValues: ["→ PS1.+ 04.B2 (also shown 05.B2)"],
  };
  const note = (bbox) => ({
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(obl.source),
    text: obl.values[0],
    painted: true,
    fontSize: 2.5,
    bbox,
  });
  // Exact D-conveyor s07 tie: 2.808 mm from both S2.11 and S2.12, 3.458 mm from both wires.
  const tied = peerReferenceFindings(
    7,
    { texts: [note({ x: 97.255, y: 99.458, w: 60.17, h: 2.295 })] },
    [obl],
  );
  expect(tied.map((f) => f.kind)).toContain(
    "issued-peer-reference-foreign-owner",
  );
  expect(tied[0].minimumMarginMm).toBe(OWNER_MARGIN_MM);
  // Insufficient margin (~0.20 mm): owner gap = 2.808 mm, foreign gap = 3.008 mm.
  expect(
    peerReferenceFindings(
      7,
      { texts: [note({ x: 97.74, y: 99.458, w: 30, h: 2.295 })] },
      [obl],
    ).map((f) => f.kind),
  ).toContain("issued-peer-reference-foreign-owner");
  // Sufficient margin (>= 0.50 mm): owner gap = 2.808 mm, foreign gap = 3.760 mm.
  expect(
    peerReferenceFindings(
      7,
      { texts: [note({ x: 96.32, y: 99.458, w: 30, h: 2.295 })] },
      [obl],
    ),
  ).toEqual([]);
});

it("#573 DQ-08 flags a tie or sub-0.25 mm margin against a foreign conductor and passes >= 0.25 mm", () => {
  const obl = {
    kind: "conductor-peer",
    source: ["PS1.-", "W-CTL-031", "H1.X2"],
    ownerLabel: "PS1.-",
    owners: [{ x: 280, y: 65.46, w: 1, h: 1 }],
    supports: [{ x: 202.44, y: 91.09, w: 83.86, h: 0 }],
    foreignConductors: [{ x: 251.44, y: 65.46, w: 35, h: 0 }],
    values: ["W-CTL-031 · PS1.- → H1.X2 08.B3"],
    compactValues: ["→ H1.X2 08.B3"],
  };
  const note = (bbox) => ({
    peerReference: "conductor-peer",
    peerSource: JSON.stringify(obl.source),
    text: obl.values[0],
    painted: true,
    fontSize: 2.5,
    bbox,
  });
  // Tie: both owner and foreign conductor at y=65.46 are 4.22 mm away.
  const tied = peerReferenceFindings(
    8,
    { texts: [note({ x: 250.41, y: 59.39, w: 37.46, h: 1.85 })] },
    [obl],
  );
  expect(tied).toContainEqual(
    expect.objectContaining({
      kind: "issued-peer-reference-foreign-owner",
      minimumMarginMm: CONDUCTOR_OWNER_MARGIN_MM,
    }),
  );
  // 0.32 mm foreign-conductor margin (>= 0.25 mm) passes.
  const margin032 = {
    ...obl,
    owners: [{ x: 280, y: 65.14, w: 1, h: 1 }],
  };
  expect(
    peerReferenceFindings(
      8,
      { texts: [note({ x: 270, y: 59.39, w: 20, h: 1.85 })] },
      [margin032],
    ),
  ).toEqual([]);
  // Shifting right so foreign conductor ends 4 mm left of note: owner gap 4.22 mm, foreign gap 5.81 mm (+1.59 mm).
  const shifted = {
    ...obl,
    owners: [{ x: 292, y: 65.46, w: 1, h: 1 }],
  };
  expect(
    peerReferenceFindings(
      8,
      { texts: [note({ x: 290.44, y: 59.39, w: 20, h: 1.85 })] },
      [shifted],
    ),
  ).toEqual([]);
});

it("#573 DQ-08 enforces zero-margin nearest-owner rule for siblingOwners while keeping 0.5 mm for foreignOwners", () => {
  const obl = {
    kind: "terminal-interface",
    source: [
      { deviceUid: "k_y", terminalKey: "A1" },
      { deviceUid: "k_y", terminalKey: "14" },
    ],
    ownerLabel: "K-Y A1",
    owners: [{ x: 100, y: 100, w: 1.3, h: 1.3 }],
    siblingOwners: [{ x: 100, y: 108, w: 1.3, h: 1.3 }],
    foreignOwners: [{ x: 130, y: 100, w: 1.3, h: 1.3 }],
    values: ["K-Y · coil terminal A1 → contact terminal 14 07.C4"],
    compactValues: ["→ K-Y contact terminal 14 07.C4"],
  };
  const note = (bbox) => ({
    peerReference: "terminal-interface",
    peerSource: JSON.stringify(obl.source),
    text: obl.values[0],
    painted: true,
    fontSize: 2.5,
    bbox,
  });
  // Closer to sibling A2 (2.086 mm) than owner A1 (2.299 mm) by > INK_ACCURACY_MM -> flagged with minimumMarginMm 0.
  const closerToSibling = peerReferenceFindings(
    5,
    { texts: [note({ x: 100, y: 103.599, w: 20, h: 2.315 })] },
    [obl],
  );
  expect(closerToSibling).toHaveLength(1);
  expect(closerToSibling[0].kind).toBe("issued-peer-reference-foreign-owner");
  expect(closerToSibling[0].minimumMarginMm).toBe(0);

  // Nearer owner A1 (2.0 mm) than sibling A2 (2.39 mm) -> passes with 0.39 mm sibling margin.
  expect(
    peerReferenceFindings(
      5,
      { texts: [note({ x: 100, y: 103.3, w: 20, h: 2.31 })] },
      [obl],
    ),
  ).toEqual([]);
});
