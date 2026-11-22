import type { Diagnostic } from "@thermite/schema";

// Complete reviewed expectations, independent of the production formatter.
export const validationGateExpectations = {
  exclusive: {
    file: "system.json",
    line: 4,
    column: 14,
    jsonPointer: "/project",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: E201 topology gate: skipped E300, E301, E302, W902, W303, I304, I305 on 1 net: ["FIRST.T, SECOND.T, TARGET.E [net:sha256:8db87843938ddcb1105ed9a0b1489ebf4e67a234c8c0325878ffccee913cdbf5]"].',
  },
  unavailable: {
    file: "system.json",
    line: 1,
    column: 108,
    jsonPointer: "/libraries/0/name",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: project loading/structural gate (E032); skipped library-lock verification, reference resolution (E1xx), W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (2 items: ["system.json:1:108 /libraries/0/name", "system.json:1:162 /libraries/1/version"]); net IDs are unavailable before trustworthy IR exists.',
  },
  missing: {
    file: "system.json",
    line: 1,
    column: 1,
    jsonPointer: "",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: project loading/structural gate (E001); skipped library-lock verification, reference resolution (E1xx), W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (1 item: ["system.json:1:1"]); net IDs are unavailable before trustworthy IR exists.',
  },
  typeOnly: {
    file: "connections/field-terminations.json",
    line: 24,
    column: 40,
    jsonPointer: "/objects/1/endpoints/1/terminal",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: resolution gate (E102); skipped W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (2 items: ["uid 4f3f64e8-af7c-4b5d-9cbc-250368ad3e75 at connections/field-terminations.json:24:40 /objects/1/endpoints/1/terminal", "uid c2dccef7-ec9d-48dc-b58b-6e0dd990dd51 at connections/field-terminations.json:37:40 /objects/2/endpoints/0/terminal"]); net IDs are unavailable before trustworthy IR exists.',
  },
  shippedMutation: {
    file: "@thermite/core-library/types/breaker-3p.json",
    line: 1,
    column: 1,
    jsonPointer: "",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: library lock gate (E108); skipped reference resolution (E1xx), W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (1 item: ["@thermite/core-library/types/breaker-3p.json:1:1"]); net IDs are unavailable before trustworthy IR exists.',
  },
  shippedRemoval: {
    file: "electrical-system.lock.json",
    line: 11,
    column: 16,
    jsonPointer: "/libraries/core/files",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: library lock gate (E107); skipped reference resolution (E1xx), W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (1 item: ["electrical-system.lock.json:11:16 /libraries/core/files"]); net IDs are unavailable before trustworthy IR exists.',
  },
  shippedVersion: {
    file: "system.json",
    line: 15,
    column: 46,
    jsonPointer: "/libraries/0/version",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: project loading/structural gate (E028); skipped library-lock verification, reference resolution (E1xx), W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (1 item: ["system.json:15:46 /libraries/0/version"]); net IDs are unavailable before trustworthy IR exists.',
  },
  shippedMissing: {
    file: "@thermite/core-library/library.json",
    line: 1,
    column: 1,
    jsonPointer: "",
    code: "I208",
    severity: "info",
    message:
      'Checks not completed: project loading/structural gate (E001); skipped library-lock verification, reference resolution (E1xx), W111 and rules E200, E201, E300, E301, E302, W902, E202, E203, E204, E207, E205, E206, W903, W904, W905, W303, I304, I305 for the whole project. Blocking objects/locations (1 item: ["@thermite/core-library/library.json:1:1"]); net IDs are unavailable before trustworthy IR exists.',
  },
} as const satisfies Record<string, Diagnostic>;
