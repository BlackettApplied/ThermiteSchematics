import { it, expect } from "vitest";
import { assemble, it0 } from "./repin-fixture.mjs";
import { instanceInventory } from "./repin-core.mjs";
import {
  checkIndexedEntries,
  checkReportedSources,
  cropHeader,
  sourcePath,
  entryTokens,
  verificationFact,
} from "./crop-report.mjs";
import { sourceGeometryFixture } from "./crop-source-fixture.mjs";
import { hash } from "./support.mjs";
function fixture() {
  const i = it0("target", { bbox: { x: 1, y: 1, w: 1, h: 1 } }),
    ctx = assemble({
      registryItems: [],
      currentItems: [i],
      entries: ({ add }) => [add(i)],
    });
  const t = instanceInventory(ctx.report, ctx.reportSha256).instances[0],
    scope = t.scope;
  const crop = { path: "evals/out/draw-samples/test.png", sha256: hash("png") };
  const file = {
    summarySha256: ctx.reportSha256,
    entries: [
      {
        action: "new-defect",
        to: { markerId: t.markerId, scope },
        instances: [t.token],
        crop,
      },
    ],
  };
  const row = {
    ...sourceGeometryFixture(),
    capture: "fresh-source",
    path: crop.path,
    reportSha256: ctx.reportSha256,
    token: t.token,
    scope,
    markerId: t.markerId,
    physicalSheet: 1,
    row: t.row,
    text: t.facts.text,
    headerPixels: 86,
    headerLines: cropHeader(t),
    sourceRender: {
      medium: "svg",
      svg: `${scope.case}/sheet-001.svg`,
      svgSha256: hash("source"),
    },
  };
  const reports = new Map([[ctx.reportSha256, ctx.report]]);
  file.entries[0].sourceVerification = verificationFact(row, hash("source"));
  return { file, row, index: { crops: [row] }, reports };
}
it("accepts report-owned scope, token, text, box and source path", () => {
  const c = fixture();
  checkIndexedEntries(c.file, c.index, c.reports);
  checkReportedSources(c.file, c.reports);
});
it.each([
  ["missing capture", (c) => delete c.row.capture, /capture: "fresh-source"/],
  [
    "old capture",
    (c) => (c.row.capture = "pipeline"),
    /capture: "fresh-source"/,
  ],
  ["header", (c) => (c.row.headerLines[3] = "Text B"), /header/],
  ["source containment", (c) => (c.row.sourceBbox.x = 100), /outside/],
  [
    "false matching box",
    (c) => (c.row.instanceBbox = { x: 2, y: 1, w: 1, h: 1 }),
    /box/,
  ],
  ["sheet", (c) => (c.row.physicalSheet = 2), /physical sheet/],
  [
    "case",
    (c) => (c.row.scope = { ...c.row.scope, case: "another-case" }),
    /case\/medium/,
  ],
  [
    "entry case",
    (c) =>
      (c.file.entries[0].to = {
        ...c.file.entries[0].to,
        scope: { ...c.row.scope, case: "other" },
      }),
    /marker\/scope/,
  ],
  [
    "PDF entry",
    (c) =>
      (c.file.entries[0].to = {
        ...c.file.entries[0].to,
        scope: { ...c.row.scope, medium: "pdf" },
      }),
    /PDF-scope entry cannot use SVG/,
  ],
  [
    "token",
    (c) => (c.file.entries[0].instances = ["not-cited"]),
    /entry.s instances/,
  ],
  [
    "source sheet",
    (c) =>
      (c.row.sourceRender.svg = c.row.sourceRender.svg.replace("001", "002")),
    /source path/i,
  ],
  [
    "source case",
    (c) => (c.row.sourceRender.svg = "another/sheet-001.svg"),
    /source path/i,
  ],
  ["marker", (c) => (c.row.markerId = "other"), /marker differs/],
  ["row", (c) => (c.row.row = "other"), /row\/physical/],
  ["text", (c) => (c.row.text = "B"), /text differs/],
  ["report hash", (c) => (c.row.reportSha256 = hash("other")), /token\/report/],
  ["missing index", (c) => (c.index.crops = []), /missing from index/],
  [
    "summary binding",
    (c) => (c.file.summarySha256 = hash("stale")),
    /exact --report/,
  ],
])("refuses indexed %s", (_, edit, error) => {
  const c = fixture();
  edit(c);
  expect(() => checkIndexedEntries(c.file, c.index, c.reports)).toThrow(error);
});
it.each([
  ["medium", (v) => (v.medium = "html"), /medium\/physical/],
  ["sheet", (v) => (v.sheet = 999), /medium\/physical/],
  ["bbox", (v) => (v.instanceBbox.x = 5), /box/],
  ["scope", (v) => (v.scope = { ...v.scope, case: "other" }), /scope/],
  ["marker", (v) => (v.markerId = "other"), /identity/],
  ["row", (v) => (v.row = "other"), /identity/],
  ["text", (v) => (v.text = "false"), /text\/path/],
  ["path", (v) => (v.sourcePath = "other"), /text\/path/],
  ["token", (v) => (v.token = hash("other")), /token\/report/],
])("preview refuses attested %s", (_, edit, error) => {
  const c = fixture();
  edit(c.file.entries[0].sourceVerification);
  expect(() => checkReportedSources(c.file, c.reports)).toThrow(error);
});

it("refuses a crop object without a decision reference", () => {
  const crop = {};
  expect(() => entryTokens({ entries: [] }, crop, crop)).toThrow(
    /Crop has no decision reference/,
  );
});

it("names the delivered PDF packet, never an SVG substitute", () => {
  expect(
    sourcePath({ scope: { case: "fixture", medium: "pdf" }, physicalSheet: 1 }),
  ).toBe("fixture/packet.pdf");
  expect(() =>
    sourcePath({
      scope: { case: "fixture", medium: "PDFKit" },
      physicalSheet: 1,
    }),
  ).toThrow(/medium/);
});
