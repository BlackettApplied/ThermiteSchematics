// Authored P2 predicates. R-code expectations are never learned from render output.
export function renderDiagnosticRecipe() {
  return {
    format: "thermite-eval-render-diagnostics/1.0",
    cases: [
      ...[
        "thermite:pressure-transmitter",
        "iec:indicator-light",
        "thermite:lamp",
      ].map((profile, i) => ({
        id: `unsupported-profile-${i}`,
        probe: "profile",
        profile,
        code: "R002",
        designation: "PLC1",
        functionKey: "do0",
        family: "control",
      })),
      {
        id: "unsupported-root-shape",
        probe: "root-profile",
        code: "R001",
        designation: "K1",
        functionKey: "coil",
        profile: "thermite:lamp",
        family: "control",
      },
      { id: "disconnected-control", probe: "disconnected", code: "R002" },
      {
        id: "trace-root-accepted",
        probe: "trace-root",
        code: "R001",
        reason: "root-not-accepted",
      },
      { id: "layout-conductors", probe: "layout", code: "R004" },
      {
        id: "circuit-profile",
        probe: "circuit-profile",
        code: "R006",
        designation: "PLC1",
        functionKey: "do0",
        profile: "iec:indicator-light",
        family: "circuit",
      },
      { id: "packet-view-context", probe: "packet-view", code: "R006" },
      { id: "circuit-keys", probe: "circuit-keys", code: "R006" },
      {
        id: "compact-hint-succeeds",
        probe: "compact",
        paper: "tabloid",
        rescued: true,
        code: "R006",
      },
      {
        id: "compact-hint-fails",
        probe: "compact",
        paper: "a4",
        rescued: false,
        code: "R006",
      },
      { id: "packet-coverage", probe: "coverage", code: "W906" },
    ],
  };
}
