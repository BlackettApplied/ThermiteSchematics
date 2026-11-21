import { renderDiagnostics } from "./render-diagnostics.mjs";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { loadProject, engineRoot } from "./engine.mjs";
import {
  mutationCases,
  mutate,
  assertDiagnostics,
  partialPotentialMessageMatches,
} from "./validation.mjs";
import {
  temporary,
  probe,
  cli,
  streams,
  request,
  filePatch,
  patchRequest,
  readJson,
} from "./support.mjs";
import { assess } from "./assessment.mjs";
import {
  assertLocations,
  containsAlternatives,
  typeAlternatives,
} from "./diagnostic-policy.mjs";

// Every row selects an explicit constraint predicate. All location, schema,
// loading and protocol checks are hard assertions before any gap assessment.
export async function actionable(report, scenario, project) {
  // Gate summaries are pinned by assertDiagnostics; actionability evaluates
  // the original seeded authoring errors, not the accompanying stage report.
  const selected = scenario.expected
    .filter((e) => e.code !== "I208")
    .map((e) =>
      report.diagnostics.find((d) =>
        Object.entries(e).every(([k, v]) => isDeepStrictEqual(d[k], v)),
      ),
    );
  assert(selected.every(Boolean), "Every seeded diagnostic must be present");
  const d = selected[0],
    text = d.message;
  const matches = {
    "required-property": () =>
      text.includes(
        `Missing required property ${JSON.stringify(d.jsonPointer.split("/").pop())}`,
      ),
    "property-type": () =>
      /Expected (?:string|array|object|number|boolean) value\./.test(text),
    "unknown-property": () => text.includes('Unknown property "invented"'),
    cardinality: () =>
      /Array has (?:fewer|more) items than allowed\./.test(text),
    "manifest-version": () =>
      text.includes('Unsupported manifest format "electrical-system/99.0"'),
    "duplicate-identity": () =>
      /Duplicate uid ".+"\./.test(text) && d.related?.length > 0,
    "duplicate-designation": () =>
      /Duplicate project designation "X1"/.test(text) && d.related?.length > 0,
    "device-reference": () =>
      text.includes('No unique device has designation "ABSENT"'),
    "type-kind": () =>
      /references type ".+", but it is a (?:device_type|cable_type)/.test(text),
    "duplicate-core": () =>
      text.includes('Duplicate conductor id "1+" within one cable'),
    "identical-endpoints": () =>
      /endpoints must refer to different terminals/.test(text),
    "library-reference": () =>
      text.includes(
        'Function "contact" references undeclared terminal "ABSENT"',
      ),
    "library-lock": () =>
      /Library "eval" file "types\/node.json" integrity does not match the lock/.test(
        text,
      ),
    "cable-id": () =>
      text.includes('conductor "ABSENT"') &&
      /Available conductor IDs:/.test(text) &&
      containsAlternatives(d, ["1+", "1-", "2+", "2-"]),
    "exclusive-landing": () =>
      text.includes('Terminal "N1.d"') &&
      /connection policy "exclusive".*excess direct conductive assignment/.test(
        text,
      ) &&
      d.related?.length > 0,
    "potential-rating": () =>
      /Effective (?:voltage type|nominal voltage).*incompatible with terminal ratings/.test(
        text,
      ) && d.related?.length > 0,
    "potential-conflict": () =>
      /Potential declaration "OTHER" conflicts with earlier declarations.*field "name"/.test(
        text,
      ) && d.related?.length > 0,
    "partial-potential": () =>
      partialPotentialMessageMatches(report.diagnostics, scenario),
    "deferred-connection": () =>
      selected.length === 1 &&
      d.code === "W905" &&
      /Required terminal N1.f is (?:unconnected|dangling)/.test(text) &&
      text.includes("Deferred work: Synthetic feed design is pending.") &&
      d.related?.length > 0,
    "required-connection": () =>
      text.includes("Required terminal N1.f has no connection") &&
      d.related?.length > 0,
    "json-syntax": () => /Unexpected end of JSON input/.test(text),
    "json-duplicate": () => text.includes('Duplicate object key "kind"'),
    terminals: () => containsAlternatives(d, scenario.alternatives),
    allowed: () => containsAlternatives(d, scenario.alternatives),
    kinds: () => containsAlternatives(d, scenario.alternatives),
    "multi-fault": () =>
      selected.length === 2 &&
      selected[0].message.includes('designation "ABSENT"') &&
      containsAlternatives(selected[1], scenario.alternatives),
    types: async () => {
      const loaded = await loadProject(project);
      assert(loaded.ok, "Diagnostic fixture must load before type discovery");
      const types = loaded.project.libraries.flatMap((l) =>
        l.sources.flatMap((s) => s.value.types),
      );
      assert.deepEqual(
        types.map((t) => t.id).sort(),
        scenario.alternatives,
        "Type alternative facts drifted",
      );
      const index = /^\/objects\/(\d+)\/type$/.exec(d.jsonPointer);
      assert(index, "Unknown-type diagnostic must locate an instance type");
      const instance = loaded.project.sources.find((s) => s.file === d.file)
        ?.value.objects[Number(index[1])];
      assert(
        instance && ["device", "cable"].includes(instance.kind),
        "Type alternatives require the authored instance kind",
      );
      const kind = `${instance.kind}_type`;
      const available = types
        .filter((t) => t.kind === kind)
        .map((t) => t.id)
        .sort();
      return typeAlternatives(d, available, {
        project: loaded.project,
        engineRoot,
        kind,
      });
    },
    pattern: async () => {
      const schema = await readJson(
        join(engineRoot, "packages/schema/schemas/common.schema.json"),
      );
      const field = d.jsonPointer.split("/").pop();
      const definition =
        field === "uid" ? "uid" : field === "type" ? "typeId" : "designation";
      const pattern = schema.$defs[definition].pattern;
      return (
        d.pattern === pattern ||
        text.includes(pattern) ||
        text.includes(`common.schema.json#/$defs/${definition}`)
      );
    },
  };
  assert(
    Object.hasOwn(matches, scenario.predicate),
    `Missing actionability predicate ${scenario.id}`,
  );
  return Boolean(await matches[scenario.predicate]());
}
export async function evaluateDiagnostic(id, report, scenario, project, exit) {
  assertLocations(report.diagnostics);
  assertDiagnostics(report.diagnostics, scenario);
  const passed = await actionable(report, scenario, project);
  return assess(
    id,
    {
      family: scenario.family,
      provenance: scenario.provenance,
      exit,
      predicate: scenario.predicate,
      diagnostics: report.diagnostics,
      actionable: passed,
    },
    passed,
  );
}
export async function diagnostics() {
  const rows = [];
  for (const scenario of (await mutationCases()).filter(
    (s) => s.expected.length && s.fixture !== "ratings-pair",
  )) {
    const id = `diag/${scenario.id}`;
    rows.push(
      await probe(id, () =>
        temporary(async (project) => {
          await mutate(project, scenario);
          const exit = scenario.expected.some((d) => d.severity === "error")
            ? 1
            : 0;
          const { report } = streams(
            await cli("validate", request(project)),
            "validate",
            exit,
          );
          return evaluateDiagnostic(id, report, scenario, project, exit);
        }, scenario.fixture ?? "topology"),
      ),
    );
  }
  for (const [name, operations, code, reason] of [
    [
      "patch-pointer",
      [{ op: "replace", path: "/objects/~2", value: "x" }],
      "A002",
      "invalid-pointer",
    ],
    [
      "patch-index",
      [{ op: "replace", path: "/objects/999", value: "x" }],
      "A002",
      "invalid-array-index",
    ],
    [
      "patch-test",
      [{ op: "test", path: "/objects/0/designation", value: "ABSENT" }],
      "A002",
      "test-failed",
    ],
    [
      "patch-op-enum",
      [{ op: "move", path: "/objects/0", from: "/objects/1" }],
      "A001",
      "unsupported-value",
    ],
  ]) {
    const id = `diag/${name}`;
    rows.push(
      await probe(id, () =>
        temporary(async (project) => {
          const file = await filePatch(
            project,
            "devices/equipment.json",
            operations,
          );
          const { report } = streams(
            await cli("apply-source-patch", patchRequest(project, [file])),
            "apply-source-patch",
            1,
          );
          const e = report.error;
          assert.equal(e.code, code);
          assert.equal(e.reason, reason);
          assert.equal(
            e.path ?? e.field,
            code === "A002" ? operations[0].path : "/files/0/operations/0/op",
          );
          assert(typeof e.message === "string");
          const passed =
            code === "A001"
              ? containsAlternatives(e, ["add", "remove", "replace", "test"])
              : e.file === file.path &&
                e.operationIndex === 0 &&
                e.message.includes(JSON.stringify(e.path)) &&
                e.message.includes(reason.replaceAll("-", " "));
          return assess(
            id,
            {
              exit: 1,
              error: e,
              predicate:
                code === "A001"
                  ? "patch-operations"
                  : "patch-location-and-reason",
              provenance: ["EA patch controls"],
              actionable: passed,
            },
            passed,
          );
        }),
      ),
    );
  }
  rows.push(
    await probe("diag/query-terminal", () =>
      temporary(async (project) => {
        const { report } = streams(
          await cli(
            "query",
            request(project, {
              query: {
                operation: "net",
                selector: {
                  by: "parts",
                  deviceDesignation: "PS1",
                  terminalKey: "ABSENT",
                },
              },
            }),
          ),
          "query",
          1,
        );
        const e = report.error;
        assert.equal(e.code, "Q004");
        assert.equal(e.deviceDesignation, "PS1");
        assert.equal(e.terminalKey, "ABSENT");
        const passed = containsAlternatives(e, ["L", "N", "+", "-"]);
        return assess(
          "diag/query-terminal",
          {
            exit: 1,
            error: e,
            predicate: "query-terminal-alternatives",
            provenance: ["EA F7; GI T09"],
            actionable: passed,
          },
          passed,
        );
      }),
    ),
  );
  rows.push(...(await renderDiagnostics()));
  assert(rows.length >= 40);
  return rows;
}
export function actionabilityMetric(rows) {
  const total = rows.length;
  const actionable = rows.filter(
    (r) =>
      ["pass", "xpass"].includes(r.status) && r.evidence?.actionable === true,
  ).length;
  return {
    actionable,
    total,
    percentage: total ? (100 * actionable) / total : 0,
  };
}
