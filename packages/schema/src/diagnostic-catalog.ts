export type DiagnosticProducer = "code" | "parser" | "schema";

export interface DiagnosticCatalogEntry {
  severity: "error" | "warning" | "info";
  producer: DiagnosticProducer;
  meaning: string;
}

export const DIAGNOSTIC_CATALOG = {
  E001: {
    severity: "error",
    producer: "code",
    meaning:
      "File unreadable, I/O or infrastructure failure, or missing manifest; agent failures include sanitized request/tool context.",
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
      "Invalid channel or connector I/O assignment, missing connector I/O address space, or duplicate address within an address space.",
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
  W303: {
    severity: "warning",
    producer: "code",
    meaning:
      "Connected terminals have conflicting comparable declared ratings in a voltage field left undeclared by the net's potentials; no voltage is inferred.",
  },
  I304: {
    severity: "info",
    producer: "code",
    meaning:
      "Connected voltage-rated terminals lack voltage facts in potentials, leaving net voltage compatibility unassessed.",
  },
  I208: {
    severity: "info",
    producer: "code",
    meaning:
      "Validation could not be completed; the diagnostic names blocked or incomplete checks and affected nets or objects.",
  },
  W801: {
    severity: "warning",
    producer: "code",
    meaning:
      "Source patch completed but its write reservation could not be released; verify committed changes before recovering the reservation.",
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
    meaning:
      "A non-deferred required terminal or port has no completed connection.",
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
  W906: {
    severity: "warning",
    producer: "code",
    meaning:
      "Packet coverage: devices appear on no schematic sheet, only in reports or nowhere in the packet.",
  },
  W111: {
    severity: "warning",
    producer: "code",
    meaning:
      "A placed device uses an unknown profile or has functions or terminal roles without cataloged renderer support.",
  },
  I005: {
    severity: "info",
    producer: "code",
    meaning:
      "A reviewed generic connection interface cannot check actual-part terminals beyond the modeled abstract interface; completeness findings include its review notes.",
  },
  I001: {
    severity: "info",
    producer: "code",
    meaning:
      "Completeness inventory: an optional terminal or port is unconnected or has an unfinished cable core, with no unused disposition; spare-only I/O terminals are excluded.",
  },
  I002: {
    severity: "info",
    producer: "code",
    meaning:
      "Completeness inventory: an optional, unconnected terminal or port is explicitly reviewed as intentionally unused.",
  },
  I003: {
    severity: "info",
    producer: "code",
    meaning:
      "Completeness inventory: the device type has no declared connection coverage, so missing physical connections cannot be detected.",
  },
  R001: {
    severity: "error",
    producer: "code",
    meaning:
      "Invalid schematic view request, including unsupported format, flow, family or intent, or a root or target not accepted by that view's mapping rules. A non-cable conductors root instead returns Q002 during cable lookup.",
  },
  R002: {
    severity: "error",
    producer: "code",
    meaning:
      "A rooted view cannot select a complete required path: control input/return, power lane, trace signal/supply, cable conductors or complete load. Read the reported segment and mapping context.",
  },
  R003: {
    severity: "error",
    producer: "code",
    meaning:
      "A selected device type or function has no supported symbol mapping for the requested rooted view family.",
  },
  R004: {
    severity: "error",
    producer: "code",
    meaning:
      "ELK layout output failed validation, such as invalid geometry, endpoints or orthogonal routes. The view cannot be rendered safely from that layout.",
  },
  R005: {
    severity: "error",
    producer: "code",
    meaning:
      "Render text failed preflight: an unpaired surrogate, XML-illegal code point, forbidden single-line character, or an empty or over-160-code-point project name. The error names its owner, field and reason.",
  },
  R006: {
    severity: "error",
    producer: "code",
    meaning:
      "Invalid page or packet request, or an unprintable layout, including unsupported selected circuit mappings and content that cannot fit safely. Renderer errors include reason (invalid-page, invalid-packet or unprintable-layout) and may include details. The CLI also uses R006 without those fields when an SVG output would require multiple sheets; use HTML, PDF or JSON to retain them.",
  },
  Q001: {
    severity: "error",
    producer: "code",
    meaning:
      "No project object matches the selected UID or designation; a diagnostics device/location scope has no matching devices; or continuity could not read or validate its request. Read the message for the failed lookup or request requirement.",
  },
  Q002: {
    severity: "error",
    producer: "code",
    meaning:
      "The resolved object has the wrong kind: neighbors, trace and terminal lookup require a device; cable lookup (also used by conductors views) requires a cable.",
  },
  Q003: {
    severity: "error",
    producer: "code",
    meaning:
      "A display terminal reference cannot be parsed into a device designation and terminal key; use explicit device/terminal parts instead.",
  },
  Q004: {
    severity: "error",
    producer: "code",
    meaning:
      "The resolved device does not declare the requested terminal key. The error supplies declared keys with bounds and a full-list lookup when needed.",
  },
  A001: {
    severity: "error",
    producer: "code",
    meaning:
      "Invalid agent request JSON or request shape/value. The field and reason identify the failure; closed-literal errors include accepted values.",
  },
  A002: {
    severity: "error",
    producer: "code",
    meaning:
      "A source patch operation failed: invalid JSON pointer, forbidden root mutation, missing target, invalid array index or failed test. The error identifies the file, operation index and path.",
  },
  A003: {
    severity: "error",
    producer: "code",
    meaning:
      "Unsafe source patch target: invalid path, duplicate file, non-project-source target or reparse point. Only admitted project source and presentation documents are patch-eligible.",
  },
  A004: {
    severity: "error",
    producer: "code",
    meaning:
      'A request target failed its byte guard, or a project-controlled file (such as system.json, the lock or a library manifest/source) changed during apply; the file need not be a request target and expectedIntegrity from the loaded project can be "missing". Reload the project and retry with refreshed guards, pointers and UUID tests.',
  },
  A005: {
    severity: "error",
    producer: "code",
    meaning:
      "The project's write reservation is held or abandoned. Owner metadata, age and process state describe contention; age alone does not establish abandonment.",
  },
  A006: {
    severity: "error",
    producer: "code",
    meaning:
      "A guarded source patch cannot apply because a document has JSON syntax errors or duplicate keys; the error names the file and parser line/column. Regenerate a corrupt library lock with thermite lock .; repair source, presentation, manifest or library JSON with an ordinary edit, then validate (thermite guide agent-requests).",
  },
  T001: {
    severity: "error",
    producer: "code",
    meaning:
      "The alpha CLI caught an exception and reports its message on stderr, normally exiting 2. In watch, regeneration or polling failures report T001 and the process keeps watching; messages may embed E-code diagnostics. Commander usage failures may instead print plain help/error text with exit 2.",
  },
  INIT000: {
    severity: "error",
    producer: "code",
    meaning:
      "Library runCli only: invalid initialization command syntax; the shipped thermite init does not emit this prefix.",
  },
  INIT001: {
    severity: "error",
    producer: "code",
    meaning:
      "Library initialization (runCli/runInit) only: --name must be 1-160 XML-valid single-line Unicode code points. The shipped thermite init validates this limit first and reports T001 instead.",
  },
  INIT002: {
    severity: "error",
    producer: "code",
    meaning:
      "Library initialization (runCli/runInit) only: --revision must be 1-128 XML-valid single-line Unicode code points. The shipped thermite init enforces 1-96 first and reports T001 instead.",
  },
  INIT003: {
    severity: "error",
    producer: "code",
    meaning: "Initialization failed: current directory inspection failed.",
  },
  INIT004: {
    severity: "error",
    producer: "code",
    meaning:
      "Initialization failed: current directory is not an ordinary directory.",
  },
  INIT005: {
    severity: "error",
    producer: "code",
    meaning: "Initialization failed: packaged starter assets are unavailable.",
  },
  INIT006: {
    severity: "error",
    producer: "code",
    meaning: "Initialization failed: starter preparation failed.",
  },
  INIT007: {
    severity: "error",
    producer: "code",
    meaning: "Initialization failed: final empty-directory check failed.",
  },
  INIT008: {
    severity: "error",
    producer: "code",
    meaning: "Initialization failed: scaffold write failed.",
  },
  INIT009: {
    severity: "error",
    producer: "code",
    meaning:
      "Initialization failed: rollback failed; created entries may remain.",
  },
  INIT010: {
    severity: "error",
    producer: "code",
    meaning: "Initialization failed: concurrent filesystem change detected.",
  },
  INIT011: {
    severity: "error",
    producer: "code",
    meaning:
      "Initialization failed: rollback ownership changed; foreign entries were preserved.",
  },
  INIT012: {
    severity: "error",
    producer: "code",
    meaning: "Initialization failed: created entry identity capture failed.",
  },
  I305: {
    severity: "info",
    producer: "code",
    meaning:
      "Voltage compatibility is unassessed on connected nets with one comparable voltage-rated terminal and no voltage facts in potentials ({summary}). Ratings describe equipment capability; potentials declare net intent. No supply path was assessed.",
  },
  R007: {
    severity: "error",
    producer: "code",
    meaning:
      "Printable font subset exceeds the export byte budget. For SVG, export .html or .pdf instead; for packet HTML, export .pdf instead. The CLI exits 1 without writing the requested file.",
  },
  W907: {
    severity: "warning",
    producer: "code",
    meaning:
      "A redundant contact-state caption has no clear owner-nearest position and was omitted. The contact mark still depicts the authored normal state; the view remains printable.",
  },
} as const satisfies Record<string, DiagnosticCatalogEntry>;

export type DiagnosticCatalogCode = keyof typeof DIAGNOSTIC_CATALOG;
/** Compiler diagnostics stay aligned with diagnostic.schema.json; tool errors are separate. */
export type DiagnosticCode = Extract<
  DiagnosticCatalogCode,
  `E${number}` | `W${number}` | `I${number}`
>;

export const DIAGNOSTIC_CATALOG_CODES = Object.freeze(
  Object.keys(DIAGNOSTIC_CATALOG) as DiagnosticCatalogCode[],
);
export function isDiagnosticCatalogCode(
  code: string,
): code is DiagnosticCatalogCode {
  return Object.hasOwn(DIAGNOSTIC_CATALOG, code);
}
export function isDiagnosticCode(code: string): code is DiagnosticCode {
  return /^[EWI]\d{3}$/.test(code) && isDiagnosticCatalogCode(code);
}
export const DIAGNOSTIC_CODES = Object.freeze(
  DIAGNOSTIC_CATALOG_CODES.filter(isDiagnosticCode),
);
