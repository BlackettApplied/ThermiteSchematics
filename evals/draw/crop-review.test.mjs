import { it, expect } from "vitest";
import { cropPlans } from "./crop-index.mjs";
import {
  checkIndexedEntries,
  checkReportedSources,
  verificationFact,
} from "./crop-report.mjs";
import { mixedCropFixture } from "./crop-review-fixture.mjs";
import { hash } from "./support.mjs";
it.each([false, true])(
  "selects the changed-text instance in either pair order: reverse=%s",
  (reverse) => {
    const c = mixedCropFixture({ reverse });
    const [plan] = cropPlans(c.file, c.reports);
    expect(plan.t.token).toBe(c.b.token);
    expect(plan.pipelineCrop).toBeUndefined();
  },
);
it.each([false, true])(
  "bind refuses the unchanged instance in mixed renames: reverse=%s",
  (reverse) => {
    const c = mixedCropFixture({ reverse });
    expect(() =>
      checkIndexedEntries(c.file, c.indexFor(c.a), c.reports),
    ).toThrow(/changed-text/);
    expect(() =>
      checkIndexedEntries(c.file, c.indexFor(c.b), c.reports),
    ).not.toThrow();
  },
);
it.each([false, true])(
  "refuses mixed renames whose changed instance has no box: reverse=%s",
  (reverse) => {
    const c = mixedCropFixture({ reverse, changedBox: false });
    expect(() => cropPlans(c.file, c.reports)).toThrow(/no exported bbox/);
  },
);
it("refuses W-C11 to W-C17 source substitution despite a matching index hash", () => {
  const c = mixedCropFixture(),
    i = c.indexFor(c.b);
  i.crops[0].sourceRender.svgSha256 = hash(c.source.replace("W-C11", "W-C17"));
  expect(() => checkIndexedEntries(c.file, i, c.reports)).toThrow(
    /hash differs from C1 report/,
  );
});
it("refuses cropped bindings from a report without source hashes", () => {
  const c = mixedCropFixture();
  delete c.report.sourceHashes;
  expect(() => checkIndexedEntries(c.file, c.indexFor(c.b), c.reports)).toThrow(
    /fresh C1.*source hashes/i,
  );
});
it("preview refuses source attestation outside the report's pinned bytes", () => {
  const c = mixedCropFixture(),
    i = c.indexFor(c.b);
  c.entry.sourceVerification = verificationFact(
    i.crops[0],
    hash("substituted source"),
  );
  expect(() => checkReportedSources(c.file, c.reports)).toThrow(
    /hash differs from C1 report/,
  );
});
