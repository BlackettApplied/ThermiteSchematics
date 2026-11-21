// Synthetic PDF evidence; these fixtures do not approve any drawing.
import { hash, json } from "./support.mjs";
import { SOURCE_HASH_FORMAT } from "./source-hashes.mjs";
import { instanceInventory } from "./repin-core.mjs";
import { instanceCropRow } from "./crop-index.mjs";
import { cropHeader, verificationFact } from "./crop-report.mjs";
import { sourceVerificationFixture } from "./crop-source-fixture.mjs";
import { PDF_CAPTURE_IMPLEMENTATION } from "./pdf-source-policy.mjs";
import { pdfInkRegion } from "./pdf-ink-policy.mjs";
import { pngFixture } from "./png-fixture.mjs";
export const pdfPageFixture = () => ({
  number: 1,
  view: [0, 0, 720, 360],
  userUnit: 1,
  rotation: 0,
  widthMm: 254,
  heightMm: 127,
});
export function pdfPolicyFixture(kind = "text-below-minimum-em") {
  const bbox = { x: 10, y: 10, w: 10, h: 3 },
    page = pdfPageFixture(),
    version = "6.5.438";
  const pin = {
    path: "example/packet.pdf",
    sha256: hash("PDF"),
    backend: "pdf.js",
    pdfjsVersion: version,
    page,
  };
  const classification =
    kind === "iso-cap-height-policy" ? "policy-gap" : "drawing";
  const report = {
    cases: ["example"],
    raster: { pdfjs: true, pdfkit: false },
    sourceHashes: {
      format: SOURCE_HASH_FORMAT,
      sheets: [{ case: "example", sheet: 1, pdf: pin }],
    },
    results: [
      {
        id: "pdf-row",
        status: "fail",
        case: "example",
        dq: "DQ-02",
        sheet: 1,
        medium: "pdf",
        classification,
        evidence: {
          crop: "example/pipeline.png",
          cropBbox: { x: 7, y: 7, w: 16, h: 9 },
          findings: [
            {
              kind,
              medium: "pdf",
              text: "LABEL",
              bbox,
              ...(kind === "iso-cap-height-policy" ? { policySheet: 1 } : {}),
              identities: [
                {
                  coarse: false,
                  dq: "DQ-02",
                  family: "fixture",
                  kind,
                  locator: "text/LABEL",
                  check: "sheet",
                  sheet: "view:example",
                  medium: "pdf",
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const sha = hash(json(report)),
    t = instanceInventory(report, sha).instances[0],
    png = pngFixture(),
    path = "evals/out/draw-samples/pdf.png";
  const cropShape = {
    kind: "pdf-em-ink/1.0",
    inkBbox: bbox,
    marginPixels: 1,
    textItem: 0,
    operators: [1],
    fontPrograms: [hash("embedded")],
  };
  const row = instanceCropRow(
    {
      t,
      reportSha256: sha,
      sourceRef: pin,
      headerLines: cropHeader(t),
      cropShape,
    },
    path,
    png,
    pdfInkRegion(page, bbox, cropShape),
    Buffer.from("PDF"),
  );
  row.headerPixels = 0;
  const file = {
    format: "thermite-draw-decisions/1.0",
    summarySha256: sha,
    entries: [
      {
        reviewed: false,
        action: "new-defect",
        to: { markerId: t.markerId, scope: t.scope },
        instances: [t.token],
        crop: { path, sha256: hash(png) },
      },
    ],
  };
  const capture = {
    implementation: PDF_CAPTURE_IMPLEMENTATION,
    pdfjsVersion: version,
    platform: "synthetic",
    dpi: 300,
    useSystemFonts: false,
    isEvalSupported: false,
    externalResources: "deny",
  };
  const v = {
    ...sourceVerificationFixture(png),
    ...verificationFact(row, pin.sha256),
    capture,
  };
  return {
    report,
    sha,
    t,
    row,
    pin,
    file,
    v,
    png,
    index: { format: "thermite-draw-crop-index/3.0", crops: [row] },
    reports: new Map([[sha, report]]),
  };
}
