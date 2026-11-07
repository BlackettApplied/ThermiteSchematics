import {
  machineAssessmentDiagnostics,
  singleRatedExampleDiagnostics,
} from "./validation-gate-expectations.mjs";
// Reviewed example warning inventory. Do not refresh from engine output.
// W903 = authored required connection omitted; W904 = declared partial model;
// W905 = authored deferred work. Any addition, removal or changed message fails.
export const exampleDiagnostics = {
  "assembly-note-bounds": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "R1: Incomplete connection model: Generic connector inventory; no supply or terminal pinout modeled.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "S1: Incomplete connection model: Generic connector interface; cable pin wiring remains unresolved.",
      },
    ],
  },
  "cap-pagination": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "R1: Incomplete connection model: Synthetic connector-only rack; no supply or terminal pinout modeled.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/9",
        code: "W904",
        severity: "warning",
        message:
          "S1: Incomplete connection model: Synthetic connector-only interface; cable pin wiring unresolved.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/10",
        code: "W904",
        severity: "warning",
        message:
          "D1: Incomplete connection model: Synthetic disconnected interface; no power or signal terminals modeled.",
      },
    ],
  },
  "circuit-pagination": {
    classification: "clean",
    rationale: "No diagnostics expected.",
    diagnostics: [],
  },
  "connector-io": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "R1: Incomplete connection model: Connector occupancy does not document cable pin wiring.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W903",
        severity: "warning",
        message:
          "S1: Required terminal S1.M has no connection. Required terminal S1.P has no connection.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "S1: Incomplete connection model: Connector occupancy does not document cable pin wiring.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W903",
        severity: "warning",
        message:
          "S2: Required terminal S2.M has no connection. Required terminal S2.P has no connection.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W904",
        severity: "warning",
        message:
          "S2: Incomplete connection model: Connector occupancy does not document cable pin wiring.",
      },
    ],
  },
  "conveyor-line": {
    classification: "unassessed-single-rated-nets",
    rationale:
      "I305 reports six single-rated physical nets without potential voltage facts, with no supply inference or new warning.",
    diagnostics: singleRatedExampleDiagnostics["conveyor-line"].map(
      ({ code, severity, file, jsonPointer, message }) => ({
        code,
        severity,
        file,
        jsonPointer,
        message,
      }),
    ),
  },
  "functional-symbols": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "AC1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "T1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/2",
        code: "W904",
        severity: "warning",
        message:
          "PS1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/3",
        code: "W904",
        severity: "warning",
        message:
          "SP1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W904",
        severity: "warning",
        message:
          "SL1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/5",
        code: "W904",
        severity: "warning",
        message:
          "LS1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/6",
        code: "W904",
        severity: "warning",
        message:
          "CP1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/7",
        code: "W904",
        severity: "warning",
        message:
          "SO1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/8",
        code: "W904",
        severity: "warning",
        message:
          "X1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Ratings, housing and optional interfaces are unspecified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/24",
        code: "W904",
        severity: "warning",
        message:
          "LD1: Incomplete connection model: Original generic teaching interface; not an exact manufacturer pinout. Optional interfaces and sensor behavior are unspecified.",
      },
    ],
  },
  "machine-demo": {
    classification: "unassessed-rated-net",
    rationale:
      "I304 retains the connected PLC commons; I305 adds nine single-rated nets without potential voltage facts. No new warning or skipped check.",
    diagnostics: [
      ...machineAssessmentDiagnostics,
      ...singleRatedExampleDiagnostics["machine-demo"],
    ].map(({ code, severity, file, jsonPointer, message }) => ({
      code,
      severity,
      file,
      jsonPointer,
      message,
    })),
  },
  "motor-starter": {
    classification: "unassessed-single-rated-nets",
    rationale:
      "I305 reports five single-rated physical nets without potential voltage facts, with no supply inference or new warning.",
    diagnostics: singleRatedExampleDiagnostics["motor-starter"].map(
      ({ code, severity, file, jsonPointer, message }) => ({
        code,
        severity,
        file,
        jsonPointer,
        message,
      }),
    ),
  },
  "network-pagination": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "N01: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "N02: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/2",
        code: "W904",
        severity: "warning",
        message:
          "N03: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/3",
        code: "W904",
        severity: "warning",
        message:
          "N04: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W904",
        severity: "warning",
        message:
          "N05: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/5",
        code: "W904",
        severity: "warning",
        message:
          "N06: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/6",
        code: "W904",
        severity: "warning",
        message:
          "N07: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/7",
        code: "W904",
        severity: "warning",
        message:
          "N08: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/8",
        code: "W904",
        severity: "warning",
        message:
          "N09: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/9",
        code: "W904",
        severity: "warning",
        message:
          "N10: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/10",
        code: "W904",
        severity: "warning",
        message:
          "B1: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/11",
        code: "W904",
        severity: "warning",
        message:
          "B2: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/12",
        code: "W904",
        severity: "warning",
        message:
          "B3: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/13",
        code: "W904",
        severity: "warning",
        message:
          "ISO1: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/14",
        code: "W904",
        severity: "warning",
        message:
          "H1: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/15",
        code: "W904",
        severity: "warning",
        message:
          "H2: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/16",
        code: "W904",
        severity: "warning",
        message:
          "H3: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/17",
        code: "W904",
        severity: "warning",
        message:
          "H4: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/18",
        code: "W904",
        severity: "warning",
        message:
          "H5: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/19",
        code: "W904",
        severity: "warning",
        message:
          "H6: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/20",
        code: "W904",
        severity: "warning",
        message:
          "H7: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/21",
        code: "W904",
        severity: "warning",
        message:
          "H8: Incomplete connection model: Original topology test model; electrical supply and physical pinout are not specified.",
      },
    ],
  },
  "operator-console": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "HMI1: Incomplete connection model: DC input and remote power-switch pins modeled. Verify Ethernet socket aliases and shell bonding attachment; USB/serial and internal headers are not inventoried.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W905",
        severity: "warning",
        message:
          "HMI1: HMI1.CHASSIS has deferred work: Bond conductor shown, but physical shell attachment and conductor acceptance still require manufacturer/installation review.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "PS24: Incomplete connection model: Output boundary only. Source part, input terminals, AC feed, upstream protection and total loading are not modeled.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/2",
        code: "W904",
        severity: "warning",
        message:
          "KP8: Incomplete connection model: X60 pins and both network ports inventoried. Alternate supply commoning and configurable DI/DO behavior are not modeled; require the chosen feed pair on the instance.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/3",
        code: "W904",
        severity: "warning",
        message:
          "XT-MC: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W904",
        severity: "warning",
        message:
          "XT-HMI: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/5",
        code: "W904",
        severity: "warning",
        message:
          "PE-MC: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/5",
        code: "W905",
        severity: "warning",
        message:
          "PE-MC: PE-MC.PE has deferred work: Console bond is connected; upstream main protective bond path remains open.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/6",
        code: "W904",
        severity: "warning",
        message:
          "PE-HMI: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/7",
        code: "W904",
        severity: "warning",
        message:
          "FRAME-HMI: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/8",
        code: "W904",
        severity: "warning",
        message:
          "F-CON: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/9",
        code: "W904",
        severity: "warning",
        message:
          "F-KP8: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/10",
        code: "W904",
        severity: "warning",
        message:
          "F-SL: Incomplete connection model: Proposed logical terminals; exact hardware, terminal capacity and ratings require selection before construction.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/16",
        code: "W904",
        severity: "warning",
        message:
          "SW1: Incomplete connection model: Example communication interface only; supply omitted.",
      },
    ],
  },
  "report-filtering": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "PLC1: Incomplete connection model: Original generic test model; ratings, installed supply and pin mapping are not established.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "PLC2: Incomplete connection model: Original generic test model; ratings, installed supply and pin mapping are not established.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/2",
        code: "W904",
        severity: "warning",
        message:
          "S1: Incomplete connection model: Original generic test model; ratings, installed supply and pin mapping are not established.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/3",
        code: "W904",
        severity: "warning",
        message:
          "S2: Incomplete connection model: Original generic test model; ratings, installed supply and pin mapping are not established.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W904",
        severity: "warning",
        message:
          "DOC1: Incomplete connection model: Original generic test model; ratings, installed supply and pin mapping are not established.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/5",
        code: "W904",
        severity: "warning",
        message:
          "DOC2: Incomplete connection model: Original generic test model; ratings, installed supply and pin mapping are not established.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/8",
        code: "W904",
        severity: "warning",
        message:
          "UNLOC: Incomplete connection model: Original generic test model; ratings, installed supply and pin mapping are not established.",
      },
    ],
  },
  "self-loop-labels": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "S1: Incomplete connection model: Synthetic signal-only block; no supply or installed-device model.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "D1: Incomplete connection model: Synthetic interface; external bridges are explicit wires, not internal commoning.",
      },
    ],
  },
  "topology-coverage": {
    classification: "authored-model-obligations",
    rationale:
      "Teaching fixtures declare partial connection models, required-but-unwired terminals, or deferred connection review; preserve these warnings, not false positives.",
    diagnostics: [
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W903",
        severity: "warning",
        message:
          "R1: Required terminal R1.M has no connection. Required terminal R1.P has no connection.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/0",
        code: "W904",
        severity: "warning",
        message:
          "R1: Incomplete connection model: Connector occupancy does not document cable pin wiring.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W903",
        severity: "warning",
        message:
          "S1: Required terminal S1.M has no connection. Required terminal S1.P has no connection.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/1",
        code: "W904",
        severity: "warning",
        message:
          "S1: Incomplete connection model: Connector occupancy does not document cable pin wiring.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W903",
        severity: "warning",
        message:
          "S2: Required terminal S2.M has no connection. Required terminal S2.P has no connection.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/4",
        code: "W904",
        severity: "warning",
        message:
          "S2: Incomplete connection model: Connector occupancy does not document cable pin wiring.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/9",
        code: "W903",
        severity: "warning",
        message:
          "N3: Required terminal N3.M has no connection. Required terminal N3.P has no connection.",
      },
      {
        file: "source.json",
        jsonPointer: "/objects/9",
        code: "W904",
        severity: "warning",
        message:
          "N3: Incomplete connection model: Connector occupancy does not document cable pin wiring.",
      },
    ],
  },
};
