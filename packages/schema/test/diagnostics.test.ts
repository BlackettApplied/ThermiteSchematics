import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_CATALOG,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_CATALOG_CODES,
  isDiagnosticCode,
  isDiagnosticCatalogCode,
} from "../src/diagnostic-catalog.js";
import { normalizeDiagnostics, type Diagnostic } from "../src/diagnostics.js";
import {
  appendJsonPointer,
  escapeJsonPointerSegment,
  splitJsonPointer,
} from "../src/json-pointer.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_CATALOG_CODES = [
  "E001",
  "E002",
  "E003",
  "E010",
  "E011",
  "E012",
  "E013",
  "E014",
  "E015",
  "E016",
  "E017",
  "E020",
  "E021",
  "E022",
  "E023",
  "E024",
  "E025",
  "E026",
  "E027",
  "E028",
  "E029",
  "E030",
  "E031",
  "E032",
  "E100",
  "E101",
  "E102",
  "E103",
  "E104",
  "E105",
  "E106",
  "E107",
  "E108",
  "E109",
  "E110",
  "E200",
  "E201",
  "E202",
  "E203",
  "E204",
  "E205",
  "E206",
  "E207",
  "E300",
  "E301",
  "E302",
  "W303",
  "I304",
  "I208",
  "W801",
  "W901",
  "W902",
  "W903",
  "W904",
  "W905",
  "W906",
  "W111",
  "I005",
  "I001",
  "I002",
  "I003",
  "R001",
  "R002",
  "R003",
  "R004",
  "R005",
  "R006",
  "Q001",
  "Q002",
  "Q003",
  "Q004",
  "A001",
  "A002",
  "A003",
  "A004",
  "A005",
  "A006",
  "T001",
  "INIT000",
  "INIT001",
  "INIT002",
  "INIT003",
  "INIT004",
  "INIT005",
  "INIT006",
  "INIT007",
  "INIT008",
  "INIT009",
  "INIT010",
  "INIT011",
  "INIT012",
  "I305",
  "R007",
  "W907",
];

const exactE1xxFixtureByCode = {
  E100: "../compiler/fixtures/referential-diagnostics/expected.json",
  E101: "../compiler/fixtures/referential-diagnostics/expected.json",
  E102: "../compiler/fixtures/referential-diagnostics/expected.json",
  E103: "../compiler/fixtures/referential-diagnostics/expected.json",
  E104: "../compiler/fixtures/referential-diagnostics/expected.json",
  E105: "../compiler/fixtures/lock-diagnostics/expected.json",
  E106: "../compiler/fixtures/lock-diagnostics/expected.json",
  E107: "../compiler/fixtures/lock-diagnostics/expected.json",
  E108: "../compiler/fixtures/lock-diagnostics/expected.json",
  E109: "../compiler/fixtures/lock-diagnostics/expected.json",
  E110: "../compiler/fixtures/lock-diagnostics/expected.json",
} as const;

const exactM3FixtureByCode = {
  E207: "../compiler/fixtures/rules/invalid-connector-port/expected.json",
  E206: "../compiler/fixtures/rules/invalid-circuit-symbol/expected.json",
  E205: "../compiler/fixtures/rules/invalid-connection-review/expected.json",
  W903: "../compiler/fixtures/rules/missing-required-connection/expected.json",
  W904: "../compiler/fixtures/rules/partial-connection-model/expected.json",
  W905: "../compiler/fixtures/rules/deferred-connection/expected.json",
  E204: "../compiler/fixtures/rules/invalid-communication-port/expected.json",
  E202: "../compiler/fixtures/rules/invalid-channel-assignment/expected.json",
  E203: "../compiler/fixtures/rules/invalid-terminal-order/expected.json",
  E200: "../compiler/fixtures/rules/invalid-cable-conductor/expected.json",
  E201: "../compiler/fixtures/rules/exclusive-terminal-second-wire/expected.json",
  E300: "../compiler/fixtures/rules/conflicting-potential-name/expected.json",
  E301: "../compiler/fixtures/rules/voltage-type-mismatch/expected.json",
  E302: "../compiler/fixtures/rules/nominal-voltage-mismatch/expected.json",
  W902: "../compiler/fixtures/rules/exact-duplicate-potential/expected.json",
} as const;

async function findExpectedSidecars(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);

      if (entry.isDirectory()) {
        return findExpectedSidecars(path);
      }

      return entry.isFile() && entry.name === "expected.json" ? [path] : [];
    }),
  );

  return paths.flat();
}

describe("diagnostic catalog", () => {
  it("contains the original diagnostic codes and alpha documentation extensions", () => {
    expect(DIAGNOSTIC_CATALOG_CODES).toEqual(EXPECTED_CATALOG_CODES);
    expect(DIAGNOSTIC_CATALOG.W901.severity).toBe("warning");
    expect(DIAGNOSTIC_CATALOG.W902.severity).toBe("warning");
    expect(
      DIAGNOSTIC_CATALOG_CODES.filter(
        (code) => DIAGNOSTIC_CATALOG[code].severity === "error",
      ),
    ).toHaveLength(DIAGNOSTIC_CATALOG_CODES.length - 17);
  });

  it("keeps compiler diagnostics separate from the full lookup catalog", () => {
    expect(DIAGNOSTIC_CODES.every((code) => /^[EWI]\d{3}$/.test(code))).toBe(
      true,
    );
    for (const code of ["R001", "Q001", "A004", "A006", "T001", "INIT012"]) {
      expect(isDiagnosticCode(code)).toBe(false);
      expect(isDiagnosticCatalogCode(code)).toBe(true);
    }
  });

  it("covers every code with an invalid-fixture sidecar except unit-tested E001, E032, W801 and render W906/W907", async () => {
    const sidecars = (
      await Promise.all([
        findExpectedSidecars(join(packageRoot, "fixtures/invalid")),
        findExpectedSidecars(join(packageRoot, "../cli/fixtures")),
        findExpectedSidecars(join(packageRoot, "../compiler/fixtures")),
      ])
    ).flat();
    const coveredCodes = new Set<string>();

    for (const sidecar of sidecars) {
      const expected = JSON.parse(await readFile(sidecar, "utf8")) as Array<{
        code: string;
      }>;

      for (const diagnostic of expected) {
        coveredCodes.add(diagnostic.code);
      }
    }

    expect([...coveredCodes].sort()).toEqual(
      DIAGNOSTIC_CODES.filter(
        (code) =>
          /^[EWI]/.test(code) &&
          !["I001", "I002", "I003"].includes(code) &&
          code !== "E001" &&
          code !== "E032" &&
          code !== "W801" &&
          code !== "W906" &&
          code !== "W907",
      ).sort(),
    );
    expect(DIAGNOSTIC_CATALOG.E032).toEqual({
      severity: "error",
      producer: "code",
      meaning:
        "Name/version-only library dependency is unavailable from the shipped library set.",
    });
  });

  it("maps every catalogued E1xx producer to an exact anchored fixture", async () => {
    const e1xxCodes = DIAGNOSTIC_CODES.filter((code) => /^E1\d\d$/u.test(code));

    expect(Object.keys(exactE1xxFixtureByCode).sort()).toEqual(
      [...e1xxCodes].sort(),
    );

    for (const code of e1xxCodes) {
      const relativeFixture =
        exactE1xxFixtureByCode[code as keyof typeof exactE1xxFixtureByCode];
      const expected = JSON.parse(
        await readFile(join(packageRoot, relativeFixture), "utf8"),
      ) as Array<{
        code: string;
        file: string;
        line: number;
        column: number;
        jsonPointer: string;
      }>;
      const anchored = expected.filter(
        (diagnostic) =>
          diagnostic.code === code &&
          typeof diagnostic.file === "string" &&
          Number.isInteger(diagnostic.line) &&
          Number.isInteger(diagnostic.column) &&
          typeof diagnostic.jsonPointer === "string",
      );

      expect(anchored.length, code).toBeGreaterThan(0);
    }
  });

  it("maps every catalogued M3 rule to exactly one distinct complete fixture", async () => {
    const m3Codes = DIAGNOSTIC_CODES.filter(
      (code) => /^E[23]\d\d$/u.test(code) || /^W90[2-5]$/u.test(code),
    );

    expect(Object.keys(exactM3FixtureByCode).sort()).toEqual(
      [...m3Codes].sort(),
    );
    expect(new Set(Object.values(exactM3FixtureByCode)).size).toBe(
      m3Codes.length,
    );

    for (const code of m3Codes) {
      const relativeFixture =
        exactM3FixtureByCode[code as keyof typeof exactM3FixtureByCode];
      const expected = JSON.parse(
        await readFile(join(packageRoot, relativeFixture), "utf8"),
      ) as Diagnostic[];
      const electrical = expected.filter((d) => d.code !== "I208");
      expect(electrical, code).toHaveLength(1);
      const diagnostic = electrical[0]!;
      expect(diagnostic.code, code).toBe(code);
      expect(diagnostic.severity, code).toBe(DIAGNOSTIC_CATALOG[code].severity);
      expect(typeof diagnostic.message, code).toBe("string");
      expect(typeof diagnostic.file, code).toBe("string");
      expect(Number.isInteger(diagnostic.line), code).toBe(true);
      expect(Number.isInteger(diagnostic.column), code).toBe(true);
      expect(typeof diagnostic.jsonPointer, code).toBe("string");
      if (code !== "E203" && code !== "E206")
        expect(typeof diagnostic.uid, code).toBe("string");
      else expect(diagnostic.uid).toBeUndefined();
      expect(Array.isArray(diagnostic.related), code).toBe(true);
      expect(diagnostic.related?.length, code).toBeGreaterThan(0);
    }
  });
});

describe("diagnostic normalization", () => {
  it("sorts deterministically and deduplicates on code, file, and pointer", () => {
    const diagnostics: Diagnostic[] = [
      {
        code: "E003",
        severity: "error",
        message: "later duplicate",
        file: "b.json",
        line: 9,
        column: 2,
        jsonPointer: "/key",
      },
      {
        code: "E002",
        severity: "error",
        message: "syntax",
        file: "a.json",
        line: 3,
        column: 4,
        jsonPointer: "",
      },
      {
        code: "E003",
        severity: "error",
        message: "earlier duplicate",
        file: "b.json",
        line: 2,
        column: 3,
        jsonPointer: "/key",
      },
      {
        code: "E010",
        severity: "error",
        message: "required",
        file: "b.json",
        line: 2,
        column: 3,
        jsonPointer: "/missing",
      },
    ];

    expect(
      normalizeDiagnostics(diagnostics).map(
        ({ code, file, line, column, jsonPointer, message }) => ({
          code,
          file,
          line,
          column,
          jsonPointer,
          message,
        }),
      ),
    ).toEqual([
      {
        code: "E002",
        file: "a.json",
        line: 3,
        column: 4,
        jsonPointer: "",
        message: "syntax",
      },
      {
        code: "E003",
        file: "b.json",
        line: 2,
        column: 3,
        jsonPointer: "/key",
        message: "earlier duplicate",
      },
      {
        code: "E010",
        file: "b.json",
        line: 2,
        column: 3,
        jsonPointer: "/missing",
        message: "required",
      },
    ]);
  });
});

describe("RFC 6901 helpers", () => {
  it("escapes and splits pointer segments", () => {
    expect(escapeJsonPointerSegment("a~/b")).toBe("a~0~1b");
    expect(appendJsonPointer("/root", "a~/b")).toBe("/root/a~0~1b");
    expect(splitJsonPointer("/root/a~0~1b")).toEqual(["root", "a~/b"]);
  });
});
