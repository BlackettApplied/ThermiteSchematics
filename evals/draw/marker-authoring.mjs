import assert from "node:assert/strict";
import { canonical, hash } from "./support.mjs";
import { observations } from "./assessment.mjs";
import { markerId } from "./locators.mjs";
import { compressScopes } from "./marker-scopes.mjs";
import { bands } from "./marker-metrics.mjs";
export const EXPECTATION_BUDGET = 512 * 1024;
export function seed(rows, specs) {
  const groups = new Map();
  const observed = observations(rows);
  const population = observed.flatMap((o) => o.findings);
  for (const observation of observed) {
    if (!groups.has(observation.key)) groups.set(observation.key, []);
    groups.get(observation.key).push(observation);
  }
  return canonical({
    format: "thermite-draw-expectations/2.0",
    markers: [...groups.values()]
      .map((list) => {
        const first = list[0].identity,
          counts = list.map((o) => o.occurrences ?? o.findings.length);
        const scalarBands = bands(
          list.flatMap((o) => o.findings),
          population,
        );
        return {
          id: markerId(first),
          dq: first.dq,
          family: first.family,
          kind: first.kind,
          locator: first.locator,
          check: first.check,
          coarse: list.some((o) => o.identity.coarse),
          scopes: compressScopes(
            list.map((o) => o.unit),
            specs,
          ),
          bands: scalarBands,
          count: [Math.min(...counts), Math.max(...counts)],
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  });
}
export function serializeRegistry(registry) {
  // Shared storage has no semantic effect: each locator remains a readable row.
  const dictionary = (key) =>
    [...new Set(registry.markers.map((m) => JSON.stringify(m[key])))]
      .sort()
      .map(JSON.parse);
  const intern = (key) => {
    const entries = dictionary(key).map((value) => [
      hash(JSON.stringify(value)).slice(0, 8),
      value,
    ]);
    assert.equal(
      new Set(entries.map(([id]) => id)).size,
      entries.length,
      "Shared-data ID collision",
    );
    return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  const scopeSets = intern("scopes"),
    severityBands = intern("bands");
  const scopeIndex = new Map(
    Object.entries(scopeSets).map(([id, value]) => [JSON.stringify(value), id]),
  );
  const bandIndex = new Map(
    Object.entries(severityBands).map(([id, value]) => [
      JSON.stringify(value),
      id,
    ]),
  );
  const groups = new Map();
  for (const m of registry.markers) {
    const { dq, family, kind, check, coarse } = m;
    const key = JSON.stringify({ dq, family, kind, check, coarse });
    if (!groups.has(key)) groups.set(key, []);
    const defect = {
      locator: m.locator,
      scopes: scopeIndex.get(JSON.stringify(m.scopes)),
      bands: bandIndex.get(JSON.stringify(m.bands)),
    };
    if (JSON.stringify(m.count) !== "[1,1]") defect.count = m.count;
    groups.get(key).push(defect);
  }
  const lines = (entries) =>
    Object.entries(entries)
      .map(
        ([key, v]) =>
          "  " + JSON.stringify(key) + ": " + JSON.stringify(v) + ",",
      )
      .join("\n");
  const groupLines = [...groups]
    .sort()
    .map(([key, defects]) => {
      const head = key.slice(0, -1);
      return (
        "  " +
        head +
        ',"defects":[\n' +
        defects
          .sort((a, b) => (a.locator < b.locator ? -1 : 1))
          .map((v) => "    " + JSON.stringify(v) + ",")
          .join("\n") +
        "\n  ]},"
      );
    })
    .join("\n");
  const text = `// Stable defect identities. See README: scopes/bands are shared storage only.
// Band tuple: [allowed minimum, reference minimum, reference maximum, allowed maximum].
import { expandRegistry } from "./marker-data.mjs";
// prettier-ignore
const scopeSets = {
${lines(scopeSets)}
};
// prettier-ignore
const severityBands = {
${lines(severityBands)}
};
// prettier-ignore
const groups = [
${groupLines}
];
export const expectations = expandRegistry(scopeSets, severityBands, groups);
`;
  assert(
    Buffer.byteLength(text) <= EXPECTATION_BUDGET,
    `Expectations exceed ${EXPECTATION_BUDGET} bytes (${Buffer.byteLength(text)}); refine/deduplicate identities`,
  );
  return text;
}
