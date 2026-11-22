import { it, expect } from "vitest";
import { assemble, it0 } from "./repin-fixture.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { cropPlans, pipelineCrops } from "./crop-index.mjs";
function fixture() {
  const i = it0("target", { bbox: { x: 20, y: 40, w: 5, h: 2 } });
  const c = assemble({
    registryItems: [],
    currentItems: [i],
    entries: ({ add }) => [add(i)],
  });
  const t = instanceInventory(c.report, c.reportSha256).instances[0];
  c.report.results.find((r) => r.id === t.row).evidence.crop = "case/crop.png";
  c.report.results.find((r) => r.id === t.row).evidence.cropBbox = {
    x: 17,
    y: 37,
    w: 11,
    h: 8,
  };
  return {
    c,
    file: c.decisions[0],
    reports: new Map([[c.reportSha256, c.report]]),
  };
}
it("reuses the real pipeline crop only when it contains the selected instance", () => {
  const x = fixture();
  const plan = cropPlans(x.file, x.reports)[0];
  expect(plan.pipelineCrop).toBe("case/crop.png");
  expect(plan.t.bbox).toEqual({ x: 20, y: 40, w: 5, h: 2 });
});
it("re-crops the selected instance rather than using the row first crop", () => {
  const x = fixture();
  x.c.report.results.find((r) => r.evidence.crop).evidence.cropBbox = {
    x: 200,
    y: 100,
    w: 10,
    h: 10,
  };
  expect(cropPlans(x.file, x.reports)[0].pipelineCrop).toBeUndefined();
});
it("indexes all pipeline rows and names unsupported PDF rows", () => {
  const x = fixture();
  const r = x.c.report.results.find((r) => r.evidence.crop);
  x.c.report.results.push({ ...r, id: "pdf", medium: "pdf" });
  const a = pipelineCrops(x.c.report, x.c.reportSha256);
  expect(a).toHaveLength(2);
  expect(a[1]).toMatchObject({
    supported: false,
    reason: "PDF row has no exported PDF instance",
  });
});
it("refuses unknown target tokens before creating evidence", () => {
  const x = fixture();
  x.file.entries[0].instances = ["unknown"];
  expect(() => cropPlans(x.file, x.reports)).toThrow(
    /known report instance tokens/,
  );
});
it("refuses a PDF target instead of substituting an SVG crop", () => {
  const x = fixture();
  const r = x.c.report.results.find((r) => r.evidence.crop);
  r.medium = "pdf";
  r.evidence.findings[0].identities[0].medium = "pdf";
  const t = instanceInventory(x.c.report, x.c.reportSha256).instances[0];
  x.file.entries[0].instances = [t.token];
  expect(() => cropPlans(x.file, x.reports)).toThrow(/no pinned PDF source/);
});
it("refuses an instance without exported geometry", () => {
  const x = fixture(),
    r = x.c.report.results.find((r) => r.evidence.crop);
  delete r.evidence.findings[0].bbox;
  const t = instanceInventory(x.c.report, x.c.reportSha256).instances[0];
  x.file.entries[0].instances = [t.token];
  expect(() => cropPlans(x.file, x.reports)).toThrow(/no exported bbox/);
});
it("lists every unsupported entry with its case, view, physical page and marker", () => {
  const a = it0("no-box"),
    b = it0("pdf", { medium: "pdf" });
  const c = assemble({
    registryItems: [],
    currentItems: [a, b],
    entries: ({ add }) => [add(a), add(b)],
  });
  let message;
  try {
    cropPlans(c.decisions[0], new Map([[c.reportSha256, c.report]]));
  } catch (e) {
    message = e.message;
  }
  expect(message).toMatch(/2 entry\(s\)/);
  expect(message).toContain("entry 0 (new-defect)");
  expect(message).toContain("entry 1 (new-defect)");
  for (const text of [
    "case=probe-left-to-right",
    'view="view:io/I/O"',
    "page=1",
    "marker=DQ-05/",
  ])
    expect(message).toContain(text);
  expect(message).toContain("no exported bbox");
  expect(message).toMatch(/entry 1.*no exported bbox/);
});

it("the builder refuses a PDF-scope entry carrying an SVG instance token", () => {
  const c = fixture();
  c.file.entries[0].to.scope = { ...c.file.entries[0].to.scope, medium: "pdf" };
  expect(() => cropPlans(c.file, c.reports)).toThrow(
    /PDF-scope entry cannot use SVG/,
  );
});
