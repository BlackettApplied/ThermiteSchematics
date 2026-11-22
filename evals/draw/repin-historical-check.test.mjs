import { it, expect } from "vitest";
import { assemble, it0, view } from "./repin-fixture.mjs";
import { prepareRepin } from "./repin-core.mjs";
import { hash, json } from "./support.mjs";

it("prepareRepin derives the measured check key for a historical row", () => {
  const old = it0("old"),
    context = assemble({
      registryItems: [old],
      currentItems: [],
      entries: ({ retire }) => [retire(old, "fixed")],
    }),
    row = context.report.results.find(
      (r) => !r.expectation && r.dq === "DQ-05" && r.viewScope === view,
    );
  row.id += "/sheet-001";
  delete row.check;
  context.reportSha256 = hash(json(context.report));
  context.decisions[0].summarySha256 = context.reportSha256;

  const result = prepareRepin(context);
  expect(result.registry.markers).toEqual([]);
  expect(result.expected.exitCode).toBe(0);
});
