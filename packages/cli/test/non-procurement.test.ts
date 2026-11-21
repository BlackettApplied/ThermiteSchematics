import { expect, it } from "vitest";
import { createQueryEngine } from "@thermite/query";
import { documentationFixture } from "../../query/test/documentation-fixture.js";
import { renderHumanQueryResult } from "../src/query-renderer.js";

it("prints an authored non-procurement reason in human inspection", async () => {
  const ir = await documentationFixture(true);
  const result = createQueryEngine(ir).inspect({
    by: "designation",
    value: "SUP1",
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(renderHumanQueryResult(result.value)).toContain(
    '  not-purchased "Existing site utility; outside purchasing scope"',
  );
  const unflagged = createQueryEngine(ir).inspect({
    by: "designation",
    value: "GEN1",
  });
  if (!unflagged.ok) throw Error(JSON.stringify(unflagged.error));
  expect(renderHumanQueryResult(unflagged.value)).not.toContain(
    "not-purchased",
  );
});
