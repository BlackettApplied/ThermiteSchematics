import { expect, it } from "vitest";
import { pdfPolicyFixture, pdfPageFixture } from "./pdf-source-fixture.mjs";
import {
  checkPdfPage,
  checkPdfRegion,
  checkPdfInstance,
  checkPdfCapture,
} from "./pdf-source-policy.mjs";
import { pinnedSource, captureSources } from "./source-hashes.mjs";
import { checkIndexedEntries, checkReportedSources } from "./crop-report.mjs";
import { cropPlans } from "./crop-index.mjs";
import { checkSourceVerification } from "./crop-source-policy.mjs";
it.each(["text-below-minimum-em", "iso-cap-height-policy"])(
  "binds report-pinned %s with its exact instance box and classification",
  (kind) => {
    const c = pdfPolicyFixture(kind);
    checkIndexedEntries(c.file, c.index, c.reports);
    c.file.entries[0].sourceVerification = c.v;
    checkReportedSources(c.file, c.reports);
    expect(cropPlans(c.file, c.reports)[0].sourceBbox).toBeNull();
    expect(() =>
      checkSourceVerification({ sourceVerification: c.v }),
    ).not.toThrow();
    expect(c.v.classification).toBe(
      kind === "iso-cap-height-policy" ? "policy-gap" : "drawing",
    );
  },
);
it.each([
  [
    "missing PDF pin",
    (c) => delete c.report.sourceHashes.sheets[0].pdf,
    /no pinned PDF/,
  ],
  ["page", (c) => (c.pin.page.number = 2), /physical page/],
  ["rotation", (c) => (c.pin.page.rotation = 45), /rotation/],
  ["dimensions", (c) => (c.pin.page.widthMm = 253), /dimensions/],
  ["view", (c) => (c.pin.page.view[2] = 0), /page bounds/],
  ["NaN", (c) => (c.pin.page.userUnit = NaN), /page bounds/],
  ["pin backend", (c) => (c.pin.backend = "PDFKit"), /pdf.js backend/],
  ["pin version", (c) => (c.pin.pdfjsVersion = "unknown"), /pdf.js backend/],
  ["pin hash", (c) => (c.pin.sha256 = "wrong"), /ambiguous pinned/],
  ["path", (c) => (c.pin.path = "other/packet.pdf"), /source path differs/],
  [
    "PDFKit finding",
    (c) => (c.report.results[0].evidence.findings[0].backend = "PDFKit"),
    /PDFKit/,
  ],
  [
    "unsupported finding",
    (c) => (c.report.results[0].evidence.findings[0].kind = "missing-pdf-text"),
    /PDFKit/,
  ],
  ["not pdf.js", (c) => (c.report.raster.pdfjs = false), /pdf.js/],
  ["missing box", (c) => delete c.t.bbox, /exported box/],
  [
    "wrong policy class",
    (c) => (c.t.classification = "policy-gap"),
    /classification/,
  ],
])("refuses pinned PDF %s", (_, edit, error) => {
  const c = pdfPolicyFixture();
  edit(c);
  expect(() => pinnedSource(c.report, c.t)).toThrow(error);
});
it.each([
  [
    "substitute medium",
    (c) => (c.row.sourceRender.medium = "svg"),
    /Source path/,
  ],
  [
    "substitute PDF page",
    (c) => (c.row.sourceRender.page = { ...c.pin.page, number: 2 }),
    /page\/backend/,
  ],
  [
    "substitute backend",
    (c) => (c.row.sourceRender.backend = "PDFKit"),
    /page\/backend/,
  ],
  [
    "substitute version",
    (c) => (c.row.sourceRender.pdfjsVersion = "1.0.0"),
    /page\/backend/,
  ],
  [
    "padded crop",
    (c) => (c.row.sourceBbox = { x: 7, y: 7, w: 16, h: 9 }),
    /exactly.*derived/,
  ],
  [
    "classification",
    (c) => (c.row.classification = "policy-gap"),
    /classification/,
  ],
  ["NaN box", (c) => (c.row.sourceBbox.w = NaN), /outside|Nonfinite/],
  [
    "source hash",
    (c) => (c.row.sourceRender.pdfSha256 = "a".repeat(64)),
    /hash differs/,
  ],
])("refuses indexed PDF %s", (_, edit, error) => {
  const c = pdfPolicyFixture();
  edit(c);
  expect(() => checkIndexedEntries(c.file, c.index, c.reports)).toThrow(error);
});
it.each(["pdf", "classification"])(
  "preview rechecks attested %s against the report",
  (field) => {
    const c = pdfPolicyFixture();
    c.file.entries[0].sourceVerification = c.v;
    if (field === "pdf") c.v.pdf = { ...c.v.pdf, pdfjsVersion: "1.0.0" };
    else c.v.classification = "policy-gap";
    expect(() => checkReportedSources(c.file, c.reports)).toThrow(
      /differs from report/,
    );
  },
);
it.each([
  ["number", (p) => (p.number = 0)],
  ["noninteger page", (p) => (p.number = 1.5)],
  ["view NaN", (p) => (p.view[0] = NaN)],
  ["view arity", (p) => p.view.pop()],
  ["negative unit", (p) => (p.userUnit = -1)],
  ["height", (p) => (p.heightMm = 0)],
])("rejects invalid PDF page %s", (_, edit) => {
  const p = pdfPageFixture();
  edit(p);
  expect(() => checkPdfPage(p, 1)).toThrow();
});
it("uses the rotated physical viewport dimensions", () => {
  const p = pdfPageFixture();
  p.rotation = 90;
  [p.widthMm, p.heightMm] = [p.heightMm, p.widthMm];
  expect(() => checkPdfPage(p, 1)).not.toThrow();
  const b = { x: 128, y: 1, w: 1, h: 1 };
  expect(() => checkPdfRegion(p, b, b)).toThrow(/outside/);
});
it.each([
  "implementation",
  "pdfjsVersion",
  "platform",
  "dpi",
  "useSystemFonts",
  "isEvalSupported",
  "externalResources",
])("refuses altered PDF capture %s", (field) => {
  const c = pdfPolicyFixture();
  c.v.capture[field] = undefined;
  expect(() => checkPdfCapture(c.v)).toThrow(/environment/);
});
it("requires a report classification in the PDF attestation", () => {
  const c = pdfPolicyFixture();
  delete c.v.classification;
  expect(() => checkPdfCapture(c.v)).toThrow(/classification/);
});
it("refuses zero-area or foreign geometry", () => {
  const p = pdfPageFixture();
  expect(() =>
    checkPdfRegion(p, { x: 1, y: 1, w: 0, h: 1 }, { x: 1, y: 1, w: 0, h: 1 }),
  ).toThrow();
  const b = { x: 1, y: 1, w: 1, h: 1 };
  expect(() => checkPdfRegion(p, b, { ...b, x: 2 })).toThrow(/outside/);
});
it("PDF archive facts must agree with the retained index", async () => {
  const { checkPdfIndexAttestation } = await import("./pdf-source-policy.mjs"),
    c = pdfPolicyFixture();
  expect(() => checkPdfIndexAttestation(c.row, c.v)).not.toThrow();
  const row = structuredClone(c.row);
  row.sourceRender.page.rotation = 180;
  expect(() => checkPdfIndexAttestation(row, c.v)).toThrow(/archive index/);
});

it("source verification invokes the PDF capture policy", () => {
  const c = pdfPolicyFixture();
  c.v.capture.useSystemFonts = true;
  expect(() => checkSourceVerification({ sourceVerification: c.v })).toThrow(
    /capture environment/,
  );
});

it("new PDF indexes require their shape and format independently of rendering", async () => {
  const { checkIndexCapture } = await import("./crop-source-policy.mjs"),
    c = pdfPolicyFixture();
  delete c.row.cropShape;
  expect(() => checkIndexCapture([c.row])).toThrow(/requires em\+ink/);
  const other = pdfPolicyFixture();
  other.index.format = "thermite-draw-crop-index/2.0";
  expect(() =>
    checkIndexedEntries(other.file, other.index, other.reports),
  ).toThrow(/format 3.0/);
});

it("PDF capture cannot claim v3 with an em-only shape or put an ink shape in a v2 archive", () => {
  const c = pdfPolicyFixture();
  delete c.v.cropShape;
  c.v.sourceBbox = c.v.instanceBbox;
  expect(() => checkPdfCapture(c.v)).toThrow(/requires v3 em\+ink/);
  const d = pdfPolicyFixture();
  d.v.format = "thermite-draw-source-crop/2.0";
  expect(() => checkPdfCapture(d.v, true)).toThrow(/requires v3 em\+ink/);
});
