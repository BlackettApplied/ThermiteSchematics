import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createInMemoryCanonicalSchemaRegistry,
  parseJson,
} from "@thermite/schema";
import {
  analyzeCompleteness,
  compileProject,
  loadProject,
} from "../src/index.js";
import { device, node, project } from "./validation-fixture.js";

const notes =
  "Reviewed two-point abstract interface; actual-part bonding and additional interfaces are outside this model.";

describe("reviewed generic connection coverage", () => {
  it.each([
    ["generic", "I005", "info"],
    ["partial", "W904", "warning"],
    ["complete", undefined, undefined],
    [undefined, "I003", "info"],
  ] as const)(
    "%s retains its own finding and severity",
    async (status, code, severity) => {
      const type = node({ P: {}, N: {} });
      if (status) type.connectionCoverage = { status, notes };
      const root = await project([device(1, "D1"), device(2, "D2")], [type]);
      const result = await compileProject(root);
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const report = analyzeCompleteness(result.ir);
      const findings = report.findings.filter((f) => f.kind === "model");
      expect(findings.map((f) => [f.designation, f.code, f.severity])).toEqual(
        code
          ? [
              ["D1", code, severity],
              ["D2", code, severity],
            ]
          : [],
      );
      if (status === "generic") {
        const expected = JSON.parse(
          await readFile(
            new URL(
              "../fixtures/completeness/generic/expected.json",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        expect(
          findings.map(({ code, severity, message }) => ({
            code,
            severity,
            message,
          })),
        ).toEqual(expected);
        expect(
          report.findings.filter((f) => f.code === "W904" || f.code === "I003"),
        ).toEqual([]);
        expect(report.counts.partialModels).toBe(0);
        expect(report.counts.unreviewedModels).toBe(0);
      }
    },
  );

  it.each(["manufacturer", "orderNumber", "both"])(
    "rejects exact-part catalog facts (%s) at the status pointer",
    async (field) => {
      const catalog = {
        ...(field !== "orderNumber" ? { manufacturer: "Synthetic" } : {}),
        ...(field !== "manufacturer" ? { orderNumber: "TEST-ONLY" } : {}),
        document: {
          url: "https://example.invalid/test",
          title: "Synthetic",
          revision: "A",
          pages: "1",
        },
      };
      const root = await project(
        [device(1, "D1")],
        [
          {
            ...node({ P: {}, N: {} }),
            catalog,
            connectionCoverage: { status: "generic", notes },
          },
        ],
      );
      const loaded = await loadProject(root);
      expect(loaded.ok).toBe(false);
      const conflict = loaded.diagnostics.find((d) => d.code === "E014")!;
      expect(conflict.message).toContain('"generic"');
      expect(conflict.message).toContain("cannot be combined");
      expect(conflict.message).toContain("exact-part catalog facts");
      expect(conflict.message).toContain("manufacturer, order number");
      expect(conflict.message).toContain("connectionCoverage/status");
      const parsed = parseJson(
        await readFile(`${root}/library/types.json`, "utf8"),
        "library/types.json",
      );
      const catalogPosition = parsed.nodes.get("/types/0/catalog")!.value;
      expect(conflict.related).toEqual([
        {
          file: "library/types.json",
          line: catalogPosition.line,
          column: catalogPosition.column,
          note: expect.stringContaining('"catalog"'),
        },
      ]);

      expect(loaded.diagnostics.filter((d) => d.code === "E014")).toMatchObject(
        [
          {
            code: "E014",
            severity: "error",
            file: "library/types.json",
            jsonPointer: "/types/0/connectionCoverage/status",
            allowed: ["complete", "partial"],
          },
        ],
      );
    },
  );

  it("publishes the generic enum, nonblank notes and exact-part guard in the raw schema", () => {
    const registry = createInMemoryCanonicalSchemaRegistry();
    const validate = registry.ajv.getSchema(
      "https://thermiteschematics.com/schemas/0.1/device-type.schema.json",
    )!;
    const type = {
      ...node({ P: {}, N: {} }),
      connectionCoverage: { status: "generic", notes },
    };
    expect(validate(type)).toBe(true);
    expect(
      validate({
        ...type,
        connectionCoverage: { status: "generic", notes: " \n " },
      }),
    ).toBe(false);
    expect(
      validate({ ...type, connectionCoverage: { status: "generic" } }),
    ).toBe(false);
    const exact = {
      ...type,
      catalog: {
        manufacturer: "Synthetic",
        orderNumber: "TEST",
        document: {
          url: "https://example.invalid/test",
          title: "Synthetic",
          revision: "A",
          pages: "1",
        },
      },
    };
    expect(validate(exact)).toBe(false);
    for (const status of ["partial", "complete"])
      expect(
        validate({ ...exact, connectionCoverage: { status, notes } }),
      ).toBe(true);
    const diagnostic = {
      code: "I005",
      severity: "info",
      message: notes,
      file: "types.json",
      line: 1,
      column: 1,
      jsonPointer: "",
    };
    const validateDiagnostic = registry.ajv.getSchema(
      "https://thermiteschematics.com/schemas/0.1/diagnostic.schema.json",
    )!;
    expect(validateDiagnostic(diagnostic)).toBe(true);
  });
});

it("retains ordinary enum advice for an unknown coverage status with a catalog", () => {
  const registry = createInMemoryCanonicalSchemaRegistry();
  const source = JSON.stringify({
    ...node({ P: {}, N: {} }),
    connectionCoverage: { status: "probably", notes },
    catalog: {
      manufacturer: "Synthetic",
      orderNumber: "TEST",
      document: {
        url: "https://example.invalid/test",
        title: "Synthetic",
        revision: "A",
        pages: "1",
      },
    },
  });
  const parsed = parseJson(source, "type.json");
  const diagnostics = registry.validateEntity("device-type", parsed.value!, {
    file: "type.json",
    nodes: parsed.nodes,
  });
  expect(diagnostics.find((d) => d.code === "E014")).toMatchObject({
    jsonPointer: "/connectionCoverage/status",
    message:
      'Value is not one of the allowed values: ["complete", "partial", "generic"].',
    allowed: ["complete", "partial", "generic"],
  });
  expect(diagnostics.find((d) => d.code === "E014")?.related).toBeUndefined();
});
