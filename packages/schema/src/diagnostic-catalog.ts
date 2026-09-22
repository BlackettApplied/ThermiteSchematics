export type DiagnosticProducer = "code" | "parser" | "schema";

export interface DiagnosticCatalogEntry {
  severity: "error" | "warning";
  producer: DiagnosticProducer;
  meaning: string;
}

export const DIAGNOSTIC_CATALOG = {
  E001: {
    severity: "error",
    producer: "code",
    meaning: "File unreadable, I/O error, or missing manifest.",
  },
  E002: {
    severity: "error",
    producer: "parser",
    meaning: "JSON syntax error.",
  },
  E003: {
    severity: "error",
    producer: "parser",
    meaning: "Duplicate object key.",
  },
  E010: {
    severity: "error",
    producer: "schema",
    meaning: "Missing required property.",
  },
  E011: {
    severity: "error",
    producer: "schema",
    meaning: "Wrong property type.",
  },
  E012: {
    severity: "error",
    producer: "schema",
    meaning: "Unknown property.",
  },
  E013: {
    severity: "error",
    producer: "schema",
    meaning: "Malformed string value or key.",
  },
  E014: {
    severity: "error",
    producer: "schema",
    meaning: "Value is not in the allowed enumeration.",
  },
  E015: {
    severity: "error",
    producer: "schema",
    meaning: "Array cardinality violation.",
  },
  E016: {
    severity: "error",
    producer: "code",
    meaning: "Unknown object kind.",
  },
  E017: {
    severity: "error",
    producer: "code",
    meaning: "Unsupported manifest format version.",
  },
  E020: {
    severity: "error",
    producer: "code",
    meaning: "Duplicate uid.",
  },
  E021: {
    severity: "error",
    producer: "code",
    meaning: "Duplicate conductor id within one cable.",
  },
  E022: {
    severity: "error",
    producer: "code",
    meaning: "Duplicate type id within one library.",
  },
  E023: {
    severity: "error",
    producer: "code",
    meaning: "Duplicate library dependency name in the manifest.",
  },
  E024: {
    severity: "error",
    producer: "code",
    meaning: "Conductive element endpoints are identical.",
  },
  E025: {
    severity: "error",
    producer: "code",
    meaning: "Function references an undeclared terminal key.",
  },
  E026: {
    severity: "error",
    producer: "code",
    meaning: "Internal relation references an undeclared function id.",
  },
  E027: {
    severity: "error",
    producer: "code",
    meaning: "Type id namespace differs from its library name.",
  },
  E028: {
    severity: "error",
    producer: "code",
    meaning: "Manifest dependency metadata differs from library metadata.",
  },
  E029: {
    severity: "error",
    producer: "code",
    meaning: "Library resolved zero type definitions.",
  },
  E030: {
    severity: "error",
    producer: "code",
    meaning: "Internal relation verb is invalid for the function kinds.",
  },
  E031: {
    severity: "error",
    producer: "code",
    meaning: "Duplicate conductor id within one cable type.",
  },
  E032: {
    severity: "error",
    producer: "code",
    meaning:
      "Name/version-only library dependency is unavailable from the shipped library set.",
  },
  E100: {
    severity: "error",
    producer: "code",
    meaning: "Duplicate non-empty project object designation.",
  },
  E101: {
    severity: "error",
    producer: "code",
    meaning: "No unique device exists for a structured device reference.",
  },
  E102: {
    severity: "error",
    producer: "code",
    meaning: "Terminal key is not declared by the resolved device type.",
  },
  E103: {
    severity: "error",
    producer: "code",
    meaning: "Device or cable instance references an unknown type.",
  },
  E104: {
    severity: "error",
    producer: "code",
    meaning: "Device or cable instance references a type of the wrong kind.",
  },
  E105: {
    severity: "error",
    producer: "code",
    meaning: "Required library lock is missing.",
  },
  E106: {
    severity: "error",
    producer: "code",
    meaning: "Library lock dependency metadata differs from the manifest.",
  },
  E107: {
    severity: "error",
    producer: "code",
    meaning: "Current library file set differs from the lock.",
  },
  E108: {
    severity: "error",
    producer: "code",
    meaning: "Current library file bytes differ from the lock.",
  },
  E109: {
    severity: "error",
    producer: "code",
    meaning: "Library aggregate integrity differs from its locked file map.",
  },
  E110: {
    severity: "error",
    producer: "code",
    meaning: "Library lock bytes are not canonical.",
  },
  E200: {
    severity: "error",
    producer: "code",
    meaning:
      "An authored cable conductor id is absent from the resolved selected cable type.",
  },
  E201: {
    severity: "error",
    producer: "code",
    meaning:
      "More than one conductive element lands directly on an explicitly exclusive library terminal.",
  },
  E202: {
    severity: "error",
    producer: "code",
    meaning:
      "Invalid channel assignment or duplicate address within an address space.",
  },
  E203: {
    severity: "error",
    producer: "code",
    meaning:
      "Terminal display order must list each declared terminal exactly once.",
  },
  E204: {
    severity: "error",
    producer: "code",
    meaning: "Invalid, incompatible or multiply occupied communication port.",
  },
  E205: {
    severity: "error",
    producer: "code",
    meaning: "Connection review references an undeclared terminal or port.",
  },
  E206: {
    severity: "error",
    producer: "code",
    meaning:
      "Circuit symbol references an undeclared function or contradicts its kind, terminal count or contact state.",
  },
  E207: {
    severity: "error",
    producer: "code",
    meaning:
      "Connector assembly references invalid or occupied ports, invalid informational pin terminals, or an inconsistent assembly/pin-mapping declaration.",
  },
  E300: {
    severity: "error",
    producer: "code",
    meaning:
      "Two declarations on one derived net have different required names or disagree on an electrical field both specify.",
  },
  E301: {
    severity: "error",
    producer: "code",
    meaning:
      "A conflict-free net's explicit voltage type differs from a connected terminal's explicit voltage-type rating.",
  },
  E302: {
    severity: "error",
    producer: "code",
    meaning:
      "A conflict-free net's positive nominal voltage differs from a connected terminal's positive nominal-voltage rating.",
  },
  W901: {
    severity: "warning",
    producer: "code",
    meaning: "Project source glob matched no files.",
  },
  W902: {
    severity: "warning",
    producer: "code",
    meaning:
      "A later declaration repeats exactly the same potential name and complete electrical intent on the same net.",
  },
  W903: {
    severity: "warning",
    producer: "code",
    meaning: "A required terminal or port has no completed connection.",
  },
  W904: {
    severity: "warning",
    producer: "code",
    meaning: "A device uses an explicitly partial connection model.",
  },
  W905: {
    severity: "warning",
    producer: "code",
    meaning:
      "Connection review records deferred work or contradicts a requirement or connection.",
  },
} as const satisfies Record<string, DiagnosticCatalogEntry>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CATALOG;

export const DIAGNOSTIC_CODES = Object.freeze(
  Object.keys(DIAGNOSTIC_CATALOG) as DiagnosticCode[],
);

export function isDiagnosticCode(code: string): code is DiagnosticCode {
  return Object.hasOwn(DIAGNOSTIC_CATALOG, code);
}
