// Synthetic attestation metadata only; not a review or source-render claim.
import { SOURCE_HASH_FORMAT } from "./source-hashes.mjs";
import { hash } from "./support.mjs";
import { SOURCE_FORMAT } from "./crop-source-policy.mjs";
import { pngFixture } from "./png-fixture.mjs";
import { decodePng } from "./png-ink.mjs";
import { SOURCE_TOLERANCE } from "./crop-source-pixels.mjs";
import { CAPTURE_IMPLEMENTATION } from "./crop-attempts.mjs";
export function referenceFixture(bytes = pngFixture(), header = 0) {
  const p = decodePng(bytes);
  return pngFixture({
    width: p.width,
    height: p.height - header,
    pixel: (x, y) => [
      ...p.rgba.subarray(
        ((y + header) * p.width + x) * 4,
        ((y + header) * p.width + x) * 4 + 4,
      ),
    ],
  });
}
export function verificationFixtures(crops, rows = []) {
  const refs = new Map();
  for (const [path, bytes] of crops) {
    const png = referenceFixture(
      bytes,
      rows.find((r) => r.path === path)?.headerPixels ?? 0,
    );
    refs.set(hash(png), png);
  }
  return refs;
}
export const sourceGeometryFixture = () => ({
  instanceBbox: { x: 1, y: 1, w: 1, h: 1 },
  sourceBbox: { x: 0, y: 0, w: 3, h: 3 },
});
export const sourceVerificationFixture = (
  bytes = pngFixture(),
  header = 0,
) => ({
  format: SOURCE_FORMAT,
  sourceSha256: hash("synthetic SVG"),
  medium: "svg",
  sheet: 1,
  dpi: 300,
  ...sourceGeometryFixture(),
  capture: {
    implementation: CAPTURE_IMPLEMENTATION,
    browser: "synthetic",
    platform: "synthetic",
    args: [],
    deviceScaleFactor: 300 / 96,
  },
  maxAttempts: 3,
  limits: { ...SOURCE_TOLERANCE },
  selectedAttempt: 1,
  attempts: [
    {
      attempt: 1,
      previousSha256: null,
      referenceSha256: hash(referenceFixture(bytes, header)),
      stats: {
        pixels: decodePng(bytes).width * (decodePng(bytes).height - header),
        changed: 0,
        maximum: 0,
        absoluteError: 0,
      },
      verdict: "pass",
      reason: null,
    },
  ],
});

export function reportedSourceFixture(t, sha) {
  const bbox = t.bbox ?? sourceGeometryFixture().instanceBbox;
  return {
    ...sourceVerificationFixture(),
    sourceSha256: hash("source"),
    reportSha256: sha,
    token: t.token,
    markerId: t.markerId,
    scope: t.scope,
    row: t.row,
    text: t.facts.text,
    medium: t.scope.medium,
    sheet: t.physicalSheet,
    instanceBbox: bbox,
    sourceBbox: { x: bbox.x - 1, y: bbox.y - 1, w: bbox.w + 2, h: bbox.h + 2 },
    sourcePath:
      t.scope.medium === "html"
        ? `${t.scope.case}/packet.html.gz`
        : `${t.scope.case}/sheet-${String(t.physicalSheet).padStart(3, "0")}.svg`,
  };
}

export function withSourceHashFixtures(report) {
  const sheets = new Map();
  for (const r of report.results) {
    if (!r.case || !Number.isSafeInteger(r.sheet)) continue;
    sheets.set(JSON.stringify([r.case, r.sheet]), {
      case: r.case,
      sheet: r.sheet,
      svg: {
        path: `${r.case}/sheet-${String(r.sheet).padStart(3, "0")}.svg`,
        sha256: hash("source"),
      },
      html: { path: `${r.case}/packet.html.gz`, sha256: hash("source") },
    });
  }
  report.sourceHashes = {
    format: SOURCE_HASH_FORMAT,
    sheets: [...sheets.values()],
  };
  return report;
}
