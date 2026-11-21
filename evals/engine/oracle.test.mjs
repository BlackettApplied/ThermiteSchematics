import {
  mutationGateDiagnostics,
  mutationAssessmentDiagnostics,
  baselineAssessmentDiagnostics,
} from "./validation-gate-expectations.mjs";
import { assertLocations } from "./diagnostic-policy.mjs";
import { describe, expect, it } from "vitest";
import {
  authoredPartition,
  oracle,
  assertSyntheticDiagnostics,
} from "./oracle.mjs";
import { verifyCorpus } from "./provenance.mjs";
import assert from "node:assert/strict";
import { probe, portable, temporary, corpus, json, edit } from "./support.mjs";
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { hostname, userInfo } from "node:os";
import { format, resolveConfig } from "prettier";
import { mutationRecipe } from "./seed-mutations.mjs";
import {
  mutationCases,
  mutate,
  evaluateRatingAssessment,
  assertDiagnostics,
  assertBaselineDiagnostics,
} from "./validation.mjs";
import { evaluateDiagnostic } from "./diagnostics.mjs";
import { assess, exitCode } from "./assessment.mjs";
import { expectations } from "./expectations.mjs";
import {
  compileProject,
  loadProject,
  lockProject,
  publicPackage,
  engineRoot,
} from "./engine.mjs";
import {
  containsAlternatives,
  typeAlternatives,
} from "./diagnostic-policy.mjs";

async function typeFixture(id, action) {
  const scenario = (await mutationCases()).find((s) => s.id === id);
  return temporary(async (project) => {
    await mutate(project, scenario);
    const loaded = await loadProject(project);
    assert(loaded.ok);
    const result = await compileProject(project);
    const diagnostic = result.diagnostics.find((d) => d.code === "E103");
    assert(diagnostic);
    const alternatives = loaded.project.libraries
      .flatMap((l) =>
        l.sources.flatMap((s) =>
          s.value.types
            .filter((t) => t.kind === "device_type")
            .map((t) => t.id),
        ),
      )
      .sort();
    return action(diagnostic, alternatives, {
      project: loaded.project,
      engineRoot,
      kind: "device_type",
    });
  });
}

describe("fixed evaluation corpus v1", () => {
  it("pins every intended gate per case and rejects omissions, changed gates and injected info", async () => {
    const cases = await mutationCases();
    expect(Object.keys(mutationGateDiagnostics)).toHaveLength(51);
    for (const scenario of cases) {
      // These descriptor-only controls need a message when the scenario pins
      // the field omitted by a partial potential; real outputs are tested below.
      const diagnostics = scenario.expected.map((d) =>
        scenario.predicate === "partial-potential" && d.code === "W303"
          ? {
              ...d,
              message: `Potential intent on this net does not declare ${scenario.missingField}; voltage compatibility for this field is unassessed.`,
            }
          : d,
      );
      expect(
        () => assertDiagnostics(diagnostics, scenario),
        scenario.id,
      ).not.toThrow();
      const gates = mutationGateDiagnostics[scenario.id];
      if (!gates) continue;
      expect(() =>
        assertDiagnostics(
          scenario.expected.filter((d) => d.code !== "I208"),
          scenario,
        ),
      ).toThrow();
      expect(() =>
        assertDiagnostics(
          scenario.expected.map((d) =>
            d.code === "I208"
              ? { ...d, message: d.message.replace("gate", "invented gate") }
              : d,
          ),
          scenario,
        ),
      ).toThrow();
      expect(() =>
        assertDiagnostics([...scenario.expected, ...gates], scenario),
      ).toThrow();
    }
    const unlisted = cases.find((c) => !mutationGateDiagnostics[c.id]);
    expect(() =>
      assertDiagnostics(
        [...unlisted.expected, mutationGateDiagnostics.exclusive[0]],
        unlisted,
      ),
    ).toThrow();
  });
  it("pins the exclusive I305 and rejects a missing, changed or duplicated summary", async () => {
    expect(Object.keys(mutationAssessmentDiagnostics)).toEqual(["exclusive"]);
    const scenario = (await mutationCases()).find((s) => s.id === "exclusive");
    await temporary(async (project) => {
      await mutate(project, scenario);
      const r = await compileProject(project);
      expect(() => assertDiagnostics(r.diagnostics, scenario)).not.toThrow();
      expect(
        (
          await evaluateDiagnostic(
            "diag/exclusive",
            { diagnostics: r.diagnostics },
            scenario,
            project,
            1,
          )
        ).status,
      ).toBe("pass");
      for (const diagnostics of [
        r.diagnostics.filter((d) => d.code !== "I305"),
        r.diagnostics.map((d) =>
          d.code === "I305" ? { ...d, message: "Supply inferred." } : d,
        ),
        [...r.diagnostics, ...mutationAssessmentDiagnostics.exclusive],
      ])
        expect(() => assertDiagnostics(diagnostics, scenario)).toThrow();
    });
  });
  it.each(["voltage_type", "nominal_voltage"])(
    "requires the partial-potential corpus message to name missing %s",
    async (field) => {
      const scenario = (await mutationCases()).find(
        (s) => s.id === `partial-potential-missing-${field}`,
      );
      expect(scenario.predicate).toBe("partial-potential");
      expect(scenario.missingField).toBe(field);
      await temporary(async (project) => {
        await mutate(project, scenario);
        const result = await compileProject(project);
        expect(result.ok).toBe(true);
        expect(() =>
          assertDiagnostics(result.diagnostics, scenario),
        ).not.toThrow();
        const wrongField =
          field === "voltage_type" ? "nominal_voltage" : "voltage_type";
        for (const message of [
          "No potential declares voltage facts on this net; voltage compatibility is unassessed.",
          `Potential intent on this net does not declare ${wrongField}; voltage compatibility for this field is unassessed.`,
          "Potential intent on this net omits a voltage field.",
        ]) {
          const broken = result.diagnostics.map((d) =>
            d.code === "W303" ? { ...d, message } : d,
          );
          expect(() => assertDiagnostics(broken, scenario)).toThrow(
            /missing field/,
          );
        }
        const row = await evaluateDiagnostic(
          `diag/${scenario.id}`,
          { diagnostics: result.diagnostics },
          scenario,
          project,
          0,
        );
        expect(row.status).toBe("pass");
      }, scenario.fixture);
    },
  );
  it("accepts info locations and exactly the reviewed unassessed baseline nets", () => {
    const ds = baselineAssessmentDiagnostics["without-potentials"];
    expect(() => assertLocations(ds)).not.toThrow();
    expect(() =>
      assertBaselineDiagnostics("without-potentials", ds),
    ).not.toThrow();
    expect(() => assertBaselineDiagnostics("authored-topology", ds)).toThrow();
    expect(() => assertBaselineDiagnostics("without-potentials", [])).toThrow();
    expect(() =>
      assertBaselineDiagnostics(
        "without-potentials",
        ds.map((d) => ({ ...d, message: "A different net is unassessed." })),
      ),
    ).toThrow();
    expect(() =>
      assertLocations(ds.map((d) => ({ ...d, severity: "notice" }))),
    ).toThrow();
  });

  it("hard-fails changed rating fixtures before the V1 assessment boundary", async () => {
    const id = "mutation/ratings-without-potential";
    const evaluate = (result) =>
      probe(id, () =>
        evaluateRatingAssessment(id, result, {
          ok: result.ok,
          exit: result.ok ? 0 : 1,
          diagnostics: result.diagnostics,
        }),
      );
    await temporary(async (project) => {
      const result = await compileProject(project);
      const row = await evaluate(result);
      expect(row.status).toBe("pass");
      expect(row.evidence.ratingConflict.net).toEqual(["N1.a", "N1.b"]);
      expect(row.evidence.netId).toBe(
        result.ir.nets.find((n) => n.terminalIds.length === 2).id,
      );
      for (const brokenDiagnostics of [
        result.diagnostics.filter((d) => d.code !== "W303"),
        result.diagnostics.map((d) =>
          d.code === "W303"
            ? { ...d, message: "Ratings disagree on an unnamed net." }
            : d,
        ),
        result.diagnostics.map((d) =>
          d.code === "W303" ? { ...d, severity: "info" } : d,
        ),
      ])
        expect(
          (await evaluate({ ...result, diagnostics: brokenDiagnostics }))
            .status,
        ).toBe("fail");
      expect(exitCode({ validation: [row] })).toBe(0);
      // Cross-check the IR's potential view as well as net.potentialUids.
      const inconsistent = structuredClone(result);
      inconsistent.ir.potentials.push({
        uid: "a-declared-potential",
        netId: row.evidence.netId,
      });
      expect((await evaluate(inconsistent)).status).toBe("fail");
    }, "ratings-pair");
    for (const scenario of [
      {
        changes: [
          {
            file: "objects.json",
            pointer: "/objects/1/endpoints/1/terminal",
            value: "c",
          },
        ],
      },
      {
        relock: true,
        changes: [
          {
            file: "library/types/node.json",
            pointer: "/types/0/terminals/b/rating",
            value: { nominal_voltage: 24, voltage_type: "DC" },
          },
        ],
      },
      {
        changes: [
          {
            file: "objects.json",
            pointer: "/objects/-",
            value: {
              uid: "00000000-0000-5000-8000-000000000005",
              kind: "potential",
              name: "COVERS",
              at: { device: "N1", terminal: "a" },
              electrical: {},
            },
          },
        ],
      },
    ]) {
      await temporary(async (project) => {
        await mutate(project, scenario);
        const result = await compileProject(project);
        expect(result.ok).toBe(true);
        const broken = await evaluate(result);
        expect(broken.status).toBe("fail");
        expect(exitCode({ validation: [broken] })).toBe(1);
      }, "ratings-pair");
    }
  });
  it("requires exactly the generated type's aggregated W111 diagnostic", () => {
    const warning = {
      code: "W111",
      severity: "warning",
      file: "library/types.json",
      jsonPointer: "/types/0/symbol",
    };
    expect(() => assertSyntheticDiagnostics([warning])).not.toThrow();
    for (const diagnostics of [
      [],
      [warning, warning],
      [{ ...warning, code: "W903" }],
      [{ ...warning, severity: "error" }],
      [{ ...warning, file: "elsewhere.json" }],
      [{ ...warning, jsonPointer: "/types/1/symbol" }],
    ])
      expect(() => assertSyntheticDiagnostics(diagnostics)).toThrow();
  });
  it("retires the V1 marker without weakening the required positive outcome", () => {
    const id = "mutation/ratings-without-potential";
    expect(expectations).not.toHaveProperty(id);
    expect(
      assess(id, { ok: true, exit: 0, diagnostics: [] }, false).status,
    ).toBe("fail");
    const repaired = assess(
      id,
      {
        ok: true,
        exit: 0,
        diagnostics: [{ code: "W303", severity: "warning" }],
      },
      true,
    );
    expect(repaired.status).toBe("pass");
    expect(exitCode({ validation: [repaired] })).toBe(0);
  });
  it("fails unrelated breakage under a registered gap and rejects stale expectations", async () => {
    const scenario = (await mutationCases()).find((s) => s.id === "terminal-0");
    const diagnostic = {
      code: "E102",
      severity: "error",
      message:
        'Device "PS1" of type "core:psu-24vdc" has no terminal "ABSENT".',
      file: "connections/wires.json",
      jsonPointer: "/objects/0/endpoints/0/terminal",
      line: 10,
      column: 23,
    };
    const evaluate = (d) =>
      probe("diag/terminal-0", () =>
        evaluateDiagnostic(
          "diag/terminal-0",
          {
            diagnostics: [
              d,
              ...scenario.expected.filter((e) => e.code === "I208"),
            ],
          },
          scenario,
          undefined,
          1,
        ),
      );
    const hasMarker = Boolean(expectations["diag/terminal-0"]);
    expect((await evaluate(diagnostic)).status).toBe(
      hasMarker ? "xfail" : "fail",
    );
    const broken = await evaluate({ ...diagnostic, line: 0 });
    expect(broken.status).toBe("fail");
    expect(exitCode({ diagnostics: [broken] })).toBe(1);
    expect(
      (
        await evaluate({
          ...diagnostic,
          message: "An unrelated diagnostic regression",
        })
      ).status,
    ).toBe("fail");
    const repaired = await evaluate({
      ...diagnostic,
      allowed: scenario.alternatives,
    });
    expect(repaired.status).toBe(hasMarker ? "xpass" : "pass");
    expect(exitCode({ diagnostics: [{ status: "xpass" }] })).toBe(1);
    expect(exitCode({ diagnostics: [repaired] }, true)).toBe(0);
  });
  it("preserves other rows after infrastructure failure", async () => {
    const rows = [
      await probe("before", () => ({})),
      await probe("bad-round", () => {
        throw new Error("worker failed");
      }),
      await probe("after", () => ({})),
    ];
    expect(rows.map((r) => r.status)).toEqual([
      "pass",
      "infrastructure-error",
      "pass",
    ]);
    expect(exitCode({ contracts: rows }, true)).toBe(2);
  });
  it("keeps failed fixture loading and relocking outside gap assessment", async () => {
    const scenario = (await mutationCases()).find(
      (s) => s.id === "unknown-type-0",
    );
    const report = {
      diagnostics: [
        {
          ...scenario.expected[0],
          line: 1,
          column: 1,
          message: 'Device "PS1" references unknown type "core:absent".',
        },
      ],
    };
    const row = await temporary((project) =>
      probe("diag/unknown-type-0", () =>
        evaluateDiagnostic(
          "diag/unknown-type-0",
          report,
          scenario,
          join(project, "absent"),
          1,
        ),
      ),
    );
    expect(row.status).toBe("fail");
    const relock = await temporary((project) =>
      probe("mutation/unsupported-profile", () =>
        mutate(project, {
          relock: true,
          changes: [{ file: "library/types/node.json", raw: "{" }],
        }),
      ),
    );
    expect(relock.status).toBe("fail");
  });
  it("scrubs owner PIDs, hostnames, users and timestamps from structured and text evidence", () => {
    const owner = {
      pid: 1987654321,
      hostname: hostname(),
      createdAt: "2001-01-01T01:00:00Z",
      ageMs: 11223344,
    };
    const evidence = {
      owner,
      ownerState: "alive",
      message: `owner ${JSON.stringify(owner)} PID 1987654321 user ${userInfo().username}`,
      failure: JSON.stringify({
        error: { owner, message: `owner ${JSON.stringify(owner)}` },
      }),
      nested: {
        hostname: "foreign-private-host",
        message: '"hostname": "foreign-private-host", "pid": 1987654321',
      },
    };
    const scrubbed = portable(evidence);
    const text = JSON.stringify(scrubbed);
    for (const secret of [
      hostname(),
      userInfo().username,
      "1987654321",
      "2001-01-01T01:00:00Z",
      "11223344",
      "foreign-private-host",
    ])
      expect(text).not.toContain(secret);
    expect(scrubbed.ownerState).toBe("alive");
    expect(scrubbed.owner).toEqual({ hostname: "<host>" });
    const windows = "C:\\Users\\private-test-user\\eval";
    expect(portable(JSON.stringify({ path: windows }), windows)).not.toContain(
      "private-test-user",
    );
  });
  it("requires explicit complete alternatives rather than incidental file text", async () => {
    expect(
      containsAlternatives(
        {
          message: "Unsupported kind",
          file: "device/wire/jumper/cable/potential/relation",
        },
        ["device", "wire", "jumper", "cable", "potential", "relation"],
      ),
    ).toBe(false);
    const alternatives = Array.from({ length: 65 }, (_, i) => `test:type-${i}`);
    expect(
      await typeAlternatives(
        { message: "Unknown type; library.json", line: 65, uid: "65" },
        alternatives,
      ),
    ).toBe(false);
    expect(
      await typeAlternatives(
        { message: "64 available types. thermite guide libraries" },
        alternatives,
      ),
    ).toBe(false);
    expect(
      await typeAlternatives(
        { message: "65 available types. thermite guide libraries" },
        alternatives,
      ),
    ).toBe(false);
  });
  it("accepts T2's complete kind-scoped allowed set and requires its exact count", async () => {
    await typeFixture("unknown-type-0", async (d, alternatives, context) => {
      expect(alternatives).not.toContain("core:cable-2pair-shielded");
      expect(await typeAlternatives(d, alternatives, context)).toBe(true);
      expect(
        await typeAlternatives(
          { ...d, allowedCount: d.allowedCount + 1 },
          alternatives,
          context,
        ),
      ).toBe(false);
      expect(
        await typeAlternatives(
          { ...d, allowedCount: undefined },
          alternatives,
          context,
        ),
      ).toBe(false);
      expect(
        await typeAlternatives(
          { ...d, allowed: undefined },
          alternatives,
          context,
        ),
      ).toBe(false);
      expect(
        await typeAlternatives(
          { ...d, allowed: d.allowed.slice(0, 10) },
          alternatives,
          context,
        ),
      ).toBe(false);
      expect(
        await typeAlternatives(
          { ...d, allowed: [...d.allowed, "core:cable-2pair-shielded"] },
          alternatives,
          context,
        ),
      ).toBe(false);
      expect(
        await typeAlternatives(
          { ...d, allowed: [...d.allowed.slice(1), d.allowed[1]] },
          alternatives,
          context,
        ),
      ).toBe(false);
      // The human message deliberately quotes only ten entries. Structured
      // allowed is the complete set and satisfies Helm G2.3.
      expect(d.allowed.length).toBeGreaterThan(10);
      expect(d.message).toContain("and 3 more");
    });
  });
  it("verifies all above-50 lookup files and the complete kind-scoped union", async () => {
    await typeFixture("unknown-type-many", async (d, alternatives, context) => {
      expect(alternatives.length).toBe(64);
      expect(d.allowed.length).toBe(50);
      expect(await typeAlternatives(d, alternatives, context)).toBe(true);
      for (const broken of [
        { ...d, allowedCount: d.allowedCount + 1 },
        { ...d, allowedCount: String(d.allowedCount) },
        { ...d, allowedLookup: undefined },
        { ...d, allowedLookup: "library/library.json" },
        { ...d, allowedLookup: `${d.allowedLookup} and "missing.txt"` },
        {
          ...d,
          allowedLookup: d.allowedLookup.replace(
            ' and "library/library.json"',
            "",
          ),
        },
        {
          ...d,
          allowedLookup: d.allowedLookup.replace(
            "packages/core-library/library/library.json",
            "packages/core-library/library/missing.json",
          ),
        },
        {
          ...d,
          allowedLookup: d.allowedLookup.replace(
            '"device_type"',
            '"cable_type"',
          ),
        },
        { ...d, allowed: [...d.allowed.slice(1), "core:cable-2pair-shielded"] },
      ])
        expect(await typeAlternatives(broken, alternatives, context)).toBe(
          false,
        );
      await rename(
        join(context.project.logicalRootPath, "library/types/node.json"),
        join(context.project.logicalRootPath, "library/types/removed.json"),
      );
      expect(await typeAlternatives(d, alternatives, context)).toBe(false);
    });
  });
  it("keeps mutation recipes byte-synchronized without recording gap markers in the corpus", async () => {
    const actual = await readFile(join(corpus, "mutations.json"), "utf8");
    const options = {
      ...(await resolveConfig(join(corpus, "mutations.json"))),
      parser: "json",
    };
    expect(await format(json(mutationRecipe()), options)).toBe(actual);
    for (const row of await mutationCases()) {
      expect(row).not.toHaveProperty("expectedFail");
      expect(row).not.toHaveProperty("actionable");
      expect(row.predicate).toBeTruthy();
    }
  });
  it("pins the complete shareable fixture inventory", async () => {
    await verifyCorpus();
  });
  it("draws the isolated synthetic function in both flows and rejects a bus with the same mark", async () => {
    await temporary(async (project) => {
      const compiled = await compileProject(project);
      expect(compiled.ok).toBe(true);
      expect(compiled.diagnostics).toEqual([]);
      const { renderSchematicPacket } = await publicPackage("render");
      const node = compiled.ir.devices.find((d) => d.designation === "N1");
      const nets = ["c", "e", "f"].map(
        (key) =>
          compiled.ir.nets.find((net) =>
            net.terminalIds.some(
              (t) => t.deviceUid === node.uid && t.terminalKey === key,
            ),
          ).id,
      );
      expect(new Set(nets).size).toBe(3);
      for (const flow of ["left-to-right", "top-to-bottom"]) {
        const rendered = await renderSchematicPacket(compiled.ir, {
          format: "schematic-packet-request/0.1",
          index: false,
          views: [
            {
              format: "circuit-view-request/0.1",
              title: "Synthetic isolated terminals",
              flow,
              groups: [
                {
                  id: "isolated",
                  conductors: [],
                  functions: [
                    {
                      device: { by: "designation", value: "N1" },
                      key: "isolatedBus",
                    },
                  ],
                },
              ],
            },
          ],
        });
        expect(rendered.ok).toBe(true);
        const f = rendered.value.coverage.functions.find(
          (f) => f.designation === "N1/isolatedBus",
        );
        expect(f.appearances).toHaveLength(1);
        expect(f.terminals.map((t) => t.terminalKey).sort()).toEqual([
          "c",
          "e",
          "f",
        ]);
        expect(rendered.value.sheets[0].svg).toContain("N1");
      }
      await edit(project, "library/types/node.json", (doc) => {
        doc.types[0].functions.isolatedBus.kind = "bus";
      });
      expect((await lockProject(project)).ok).toBe(true);
      const incompatible = await compileProject(project);
      expect(incompatible.ok).toBe(false);
      expect(
        incompatible.diagnostics.some(
          (d) =>
            d.code === "E206" &&
            d.jsonPointer === "/types/0/circuitSymbols/isolatedBus",
        ),
      ).toBe(true);
    });
  });
  it("matches authored net partitions on every example and 300/1500", async () => {
    const rows = await oracle();
    expect(rows.length).toBeGreaterThanOrEqual(27);
    expect(
      Object.keys(expectations).some((id) => id.startsWith("oracle/")),
    ).toBe(false);
    expect(rows.every((row) => !row.gap)).toBe(true);
    expect(rows.filter((row) => row.status !== "pass")).toEqual([]);
  });
  it("keeps functions, relations, loose cores and isolated terminals out of conductive unions", () => {
    const types = new Map([
      [
        "test:contact",
        {
          terminals: { a: {}, b: {}, c: {} },
          functions: {
            contact: { kind: "contact", terminals: ["a", "b"] },
            bus: { kind: "bus", terminals: ["a", "b", "c"] },
          },
        },
      ],
    ]);
    const objects = [
      { kind: "device", uid: "one", designation: "X1", type: "test:contact" },
      { kind: "device", uid: "two", designation: "X2", type: "test:contact" },
      { kind: "relation", from: { device: "X1" }, to: { device: "X2" } },
      {
        kind: "cable",
        conductors: [{ endpoints: [{ device: "X1", terminal: "a" }, null] }],
      },
    ];
    expect(authoredPartition(objects, types).partition).toHaveLength(6);
    objects.push({
      kind: "wire",
      endpoints: [
        { device: "X1", terminal: "a" },
        { device: "X2", terminal: "a" },
      ],
    });
    objects.push({
      kind: "jumper",
      endpoints: [
        { device: "X2", terminal: "a" },
        { device: "X2", terminal: "b" },
      ],
    });
    expect(authoredPartition(objects, types).partition).toHaveLength(4);
    // Removing a real edge changes the partition: a broken compiler cannot pass
    // by returning a fixed terminal count or silently omitting singleton nets.
    objects.pop();
    expect(authoredPartition(objects, types).partition).toHaveLength(5);
    expect(() =>
      authoredPartition([...objects, { kind: "new-conductor" }], types),
    ).toThrow("unknown kind");
  });
});
